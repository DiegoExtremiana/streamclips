import type { SubtitleStyleId } from '../../shared/subtitles';
import fs from 'node:fs';
import path from 'node:path';
import type { AutoNameResult, AutopilotSettings, OutputItem, VodJob, AutoRole } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { planEdit, planLong, withJoints, withMusic } from '../../shared/autoEdit';
import { buildProposal, dedupeProposals, parseThemes, THEME_SYSTEM, themePrompt, transcriptBlocks, type ThemeProposal, type ThemeUnit } from '../../shared/themes';
import { guessMood, MOOD_SYSTEM, moodPrompt, parseMood, type MusicMood } from '../../shared/music';
import { hasBackgroundSound } from '../services/music';
import { defaultStyle, type StyleProfile } from '../../shared/styleProfile';
import { dedupeTitles, isAutoNameable, isGenericAutoTitle, shortDescription, shortTitle, textOf, type Seg } from '../../shared/highlights';
import { judgeText, type Judged } from '../../shared/judge';
import { nextFreeSlot } from '../../shared/slots';
import { ChatBins } from '../services/chatlog';
import { CancelledError, isCancelled, withAbort } from '../services/abort';
import type { Range } from '../../shared/timeline';
import { type audioEnergy } from '../services/audioEnergy';
import { askJson, resolveModel, type LlmConfig } from '../services/llm';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import type { Notifier } from './notifier';
import type { TaskTracker } from './tasks';
import type { TranscriptService } from './transcripts';
import type { SpeakerService } from './speakers';
import type { ClipService } from './clips';
import type { CategoryService } from './categories';
import { categoryOf, hasCategoryLine, withCategoryLine } from '../../shared/categories';
import type { LibraryService } from './library';
import type { PublicationService } from './publications';
import { runPipeline } from './pipeline';
import { themeDescription } from './pipeline/render';
import type { Host, Titles } from './pipeline/context';

export interface AutopilotDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  tasks: TaskTracker;
  queue: SerialQueue;
  tools: () => ToolPaths;
  transcripts: TranscriptService;
  speakers: SpeakerService;
  clips: ClipService;
  categories: CategoryService;
  library: LibraryService;
  pubs: PublicationService;
  chatDir: string;
  /** Carpeta donde se guardan las valoraciones del modelo (para no repetirlas al regenerar un directo). */
  judgeDir?: string;
  /** Dónde se guardan las instantáneas de selección y las correcciones manuales de cada directo. */
  momentsDir?: string;
  /** Archivo con lo que el programa ha aprendido de tus decisiones al revisar momentos. */
  prefsFile?: string;
  /** Perfil de estilo del creador (silencios, etc.); sin él se usan los valores de la entrevista. */
  style?: () => StyleProfile;
  llmKey: () => string;
  /** IAs de apoyo (con clave en claro). */
  llmExtra?: () => { provider: Exclude<AutopilotSettings['llm']['provider'], 'none'>; model: string; apiKey: string }[];
  /** Solo pruebas. */
  llmBaseUrl?: string;
  llmFetch?: typeof fetch;
  energy?: typeof audioEnergy;
  now?: () => number;
  /** Vuelve a descargar el directo si se borró para liberar espacio. */
  restore?: (vodId: string) => Promise<string>;
  /** Borra del disco el directo completo; devuelve los bytes liberados. */
  discardSource?: (vodId: string) => number;
  /** Propuestas de vídeos temáticos pendientes de que elijas el formato (se guardan aparte). */
  themes?: { put: (vodId: string, proposals: ThemeProposal[]) => void; hasPending: (vodId: string) => boolean; pendingSpans: (vodId: string) => Range[] };
  /** Motor nocturno: devuelve el motivo si no hay tiempo para transcribir un directo de esta duración. */
  canTranscribe?: (durationSec: number) => string | null;
}



const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Cuando termina un directo y su VOD está descargado: lo transcribe, busca los mejores momentos y
 * monta resumen, vídeo principal y clips. Los deja pendientes de tu visto bueno (o los programa si lo desactivas).
 * Lo que decide los tramos son siempre las señales locales; el modelo de lenguaje solo pone títulos y descripciones.
 */
export class Autopilot implements Host {
  constructor(readonly d: AutopilotDeps) {}

  get cfg(): AutopilotSettings {
    return this.d.store.data.settings.autopilot;
  }
  private get now(): number {
    return (this.d.now ?? Date.now)();
  }

  mark(vod: VodJob, status: NonNullable<VodJob['autopilot']>['status'], note?: string): void {
    vod.autopilot = { status, ...(note ? { note } : {}), at: new Date(this.now).toISOString() };
    this.d.store.save();
    this.d.notifier.vod(vod);
    this.d.notifier.changed();
  }

  /** Lo llama el vigilante al terminar de descargar el VOD de un directo. */
  onLiveVod(vod: VodJob): void {
    if (!this.cfg.enabled) return;
    this.mark(vod, 'waiting', 'En cola para analizarse.');
    void this.run(vod.id).catch((e) => this.d.log.error('Piloto automático', e));
  }

  /**
   * Ejecuta todo el proceso sobre un VOD descargado. Una vez por VOD a la vez; con `restart` cancela el que esté en marcha
   * y empieza de nuevo (así nunca se queda bloqueado un análisis que se colgó).
   */
  async run(vodId: string, o: { restart?: boolean } = {}): Promise<VodJob> {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!vod) throw new Error('El VOD no existe.');
    const prev = this.running.get(vodId);
    if (prev) {
      if (!o.restart) throw new Error('El piloto automático ya está trabajando en este VOD.');
      prev.ctrl.abort();
      await prev.done.catch(() => undefined);
    }
    if (vod.status !== 'downloaded') throw new Error('El VOD todavía no está descargado.');
    const missing = !vod.filePath || !fs.existsSync(vod.filePath);
    if (missing && !(this.d.restore && vod.url && vod.origin !== 'clip')) throw new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).');
    const ctrl = new AbortController();
    this.mark(vod, 'waiting', missing ? 'Volviendo a descargar el directo para analizarlo…' : 'En cola para analizarse.');
    const done = this.d.queue.run(() =>
      withAbort(ctrl.signal, async () => {
        if (ctrl.signal.aborted) throw new CancelledError();
        if (missing) await this.d.restore!(vodId);
        return this.process(vod);
      }),
    );
    const entry = { ctrl, done };
    this.running.set(vodId, entry);
    // al terminar (bien, mal o cancelado) se libera, salvo que otra ejecución ya haya ocupado su sitio
    void done.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (this.running.get(vodId) === entry) this.running.delete(vodId);
      // pausado antes de empezar (esperando en la cola): el estado se ajusta aquí
      if (this.pauseRequested.delete(vodId) && vod.autopilot?.status === 'waiting') this.markPaused(vod);
    });
    return done;
  }
  private running = new Map<string, { ctrl: AbortController; done: Promise<VodJob> }>();

  /** ¿Se está analizando este VOD ahora mismo (no solo marcado como tal)? */
  isRunning(vodId: string): boolean {
    return this.running.has(vodId);
  }

  private pauseRequested = new Set<string>();

  /** Pausa el análisis: se detiene (Whisper y ffmpeg incluidos) conservando lo ya transcrito; «Reanudar» lo retoma. */
  pause(vodId: string): boolean {
    if (!this.running.has(vodId)) return false;
    this.pauseRequested.add(vodId);
    return this.cancel(vodId);
  }

  /** Detiene el análisis en marcha de un VOD (ffmpeg y Whisper incluidos). */
  cancel(vodId: string): boolean {
    const r = this.running.get(vodId);
    if (!r) return false;
    r.ctrl.abort();
    return true;
  }

  /** Al arrancar: un análisis que estaba a medias cuando se cerró el programa no sigue «en marcha»: se puede relanzar. */
  recoverInterrupted(): number {
    let n = 0;
    for (const v of this.d.store.data.vods) {
      const st = v.autopilot?.status;
      if (st && ['waiting', 'transcribing', 'analyzing', 'rendering'].includes(st) && !this.running.has(v.id)) {
        this.markPaused(v, true);
        n++;
      }
    }
    return n;
  }

  markPaused(vod: VodJob, interrupted = false): void {
    const kept = this.d.transcripts.hasCheckpoint(vod.id) ? ' Lo ya transcrito se conserva.' : '';
    this.mark(vod, 'paused', `${interrupted ? 'Se interrumpió al cerrar el programa o apagar el equipo.' : 'En pausa.'}${kept} Pulsa «Reanudar» cuando quieras.`);
  }

  /**
   * Borra el directo completo del disco y los datos que ya no sirven, dejando los vídeos y clips creados con sus
   * transcripciones (solo los tramos que usan). Si el directo hace falta más tarde se vuelve a descargar solo.
   */
  discard(vodId: string, o: { fromRun?: boolean } = {}): { freedBytes: number; kept: number } {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!vod) throw new Error('El VOD no existe.');
    if (!this.d.discardSource) throw new Error('No se puede borrar el directo en este momento.');
    if (!o.fromRun && this.running.has(vodId)) throw new Error('Se está analizando este directo; espera a que termine o cancélalo.');
    const outs = this.d.store.data.outputs.filter((x) => x.vodId === vodId);
    const spans: Range[] = [];
    let known = outs.length > 0;
    for (const x of outs) {
      if (x.kind === 'long' && x.segments?.length) spans.push(...x.segments);
      else if (x.start !== undefined && x.end !== undefined) spans.push({ start: x.start, end: x.end });
      else known = false; // un vídeo antiguo sin tramos guardados: no se sabe qué transcripción necesita
    }
    if (known) this.d.transcripts.prune(vodId, [...spans, ...(this.d.themes?.pendingSpans(vodId) ?? [])]);
    const chat = this.chatFileFor(vod);
    if (chat) fs.rmSync(chat, { force: true });
    const freedBytes = this.d.discardSource(vodId);
    return { freedBytes, kept: outs.length };
  }

  /** Archivo con la actividad del chat de este directo, si se guardó. */
  private chatFileFor(vod: VodJob): string | undefined {
    if (!vod.streamStartedAt || !fs.existsSync(this.d.chatDir)) return undefined;
    const start = Date.parse(vod.streamStartedAt);
    for (const f of fs.readdirSync(this.d.chatDir)) {
      try {
        const full = path.join(this.d.chatDir, f);
        const j = JSON.parse(fs.readFileSync(full, 'utf8')) as { startedAt: string; bins: number[] };
        // el VOD de Twitch empieza con el directo: unos segundos de diferencia como mucho
        if (Math.abs(Date.parse(j.startedAt) - start) < 5 * 60_000 && Array.isArray(j.bins)) return full;
      } catch {
        /* archivo de otro directo o dañado: se ignora */
      }
    }
    return undefined;
  }

  chatFor(vod: VodJob): number[] | undefined {
    const f = this.chatFileFor(vod);
    if (!f) return undefined;
    try {
      return ChatBins.fromArray((JSON.parse(fs.readFileSync(f, 'utf8')) as { bins: number[] }).bins).toArray();
    } catch {
      return undefined;
    }
  }

  /** Guarda los tiempos por fase de los últimos análisis (userData/analysis-times.json) para ver qué conviene acelerar. */
  recordTimes(vod: VodJob, phases: Record<string, number>, totalSec: number): void {
    if (!this.d.momentsDir) return;
    try {
      const file = path.join(path.dirname(this.d.momentsDir), 'analysis-times.json');
      let list: unknown[] = [];
      try {
        list = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown[];
      } catch {
        /* primer registro */
      }
      list.push({ at: new Date().toISOString(), vod: vod.title || vod.id, vodSec: vod.durationSec ?? null, totalSec, phases });
      fs.writeFileSync(file, JSON.stringify(list.slice(-40), null, 1));
    } catch {
      /* solo informativo */
    }
  }

  /** El análisis entero, por fases (electron/domain/pipeline). */
  private process(vod: VodJob): Promise<VodJob> {
    return runPipeline(this, vod, this.pauseRequested);
  }

  /** Configuración del modelo de lenguaje si hay uno elegido y con clave; si no, null. */
  /** ¿Está analizando algún directo? (El trabajo en segundo plano se aparta mientras tanto.) */
  isBusy(): boolean {
    return this.running.size > 0;
  }

  /** Perfil de estilo del creador (o los valores de la entrevista). */
  style(): StyleProfile {
    return this.d.style?.() ?? defaultStyle();
  }

  /** Modelo de lenguaje configurado (clave incluida), o null si no hay. */
  llmConf(): LlmConfig | null {
    const llm = this.cfg.llm;
    const key = this.d.llmKey();
    if (llm.provider === 'none' || !key) return null;
    const extra = (this.d.llmExtra?.() ?? []).map((x) => ({ provider: x.provider, model: resolveModel(x.provider, x.model), apiKey: x.apiKey, baseUrl: this.d.llmBaseUrl }));
    return { provider: llm.provider, model: resolveModel(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl, ...(extra.length ? { fallbacks: extra } : {}) };
  }

  async titles(vod: VodJob, words: Word[], moments: Seg[], mains: Seg[], notes: string[]): Promise<{ summary: Titles; mains: Titles[]; clips: Titles[] }> {
    const base = {
      summary: { title: `Resumen del directo - ${this.dateLabel(vod)}`, description: '' },
      mains: mains.map((m, i) => ({ title: clean(words.length ? shortTitle(words, m, i) : `Directo del ${this.dateLabel(vod)} (parte ${i + 1})`, 100), description: clean(shortDescription(words, m), 500) })),
      clips: moments.map((m, i) => ({ title: clean(words.length ? shortTitle(words, m, i) : `Momento ${i + 1}`, 100), description: clean(shortDescription(words, m), 500) })),
    };
    const uniq = () => {
      const u = dedupeTitles([...base.mains.map((t) => t.title), ...base.clips.map((t) => t.title)]);
      base.mains.forEach((t, i) => (t.title = u[i]));
      base.clips.forEach((t, i) => (t.title = u[base.mains.length + i]));
    };
    const llm = this.cfg.llm;
    const key = this.d.llmKey();
    if (llm.provider === 'none' || !key || !words.length) {
      if (llm.provider !== 'none' && !words.length) notes.push('Títulos sin modelo de lenguaje: no hay transcripción.');
      uniq();
      return base;
    }
    const conf: LlmConfig = { provider: llm.provider, model: resolveModel(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl };
    const items = [
      ...mains.map((m, i) => ({ id: `video${i + 1}`, texto: textOf(words, m.start, Math.min(m.end, m.start + 240), 900) })),
      ...moments.map((m, i) => ({ id: `clip${i + 1}`, texto: textOf(words, m.start, m.end, 600) })),
    ];
    try {
      const raw = (await askJson(
        conf,
        'Eres editor de contenido de un streamer que habla en español de España (castellano). Escribes en castellano de España, sin latinismos ni modismos de otros países. Escribes nombres muy cortos para cada fragmento (2 a 5 palabras, máximo 40 caracteres, que digan qué pasa en él, distintos entre sí, sin clickbait falso, sin emojis) y descripciones para YouTube de 1-3 frases (60 a 280 caracteres) que cuenten de qué trata y qué pasa, sin hashtags ni emojis ni enlaces. Responde SOLO con JSON.',
        `Estos son fragmentos transcritos de un directo. Devuelve {"resumen":{"titulo":"","descripcion":""},"videos":[{"id":"video1","titulo":"","descripcion":""}],"clips":[{"id":"clip1","titulo":"","descripcion":""}]}.\n"resumen" es el resumen de todo el directo (no tienes su texto: titúlalo a partir de los demás fragmentos). Fragmentos:\n${JSON.stringify(items)}`,
        { fetchFn: this.d.llmFetch },
      )) as { resumen?: Record<string, unknown>; videos?: Record<string, unknown>[]; clips?: Record<string, unknown>[] };
      const pick = (o: Record<string, unknown> | undefined, fb: Titles): Titles => ({ title: clean(o?.titulo, 100) || fb.title, description: clean(o?.descripcion, 500) || fb.description });
      base.summary = pick(raw.resumen, base.summary);
      const byVideo = new Map((Array.isArray(raw.videos) ? raw.videos : []).map((c) => [String(c.id), c]));
      base.mains = base.mains.map((fb, i) => pick(byVideo.get(`video${i + 1}`), fb));
      const byId = new Map((Array.isArray(raw.clips) ? raw.clips : []).map((c) => [String(c.id), c]));
      base.clips = base.clips.map((fb, i) => pick(byId.get(`clip${i + 1}`), fb));
    } catch (e) {
      notes.push(`Títulos sin modelo de lenguaje: ${(e as Error).message}`);
    }
    uniq();
    return base;
  }

  /**
   * Título provisional para un tramo (clip o vídeo) a partir de lo que se dice en él. Con un modelo de lenguaje configurado
   * lo redacta él; si no, sale de la frase más llamativa. Sin transcripción no hay de qué sacarlo y devuelve null.
   */
  async suggestTitle(vodId: string, start: number, end: number): Promise<{ title: string; source: 'llm' | 'transcript' } | null> {
    let failure: Error | null = null;
    await this.d.transcripts.ensure(vodId, [{ start, end }]).catch((e) => {
      failure = e as Error;
      this.d.log.warn(`Sin transcripción para sugerir título: ${failure.message.split('\n')[0]}`);
    });
    const r = await this.nameFor(vodId, [{ start, end }]);
    if (!r && failure) throw failure; // el motivo real (Whisper, modelo, VOD sin descargar…) llega a la pantalla
    return r && r.title ? { title: r.title, source: r.source } : null;
  }

  /**
   * Nombre corto y descripción de YouTube para uno o varios tramos de un VOD: con modelo de lenguaje los redacta él; si no,
   * salen de lo que se dice. Sin transcripción de esos tramos devuelve null.
   */
  private async nameFor(vodId: string, segs: Seg[]): Promise<{ title: string; description: string; source: 'llm' | 'transcript' } | null> {
    const words = this.d.transcripts.words(vodId);
    if (!words.some((w) => segs.some((g) => w.start >= g.start && w.end <= g.end + 0.5))) return null;
    const fbTitle = clean(shortTitle(words, segs, 0), 100);
    const fbDesc = clean(shortDescription(words, segs), 500);
    const local = { title: /^Momento \d+$/.test(fbTitle) ? '' : fbTitle, description: fbDesc, source: 'transcript' as const };
    const llm = this.cfg.llm;
    const key = this.d.llmKey();
    if (llm.provider !== 'none' && key) {
      try {
        const conf: LlmConfig = { provider: llm.provider, model: resolveModel(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl };
        const text = segs.map((g) => textOf(words, g.start, Math.min(g.end, g.start + 240), 900)).join(' / ').slice(0, 1400);
        const raw = (await askJson(
          conf,
          'Eres editor de contenido de un streamer que habla en español de España (castellano). Escribes en castellano de España. Para el fragmento escribes un nombre muy corto (2 a 5 palabras, máximo 40 caracteres, que diga qué pasa en él, sin clickbait falso, sin emojis) y una descripción para YouTube de 1 a 3 frases (60 a 280 caracteres) que cuente de qué trata y qué ocurre, sin hashtags, sin emojis y sin enlaces. Responde SOLO con JSON.',
          `Texto transcrito de un fragmento. Devuelve {"titulo":"","descripcion":""}.\n${text}`,
          { fetchFn: this.d.llmFetch },
        )) as { titulo?: unknown; descripcion?: unknown };
        const t = clean(raw.titulo, 100);
        const d = clean(raw.descripcion, 500);
        if (t || d) return { title: t || local.title, description: d || local.description, source: 'llm' };
      } catch {
        /* se usa lo local */
      }
    }
    return local.title || local.description ? local : null;
  }

  /**
   * Pone un nombre corto y, si no la tiene, una descripción de YouTube a los clips y vídeos de la Biblioteca (con `onlyVodId`,
   * solo a los de ese VOD). No toca lo que escribió el usuario ni los nombres que ya son cortos. Evita repetir nombres.
   * `generic`: regla del arranque, solo se renombran los nombres genéricos («Momento 3», «Directo del…», «Resumen del directo…»).
   */
  async autoNameLibrary(onlyVodId?: string, o2: { generic?: boolean } = {}): Promise<AutoNameResult> {
    const res: AutoNameResult = { renamed: 0, described: 0, noTranscript: 0, kept: 0 };
    const outs = this.d.store.data.outputs;
    const used = new Set(outs.map((o) => o.title.toLowerCase()));
    for (const o of outs) {
      if (onlyVodId && o.vodId !== onlyVodId) continue;
      // categoría de Twitch del momento (también para lo que ya existía) y su línea en la descripción hecha por el programa
      if (o.vodId && !o.category) {
        const segs: Seg[] = o.kind === 'long' ? (o.segments ?? []) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : [];
        const cat = segs.length ? categoryOf(await this.d.categories.ensure(o.vodId), segs) : undefined;
        if (cat) o.category = cat;
      }
      if (o.category && o.descSource === 'auto' && o.description && !hasCategoryLine(o.description)) this.d.library.setAutoDescription(o.id, withCategoryLine(o.description, o.category));
      const wantTitle = o2.generic ? isGenericAutoTitle(o) : isAutoNameable(o);
      const wantDesc = o.descSource !== 'manual' && !withCategoryLine(o.description, undefined);
      if (!wantTitle && !wantDesc) {
        res.kept++;
        continue;
      }
      const segs: Seg[] | null = o.kind === 'long' ? (o.segments?.length ? o.segments.map((g) => ({ start: g.start, end: g.end })) : null) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : null;
      const r = o.vodId && segs ? await this.nameFor(o.vodId, segs) : null;
      if (!r) {
        res.noTranscript++;
        continue;
      }
      if (wantDesc && r.description) {
        try {
          this.d.library.setAutoDescription(o.id, withCategoryLine(r.description, o.category));
          res.described++;
        } catch (e) {
          this.d.log.warn(`No se pudo poner descripción a "${o.title}": ${(e as Error).message}`);
        }
      }
      if (!wantTitle || !r.title) {
        res.kept++;
        continue;
      }
      let t = r.title;
      if (t.toLowerCase() === o.title.toLowerCase()) {
        o.titleSource = 'auto';
        res.kept++;
        continue;
      }
      for (let n = 2; used.has(t.toLowerCase()); n++) t = `${r.title} ${n}`;
      used.delete(o.title.toLowerCase());
      used.add(t.toLowerCase());
      try {
        this.d.library.setAutoTitle(o.id, t);
        res.renamed++;
      } catch (e) {
        this.d.log.warn(`No se pudo renombrar "${o.title}": ${(e as Error).message}`);
      }
    }
    if (res.renamed || res.described) this.d.log.info(`Nombres y descripciones automáticos: ${res.renamed} nombre(s), ${res.described} descripción(es)`);
    return res;
  }

  /**
   * Al abrir el programa: revisa la Biblioteca y, a los clips y vídeos que siguen con un nombre genérico (o sin descripción)
   * y no son del usuario, les pone nombre y descripción según de qué se habla. Si el VOD no tiene transcripción y está
   * descargado, la hace antes con Whisper (una por VOD, una detrás de otra). Nunca lanza: lo que falle se anota en el registro.
   */
  async refreshLibraryAtStart(o3: { generic?: boolean } = {}): Promise<AutoNameResult | null> {
    const generic = o3.generic ?? true;
    try {
      const need = this.d.store.data.outputs.filter((o) => o.vodId && ((generic ? isGenericAutoTitle(o) : isAutoNameable(o)) || (o.descSource !== 'manual' && !withCategoryLine(o.description, undefined))));
      if (!need.length) return null;
      // se transcribe solo lo de cada clip o vídeo (sus tramos), no el directo entero
      const failed = new Set<string>();
      for (const o of need) {
        const id = o.vodId as string;
        if (failed.has(id)) continue;
        const vod = this.d.store.data.vods.find((v) => v.id === id);
        if (!vod || vod.status !== 'downloaded' || !vod.filePath || !fs.existsSync(vod.filePath)) continue;
        if (!this.d.transcripts.status().engine) break; // sin Whisper no se puede transcribir
        const segs: Seg[] = o.kind === 'long' ? (o.segments ?? []) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : [];
        if (!segs.length) continue;
        try {
          await this.d.transcripts.ensure(id, segs);
        } catch (e) {
          failed.add(id);
          this.d.log.warn(`Nombres automáticos: no se pudo transcribir "${o.title}": ${(e as Error).message.split('\n')[0]}`);
        }
      }
      return await this.autoNameLibrary(undefined, { generic });
    } catch (e) {
      this.d.log.warn(`Nombres automáticos al arrancar: ${(e as Error).message}`);
      return null;
    }
  }

  private dateLabel(vod: VodJob): string {
    const d = new Date(vod.streamStartedAt ?? vod.createdAt);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }

  /** Música de fondo si el vídeo no tiene ya sonido de fondo; el ambiente sale del tema (con modelo si `smart`, si no por palabras). */
  async musicFor(vod: VodJob, words: Word[], title: string, segs: Seg[], smart: boolean, llmConf: LlmConfig | null | undefined): Promise<MusicMood | null> {
    if (this.cfg.music === false || !vod.filePath || !fs.existsSync(vod.filePath)) return null;
    try {
      const inside = words.filter((w) => segs.some((g) => w.start >= g.start && w.end <= g.end + 0.25)).sort((a, b) => a.start - b.start);
      const gaps: Range[] = [];
      for (let i = 0; i + 1 < inside.length; i++) if (inside[i + 1].start - inside[i].end >= 0.8) gaps.push({ start: inside[i].end, end: inside[i + 1].start });
      const step = Math.max(1, Math.floor(gaps.length / 6));
      if (await hasBackgroundSound(this.d.tools(), vod.filePath, gaps.filter((_, i) => i % step === 0))) return null;
      const text = inside.map((w) => w.text).join(' ');
      let mood = guessMood(`${title} ${text}`);
      if (smart && llmConf) {
        try {
          mood = parseMood(await askJson(llmConf, MOOD_SYSTEM, moodPrompt(title, text), { fetchFn: this.d.llmFetch, temperature: 0.2 })) ?? mood;
        } catch (err) {
          if (isCancelled(err)) throw err;
        }
      }
      return mood;
    } catch (err) {
      if (isCancelled(err)) throw err;
      this.d.log.warn(`Sin música en "${title}": ${(err as Error).message.split('\n')[0]}`);
      return null;
    }
  }

  /** Un corto temático: un tramo continuo con la edición profesional (cortes, sonidos, música) y, si falla, sin ella. */
  async makeShort(vodId: string, words: Word[], llmConf: LlmConfig | null | undefined, title: string, seg: Seg, subs: { subtitles?: SubtitleStyleId }): Promise<OutputItem> {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId)!;
    const style = this.d.style?.() ?? defaultStyle();
    let e = this.cfg.proEdit !== false && words.length ? planEdit(words, seg, { minGap: style.silenceMaxSec, cues: this.cfg.soundCues !== false }) : null;
    const mood = e ? await this.musicFor(vod, words, title, [seg], false, llmConf) : null;
    if (e && mood) e = { ...e, effects: withMusic(e.effects, mood) };
    if (e) {
      try {
        return await this.d.clips.createClip(vodId, { start: seg.start, end: seg.end, title, cuts: e.cuts, effects: e.effects, ...subs });
      } catch (err) {
        if (isCancelled(err)) throw err;
        this.d.log.warn(`Edición profesional falló en un corto temático, se monta sin ella: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    return this.d.clips.createClip(vodId, { start: seg.start, end: seg.end, title, ...subs });
  }

  /**
   * Busca temas con el modelo: lee los momentos valorados y la charla con contenido, agrupa por significado, construye cada propuesta
   * y descarta las que repiten lo ya generado. Sin material suficiente no devuelve nada: no se fuerza ningún vídeo.
   */
  async findThemes(vod: VodJob, judged: Judged[], words: Word[], conf: LlmConfig, notes: string[], o: { chars?: number; minLongSec?: number; hardCapSec?: number } = {}): Promise<ThemeProposal[]> {
    const chars = o.chars ?? 380;
    const cand = judged.filter((j) => !j.judgement.discard && j.total >= 3).sort((a, b) => b.total - a.total).slice(0, 36);
    const units: ThemeUnit[] = cand.map((c) => ({ id: c.id, start: (c.judgement.trim ?? c).start, end: (c.judgement.trim ?? c).end, text: judgeText(words, c.judgement.trim ?? c, chars), title: c.judgement.title, total: c.total }));
    const blocks = transcriptBlocks(words, cand).slice(0, 20);
    blocks.forEach((b, i) => units.push({ id: `b${i}`, start: b.start, end: b.end, text: judgeText(words, b, 380), total: 5 }));
    units.sort((a, b) => a.start - b.start);
    if (units.length < 4) return [];
    try {
      const raw = await askJson(conf, THEME_SYSTEM, themePrompt(units), { fetchFn: this.d.llmFetch, temperature: 0.2 });
      const built = parseThemes(raw, new Set(units.map((u) => u.id)))
        .map((t) => buildProposal(t, units, vod.id, { targetSec: this.cfg.mainMinutes * 60, ...(o.minLongSec ? { minLongSec: o.minLongSec } : {}), ...(o.hardCapSec ? { hardCapSec: o.hardCapSec } : {}) }))
        .filter((p): p is ThemeProposal => Boolean(p));
      const existing = this.d.store.data.outputs
        .filter((x) => x.vodId === vod.id && x.auto?.review !== 'pending')
        .map((x) => (x.segments?.length ? x.segments : x.start !== undefined && x.end !== undefined ? [{ start: x.start, end: x.end }] : []))
        .filter((x) => x.length);
      const { kept, dropped } = dedupeProposals(built, existing);
      const top = kept.slice(0, 3);
      notes.push(top.length ? `Edición temática: ${top.map((p) => `«${p.title}» (${p.pieces.length} fragmentos${p.long.sec ? `, ${Math.round(p.long.sec / 60)} min` : ''})`).join(', ')}${dropped ? `; ${dropped} descartado(s) por repetir lo ya hecho` : ''}.` : 'Edición temática: ningún tema con material suficiente para un vídeo con sentido.');
      return top;
    } catch (e) {
      if (isCancelled(e)) throw e;
      notes.push(`Edición temática no disponible (${(e as Error).message.split('\n')[0]}).`);
      return [];
    }
  }

  /** Crea lo que elegiste en la ventana: el vídeo largo o los cortos del tema. Si el directo se borró, se vuelve a bajar. */
  async makeTheme(proposal: ThemeProposal, format: 'long' | 'shorts'): Promise<OutputItem[]> {
    const vod = this.d.store.data.vods.find((v) => v.id === proposal.vodId);
    if (!vod) throw new Error('El directo de este tema ya no está en el programa.');
    const spans = [...proposal.pieces.map((p) => ({ start: p.start, end: p.end }))];
    await this.d.transcripts.ensure(vod.id, spans).catch((e) => this.d.log.warn(`Transcripción del tema: ${(e as Error).message}`));
    if (!vod.filePath || !fs.existsSync(vod.filePath)) await this.d.restore?.(vod.id);
    const words = this.d.transcripts.words(vod.id);
    const llmConf = this.llmConf();
    const subs = this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {};
    const made: OutputItem[] = [];
    const finish = (item: OutputItem, role: AutoRole, title: string, description: string, reason: string) => {
      item.auto = { role, review: 'pending', score: 8, kind: 'tema', reason: reason.slice(0, 200) };
      item.titleSource = 'auto';
      item.visibility = this.cfg.visibility;
      this.d.library.setAutoDescription(item.id, withCategoryLine(description, item.category));
      this.d.store.save();
      if (!this.cfg.requireApproval) {
        try {
          this.approve(item.id);
        } catch (e) {
          this.d.log.warn(`${title}: ${(e as Error).message}`);
        }
      }
      made.push(item);
    };
    if (format === 'long') {
      const style = this.d.style?.() ?? defaultStyle();
      const segs = proposal.long.segs;
      let e = this.cfg.proEdit !== false && words.length ? planLong(words, segs, { minGap: style.silenceMaxSec, cues: this.cfg.soundCues !== false }) : null;
      if (e) e = { ...e, effects: withJoints(e.effects) };
      const mood = e ? await this.musicFor(vod, words, proposal.title, segs, true, llmConf) : null;
      if (e && mood) e = { ...e, effects: withMusic(e.effects, mood) };
      const title = clean(proposal.title, 100);
      let item: OutputItem;
      try {
        item = e ? await this.d.clips.createLong(vod.id, { title, segments: e.segments, effects: e.effects, ...subs }) : await this.d.clips.createLong(vod.id, { title, segments: segs, ...subs });
      } catch (err) {
        if (!e || isCancelled(err)) throw err;
        item = await this.d.clips.createLong(vod.id, { title, segments: segs, ...subs });
      }
      finish(item, 'main', title, themeDescription(proposal), `Tema: ${proposal.context || proposal.title}`);
    } else {
      for (const sh of proposal.shorts) {
        const item = await this.makeShort(vod.id, words, llmConf, sh.title, sh.segs[0], subs);
        finish(item, 'clip', sh.title, proposal.context, `Parte del tema «${proposal.title}».`);
      }
    }
    this.d.notifier.changed();
    return made;
  }

  /** Visto bueno: programa el vídeo en su hora en las redes elegidas. */
  approve(outputId: string): OutputItem {
    const o = this.d.store.data.outputs.find((x) => x.id === outputId);
    if (!o) throw new Error('El vídeo no existe.');
    const role = o.auto?.role ?? (o.kind === 'long' ? 'main' : 'clip');
    // TikTok e Instagram solo admiten clips: los vídeos largos van solo a YouTube
    const platforms = role === 'clip' ? this.cfg.platforms : this.cfg.platforms.filter((p) => p === 'youtube');
    if (!platforms.length) {
      throw new Error(role === 'clip' ? 'Elige en Ajustes en qué redes se publica lo automático.' : 'Los vídeos largos solo se publican en YouTube: actívalo en Ajustes > Piloto automático.');
    }
    const taken = new Set(this.d.store.data.publications.filter((p) => p.status !== 'failed').map((p) => Date.parse(p.scheduledAt)));
    const now = new Date(this.now + 5 * 60_000);
    // cada hora configurada es un hueco al día: los vídeos van a los de vídeos y los clips a los de clips
    const at = nextFreeSlot(now, role === 'clip' ? this.cfg.clipTimes : this.cfg.videoTimes, taken);
    this.d.pubs.schedule(outputId, platforms, at.toISOString());
    o.auto = { role, review: 'approved' };
    this.d.store.save();
    this.d.notifier.changed();
    return o;
  }
}

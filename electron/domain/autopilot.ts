import fs from 'node:fs';
import path from 'node:path';
import type { AutoNameResult, AutopilotSettings, OutputItem, VodJob, AutoRole } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { planEdit, planLong } from '../../shared/autoEdit';
import { bestStretches, buildSummary, dedupeTitles, findMoments, isAutoNameable, isGenericAutoTitle, shortDescription, shortTitle, textOf, type Seg, type Signals } from '../../shared/highlights';
import { nextFreeSlot } from '../../shared/slots';
import { seriesFor, seriesTitles } from '../../shared/series';
import { ChatBins } from '../services/chatlog';
import { CancelledError, isCancelled, throwIfCancelled, withAbort } from '../services/abort';
import type { Range } from '../../shared/timeline';
import { audioEnergy } from '../services/audioEnergy';
import { LLM_PROVIDERS, askJson, type LlmConfig } from '../services/llm';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import type { Notifier } from './notifier';
import type { TaskTracker } from './tasks';
import type { TranscriptService } from './transcripts';
import type { ClipService } from './clips';
import type { CategoryService } from './categories';
import { categoryOf, dominantCategory, fitToCategory, hasCategoryLine, withCategoryLine } from '../../shared/categories';
import type { LibraryService } from './library';
import type { PublicationService } from './publications';

export interface AutopilotDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  tasks: TaskTracker;
  queue: SerialQueue;
  tools: () => ToolPaths;
  transcripts: TranscriptService;
  clips: ClipService;
  categories: CategoryService;
  library: LibraryService;
  pubs: PublicationService;
  chatDir: string;
  llmKey: () => string;
  /** Solo pruebas. */
  llmBaseUrl?: string;
  llmFetch?: typeof fetch;
  energy?: typeof audioEnergy;
  now?: () => number;
  /** Vuelve a descargar el directo si se borró para liberar espacio. */
  restore?: (vodId: string) => Promise<string>;
  /** Borra del disco el directo completo; devuelve los bytes liberados. */
  discardSource?: (vodId: string) => number;
  /** Motor nocturno: devuelve el motivo si no hay tiempo para transcribir un directo de esta duración. */
  canTranscribe?: (durationSec: number) => string | null;
}

interface Titles {
  title: string;
  description: string;
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Cuando termina un directo y su VOD está descargado: lo transcribe, busca los mejores momentos y
 * monta resumen, vídeo principal y clips. Los deja pendientes de tu visto bueno (o los programa si lo desactivas).
 * Lo que decide los tramos son siempre las señales locales; el modelo de lenguaje solo pone títulos y descripciones.
 */
export class Autopilot {
  constructor(private d: AutopilotDeps) {}

  private get cfg(): AutopilotSettings {
    return this.d.store.data.settings.autopilot;
  }
  private get now(): number {
    return (this.d.now ?? Date.now)();
  }

  private mark(vod: VodJob, status: NonNullable<VodJob['autopilot']>['status'], note?: string): void {
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

  private markPaused(vod: VodJob, interrupted = false): void {
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
    if (known) this.d.transcripts.prune(vodId, spans);
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

  private chatFor(vod: VodJob): number[] | undefined {
    const f = this.chatFileFor(vod);
    if (!f) return undefined;
    try {
      return ChatBins.fromArray((JSON.parse(fs.readFileSync(f, 'utf8')) as { bins: number[] }).bins).toArray();
    } catch {
      return undefined;
    }
  }

  private async process(vod: VodJob): Promise<VodJob> {
    const task = this.d.tasks.start('analyze', `Piloto automático: ${vod.title || 'directo'}`, vod.id);
    const notes: string[] = [];
    try {
      const t0 = Date.now();
      const lap = (since: number) => {
        const s = Math.round((Date.now() - since) / 1000);
        return s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`;
      };
      // El volumen del audio no depende de la transcripción: se calcula a la vez (ffmpeg y Whisper no se estorban) y se recoge después.
      const energyJob = (async () => {
        try {
          return { v: await (this.d.energy ?? audioEnergy)(this.d.tools(), vod.filePath!, () => undefined) };
        } catch (e) {
          return { e };
        }
      })();
      // 1) transcripción (si se puede)
      let words = this.d.transcripts.words(vod.id);
      let tTranscribe = '';
      if (!this.d.transcripts.isFull(vod.id)) {
        const st = this.d.transcripts.status();
        const skip = st.engine && this.d.canTranscribe ? this.d.canTranscribe(vod.durationSec ?? (await this.d.clips.vodDuration(vod.id))) : null;
        if (skip) notes.push(`Sin transcripción: ${skip}.`);
        else if (st.engine) {
          this.mark(vod, 'transcribing');
          task.update(2, 'Transcribiendo el directo (puede tardar)…');
          try {
            const ts = Date.now();
            // la transcripción ocupa del 2 % al 30 % de la barra del análisis (y es casi todo el tiempo)
            await this.d.transcripts.transcribe(vod.id, undefined, {
              onProgress: (pct, detail) => task.update(2 + pct * 0.28, detail ? `Transcribiendo (${detail})…` : undefined),
              onEstimate: (sec) => task.estimate(sec / 0.28),
            });
            words = this.d.transcripts.words(vod.id);
            tTranscribe = lap(ts);
            const mins = (vod.durationSec ?? 0) / 60;
            this.d.log.info(`Transcripción de "${vod.title}": ${tTranscribe}${mins ? ` (${(mins / Math.max(0.05, (Date.now() - ts) / 60000)).toFixed(1)}× tiempo real)` : ''}`);
          } catch (e) {
            if (isCancelled(e)) throw e;
            notes.push(`Sin transcripción: ${(e as Error).message}`);
          }
        } else notes.push('Sin transcripción: Whisper no está disponible.');
      }

      // 2) señales
      this.mark(vod, 'analyzing');
      task.update(30, 'Analizando audio y chat…');
      const duration = await this.d.clips.vodDuration(vod.id);
      let energyDb: number[] | undefined;
      const er = await energyJob;
      if ('v' in er) energyDb = er.v;
      else {
        if (isCancelled(er.e)) throw er.e;
        notes.push(`Sin análisis de volumen: ${(er.e as Error).message}`);
      }
      task.update(50);
      throwIfCancelled();
      const chat = this.chatFor(vod);
      if (!chat && this.cfg.chatCapture) notes.push('Sin datos de chat de este directo.');
      const sig: Signals = { durationSec: duration, energyDb, chat, words: words.length ? words : undefined };
      if (!energyDb && !chat && !words.length) throw new Error('No hay ninguna señal para analizar (ni audio, ni chat, ni transcripción).');

      // 3) tramos
      let moments = this.cfg.maxClips > 0 ? findMoments(sig, { count: this.cfg.maxClips }) : [];
      let summary = buildSummary(sig, { minSec: this.cfg.summaryMinutes * 60 * 0.85, maxSec: this.cfg.summaryMinutes * 60 * 1.25 });
      // el resumen cuenta como uno de los vídeos del directo; el resto son tramos continuos distintos
      let mains = this.cfg.maxVideos > 1 ? bestStretches(sig, this.cfg.mainMinutes * 60, this.cfg.maxVideos - 1) : [];
      if (!this.cfg.maxVideos) summary.length = 0;
      // Cada clip y cada vídeo es de una sola categoría de Twitch: se recorta a la del momento y lo que no cabe se descarta.
      const cats = await this.d.categories.ensure(vod.id);
      if (new Set(cats.map((c) => c.title)).size > 1) {
        const before = moments.length + mains.length;
        moments = moments.flatMap((m) => {
          const f = fitToCategory(m, cats, 15);
          return f ? [{ ...m, start: f.start, end: f.end }] : [];
        });
        mains = mains.flatMap((m) => {
          const f = fitToCategory(m, cats, 90);
          return f ? [f] : [];
        });
        const dom = dominantCategory(summary, cats, 8);
        if (dom.category && dom.segs.length !== summary.length) notes.push(`Resumen solo de la categoría «${dom.category}».`);
        summary = dom.segs;
        if (before !== moments.length + mains.length) notes.push('Algunos momentos se recortaron o descartaron para no mezclar categorías.');
      }
      if (!moments.length && !summary.length && !mains.length) {
        this.mark(vod, 'skipped', ['No se encontraron momentos que destaquen en este directo.', ...notes].join(' '));
        task.done('Sin momentos destacados');
        return vod;
      }

      // 4) títulos
      task.update(55, 'Poniendo títulos…');
      const titles = await this.titles(vod, words, moments, mains, notes);
      // serie de varios días: «Minecraft extremo Día 1»; el tema concreto de cada vídeo pasa a la descripción
      const ser = this.cfg.maxVideos > 0 ? seriesFor(vod.title ?? '', { ...this.cfg.series, nextDay: vod.seriesDay ?? this.cfg.series.nextDay }) : null;
      if (ser) {
        const st = seriesTitles(ser, mains.length);
        titles.summary = { title: clean(st.summary, 100), description: titles.summary.description };
        titles.mains = titles.mains.map((t, i) => ({ title: clean(st.mains[i], 100), description: t.description || `En este vídeo: ${t.title}` }));
        notes.push(`Serie «${ser.name}», día ${ser.day}.`);
        if (!ser.fromTitle) {
          // el día se reserva ya: con varios directos a la vez, dos no pueden coger el mismo número; al repetir este directo conserva el suyo
          vod.seriesDay = ser.day;
          this.cfg.series.nextDay = Math.max(this.cfg.series.nextDay, ser.day + 1);
          this.d.store.save();
        }
      }

      // 5) montaje
      const tr = Date.now();
      this.mark(vod, 'rendering');
      const created: OutputItem[] = [];
      const errors: string[] = [];
      const total = (summary.length ? 1 : 0) + mains.length + moments.length;
      let doneCount = 0;
      const step = async (role: AutoRole, label: string, fn: () => Promise<OutputItem>, t: Titles) => {
        try {
          const item = await fn();
          item.auto = { role, review: 'pending' };
          item.titleSource = 'auto';
          item.visibility = this.cfg.visibility;
          if (t.description || item.category) this.d.library.setAutoDescription(item.id, withCategoryLine(t.description, item.category));
          this.d.store.save();
          created.push(item);
        } catch (e) {
          if (isCancelled(e)) throw e;
          errors.push(`${label}: ${(e as Error).message}`);
        }
        task.update(55 + (++doneCount / total) * 40, `Montando (${doneCount}/${total})…`);
      };
      const pro = this.cfg.proEdit !== false && words.length > 0;
      if (this.cfg.proEdit !== false && !words.length) notes.push('Edición profesional omitida: no hay transcripción.');
      const subs = this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {};
      // si la edición profesional falla (efecto no válido, ffmpeg…), el vídeo se monta igualmente sin ella
      const safely = async <T>(edited: boolean, withEdit: () => Promise<T>, plain: () => Promise<T>): Promise<T> => {
        if (!edited) return plain();
        try {
          return await withEdit();
        } catch (err) {
          if (isCancelled(err)) throw err;
          this.d.log.warn(`Edición profesional falló, se monta sin ella: ${(err as Error).message.split('\n')[0]}`);
          return plain();
        }
      };
      const longMake = (title: string, segs: Seg[]) => {
        const e = pro ? planLong(words, segs) : null;
        return safely(
          Boolean(e),
          () => this.d.clips.createLong(vod.id, { title, segments: e!.segments, effects: e!.effects, ...subs }),
          () => this.d.clips.createLong(vod.id, { title, segments: segs, ...subs }),
        );
      };
      if (summary.length) await step('summary', 'resumen', () => longMake(titles.summary.title, summary), titles.summary);
      for (const [i, m] of mains.entries()) {
        const t = titles.mains[i];
        await step('main', `vídeo ${i + 1}`, () => longMake(t.title, [m]), t);
      }
      for (const [i, m] of moments.entries()) {
        const t = titles.clips[i];
        const e = pro ? planEdit(words, m) : null;
        await step('clip', `clip ${i + 1}`, () => safely(Boolean(e), () => this.d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, cuts: e!.cuts, effects: e!.effects, ...subs }), () => this.d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, ...subs })), t);
      }
      if (!created.length) throw new Error(`No se pudo montar ningún vídeo. ${errors.join(' ')}`);

      // un análisis repetido sustituye a los vídeos del anterior que seguían pendientes de revisión (sin publicar ni tocar por ti)
      const prior = this.d.store.data.outputs.filter(
        (x) => x.vodId === vod.id && x.auto?.review === 'pending' && !created.includes(x) && x.titleSource !== 'manual' && x.descSource !== 'manual' && !this.d.store.data.publications.some((p) => p.outputId === x.id),
      );
      if (prior.length) {
        const r = this.d.library.removeMany(prior.map((x) => x.id));
        if (r.removed) notes.push(`Se sustituyeron ${r.removed} vídeo(s) pendientes de revisión de un análisis anterior.`);
      }

      // 6) visto bueno o programación
      let scheduled = 0;
      if (!this.cfg.requireApproval) {
        for (const o of created) {
          try {
            this.approve(o.id);
            scheduled++;
          } catch (e) {
            errors.push(`${o.title}: ${(e as Error).message}`); // se queda para revisar a mano
          }
        }
      }
      // ya están los vídeos y los clips: el directo completo y lo que solo servía para sacarlos se borra
      if (this.cfg.cleanup !== false && this.d.discardSource) {
        try {
          const r = this.discard(vod.id, { fromRun: true });
          notes.push(`Directo completo borrado del disco (${(r.freedBytes / 1024 ** 3).toFixed(1)} GB liberados); se conservan ${r.kept} vídeo(s) y clip(s) con sus transcripciones.`);
        } catch (e) {
          notes.push(`No se pudo borrar el directo completo: ${(e as Error).message}`);
        }
      }
      notes.push(`Tiempos: ${tTranscribe ? `transcripción ${tTranscribe}, ` : ''}montaje ${lap(tr)}, total ${lap(t0)}.`);
      this.d.log.info(`Análisis de "${vod.title}": ${notes[notes.length - 1]}`);
      const msg = `${created.length} vídeo(s) listos${this.cfg.requireApproval ? ' para revisar' : ` (${scheduled} programados)`}.`;
      this.mark(vod, 'done', [msg, ...errors, ...notes].join(' '));
      task.done(msg);
      return vod;
    } catch (e) {
      if (isCancelled(e)) {
        const paused = this.pauseRequested.delete(vod.id);
        if (paused) this.markPaused(vod);
        else this.mark(vod, 'error', 'Análisis cancelado.');
        task.fail(paused ? 'En pausa' : 'Cancelado');
        this.d.log.info(`Análisis ${paused ? 'en pausa' : 'cancelado'}: "${vod.title}".`);
        throw e;
      }
      this.mark(vod, 'error', (e as Error).message);
      task.fail((e as Error).message);
      this.d.log.error('Piloto automático fallido', e);
      throw e;
    }
  }

  private async titles(vod: VodJob, words: Word[], moments: Seg[], mains: Seg[], notes: string[]) {
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
    const conf: LlmConfig = { provider: llm.provider, model: llm.model || LLM_PROVIDERS[llm.provider].defaultModel, apiKey: key, baseUrl: this.d.llmBaseUrl };
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
        const conf: LlmConfig = { provider: llm.provider, model: llm.model || LLM_PROVIDERS[llm.provider].defaultModel, apiKey: key, baseUrl: this.d.llmBaseUrl };
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

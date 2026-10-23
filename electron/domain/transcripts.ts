import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TranscriptInfo, VodJob, WhisperStatus } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import type { Range } from '../../shared/timeline';
import { parseTranscript } from '../../shared/transcript';
import { applyVocabulary, cleanVocabulary, learnCorrections, mergeCorrections, normToken, whisperPrompt, type Vocabulary } from '../../shared/vocab';
import { applyLineChanges, type LineChange } from '../../shared/subtitleEdit';
import { looksLikePokemon, POKEMON_PROMPT_TERMS } from '../../shared/vocabPokemon';
import { buildClaudePrompt } from '../../shared/claudePrompt';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import { WHISPER_MODELS, downloadModel, ggmlProblem, isKnownModel, modelInstalled, modelPath, transcribeVideo } from '../services/whisper';
import type { TaskTracker } from './tasks';
import type { SerialQueue } from '../services/queue';
import type { Notifier } from './notifier';

const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

export interface TranscriptDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  /** Cola propia: transcribir puede tardar mucho y no debe bloquear los renders. */
  queue: SerialQueue;
  /** Transcripciones a la vez: se reparten los núcleos entre ellas. */
  concurrency?: () => number;
  tools: () => ToolPaths;
  tasks: TaskTracker;
  /** Ruta a whisper-cli (la de Ajustes o la incluida); null si no hay. */
  whisperExe: () => string | null;
  /** Solo para pruebas: servidor desde el que se descargan los modelos. */
  modelBaseUrl?: string;
  /** Ruta del archivo del directo, volviéndolo a descargar si se borró para liberar espacio. */
  source?: (vodId: string) => Promise<string>;
}

/** Transcripciones por VOD: se importan (JSON, SRT, VTT) o se generan con Whisper si está configurado. */
export class TranscriptService {
  private dir: string;
  /** Lo llama al guardar una transcripción nueva (p. ej. para poner nombres cortos a lo ya creado). */
  onSaved?: (vodId: string) => void;

  constructor(private d: TranscriptDeps) {
    this.dir = path.join(path.dirname(d.store.file), 'transcripts');
  }

  private vod(vodId: string): VodJob {
    const v = this.d.store.data.vods.find((x) => x.id === vodId);
    if (!v) throw new Error('El VOD no existe.');
    return v;
  }

  private file(vodId: string): string {
    return path.join(this.dir, `${vodId.replace(/[^\w-]/g, '_')}.json`);
  }

  /** Versión del vocabulario: sube al cambiarlo, para descartar lo que ya se había corregido. */
  private vocabVersion = 0;
  private corrected = new Map<string, { key: string; words: Word[] }>();

  /** Palabras propias y correcciones aprendidas. */
  vocabulary(): Vocabulary {
    return this.d.store.data.vocab;
  }

  setVocabulary(v: unknown): Vocabulary {
    this.d.store.data.vocab = cleanVocabulary(v);
    this.vocabVersion++;
    this.d.store.save();
    this.d.notifier.changed();
    return this.d.store.data.vocab;
  }

  /**
   * Palabras guardadas con el vocabulario aplicado (lo guardado en disco no se toca, así que lo que se aprenda
   * mañana también corrige las transcripciones de hoy). Vacío si no hay transcripción o no se puede leer.
   */
  words(vodId: string): Word[] {
    const raw = this.raw(vodId).words;
    const v = this.vocabulary();
    if (!raw.length || (!v.terms.length && !v.corrections.length)) return raw;
    let mtime = 0;
    try {
      mtime = fs.statSync(this.file(vodId)).mtimeMs;
    } catch {
      /* sin archivo */
    }
    const key = `${this.vocabVersion}:${mtime}:${raw.length}`;
    const hit = this.corrected.get(vodId);
    if (hit?.key === key) return hit.words;
    const words = applyVocabulary(raw, v);
    this.corrected.set(vodId, { key, words });
    if (this.corrected.size > 4) this.corrected.delete(this.corrected.keys().next().value as string);
    return words;
  }

  /** Prompt inicial de Whisper: las palabras propias y de qué va el directo (título y juegos). */
  private promptFor(vod: VodJob): string {
    const context = [vod.title ?? '', ...(vod.chapters ?? []).map((c) => c.title)];
    return whisperPrompt(this.vocabulary(), context, looksLikePokemon(context) ? POKEMON_PROMPT_TERMS : []);
  }

  /**
   * El usuario corrige el texto de unas líneas de subtítulo: se guardan las palabras nuevas en la transcripción
   * y se aprenden las correcciones (lo que salió mal → lo que puso) para el futuro.
   */
  editLines(vodId: string, changes: LineChange[]): { changed: number; learned: { from: string; to: string }[] } {
    this.vod(vodId);
    if (!Array.isArray(changes) || changes.length > 5000) throw new Error('Las correcciones no son válidas.');
    for (const c of changes) {
      if (typeof c?.text !== 'string' || typeof c.start !== 'number' || typeof c.end !== 'number') throw new Error('Las correcciones no son válidas.');
      if (c.text.length > 600) throw new Error('Una línea de subtítulo es demasiado larga.');
    }
    const cur = this.raw(vodId);
    if (!cur.words.length) throw new Error('Este VOD no tiene transcripción que corregir.');
    // las líneas que ve el usuario son las ya corregidas con el vocabulario; sobre esas se aplican sus cambios
    const base = this.words(vodId);
    const r = applyLineChanges(base, changes);
    if (!r.changed.length) return { changed: 0, learned: [] };
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(vodId);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ words: r.words, ...(cur.covered ? { covered: cur.covered } : {}) }));
    fs.renameSync(`${file}.tmp`, file);
    const vod = this.vod(vodId);
    vod.transcript = { ...(vod.transcript ?? { source: 'whisper', at: new Date().toISOString() }), words: r.words.length, at: new Date().toISOString() } as TranscriptInfo;
    // aprender: cada cambio pequeño pasa a ser una corrección y su resultado, un término si es un nombre propio
    let learned: { from: string; to: string }[] = [];
    for (const c of r.changed) learned = learned.concat(learnCorrections(c.before, c.after));
    if (learned.length) {
      const v = this.vocabulary();
      v.corrections = mergeCorrections(v.corrections, learned);
      for (const l of learned) {
        const name = /^\p{Lu}/u.test(l.to) && l.to.length >= 4 && !l.to.includes(' ');
        if (name && !v.terms.some((t) => normToken(t) === normToken(l.to))) v.terms.push(l.to);
      }
      this.vocabVersion++;
    }
    this.corrected.delete(vodId);
    this.d.store.save();
    this.d.notifier.changed();
    return { changed: r.changed.length, learned };
  }

  private raw(vodId: string): { words: Word[]; covered?: Range[] } {
    try {
      const j = JSON.parse(fs.readFileSync(this.file(vodId), 'utf8')) as { words?: Word[]; covered?: Range[] };
      return { words: Array.isArray(j.words) ? j.words : [], covered: Array.isArray(j.covered) ? j.covered : undefined };
    } catch {
      return { words: [] };
    }
  }

  /** ¿Está transcrito el directo entero (no solo algunos tramos)? */
  isFull(vodId: string): boolean {
    const r = this.raw(vodId);
    return r.words.length > 0 && !r.covered;
  }

  /** Partes de `ranges` que todavía no están transcritas (con un pequeño margen). */
  missing(vodId: string, ranges: Range[]): Range[] {
    const r = this.raw(vodId);
    if (r.words.length && !r.covered) return [];
    const cov = r.covered ?? [];
    const out: Range[] = [];
    for (const g of ranges) {
      let pending: Range[] = [{ start: Math.max(0, g.start - 1.5), end: g.end + 1.5 }];
      for (const c of cov) {
        pending = pending.flatMap((p) => {
          if (c.end <= p.start || c.start >= p.end) return [p];
          const parts: Range[] = [];
          if (c.start > p.start) parts.push({ start: p.start, end: c.start });
          if (c.end < p.end) parts.push({ start: c.end, end: p.end });
          return parts;
        });
      }
      out.push(...pending.filter((p) => p.end - p.start > 0.5));
    }
    return mergeRanges(out, 20);
  }

  /**
   * Deja solo la transcripción de los tramos indicados (lo que usan los vídeos y clips ya creados), con un pequeño margen.
   * Devuelve cuántas palabras se quitaron. Lo demás del directo ya no hace falta y ocupa espacio.
   */
  prune(vodId: string, ranges: Range[]): number {
    const vod = this.vod(vodId);
    const cur = this.raw(vodId);
    if (!cur.words.length || !ranges.length) return 0;
    const keep = mergeRanges(ranges.map((r) => ({ start: Math.max(0, r.start - 1.5), end: r.end + 1.5 })), 0.5);
    const words = cur.words.filter((w) => keep.some((r) => w.start >= r.start && w.start < r.end));
    const covered = cur.covered ? keep.flatMap((k) => cur.covered!.flatMap((c) => (Math.min(k.end, c.end) > Math.max(k.start, c.start) ? [{ start: Math.max(k.start, c.start), end: Math.min(k.end, c.end) }] : []))) : keep;
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(vodId);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ words, covered: mergeRanges(covered, 0.5) }));
    fs.renameSync(`${file}.tmp`, file);
    vod.transcript = { words: words.length, source: vod.transcript?.source ?? 'whisper', at: new Date().toISOString(), partial: true };
    this.d.store.save();
    this.d.notifier.changed();
    return cur.words.length - words.length;
  }

  /** Añade las palabras de un tramo recién transcrito a lo que ya había, sin tocar lo demás. */
  private savePartial(vod: VodJob, words: Word[], range: Range): VodJob {
    const cur = this.raw(vod.id);
    if (cur.words.length && !cur.covered) return vod; // mientras tanto llegó la transcripción completa
    const keep = cur.words.filter((w) => w.end <= range.start || w.start >= range.end);
    const merged = [...keep, ...words.filter((w) => w.start >= range.start && w.start < range.end)].sort((a, b) => a.start - b.start);
    const covered = mergeRanges([...(cur.covered ?? []), range], 0.5);
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(vod.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ words: merged, covered }));
    fs.renameSync(`${file}.tmp`, file);
    vod.transcript = { words: merged.length, source: 'whisper', at: new Date().toISOString(), partial: true };
    this.d.store.save();
    this.d.notifier.changed();
    try {
      this.onSaved?.(vod.id);
    } catch (e) {
      this.d.log.warn(`Tras guardar la transcripción: ${(e as Error).message}`);
    }
    return vod;
  }

  private save(vod: VodJob, words: Word[], source: TranscriptInfo['source']): VodJob {
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(vod.id);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ words }));
    fs.renameSync(tmp, file);
    vod.transcript = { words: words.length, source, at: new Date().toISOString() };
    this.d.store.save();
    this.d.notifier.changed();
    try {
      this.onSaved?.(vod.id);
    } catch (e) {
      this.d.log.warn(`Tras guardar la transcripción: ${(e as Error).message}`);
    }
    return vod;
  }

  /** Lee el archivo, lo valida entero y solo entonces sustituye la transcripción anterior. */
  importFile(vodId: string, filePath: string): VodJob {
    const vod = this.vod(vodId);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error('El archivo no existe.');
    if (fs.statSync(filePath).size > MAX_IMPORT_BYTES) throw new Error('El archivo es demasiado grande para ser una transcripción.');
    const words = parseTranscript(fs.readFileSync(filePath, 'utf8'));
    this.d.log.info(`Transcripción importada (${words.length} palabras) para "${vod.title}"`);
    return this.save(vod, words, 'import');
  }

  private get modelsDir(): string {
    return path.join(path.dirname(this.d.store.file), 'models');
  }

  status(): WhisperStatus {
    const name = this.d.store.data.settings.whisperModel;
    return {
      engine: Boolean(this.d.whisperExe()),
      model: name,
      modelInstalled: isKnownModel(name) && modelInstalled(this.modelsDir, name),
      modelApproxMb: isKnownModel(name) ? WHISPER_MODELS[name].approxMb : 0,
    };
  }

  private inflight = new Map<string, Promise<void>>();
  private useBasic = false;

  /**
   * Garantiza que hay transcripción de lo que se pide. Con `ranges` (los tramos de un clip o vídeo) se transcribe SOLO eso,
   * no el directo entero; sin ellos, el directo completo. Así los subtítulos y los títulos sugeridos no obligan a transcribir
   * a mano ni a esperar a todo el directo. Falla con un motivo claro si no se puede (sin Whisper o sin el VOD descargado).
   */
  async ensure(vodId: string, ranges?: Range[], opts: { onProgress?: (doneSec: number, totalSec: number) => void } = {}): Promise<void> {
    if (!ranges?.length) {
      if (this.words(vodId).length && this.isFull(vodId)) return;
      return this.once(`${vodId}:full`, async () => {
        this.requirements(vodId);
        await this.transcribe(vodId);
      });
    }
    const pending = this.missing(vodId, ranges);
    const totalSec = pending.reduce((a, r) => a + (r.end - r.start), 0);
    let doneSec = 0;
    opts.onProgress?.(0, totalSec);
    // varios tramos a la vez (la cola reparte los núcleos); cada uno se guarda al terminar, así que se puede pausar sin perder lo hecho
    await Promise.all(
      pending.map((m) =>
        this.once(`${vodId}:${Math.round(m.start)}-${Math.round(m.end)}`, async () => {
          this.requirements(vodId);
          // otro tramo pudo cubrirlo mientras esperaba
          const still = this.missing(vodId, [{ start: m.start + 1.5, end: m.end - 1.5 }]);
          for (const s of still) await this.transcribe(vodId, s);
        }).then(() => {
          doneSec += m.end - m.start;
          opts.onProgress?.(doneSec, totalSec);
        }),
      ),
    );
  }

  /** Segundos de audio que faltan por transcribir de estos tramos y lo que tardará según la velocidad medida en este PC. */
  estimate(vodId: string, ranges: Range[]): { sec: number; eta: number } {
    const sec = this.missing(vodId, ranges).reduce((a, r) => a + (r.end - r.start), 0);
    return { sec, eta: sec / this.ratio(this.d.store.data.settings.whisperModel) };
  }

  private once(key: string, fn: () => Promise<void>): Promise<void> {
    const running = this.inflight.get(key);
    if (running) return running;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private requirements(vodId: string): void {
    const vod = this.vod(vodId);
    if (!this.d.whisperExe()) throw new Error('No hay transcripción de este tramo y no se encuentra Whisper para hacerla. Impórtala o indica whisper-cli en Ajustes.');
    const restorable = Boolean(this.d.source) && vod.status === 'downloaded' && vod.origin !== 'clip' && Boolean(vod.url);
    if (!restorable && (vod.status !== 'downloaded' || !vod.filePath || !fs.existsSync(vod.filePath))) throw new Error('No hay transcripción de este tramo y el archivo del VOD no está descargado, así que no se puede transcribir.');
  }

  /** Descarga el modelo elegido en Ajustes (si ya está, no hace nada). */
  private modelJob?: Promise<WhisperStatus>;

  /** Segundos de audio que se transcriben por segundo de reloj con este modelo: lo medido en este equipo o, si aún no hay, una estimación gruesa. */
  ratio(model: string): number {
    const guess: Record<string, number> = { tiny: 10, base: 5, small: 1.3, medium: 0.45 };
    return this.d.store.data.stats.transcribeRatio[model] ?? guess[model] ?? 1;
  }

  private learnRatio(model: string, measured: number): void {
    if (!Number.isFinite(measured) || measured <= 0 || measured >= 1000) return;
    const r = this.d.store.data.stats.transcribeRatio;
    r[model] = r[model] ? Math.round((r[model] * 0.5 + measured * 0.5) * 1000) / 1000 : Math.round(measured * 1000) / 1000;
    this.d.store.save();
  }

  /** Una sola descarga del modelo a la vez, aunque haya varias transcripciones esperándolo. */
  downloadModel(): Promise<WhisperStatus> {
    if (this.modelJob) return this.modelJob;
    const p = this.fetchModel().finally(() => {
      this.modelJob = undefined;
    });
    this.modelJob = p;
    return p;
  }

  private async fetchModel(): Promise<WhisperStatus> {
    const name = this.d.store.data.settings.whisperModel;
    if (!isKnownModel(name)) throw new Error(`Modelo de Whisper desconocido: ${name} (usa tiny, base, small o medium).`);
    if (modelInstalled(this.modelsDir, name)) {
      const bad = ggmlProblem(modelPath(this.modelsDir, name));
      if (!bad) return this.status();
      this.d.log.warn(`El modelo de Whisper «${name}» está dañado (${bad}); se descarga otra vez.`);
      fs.rmSync(modelPath(this.modelsDir, name), { force: true });
    }
    const task = this.d.tasks.start('model', `Descargando el modelo de Whisper (${name}, ~${WHISPER_MODELS[name].approxMb} MB)`);
    try {
      // una descarga alterada por el camino se repite (hasta 3 veces); un fallo de conexión no
      for (let intento = 1; ; intento++) {
        try {
          await downloadModel(this.modelsDir, name, (pct) => task.update(pct), { baseUrl: this.d.modelBaseUrl });
          break;
        } catch (e) {
          if (intento >= 3 || !/dañado/.test((e as Error).message)) throw e;
          this.d.log.warn(`Descarga del modelo dañada (intento ${intento}); se repite.`);
          task.update(0, `Descarga dañada, repitiendo (${intento + 1}/3)…`);
        }
      }
      task.done();
    } catch (e) {
      task.fail((e as Error).message);
      throw e;
    }
    this.d.notifier.changed();
    return this.status();
  }

  /** Audio del VOD -> whisper.cpp -> palabras con tiempos. Descarga el modelo la primera vez. */
  async transcribe(vodId: string, range?: Range, opts: { onProgress?: (pct: number, detail?: string) => void; onEstimate?: (totalSec: number) => void } = {}): Promise<VodJob> {
    const exe = this.d.whisperExe();
    if (!exe) {
      throw new Error('No se encuentra Whisper. El instalador lo incluye; si lo has compilado tú, indica la ruta de whisper-cli en Ajustes, o importa una transcripción ya hecha.');
    }
    const vod = this.vod(vodId);
    // si el directo se borró para liberar espacio, se vuelve a descargar antes de ocupar la cola de transcripción
    if (vod.status === 'downloaded' && (!vod.filePath || !fs.existsSync(vod.filePath)) && this.d.source) await this.d.source(vodId);
    if (vod.status !== 'downloaded' || !vod.filePath || !fs.existsSync(vod.filePath)) {
      throw new Error('El VOD todavía no está descargado o su archivo ya no está en su sitio.');
    }
    const input = vod.filePath;
    const s = this.d.store.data.settings;
    return this.d.queue.run(async () => {
      await this.downloadModel();
      const task = this.d.tasks.start('transcribe', range ? `Transcribiendo un tramo de "${vod.title || vod.url}" (${Math.round(range.end - range.start)} s)` : `Transcribiendo "${vod.title || vod.url}"`, vodId);
      try {
        let info: { durationSec: number; skippedFraction: number } | undefined;
        const t0 = Date.now();
        const runWith = (bin: string) =>
          transcribeVideo(this.d.tools(), input, {
            exe: bin,
            model: modelPath(this.modelsDir, s.whisperModel),
            language: s.whisperLanguage,
            prompt: this.promptFor(vod),
            range,
            ...this.share(),
            // el directo entero tarda horas: lo hecho se guarda por trozos y se puede pausar o apagar el equipo
            ...(range ? {} : { checkpointDir: this.checkpointDir(vodId) }),
            onProgress: (pct, detail) => {
              task.update(pct, detail);
              opts.onProgress?.(pct, detail);
            },
            onInfo: ({ durationSec, skippedFraction }) => {
              info = { durationSec, skippedFraction };
              const est = (durationSec * (1 - skippedFraction)) / this.ratio(s.whisperModel);
              task.estimate(est);
              opts.onEstimate?.(est);
            },
          });
        // Si el whisper-cli principal usa instrucciones que este procesador no tiene (código 0xC000001D), se usa el alternativo, sin extensiones.
        const basic = basicExe(exe);
        const run = async () => {
          if (this.useBasic && basic) return runWith(basic);
          try {
            return await runWith(exe);
          } catch (e) {
            if (!basic || !ILLEGAL_INSTRUCTION.test((e as Error).message)) throw e;
            this.d.log.warn('Whisper usa instrucciones que este procesador no soporta; se usa la versión básica (más lenta).');
            this.useBasic = true;
            return runWith(basic);
          }
        };
        let words;
        try {
          words = await run();
        } catch (e) {
          // un modelo dañado (descarga cortada o corrupta) no se arregla reintentando: se borra, se baja otra vez y se prueba una vez más
          if (!/unknown tensor|bad magic|invalid model|has wrong size|unexpected end|failed to read/i.test((e as Error).message)) throw e;
          this.d.log.warn(`El modelo de Whisper parece dañado; se vuelve a descargar. ${(e as Error).message.split('\n')[0]}`);
          task.update(0, 'El modelo estaba dañado: descargándolo otra vez…');
          fs.rmSync(modelPath(this.modelsDir, s.whisperModel), { force: true });
          await this.downloadModel();
          try {
            words = await run();
          } catch (e2) {
            // último recurso: un modelo menor (verificado) para que la transcripción no se quede bloqueada
            const alt = s.whisperModel === 'base' || s.whisperModel === 'tiny' ? '' : 'base';
            if (alt) {
              try {
                await downloadModel(this.modelsDir, alt, (pct) => task.update(pct, `Descargando el modelo ${alt}…`), { baseUrl: this.d.modelBaseUrl });
                this.d.log.warn(`Whisper no pudo con «${s.whisperModel}»; se usa «${alt}» en esta transcripción.`);
                words = await transcribeVideo(this.d.tools(), input, {
                  exe,
                  model: modelPath(this.modelsDir, alt),
                  language: s.whisperLanguage,
                  range,
                  onProgress: (pct, detail) => task.update(pct, detail),
                });
              } catch {
                /* se informa del error original */
              }
            }
            if (!words) throw new Error(`Whisper no puede cargar el modelo «${s.whisperModel}» ni tras descargarlo de nuevo. Prueba con otro modelo en Ajustes (por ejemplo «base»).\n${(e2 as Error).message}`);
          }
        }
        this.d.log.info(`Transcripción con Whisper (${words.length} palabras) para "${vod.title}"`);
        if (info && !range) this.learnRatio(s.whisperModel, (info.durationSec * (1 - info.skippedFraction)) / Math.max(1, (Date.now() - t0) / 1000));
        const v = range ? this.savePartial(vod, words, range) : this.save(vod, words, 'whisper');
        if (!range) fs.rmSync(this.checkpointDir(vodId), { recursive: true, force: true });
        task.done(`${words.length} palabras`);
        return v;
      } catch (e) {
        this.d.log.error(`Transcripción fallida ("${vod.title}")`, e);
        task.fail((e as Error).message);
        throw e;
      }
    });
  }

  /** Con varias transcripciones a la vez, cada Whisper usa su parte de los núcleos (y trabaja de un trozo en uno). */
  private share(): { jobs?: number; threads?: number } {
    const n = Math.max(1, this.d.concurrency?.() ?? 1);
    if (n === 1) return {};
    return { jobs: 1, threads: Math.max(2, Math.floor((os.cpus().length * 0.75) / n)) };
  }

  /** Trozos de transcripción ya terminados de un directo a medias (para retomarlo). */
  checkpointDir(vodId: string): string {
    return path.join(this.dir, `${vodId.replace(/[^\w-]/g, '_')}.parcial`);
  }

  /** ¿Hay una transcripción a medias que se puede retomar? */
  hasCheckpoint(vodId: string): boolean {
    try {
      return fs.readdirSync(this.checkpointDir(vodId)).some((f) => /^c\d+\.json$/.test(f));
    } catch {
      return false;
    }
  }

  /** Instrucciones + transcripción para pegar en Claude. */
  claudePrompt(vodId: string, durationSec?: number): string {
    const vod = this.vod(vodId);
    const words = this.words(vodId);
    if (!words.length) throw new Error('Este VOD no tiene transcripción. Impórtala o transcríbela primero.');
    return buildClaudePrompt(vod.title || vod.url, durationSec, words);
  }
}

/** Une tramos que se tocan o están a menos de `gap` segundos. */
export function mergeRanges(list: Range[], gap: number): Range[] {
  const out: Range[] = [];
  for (const r of [...list].sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Salida de whisper-cli cuando el procesador no soporta sus instrucciones (Windows 0xC000001D; en Linux SIGILL). */
export const ILLEGAL_INSTRUCTION = /código (3221225501|132)\b|illegal instruction/i;

/** whisper-cli sin extensiones de CPU, junto al principal (`whisper-cli-basic`); undefined si no existe. */
export function basicExe(exe: string): string | undefined {
  const ext = path.extname(exe);
  const p = path.join(path.dirname(exe), `${path.basename(exe, ext)}-basic${ext}`);
  return fs.existsSync(p) ? p : undefined;
}

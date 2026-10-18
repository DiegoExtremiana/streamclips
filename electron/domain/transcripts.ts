import fs from 'node:fs';
import path from 'node:path';
import type { TranscriptInfo, VodJob, WhisperStatus } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { parseTranscript } from '../../shared/transcript';
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
  tools: () => ToolPaths;
  tasks: TaskTracker;
  /** Ruta a whisper-cli (la de Ajustes o la incluida); null si no hay. */
  whisperExe: () => string | null;
  /** Solo para pruebas: servidor desde el que se descargan los modelos. */
  modelBaseUrl?: string;
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

  /** Palabras guardadas; vacío si no hay transcripción o el archivo no se puede leer. */
  words(vodId: string): Word[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(vodId), 'utf8')) as { words?: Word[] };
      return Array.isArray(raw.words) ? raw.words : [];
    } catch {
      return [];
    }
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

  /**
   * Garantiza que el VOD tiene transcripción: si no la tiene, la hace con Whisper (una sola vez aunque la pidan varios a la vez).
   * Así los subtítulos y los títulos sugeridos no obligan a transcribir a mano. Falla con un motivo claro si no se puede.
   */
  ensure(vodId: string): Promise<void> {
    if (this.words(vodId).length) return Promise.resolve();
    const running = this.inflight.get(vodId);
    if (running) return running;
    const p = (async () => {
      const vod = this.vod(vodId);
      if (!this.d.whisperExe()) throw new Error('Este VOD no tiene transcripción y no se encuentra Whisper para hacerla. Impórtala o indica whisper-cli en Ajustes.');
      if (vod.status !== 'downloaded' || !vod.filePath || !fs.existsSync(vod.filePath)) throw new Error('Este VOD no tiene transcripción y su archivo no está descargado, así que no se puede transcribir.');
      await this.transcribe(vodId);
    })().finally(() => this.inflight.delete(vodId));
    this.inflight.set(vodId, p);
    return p;
  }

  /** Descarga el modelo elegido en Ajustes (si ya está, no hace nada). */
  async downloadModel(): Promise<WhisperStatus> {
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
  transcribe(vodId: string): Promise<VodJob> {
    const exe = this.d.whisperExe();
    if (!exe) {
      throw new Error('No se encuentra Whisper. El instalador lo incluye; si lo has compilado tú, indica la ruta de whisper-cli en Ajustes, o importa una transcripción ya hecha.');
    }
    const vod = this.vod(vodId);
    if (vod.status !== 'downloaded' || !vod.filePath || !fs.existsSync(vod.filePath)) {
      throw new Error('El VOD todavía no está descargado o su archivo ya no está en su sitio.');
    }
    const input = vod.filePath;
    const s = this.d.store.data.settings;
    return this.d.queue.run(async () => {
      await this.downloadModel();
      const task = this.d.tasks.start('transcribe', `Transcribiendo "${vod.title || vod.url}"`);
      try {
        const run = () =>
          transcribeVideo(this.d.tools(), input, {
            exe,
            model: modelPath(this.modelsDir, s.whisperModel),
            language: s.whisperLanguage,
            onProgress: (pct, detail) => task.update(pct, detail),
          });
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
        const v = this.save(vod, words, 'whisper');
        task.done(`${words.length} palabras`);
        return v;
      } catch (e) {
        this.d.log.error(`Transcripción fallida ("${vod.title}")`, e);
        task.fail((e as Error).message);
        throw e;
      }
    });
  }

  /** Instrucciones + transcripción para pegar en Claude. */
  claudePrompt(vodId: string, durationSec?: number): string {
    const vod = this.vod(vodId);
    const words = this.words(vodId);
    if (!words.length) throw new Error('Este VOD no tiene transcripción. Impórtala o transcríbela primero.');
    return buildClaudePrompt(vod.title || vod.url, durationSec, words);
  }
}

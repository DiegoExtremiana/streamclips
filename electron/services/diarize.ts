import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Range } from '../../shared/timeline';
import { mergeClusters, type SpeakerSeg } from '../../shared/speakers';
import { run, type ToolPaths } from './tools';

/**
 * Diarización de hablantes (quién habla cuándo) con sherpa-onnx: segmentación pyannote 3.0 + vectores de voz 3D-Speaker.
 * Corre en el propio ordenador, sin Python y sin coste. El modelo de segmentación (1,5 MB) viene con el programa; el de voz
 * (40 MB) se descarga la primera vez. Si el módulo nativo no está o falla, la función queda «no disponible» y el resto del
 * programa sigue igual.
 */

export const EMBEDDING_MODEL = {
  file: '3dspeaker_eres2net_base_zh-cn_16k.onnx',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx',
  bytes: 39_593_761,
  sha256: '1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b',
};
export const SEGMENTATION_FILE = 'pyannote-segmentation-3.0.int8.onnx';

/** Umbral del agrupamiento de sherpa (más alto = menos voces). Se usa uno bajo (parte de más) y luego se unen los grupos por vector de voz. */
export const CLUSTER_THRESHOLD = 0.8;
/** Parecido de voz a partir del cual dos grupos del mismo directo son la misma persona. */
export const SAME_VOICE = 0.45;
/** Máximo de audio de cada voz que se usa para su vector (s). */
const EMBED_SECONDS = 30;
const SR = 16000;

export interface DiarizeResult {
  /** Tramos en tiempo del VOD, con el número de voz ya unificado dentro de este análisis. */
  segs: SpeakerSeg[];
  /** Vector de voz de cada voz (número de voz → vector). */
  embeddings: Map<number, number[]>;
  /** Segundos de audio de cada voz. */
  seconds: Map<number, number>;
}

/** Motor de diarización sobre un audio mono de 16 kHz (inyectable para las pruebas). */
export interface DiarizeEngine {
  process(samples: Float32Array): { start: number; end: number; speaker: number }[];
  embed(samples: Float32Array): number[];
}

type Sherpa = {
  OfflineSpeakerDiarization: new (c: unknown) => { process(s: Float32Array): { start: number; end: number; speaker: number }[] };
  SpeakerEmbeddingExtractor: new (c: unknown) => { createStream(): { acceptWaveform(w: { sampleRate: number; samples: Float32Array }): void }; compute(s: unknown): Float32Array };
  readWave(file: string): { sampleRate: number; samples: Float32Array };
};

let cachedSherpa: Sherpa | null | undefined;

/** Carga sherpa-onnx si está instalado (módulo nativo opcional). null si no. */
export function loadSherpa(): Sherpa | null {
  if (cachedSherpa !== undefined) return cachedSherpa;
  try {
    cachedSherpa = createRequire(__filename)('sherpa-onnx-node') as Sherpa;
  } catch {
    cachedSherpa = null;
  }
  return cachedSherpa;
}

export function embeddingPath(dir: string): string {
  return path.join(dir, EMBEDDING_MODEL.file);
}

export const embeddingInstalled = (dir: string): boolean => {
  try {
    return fs.statSync(embeddingPath(dir)).size === EMBEDDING_MODEL.bytes;
  } catch {
    return false;
  }
};

/** Descarga el modelo de voz comprobando tamaño y huella SHA-256; un archivo cortado o cambiado se rechaza. */
export async function downloadEmbeddingModel(dir: string, onProgress: (pct: number) => void, fetchFn: typeof fetch = fetch): Promise<string> {
  const dest = embeddingPath(dir);
  if (embeddingInstalled(dir)) return dest;
  fs.mkdirSync(dir, { recursive: true });
  const part = `${dest}.part`;
  try {
    let res: Response;
    try {
      res = await fetchFn(EMBEDDING_MODEL.url, { redirect: 'follow' });
    } catch {
      throw new Error('No se pudo conectar para descargar el modelo de voz. Comprueba tu conexión a internet.');
    }
    if (!res.ok || !res.body) throw new Error(`No se pudo descargar el modelo de voz (HTTP ${res.status}).`);
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(part, 'w');
    let got = 0;
    let last = -1;
    try {
      for await (const raw of Readable.fromWeb(res.body as never) as AsyncIterable<Uint8Array>) {
        const c = Buffer.from(raw);
        hash.update(c);
        let off = 0;
        while (off < c.length) off += fs.writeSync(fd, c, off, c.length - off);
        got += c.length;
        const pct = Math.min(100, Math.floor((got / EMBEDDING_MODEL.bytes) * 100));
        if (pct !== last) {
          last = pct;
          onProgress(pct);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    if (got !== EMBEDDING_MODEL.bytes) throw new Error(`El modelo de voz se descargó incompleto (${got} de ${EMBEDDING_MODEL.bytes} bytes).`);
    if (hash.digest('hex') !== EMBEDDING_MODEL.sha256) throw new Error('El modelo de voz descargado no es el esperado (huella distinta).');
    fs.renameSync(part, dest);
    return dest;
  } finally {
    fs.rmSync(part, { force: true });
  }
}

/** Motor real con sherpa-onnx. Lanza si el módulo o los modelos no están. */
export function sherpaEngine(segmentationModel: string, embeddingModel: string, threads = 2): DiarizeEngine {
  const sherpa = loadSherpa();
  if (!sherpa) throw new Error('El módulo de diarización (sherpa-onnx) no está disponible en este equipo.');
  const sd = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: segmentationModel }, numThreads: threads, debug: 0 },
    embedding: { model: embeddingModel, numThreads: threads, debug: 0 },
    clustering: { numClusters: -1, threshold: CLUSTER_THRESHOLD },
    minDurationOn: 0.2,
    minDurationOff: 0.5,
  });
  const ex = new sherpa.SpeakerEmbeddingExtractor({ model: embeddingModel, numThreads: threads, debug: 0 });
  return {
    process: (s) => sd.process(s),
    embed: (s) => {
      const st = ex.createStream();
      st.acceptWaveform({ sampleRate: SR, samples: s });
      return Array.from(ex.compute(st));
    },
  };
}

/** Audio mono de 16 kHz de un tramo del vídeo, como muestras (ffmpeg → WAV temporal → Float32). */
export async function extractSamples(tools: ToolPaths, file: string, r: Range): Promise<Float32Array> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-diar-'));
  try {
    const wav = path.join(tmp, 'a.wav');
    await run(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, r.start)), '-t', String(Math.max(0.1, r.end - r.start)), '-i', file, '-vn', '-ac', '1', '-ar', String(SR), '-c:a', 'pcm_s16le', wav]);
    const buf = fs.readFileSync(wav);
    // cabecera WAV de 44 bytes (ffmpeg puede añadir bloques LIST: se busca «data»)
    let pos = 12;
    let dataAt = -1;
    let dataLen = 0;
    while (pos + 8 <= buf.length) {
      const id = buf.toString('ascii', pos, pos + 4);
      const len = buf.readUInt32LE(pos + 4);
      if (id === 'data') {
        dataAt = pos + 8;
        dataLen = Math.min(len, buf.length - dataAt);
        break;
      }
      pos += 8 + len + (len % 2);
    }
    if (dataAt < 0) throw new Error('El audio extraído no tiene datos.');
    const n = Math.floor(dataLen / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataAt + i * 2) / 32768;
    return out;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Diariza un tramo: tramos de cada voz en tiempo del VOD y un vector de voz de cada una. Los grupos que el motor separó de
 * más pero que suenan igual se unen (parecido de voz ≥ SAME_VOICE).
 */
export function diarizeSamples(engine: DiarizeEngine, samples: Float32Array, offsetSec: number): DiarizeResult {
  const raw = engine.process(samples);
  const byCluster = new Map<number, Float32Array[]>();
  for (const s of raw) {
    const a = Math.max(0, Math.floor(s.start * SR));
    const b = Math.min(samples.length, Math.floor(s.end * SR));
    if (b - a < SR * 0.3) continue;
    (byCluster.get(s.speaker) ?? byCluster.set(s.speaker, []).get(s.speaker)!).push(samples.subarray(a, b));
  }
  const clusterEmb = new Map<number, number[]>();
  const clusterSec = new Map<number, number>();
  for (const [k, parts] of byCluster) {
    const total = parts.reduce((a, p) => a + p.length, 0);
    clusterSec.set(k, total / SR);
    const take = Math.min(total, EMBED_SECONDS * SR);
    const all = new Float32Array(take);
    let o = 0;
    for (const p of parts) {
      const n = Math.min(p.length, take - o);
      if (n <= 0) break;
      all.set(p.subarray(0, n), o);
      o += n;
    }
    if (take >= SR * 1.0) clusterEmb.set(k, engine.embed(all));
  }
  const groups = mergeClusters(clusterEmb, SAME_VOICE);
  const embeddings = new Map<number, number[]>();
  const seconds = new Map<number, number>();
  for (const [k, g] of groups) {
    seconds.set(g, (seconds.get(g) ?? 0) + (clusterSec.get(k) ?? 0));
  }
  // vector de cada voz unida: media ponderada por segundos de sus grupos
  for (const [k, g] of groups) {
    const w = clusterSec.get(k) ?? 0;
    const e = clusterEmb.get(k)!;
    const cur = embeddings.get(g);
    const tot = seconds.get(g) || 1;
    embeddings.set(g, (cur ?? new Array<number>(e.length).fill(0)).map((x, i) => x + (e[i] * w) / tot));
  }
  const segs: SpeakerSeg[] = [];
  for (const s of raw) {
    const g = groups.get(s.speaker);
    // los grupos sin audio suficiente para un vector se quedan sin voz asignada (no se adivina)
    if (g === undefined) continue;
    segs.push({ start: s.start + offsetSec, end: s.end + offsetSec, speaker: g });
  }
  return { segs, embeddings, seconds };
}

/** Diariza un tramo de un vídeo. */
export async function diarizeRange(tools: ToolPaths, engine: DiarizeEngine, file: string, r: Range): Promise<DiarizeResult> {
  return diarizeSamples(engine, await extractSamples(tools, file, r), r.start);
}

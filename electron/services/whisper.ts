import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Word } from '../../shared/subtitles';
import { spreadWords } from '../../shared/transcript';
import { probe } from './ffmpeg';
import { run, type ToolPaths } from './tools';

/** Modelos de whisper.cpp (ggml). `minBytes` sirve para descartar descargas cortadas o páginas de error. */
export const WHISPER_MODELS: Record<string, { file: string; minBytes: number; approxMb: number }> = {
  tiny: { file: 'ggml-tiny.bin', minBytes: 70_000_000, approxMb: 78 },
  base: { file: 'ggml-base.bin', minBytes: 140_000_000, approxMb: 148 },
  small: { file: 'ggml-small.bin', minBytes: 460_000_000, approxMb: 488 },
  medium: { file: 'ggml-medium.bin', minBytes: 1_500_000_000, approxMb: 1530 },
};
export const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
/** Audio troceado para no cargar horas de directo en memoria de una vez. */
export const CHUNK_SEC = 20 * 60;

export function isKnownModel(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(WHISPER_MODELS, name);
}

export function modelPath(dir: string, name: string): string {
  if (!isKnownModel(name)) throw new Error(`Modelo de Whisper desconocido: ${name} (usa tiny, base, small o medium).`);
  return path.join(dir, WHISPER_MODELS[name].file);
}

export function modelInstalled(dir: string, name: string): boolean {
  try {
    return fs.statSync(modelPath(dir, name)).size >= WHISPER_MODELS[name].minBytes;
  } catch {
    return false;
  }
}

/** Bytes por elemento (o por bloque) de cada tipo de tensor ggml que puede traer un modelo de Whisper. */
const GGML_TYPES: Record<number, { block: number; bytes: number }> = {
  0: { block: 1, bytes: 4 },
  1: { block: 1, bytes: 2 },
  2: { block: 32, bytes: 18 },
  3: { block: 32, bytes: 20 },
  6: { block: 32, bytes: 22 },
  7: { block: 32, bytes: 24 },
  8: { block: 32, bytes: 34 },
};

/**
 * Recorre la estructura de un modelo ggml (cabecera, filtros mel, vocabulario y la cabecera de cada tensor) saltando los datos,
 * y comprueba que todo encaja y que el archivo termina exactamente donde debe. Un archivo con tamaño correcto pero con bloques
 * dañados (descarga corrupta, antivirus, disco) se descubre así sin tener que cargarlo entero. Devuelve el problema o null.
 * Si el archivo no empieza por la firma ggml no se juzga (null): lo rechazará Whisper con su propio mensaje.
 */
export function ggmlProblem(file: string): string | null {
  let fd = -1;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(4096);
    let pos = 0;
    const read = (n: number): Buffer => {
      if (pos + n > size) throw new Error('el archivo termina antes de tiempo');
      const b = n <= buf.length ? buf : Buffer.alloc(n);
      fs.readSync(fd, b, 0, n, pos);
      pos += n;
      return b;
    };
    const i32 = () => read(4).readInt32LE(0);
    if (size < 4 || read(4).readUInt32LE(0) !== 0x67676d6c) return null;
    for (let i = 0; i < 11; i++) i32(); // hiperparámetros
    const melRows = i32();
    const melCols = i32();
    if (melRows < 0 || melCols < 0 || melRows * melCols > 1_000_000) throw new Error('filtros mel con tamaño absurdo');
    pos += melRows * melCols * 4;
    const nVocab = i32();
    if (nVocab < 0 || nVocab > 200_000) throw new Error('vocabulario con tamaño absurdo');
    for (let i = 0; i < nVocab; i++) {
      const len = read(4).readUInt32LE(0);
      if (len > 1000) throw new Error('palabra de vocabulario con tamaño absurdo');
      pos += len;
    }
    let tensors = 0;
    while (pos < size) {
      const at = pos;
      const nd = i32();
      const nameLen = i32();
      const ft = i32();
      if (nd < 1 || nd > 4 || nameLen < 1 || nameLen > 200 || !GGML_TYPES[ft]) throw new Error(`cabecera de tensor ${tensors} dañada (byte ${at})`);
      let n = 1;
      for (let d = 0; d < nd; d++) {
        const v = i32();
        if (v < 1 || v > 1_000_000) throw new Error(`dimensión absurda en el tensor ${tensors} (byte ${at})`);
        n *= v;
      }
      const name = read(nameLen).toString('latin1', 0, nameLen);
      if (!/^[A-Za-z0-9_.]+$/.test(name)) throw new Error(`nombre de tensor ilegible en el byte ${at}`);
      const t = GGML_TYPES[ft];
      pos += Math.ceil(n / t.block) * t.bytes;
      tensors++;
    }
    if (pos !== size) throw new Error('los datos no terminan donde deberían');
    return tensors > 0 ? null : 'no contiene tensores';
  } catch (e) {
    return (e as Error).message;
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}

export interface DownloadOpts {
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

/** Descarga el modelo a un archivo temporal y solo lo da por bueno si llega entero. */
export async function downloadModel(dir: string, name: string, onProgress: (pct: number) => void, o: DownloadOpts = {}): Promise<string> {
  const dest = modelPath(dir, name);
  if (modelInstalled(dir, name)) return dest;
  fs.mkdirSync(dir, { recursive: true });
  const part = `${dest}.part`;
  const url = `${o.baseUrl ?? MODEL_BASE_URL}/${WHISPER_MODELS[name].file}`;
  try {
    // Hugging Face publica la huella SHA-256 del archivo en la primera respuesta (antes de la redirección): se usa para
    // comprobar que lo descargado es idéntico. Si no se puede leer, se sigue solo con las comprobaciones de tamaño.
    let expected = '';
    try {
      const head = await (o.fetchFn ?? fetch)(url, { method: 'HEAD', redirect: 'manual' });
      const tag = (head.headers.get('x-linked-etag') ?? '').replace(/"/g, '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(tag)) expected = tag;
    } catch {
      /* sin huella */
    }
    // Segunda fuente de la huella: el listado oficial del repositorio (solo con la URL oficial).
    if (!expected && !o.baseUrl) {
      try {
        const r = await (o.fetchFn ?? fetch)('https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main');
        const list = (await r.json()) as { path?: string; lfs?: { oid?: string } }[];
        const oid = list.find((x) => x.path === WHISPER_MODELS[name].file)?.lfs?.oid?.toLowerCase() ?? '';
        if (/^[0-9a-f]{64}$/.test(oid)) expected = oid;
      } catch {
        /* sin huella */
      }
    }
    const hash = crypto.createHash('sha256');
    let res: Response;
    try {
      res = await (o.fetchFn ?? fetch)(url, { redirect: 'follow' });
    } catch {
      throw new Error('No se pudo conectar para descargar el modelo de Whisper. Comprueba tu conexión a internet.');
    }
    if (!res.ok || !res.body) throw new Error(`No se pudo descargar el modelo de Whisper (HTTP ${res.status}).`);
    const total = Number(res.headers.get('content-length') ?? 0);
    let got = 0;
    let last = -1;
    // Cada trozo se copia antes de escribirlo: así lo que se guarda no depende de memoria que la red pueda reutilizar.
    const fd = fs.openSync(part, 'w');
    try {
      for await (const raw of Readable.fromWeb(res.body as never) as AsyncIterable<Uint8Array>) {
        const c = Buffer.from(raw);
        hash.update(c);
        let off = 0;
        while (off < c.length) off += fs.writeSync(fd, c, off, c.length - off);
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== last) {
            last = pct;
            onProgress(pct);
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    if (total && got !== total) throw new Error('La descarga del modelo se cortó. Vuelve a intentarlo.');
    if (got < WHISPER_MODELS[name].minBytes) throw new Error('El archivo descargado es demasiado pequeño para ser el modelo. Vuelve a intentarlo.');
    const streamed = hash.digest('hex');
    if (expected && streamed !== expected) throw new Error('El modelo de Whisper se descargó dañado (su huella no coincide). Vuelve a intentarlo.');
    // Lo que quedó en el disco tiene que ser idéntico a lo que llegó por la red.
    const onDisk = crypto.createHash('sha256');
    await pipeline(fs.createReadStream(part), onDisk);
    if (onDisk.digest('hex') !== streamed) throw new Error('El modelo de Whisper se descargó dañado (lo guardado en el disco no coincide con lo recibido; revisa el disco o el antivirus).');
    const bad = ggmlProblem(part);
    if (bad) throw new Error(`El modelo de Whisper se descargó dañado (${bad}). Vuelve a intentarlo.`);
    fs.renameSync(part, dest);
    onProgress(100);
    return dest;
  } finally {
    fs.rmSync(part, { force: true });
  }
}

/** Texto que Whisper pone para sonidos o silencio, que no es habla: [BLANK_AUDIO], (música), ♪... */
const NON_SPEECH = /^[\s[(♪*].*[\])♪*\s]$|^\s*$/;

/** JSON de whisper.cpp (-oj): una lista `transcription` con `offsets` en milisegundos. */
export function parseWhisperCppJson(text: string, offsetSec = 0): Word[] {
  let raw: { transcription?: { text?: unknown; offsets?: { from?: unknown; to?: unknown } }[] };
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`La salida de Whisper no es JSON válido: ${(e as Error).message}`);
  }
  if (!Array.isArray(raw.transcription)) throw new Error('La salida de Whisper no tiene el formato esperado (falta "transcription").');
  const out: Word[] = [];
  for (const seg of raw.transcription) {
    const from = seg.offsets?.from;
    const to = seg.offsets?.to;
    if (typeof seg.text !== 'string' || typeof from !== 'number' || typeof to !== 'number') continue;
    if (NON_SPEECH.test(seg.text) && seg.text.trim().length > 0) continue;
    out.push(...spreadWords(seg.text, offsetSec + from / 1000, offsetSec + Math.max(to, from) / 1000));
  }
  return out;
}

export interface TranscribeOpts {
  exe: string;
  model: string; // ruta al .bin
  language: string; // '' = detectar
  threads?: number;
  chunkSec?: number;
  onProgress?: (pct: number, detail: string) => void;
}

function runCli(exe: string, args: string[], onPct: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true });
    let tail = '';
    const feed = (d: Buffer) => {
      const t = d.toString();
      tail = (tail + t).slice(-4000);
      // varias líneas pueden llegar juntas: se informa de todas, en orden
      for (const m of t.matchAll(/progress\s*=\s*(\d+)%/g)) onPct(Math.min(100, Number(m[1])));
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => reject(new Error(`No se pudo ejecutar Whisper (${exe}): ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Whisper terminó con código ${code}\n${tail.trim().split('\n').slice(-10).join('\n')}`))));
  });
}

/** Transcribe el audio de un vídeo por trozos y devuelve las palabras con su tiempo en el vídeo. */
export async function transcribeVideo(tools: ToolPaths, input: string, o: TranscribeOpts): Promise<Word[]> {
  if (!fs.existsSync(o.model)) throw new Error('Falta el modelo de Whisper.');
  const dur = (await probe(tools, input)).durationSec;
  const chunk = o.chunkSec ?? CHUNK_SEC;
  const n = Math.max(1, Math.ceil(dur / chunk));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-whisper-'));
  const words: Word[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const offset = i * chunk;
      const wav = path.join(tmp, `c${i}.wav`);
      await run(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(offset), '-t', String(chunk), '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      if (!fs.existsSync(wav) || fs.statSync(wav).size < 2000) continue; // trozo sin audio
      const base = path.join(tmp, `c${i}`);
      const args = ['-m', o.model, '-f', wav, '-l', o.language || 'auto', '-oj', '-ml', '1', '-sow', '-pp', '-t', String(o.threads ?? Math.max(1, os.cpus().length - 1)), '-of', base];
      await runCli(o.exe, args, (pct) => o.onProgress?.(((i + pct / 100) / n) * 100, `trozo ${i + 1} de ${n}`));
      const json = `${base}.json`;
      if (!fs.existsSync(json)) throw new Error('Whisper terminó pero no generó la transcripción.');
      words.push(...parseWhisperCppJson(fs.readFileSync(json, 'utf8'), offset));
      fs.rmSync(wav, { force: true });
      o.onProgress?.(((i + 1) / n) * 100, `trozo ${i + 1} de ${n}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!words.length) throw new Error('Whisper no encontró ninguna palabra en el audio.');
  return words;
}

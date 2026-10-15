import { spawn } from 'node:child_process';
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
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => {
      got += c.length;
      if (total) {
        const pct = Math.floor((got / total) * 100);
        if (pct !== last) {
          last = pct;
          onProgress(pct);
        }
      }
    });
    await pipeline(body, fs.createWriteStream(part));
    if (total && got !== total) throw new Error('La descarga del modelo se cortó. Vuelve a intentarlo.');
    if (got < WHISPER_MODELS[name].minBytes) throw new Error('El archivo descargado es demasiado pequeño para ser el modelo. Vuelve a intentarlo.');
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
      tail = (tail + t).slice(-1500);
      const m = [...t.matchAll(/progress\s*=\s*(\d+)%/g)].pop();
      if (m) onPct(Math.min(100, Number(m[1])));
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('error', (e) => reject(new Error(`No se pudo ejecutar Whisper (${exe}): ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Whisper terminó con código ${code}\n${tail.trim().split('\n').slice(-4).join('\n')}`))));
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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Word } from '../../shared/subtitles';
import type { Judged } from '../../shared/judge';
import { applyVisual, frameTimes, parseVisual, visualPrompt, VISUAL_SYSTEM, type VisualJudgement } from '../../shared/visual';
import { askJson, MIN_INTERVAL_MS, visionConfig, type LlmConfig } from './llm';
import { run } from './tools';

const VERSION = 'v1';

/** Un fotograma del directo (JPEG de 512 px) como data URL, con búsqueda rápida en el archivo. */
export async function vodFrame(ffmpeg: string, file: string, at: number, tmpDir: string): Promise<string> {
  const out = path.join(tmpDir, `f${crypto.randomBytes(4).toString('hex')}.jpg`);
  await run(ffmpeg, ['-y', '-v', 'error', '-nostdin', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-an', '-vf', 'scale=512:-2', '-q:v', '6', out], 60_000);
  const b64 = fs.readFileSync(out).toString('base64');
  fs.rmSync(out, { force: true });
  return `data:image/jpeg;base64,${b64}`;
}

export interface VisualOpts {
  ffmpeg: string;
  file: string;
  tmpDir: string;
  cacheFile?: string;
  /** Cuántos de los mejores momentos se miran. */
  top?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  paceMs?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: () => void;
}

export interface VisualResult {
  judged: Judged[];
  looked: number;
  cached: number;
  dead: number;
  failed: boolean;
  error?: string;
}

const keyOf = (c: Judged, words: Word[]) => crypto.createHash('sha1').update(`${VERSION}|${Math.round(c.start)}|${Math.round(c.end)}|${words.length}`).digest('hex').slice(0, 20);

/**
 * Mira el directo: de los mejores momentos saca fotogramas y el modelo con visión puntúa la imagen. Es un extra: si algo falla
 * (el modelo no admite imágenes, límite gratuito, el archivo) se devuelve la selección tal cual, sin la nota visual.
 */
export async function judgeVisual(conf: LlmConfig, words: Word[], judged: Judged[], o: VisualOpts): Promise<VisualResult> {
  const vconf = visionConfig(conf);
  // Groq admite 5 imágenes por petición (2 por momento, 2 momentos); Gemini admite muchas más (3 por momento, 5 momentos)
  const perCand = conf.provider === 'groq' && !conf.baseUrl ? 2 : 3;
  const perReq = conf.provider === 'groq' && !conf.baseUrl ? 2 : 5;
  const top = [...judged].filter((j) => !j.judgement.discard).sort((a, b) => b.total - a.total).slice(0, o.top ?? 14);
  let cache: Record<string, VisualJudgement> = {};
  try {
    cache = o.cacheFile ? (JSON.parse(fs.readFileSync(o.cacheFile, 'utf8')) as Record<string, VisualJudgement>) : {};
  } catch {
    cache = {};
  }
  const found: VisualJudgement[] = [];
  const todo: Judged[] = [];
  for (const c of top) {
    const s = cache[keyOf(c, words)];
    if (s) found.push({ ...s, id: c.id });
    else todo.push(c);
  }
  const cached = found.length;
  let failed = false;
  let error: string | undefined;
  const groups: Judged[][] = [];
  for (let i = 0; i < todo.length; i += perReq) groups.push(todo.slice(i, i + perReq));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  fs.mkdirSync(o.tmpDir, { recursive: true });
  for (const [n, g] of groups.entries()) {
    o.signal?.();
    if (n > 0) await sleep(o.paceMs ?? MIN_INTERVAL_MS[conf.provider]);
    try {
      const images: string[] = [];
      const items: { c: Judged; frames: number }[] = [];
      for (const c of g) {
        const seg = c.judgement.trim ?? c;
        const times = frameTimes(seg, perCand);
        for (const t of times) images.push(await vodFrame(o.ffmpeg, o.file, t, o.tmpDir));
        items.push({ c, frames: times.length });
      }
      const raw = await askJson(vconf, VISUAL_SYSTEM, visualPrompt(words, items), { fetchFn: o.fetchFn, sleep: o.sleep, temperature: 0.2, images });
      const res = parseVisual(raw, new Set(g.map((c) => c.id)));
      for (const r of res) {
        found.push(r);
        cache[keyOf(g.find((c) => c.id === r.id)!, words)] = r;
      }
      if (o.cacheFile) {
        fs.mkdirSync(path.dirname(o.cacheFile), { recursive: true });
        fs.writeFileSync(o.cacheFile, JSON.stringify(cache));
      }
    } catch (e) {
      const msg = (e as Error).message;
      error = msg;
      // si el modelo no ve imágenes, la clave no vale o no queda cuota, insistir no sirve de nada
      if (/no admite imágenes|límite gratuito|rechazó la clave|no existe/.test(msg)) {
        failed = true;
        break;
      }
    }
    o.onProgress?.(n + 1, groups.length);
  }
  const dead = found.filter((v) => v.dead && v.visual <= 3).length;
  return { judged: applyVisual(judged, found), looked: found.length, cached, dead, failed: failed || (!found.length && todo.length > 0), error };
}

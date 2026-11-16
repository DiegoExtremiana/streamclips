import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Word } from '../../shared/subtitles';
import { JUDGE_SYSTEM, judgePrompt, judgeText, parseJudgements, toJudged, type Candidate, type Judged, type Judgement } from '../../shared/judge';
import { MIN_INTERVAL_MS, askJson, type LlmConfig } from './llm';

const VERSION = 'v2';
const CHUNK = 6;

export interface JudgeResult {
  judged: Judged[];
  /** Valoraciones que ya estaban guardadas (no se pagan ni se esperan otra vez). */
  cached: number;
  asked: number;
  failedChunks: number;
  chunks: number;
}

interface Stored {
  scores: Judgement['scores'];
  kind: Judgement['kind'];
  reason: string;
  title?: string;
  discard: boolean;
  trim?: { a: number; b: number };
}

const keyOf = (words: Word[], c: Candidate) => crypto.createHash('sha1').update(`${VERSION}|${Math.round(c.end - c.start)}|${judgeText(words, c)}`).digest('hex').slice(0, 20);

function loadCache(file?: string): Record<string, Stored> {
  if (!file) return {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Stored>;
    return typeof j === 'object' && j ? j : {};
  } catch {
    return {};
  }
}

function saveCache(file: string | undefined, data: Record<string, Stored>): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
    /* sin caché no pasa nada: solo se vuelve a preguntar */
  }
}

/**
 * Valora candidatos con el modelo de lenguaje, por lotes. Las valoraciones se guardan por contenido en `cacheFile`: al
 * regenerar el montaje de un directo ya analizado no se vuelve a preguntar por lo mismo.
 * Si fallan más de la mitad de los lotes (clave, límite gratuito, red) lanza el error para que el piloto use la selección por señales.
 */
export async function judgeCandidates(
  conf: LlmConfig,
  words: Word[],
  cands: Candidate[],
  d: { fetchFn?: typeof fetch; sleep?: (ms: number) => Promise<void>; cacheFile?: string; /** Pausa entre peticiones (ms); por defecto la del proveedor. */ paceMs?: number; onProgress?: (done: number, total: number) => void; signal?: () => void; /** Varias IAs que se reparten los lotes A LA VEZ (ver `lanesFor`); por defecto solo `conf`. */ lanes?: LlmConfig[] } = {},
): Promise<JudgeResult> {
  const cache = loadCache(d.cacheFile);
  const found: Judgement[] = [];
  const todo: Candidate[] = [];
  for (const c of cands) {
    const s = cache[keyOf(words, c)];
    if (s) found.push({ id: c.id, scores: s.scores, kind: s.kind, reason: s.reason, title: s.title, discard: s.discard, trim: s.trim ? { start: c.start + s.trim.a, end: c.start + s.trim.b } : undefined });
    else todo.push(c);
  }
  const cached = found.length;
  const chunks: Candidate[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  let failed = 0;
  let lastError: Error | null = null;
  let done = 0;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  // los lotes se reparten entre las IAs disponibles y cada una trabaja los suyos a su ritmo, todas a la vez
  const lanes = d.lanes?.length ? d.lanes : [conf];
  const one = async (lane: LlmConfig, chunk: Candidate[]): Promise<void> => {
    try {
      const raw = await askJson(lane, JUDGE_SYSTEM, judgePrompt(words, chunk), { fetchFn: d.fetchFn, sleep: d.sleep, temperature: 0.2 });
      const js = parseJudgements(raw, chunk);
      for (const j of js) {
        const c = chunk.find((x) => x.id === j.id)!;
        cache[keyOf(words, c)] = { scores: j.scores, kind: j.kind, reason: j.reason, title: j.title, discard: j.discard, trim: j.trim ? { a: j.trim.start - c.start, b: j.trim.end - c.start } : undefined };
        found.push(j);
      }
      saveCache(d.cacheFile, cache);
      if (!js.length) {
        failed++;
        lastError = new Error('El modelo no devolvió valoraciones utilizables.');
      }
    } catch (e) {
      if (/rechaz|clave/i.test((e as Error).message)) throw e; // una clave mala no mejora reintentando
      failed++;
      lastError = e as Error;
    }
    d.onProgress?.(++done, chunks.length);
  };
  await Promise.all(
    lanes.map(async (lane, li) => {
      for (let n = li, first = true; n < chunks.length; n += lanes.length, first = false) {
        d.signal?.();
        if (!first) await sleep(d.paceMs ?? MIN_INTERVAL_MS[lane.provider]);
        await one(lane, chunks[n]);
      }
    }),
  );
  if (chunks.length && failed > chunks.length / 2) throw lastError ?? new Error('No se pudo valorar con el modelo de lenguaje.');
  return { judged: toJudged(cands, found), cached, asked: todo.length, failedChunks: failed, chunks: chunks.length };
}

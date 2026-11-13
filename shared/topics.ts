import type { Word } from './subtitles';
import { judgeText, type Judged } from './judge';
import { mergeSegments, type Seg } from './highlights';

/**
 * Temas a lo largo del directo: si hablas de algo en varios momentos, un vídeo los junta en orden para que tenga sentido.
 * El modelo de lenguaje agrupa los momentos ya valorados por tema; aquí se valida lo que devuelve y se monta cada hilo
 * (no hace falta que dure justo 10 minutos: puede pasarse un poco o quedarse corto).
 */
export interface Topic {
  title: string;
  ids: string[];
}

export interface TopicThread {
  title: string;
  segs: Seg[];
  totalSec: number;
  /** Nota media de los momentos del hilo. */
  score: number;
  pieces: number;
}

export const TOPIC_SYSTEM =
  'Eres editor de vídeo de un streamer de Twitch que habla en español de España. Recibes fragmentos de un mismo directo (con su id y su hora). ' +
  'Agrúpalos por TEMA: fragmentos en los que se habla de lo mismo (una anécdota que se retoma, una partida o reto, una discusión, un asunto recurrente), aunque estén separados por horas. ' +
  'Un grupo solo vale si, puesto en orden cronológico, los fragmentos se entienden como una historia o un tema continuo. No fuerces grupos: un fragmento que no encaja con ninguno se deja fuera. Cada id va como mucho en un grupo. ' +
  'Responde SOLO con JSON: {"temas":[{"titulo":"nombre corto del tema en castellano, 2 a 6 palabras, sin emojis","ids":["c1","c4"]}]}';

export function topicPrompt(words: Word[], items: Judged[]): string {
  const list = items.map((c) => ({ id: c.id, hora: `${Math.floor(c.start / 3600)}h${String(Math.floor((c.start % 3600) / 60)).padStart(2, '0')}`, titulo: c.judgement.title ?? '', texto: judgeText(words, c, 420) }));
  return JSON.stringify({ fragmentos: list });
}

/** Valida la respuesta: solo ids conocidos, sin repetir ninguno, grupos de 2 o más. */
export function parseTopics(raw: unknown, valid: Set<string>): Topic[] {
  const list = (raw as { temas?: unknown } | null)?.temas;
  if (!Array.isArray(list)) return [];
  const used = new Set<string>();
  const out: Topic[] = [];
  for (const t of list) {
    const o = t as { titulo?: unknown; ids?: unknown };
    if (typeof o?.titulo !== 'string' || !Array.isArray(o.ids)) continue;
    const ids = o.ids.filter((x): x is string => typeof x === 'string' && valid.has(x) && !used.has(x));
    const uniq = [...new Set(ids)];
    if (uniq.length < 2) continue;
    uniq.forEach((x) => used.add(x));
    out.push({ title: o.titulo.replace(/\s+/g, ' ').trim().slice(0, 60), ids: uniq });
  }
  return out;
}

export interface ThreadOpts {
  /** Duración que se busca (s). */
  targetSec?: number;
  /** Se puede pasar hasta este tanto por uno del objetivo antes de parar. */
  overshoot?: number;
  /** Por debajo de esto no es un vídeo (s). */
  minSec?: number;
  minPieces?: number;
  /** Los fragmentos con nota baja sirven de enlace, pero no por debajo de esta. */
  minTotal?: number;
  maxThreads?: number;
}

/**
 * Monta el hilo de cada tema: los fragmentos mejor valorados hasta llegar al objetivo (admitiendo pasarse un poco) y luego
 * en orden cronológico. Cada fragmento va recortado a donde empieza y acaba de verdad la situación.
 */
export function buildThreads(judged: Judged[], topics: Topic[], o: ThreadOpts = {}): TopicThread[] {
  const target = o.targetSec ?? 600;
  const cap = target * (o.overshoot ?? 1.25);
  const minSec = o.minSec ?? 150;
  const minPieces = o.minPieces ?? 2;
  const byId = new Map(judged.map((j) => [j.id, j]));
  const threads: TopicThread[] = [];
  for (const t of topics) {
    const items = t.ids
      .map((id) => byId.get(id))
      .filter((j): j is Judged => Boolean(j) && !j!.judgement.discard && j!.total >= (o.minTotal ?? 3))
      .sort((a, b) => b.total - a.total);
    const chosen: Judged[] = [];
    let sum = 0;
    for (const j of items) {
      const seg = j.judgement.trim ?? j;
      const len = seg.end - seg.start;
      if (len < 5) continue;
      if (sum >= target || sum + len > cap) continue;
      chosen.push(j);
      sum += len;
    }
    if (chosen.length < minPieces) continue;
    const segs = mergeSegments(chosen.map((j) => ({ start: (j.judgement.trim ?? j).start, end: (j.judgement.trim ?? j).end })), 2);
    const totalSec = segs.reduce((a, s) => a + (s.end - s.start), 0);
    if (totalSec < minSec) continue;
    threads.push({ title: t.title, segs, totalSec, pieces: chosen.length, score: chosen.reduce((a, j) => a + j.total, 0) / chosen.length });
  }
  return threads.sort((a, b) => b.score * Math.sqrt(b.pieces) - a.score * Math.sqrt(a.pieces)).slice(0, o.maxThreads ?? 2);
}

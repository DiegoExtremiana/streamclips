import type { Word } from './subtitles';
import { textOf, type Seg } from './highlights';

/**
 * Valoración de momentos por criterios (no solo por volumen). Un modelo de lenguaje lee la transcripción de cada candidato y
 * puntúa de 0 a 10 cada criterio; aquí se valida lo que devuelve, se combina en una nota de entretenimiento y se eligen los
 * mejores con variedad, sin repetidos y sin rellenar con momentos mediocres.
 */

export type MomentKind = 'gracia' | 'fail' | 'reaccion' | 'discusion' | 'historia' | 'epico' | 'otro';
export const KINDS: MomentKind[] = ['gracia', 'fail', 'reaccion', 'discusion', 'historia', 'epico', 'otro'];

export const CRITERIA = ['humor', 'originalidad', 'interaccion', 'reaccion', 'contexto', 'autonomia'] as const;
export type Criterion = (typeof CRITERIA)[number];

/** Peso de cada criterio en la nota final (suman 1). */
export const WEIGHTS: Record<Criterion, number> = { humor: 0.3, originalidad: 0.15, interaccion: 0.15, reaccion: 0.15, autonomia: 0.15, contexto: 0.1 };

export interface Candidate extends Seg {
  id: string;
  /** Nota de las señales (volumen, chat, voz): sirve de desempate, nunca decide sola. */
  signal: number;
}

export interface Judgement {
  id: string;
  scores: Record<Criterion, number>;
  kind: MomentKind;
  reason: string;
  /** Nombre corto del momento (2-5 palabras), para capítulos y títulos. */
  title?: string;
  /** El modelo no lo recomienda (no se entiende solo, es charla sin gracia…). */
  discard: boolean;
  /** Dónde empieza y acaba de verdad la situación (segundos del directo), dentro del candidato. */
  trim?: Seg;
  /** El recorte o el momento lo puso el usuario a mano: se respeta tal cual, sin acortarlo. */
  manual?: boolean;
}

export interface Judged extends Candidate {
  judgement: Judgement;
  /** Nota final de 0 a 10. */
  total: number;
}

const clamp = (x: unknown, lo: number, hi: number): number => {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

/** Nota de 0 a 10 que sale de los criterios; las señales de audio y chat aportan como mucho un 15 %. */
export function entertainment(j: Pick<Judgement, 'scores'>, signal = 0): number {
  let t = 0;
  for (const c of CRITERIA) t += WEIGHTS[c] * clamp(j.scores[c], 0, 10);
  const sig = Math.min(10, Math.max(0, signal * 2));
  return Math.round((0.85 * t + 0.15 * sig) * 100) / 100;
}

/** Texto de un candidato con marcas de tiempo relativas cada ~10 s, para que el modelo pueda indicar dónde empieza y acaba. */
export function judgeText(words: Word[], c: Seg, maxChars = 1100): string {
  const inside = words.filter((w) => w.start >= c.start && w.start < c.end);
  const out: string[] = [];
  let nextMark = 0;
  for (const w of inside) {
    const rel = w.start - c.start;
    if (rel >= nextMark) {
      out.push(`[${Math.round(rel)}s]`);
      nextMark = rel + 10;
    }
    out.push(w.text);
  }
  const t = out.join(' ');
  return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
}

export const JUDGE_SYSTEM =
  'Eres editor de vídeo de un streamer de Twitch que habla en español de España. Valoras fragmentos transcritos de un directo para decidir cuáles merecen estar en un vídeo de mejores momentos. ' +
  'Las voces del streamer y de sus amigos de Discord llegan mezcladas, así que la transcripción no dice quién habla: deduce el contexto. ' +
  'Sé EXIGENTE y no te dejes llevar por el volumen: una conversación larga o gritos no son gracia. La media de un directo es mediocre: puntúa 5 lo normal, 7 lo bueno y 9-10 solo lo realmente excepcional. ' +
  'Cada criterio es de 0 a 10: humor (gracia o potencial humorístico), originalidad (algo que no se ve siempre), interaccion (calidad del intercambio entre personas), reaccion (reacciones espontáneas), contexto (tiene planteamiento y desenlace claros dentro del fragmento), autonomia (se entiende sin haber visto el directo). ' +
  '"tipo" es uno de: gracia, fail, reaccion, discusion, historia, epico, otro. "descartar" es true si no merece un vídeo (charla sin interés, silencios, se entiende solo con contexto que falta, o la transcripción es ininteligible). ' +
  '"inicio" y "fin" son los segundos (relativos al inicio del fragmento, como las marcas [Ns]) donde empieza y acaba de verdad la situación: sin relleno antes ni después, pero incluyendo planteamiento y remate. "titulo" es un nombre corto del momento en castellano (2 a 5 palabras, máximo 40 caracteres, sin emojis ni clickbait falso). "motivo" es una frase corta en castellano que explica la nota. Responde SOLO con JSON.';

export function judgePrompt(words: Word[], cands: Candidate[]): string {
  const items = cands.map((c) => ({ id: c.id, duracion: Math.round(c.end - c.start), texto: judgeText(words, c) }));
  return (
    'Valora cada fragmento. Devuelve {"juicios":[{"id":"","humor":0,"originalidad":0,"interaccion":0,"reaccion":0,"contexto":0,"autonomia":0,"tipo":"","descartar":false,"inicio":0,"fin":0,"titulo":"","motivo":""}]} con un juicio por fragmento.\n' +
    `Fragmentos:\n${JSON.stringify(items)}`
  );
}

/** Valida la respuesta del modelo: lo que no sea un juicio completo y coherente se ignora (nunca se inventa una nota). */
export function parseJudgements(raw: unknown, cands: Candidate[]): Judgement[] {
  const list = (raw as { juicios?: unknown } | null)?.juicios;
  if (!Array.isArray(list)) return [];
  const byId = new Map(cands.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Judgement[] = [];
  for (const r of list as Record<string, unknown>[]) {
    if (typeof r !== 'object' || r === null) continue;
    const id = String(r.id ?? '');
    const c = byId.get(id);
    if (!c || seen.has(id)) continue;
    if (!CRITERIA.every((k) => r[k] !== undefined && r[k] !== null && Number.isFinite(Number(r[k])))) continue;
    seen.add(id);
    const scores = Object.fromEntries(CRITERIA.map((k) => [k, clamp(r[k], 0, 10)])) as Record<Criterion, number>;
    const kind = KINDS.includes(r.tipo as MomentKind) ? (r.tipo as MomentKind) : 'otro';
    const reason = typeof r.motivo === 'string' ? r.motivo.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    let trim: Seg | undefined;
    if (r.inicio !== undefined && r.fin !== undefined && Number.isFinite(Number(r.inicio)) && Number.isFinite(Number(r.fin))) {
      const len = c.end - c.start;
      const a = clamp(r.inicio, 0, len);
      const b = clamp(r.fin, 0, len);
      // solo se acepta un recorte razonable: al menos 10 s y sin comerse más de la mitad del candidato
      if (b - a >= 10 && b - a >= len * 0.5) trim = { start: c.start + a, end: c.start + b };
    }
    const title = typeof r.titulo === 'string' ? r.titulo.replace(/[<>"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    out.push({ id, scores, kind, reason, title: title.length >= 3 ? title : undefined, discard: r.descartar === true, trim });
  }
  return out;
}

export function toJudged(cands: Candidate[], js: Judgement[]): Judged[] {
  const by = new Map(js.map((j) => [j.id, j]));
  return cands.flatMap((c) => {
    const j = by.get(c.id);
    return j ? [{ ...c, judgement: j, total: entertainment(j, c.signal) }] : [];
  });
}

const STOP_WORDS = new Set('a al algo así aunque bien como con cosa cuando de del donde el ella en es esa ese eso esta este está fue ha hay la las le lo los me mi muy no nos o para pero por porque pues que qué se si sí sin su te tu un una ya yo es son tío chat vale venga'.split(' '));
const tokens = (t: string): Set<string> =>
  new Set(
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );

/** Parecido de contenido entre dos fragmentos (0 a 1): dos tramos que hablan de lo mismo no deben salir los dos. */
export function similarityOfText(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / Math.min(x.size, y.size);
}

export interface SelectOpts {
  /** Duración máxima de todo lo elegido (s). */
  maxSec: number;
  /** Nota mínima (0-10): lo que no llega no entra aunque falte duración. */
  minTotal: number;
  /** Máximo de elementos. */
  maxCount?: number;
  /** Largo máximo de cada tramo (s); si pasa, se recorta alrededor del pico. */
  maxLen?: number;
  /** Resta a la nota por cada elemento ya elegido del mismo tipo (para dar variedad). */
  kindPenalty?: number;
  /** Texto de cada candidato, para descartar los que hablan de lo mismo. */
  textFor?: (c: Seg) => string;
  /** Separación mínima entre tramos elegidos (s). */
  minGap?: number;
}

export interface Selection {
  chosen: (Judged & { seg: Seg })[];
  /** Cuántos pasaban el suelo de calidad. */
  eligible: number;
  /** Suma de duraciones elegidas. */
  totalSec: number;
}

/**
 * Elige los mejores con variedad: se parte de los que superan el suelo y se va cogiendo el de mejor nota ajustada (penalizando
 * el tipo ya repetido). No rellena: si no hay suficientes buenos, el resultado es más corto.
 */
export function selectBest(items: Judged[], o: SelectOpts): Selection {
  const penalty = o.kindPenalty ?? 0.6;
  const gap = o.minGap ?? 20;
  const pool = items.filter((x) => !x.judgement.discard && x.total >= o.minTotal);
  const chosen: Selection['chosen'] = [];
  const kinds = new Map<MomentKind, number>();
  let total = 0;
  const left = [...pool];
  while (left.length && chosen.length < (o.maxCount ?? Infinity)) {
    let bi = -1;
    let bs = -Infinity;
    for (let i = 0; i < left.length; i++) {
      const it = left[i];
      const adj = it.total - penalty * (kinds.get(it.judgement.kind) ?? 0);
      if (adj < o.minTotal - penalty * 2) continue; // ni con la variedad compensa un momento flojo
      if (adj > bs) {
        bs = adj;
        bi = i;
      }
    }
    if (bi < 0) break;
    const it = left.splice(bi, 1)[0];
    let seg: Seg = it.judgement.trim ?? { start: it.start, end: it.end };
    if (o.maxLen && !it.judgement.manual && seg.end - seg.start > o.maxLen) {
      const peakMid = (it.start + it.end) / 2;
      const a = Math.max(seg.start, Math.min(peakMid - o.maxLen / 2, seg.end - o.maxLen));
      seg = { start: a, end: a + o.maxLen };
    }
    const len = seg.end - seg.start;
    if (total + len > o.maxSec) continue;
    if (chosen.some((c) => seg.start < c.seg.end + gap && seg.end > c.seg.start - gap)) continue;
    if (o.textFor) {
      const txt = o.textFor(seg);
      if (chosen.some((c) => similarityOfText(txt, o.textFor!(c.seg)) > 0.55)) continue;
    }
    chosen.push({ ...it, seg });
    kinds.set(it.judgement.kind, (kinds.get(it.judgement.kind) ?? 0) + 1);
    total += len;
  }
  return { chosen: chosen.sort((a, b) => a.seg.start - b.seg.start), eligible: pool.length, totalSec: total };
}

/** Qué tipos de momento hay en una selección, para el aviso al usuario. */
export function kindSummary(sel: Selection): string {
  const n = new Map<MomentKind, number>();
  for (const c of sel.chosen) n.set(c.judgement.kind, (n.get(c.judgement.kind) ?? 0) + 1);
  return [...n.entries()].map(([k, v]) => `${v} ${k}`).join(', ');
}

/** Texto de un tramo para comparar duplicados. */
export const textFn = (words: Word[]) => (s: Seg) => textOf(words, s.start, s.end, 2000);

import type { Word } from './subtitles';

/** Señales por segundo del directo. Todas son opcionales: se usan las que haya. */
export interface Signals {
  durationSec: number;
  /** Volumen medio de cada segundo, en dB (índice = segundo). */
  energyDb?: number[];
  /** Mensajes de chat de cada segundo. */
  chat?: number[];
  words?: Word[];
}

export interface Moment {
  start: number;
  end: number;
  /** Segundo más intenso del tramo. */
  peak: number;
  score: number;
  reasons: string[];
}

export interface FindOpts {
  count: number;
  minLen?: number;
  maxLen?: number;
  /** Separación mínima entre picos (s). */
  gap?: number;
}

const HYPE = /\b(no puede ser|increíble|brutal|joder|madre mía|vamos|por fin|qué|cómo|socorro|jajaja|ostia|wow|guau|no me lo creo|ayuda|nooo+|siii+)\b/i;

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Media móvil centrada de ventana `w` (en muestras). */
export function smooth(xs: number[], w: number): number[] {
  const out = new Array<number>(xs.length).fill(0);
  const half = Math.max(0, Math.floor(w / 2));
  let acc = 0;
  let lo = 0;
  let hi = -1; // ventana [lo, hi]
  for (let i = 0; i < xs.length; i++) {
    const wantHi = Math.min(xs.length - 1, i + half);
    while (hi < wantHi) acc += xs[++hi];
    const wantLo = Math.max(0, i - half);
    while (lo < wantLo) acc -= xs[lo++];
    out[i] = acc / (hi - lo + 1);
  }
  return out;
}

/** Puntuación robusta: cuántas «desviaciones» (MAD) se aleja cada valor de lo habitual. Lo normal queda cerca de 0. */
export function robustZ(xs: number[]): number[] {
  const med = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - med)));
  const scale = mad > 1e-9 ? mad * 1.4826 : Math.max(1e-6, Math.sqrt(xs.reduce((a, x) => a + (x - med) ** 2, 0) / Math.max(1, xs.length)));
  return xs.map((x) => (x - med) / scale);
}

function wordsPerSecond(words: Word[], n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const w of words) {
    const i = Math.floor(w.start);
    if (i >= 0 && i < n) out[i]++;
  }
  return out;
}

function hypePerSecond(words: Word[], n: number): number[] {
  const out = new Array<number>(n).fill(0);
  // frases cortas alrededor de cada palabra para detectar expresiones de varias palabras
  for (let i = 0; i < words.length; i++) {
    const phrase = `${words[i].text} ${words[i + 1]?.text ?? ''} ${words[i + 2]?.text ?? ''}`;
    const bang = /[!?¡¿]/.test(words[i].text) ? 0.5 : 0;
    const hit = HYPE.test(phrase) ? 1 : 0;
    const s = Math.floor(words[i].start);
    if (s >= 0 && s < n) out[s] += bang + hit;
  }
  return out;
}

/** Puntuación combinada por segundo y motivos principales de cada pico. */
export function scoreSeconds(sig: Signals): { score: number[]; parts: Record<string, number[]> } {
  const n = Math.max(1, Math.ceil(sig.durationSec));
  const parts: Record<string, number[]> = {};
  const weights: Record<string, number> = {};
  const fit = (a: number[]) => {
    const r = a.slice(0, n);
    while (r.length < n) r.push(r.length ? r[r.length - 1] : 0);
    return r;
  };
  if (sig.energyDb?.length) {
    // el silencio digital (-91 dB) no debe hacer de «normal»
    const db = fit(sig.energyDb).map((x) => Math.max(x, -70));
    parts.volumen = robustZ(smooth(db, 5));
    weights.volumen = 1;
  }
  if (sig.chat?.length && sig.chat.some((x) => x > 0)) {
    parts.chat = robustZ(smooth(fit(sig.chat), 10));
    weights.chat = 1.4; // el chat reacciona a lo que la gente de verdad vive como un momento
  }
  if (sig.words?.length) {
    parts.voz = robustZ(smooth(wordsPerSecond(sig.words, n), 10));
    weights.voz = 0.6;
    parts.exclamaciones = robustZ(smooth(hypePerSecond(sig.words, n), 8));
    weights.exclamaciones = 0.8;
  }
  const keys = Object.keys(parts);
  const total = keys.reduce((a, k) => a + weights[k], 0);
  const score = new Array<number>(n).fill(0);
  if (total > 0) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (const k of keys) s += weights[k] * Math.max(-1, parts[k][i]);
      score[i] = s / total;
    }
  }
  return { score, parts };
}

interface Sentence {
  start: number;
  end: number;
}

function sentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let cur: Sentence | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!cur) cur = { start: w.start, end: w.end };
    else cur.end = w.end;
    const next = words[i + 1];
    if (/[.!?…]$/.test(w.text) || !next || next.start - w.end > 0.9) {
      out.push(cur);
      cur = null;
    }
  }
  return out;
}

/** Mueve los extremos al principio / final de la frase en la que caen, si está cerca. */
export function snapToSentences(start: number, end: number, words: Word[], maxShift = 6): { start: number; end: number } {
  if (!words.length) return { start, end };
  const ss = sentences(words);
  let s = start;
  let e = end;
  const a = ss.find((x) => x.start <= start && start < x.end);
  if (a && start - a.start <= maxShift) s = a.start;
  const b = ss.find((x) => x.start < end && end <= x.end + 0.05);
  if (b && b.end - end <= maxShift) e = b.end;
  return { start: Math.max(0, s - 0.3), end: e + 0.4 };
}

/** Los `count` mejores momentos, sin solaparse, de entre 20 y 60 s por defecto. */
export function findMoments(sig: Signals, o: FindOpts): Moment[] {
  const minLen = o.minLen ?? 20;
  const maxLen = o.maxLen ?? 60;
  const gap = o.gap ?? 90;
  const { score, parts } = scoreSeconds(sig);
  const n = score.length;
  const sm = smooth(score, 7);
  const order = [...sm.keys()].sort((a, b) => sm[b] - sm[a]);
  // lo que no destaca claramente (ni respecto a lo habitual ni respecto al mejor momento) no es un momento
  const minScore = Math.max(1, 0.25 * Math.max(0, ...sm));
  const out: Moment[] = [];
  const taken: { start: number; end: number }[] = [];
  for (const p of order) {
    if (out.length >= o.count) break;
    if (sm[p] < minScore) break;
    if (taken.some((t) => p > t.start - gap && p < t.end + gap)) continue;
    // crece mientras siga por encima de la mitad del pico
    const floor = sm[p] * 0.5;
    let lo = p;
    let hi = p;
    while (hi - lo < maxLen && (lo > 0 || hi < n - 1)) {
      const canLo = lo > 0 && sm[lo - 1] >= floor;
      const canHi = hi < n - 1 && sm[hi + 1] >= floor;
      if (!canLo && !canHi) break;
      if (canLo && (!canHi || sm[lo - 1] >= sm[hi + 1])) lo--;
      else hi++;
    }
    // antes y después, un poco de contexto
    let start = Math.max(0, lo - 6);
    let end = Math.min(sig.durationSec, hi + 8);
    while (end - start < minLen) {
      const grew = (start > 0 ? 1 : 0) + (end < sig.durationSec ? 1 : 0);
      if (!grew) break;
      if (start > 0) start = Math.max(0, start - 1);
      if (end - start < minLen && end < sig.durationSec) end = Math.min(sig.durationSec, end + 1);
    }
    if (sig.words?.length) ({ start, end } = snapToSentences(start, end, sig.words));
    start = Math.max(0, start);
    end = Math.min(sig.durationSec, end);
    if (end - start > maxLen) end = start + maxLen;
    if (end - start < 5) continue;
    const reasons = Object.keys(parts)
      .map((k) => ({ k, v: parts[k][p] }))
      .filter((x) => x.v > 0.8)
      .sort((a, b) => b.v - a.v)
      .map((x) => x.k);
    out.push({ start, end, peak: p, score: sm[p], reasons });
    taken.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export interface Seg {
  start: number;
  end: number;
}

/** Une tramos que se tocan o están a menos de `joinGap` segundos. */
export function mergeSegments(segs: Seg[], joinGap = 2): Seg[] {
  const s = [...segs].sort((a, b) => a.start - b.start);
  const out: Seg[] = [];
  for (const x of s) {
    const last = out[out.length - 1];
    if (last && x.start <= last.end + joinGap) last.end = Math.max(last.end, x.end);
    else out.push({ ...x });
  }
  return out;
}

/**
 * Resumen en orden cronológico: los mejores momentos con un poco de contexto, hasta el tiempo objetivo.
 * Si no hay suficientes picos para llegar al mínimo, devuelve lo que haya.
 */
export function buildSummary(sig: Signals, o: { minSec: number; maxSec: number }): Seg[] {
  const moments = findMoments(sig, { count: 60, minLen: 25, maxLen: 90, gap: 45 });
  const ranked = [...moments].sort((a, b) => b.score - a.score);
  const picked: Seg[] = [];
  let total = 0;
  for (const m of ranked) {
    const len = m.end - m.start;
    if (total + len > o.maxSec) continue;
    picked.push({ start: m.start, end: m.end });
    total += len;
    if (total >= o.minSec) break;
  }
  return mergeSegments(picked);
}

/** El tramo continuo más intenso de `len` segundos (para el vídeo principal), ajustado a frases. */
export function bestStretch(sig: Signals, len: number): Seg | null {
  return bestStretches(sig, len, 1)[0] ?? null;
}

/**
 * Hasta `count` tramos continuos de `len` segundos, de más a menos intensos y sin solaparse entre sí
 * ni con los tramos de `avoid`. Se devuelven en orden cronológico.
 */
export function bestStretches(sig: Signals, len: number, count: number, avoid: Seg[] = []): Seg[] {
  if (count <= 0 || sig.durationSec < len * 1.2) return [];
  const { score } = scoreSeconds(sig);
  const n = score.length;
  const w = Math.min(Math.round(len), n);
  if (w < 1) return [];
  const used = new Array<boolean>(n).fill(false);
  for (const a of avoid) for (let i = Math.max(0, Math.floor(a.start)); i < Math.min(n, Math.ceil(a.end)); i++) used[i] = true;
  const out: Seg[] = [];
  for (let k = 0; k < count; k++) {
    let acc = 0;
    let blocked = 0;
    for (let i = 0; i < w; i++) {
      acc += score[i];
      if (used[i]) blocked++;
    }
    let best = -Infinity;
    let at = -1;
    if (!blocked) {
      best = acc;
      at = 0;
    }
    for (let i = w; i < n; i++) {
      acc += score[i] - score[i - w];
      blocked += (used[i] ? 1 : 0) - (used[i - w] ? 1 : 0);
      if (!blocked && acc > best) {
        best = acc;
        at = i - w + 1;
      }
    }
    if (at < 0 || best / w < 0.2) break; // no queda ninguna zona libre que destaque de verdad
    let seg = { start: at, end: Math.min(sig.durationSec, at + w) };
    for (let i = at; i < Math.min(n, at + w); i++) used[i] = true;
    if (sig.words?.length) seg = snapToSentences(seg.start, seg.end, sig.words, 20);
    out.push({ start: Math.max(0, seg.start), end: Math.min(sig.durationSec, seg.end) });
  }
  out.sort((a, b) => a.start - b.start);
  // ajustar a frases puede correr un borde unos segundos: nunca se pisan
  for (let i = 1; i < out.length; i++) if (out[i].start < out[i - 1].end) out[i].start = out[i - 1].end;
  return out.filter((s) => s.end - s.start >= Math.min(30, len / 2));
}

/** Texto de un tramo, para títulos y para el modelo de lenguaje. */
export function textOf(words: Word[], start: number, end: number, maxChars = 700): string {
  const t = words
    .filter((w) => w.start >= start && w.start < end)
    .map((w) => w.text)
    .join(' ');
  return t.length > maxChars ? `${t.slice(0, maxChars)}…` : t;
}

/** Título provisional a partir de la frase más llamativa del tramo. */
export function fallbackTitle(words: Word[], m: Seg, index: number): string {
  const ss = sentences(words.filter((w) => w.start >= m.start && w.end <= m.end + 0.5));
  const withText = ss
    .map((s) => ({ s, t: textOf(words, s.start, s.end + 0.01, 120) }))
    .filter((x) => x.t.length >= 12)
    .sort((a, b) => (/[!?]/.test(b.t) ? 1 : 0) - (/[!?]/.test(a.t) ? 1 : 0) || b.t.length - a.t.length);
  const base = withText[0]?.t.replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();
  if (!base) return `Momento ${index + 1}`;
  return base.length > 70 ? `${base.slice(0, 67).trimEnd()}…` : base;
}

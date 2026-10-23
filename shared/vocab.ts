import type { Word } from './subtitles';

/**
 * Vocabulario propio del streamer: palabras que Whisper no conoce (nombres, apodos, series…) y correcciones
 * («marsan» → «Marshall»). Sirve para tres cosas: guiar a Whisper al transcribir (prompt inicial), corregir lo
 * ya transcrito y aprender de lo que el usuario corrige a mano.
 */
export interface Correction {
  /** Lo que sale mal (una o varias palabras, sin importar mayúsculas ni tildes). */
  from: string;
  /** Lo que debería poner. */
  to: string;
  /** Veces que se ha corregido a mano (las que apuntó el usuario a mano cuentan como 1). */
  n: number;
}

export interface Vocabulary {
  terms: string[];
  corrections: Correction[];
}

export const DEFAULT_TERMS = ['Movidas', 'Marrshall', 'MovidasMarshall', 'Gorens', 'Reaptor'];
export const MAX_TERMS = 200;
export const MAX_CORRECTIONS = 500;
/** Parecido mínimo (0 a 1) para dar por buena una palabra que se parece a un término del vocabulario. */
export const FUZZY_MIN = 0.72;
export const FUZZY_MIN_LEN = 6;

export const emptyVocabulary = (): Vocabulary => ({ terms: [...DEFAULT_TERMS], corrections: [] });

/** Palabras muy comunes: nunca se corrigen solas por parecido y no se aprenden como corrección. */
const COMMON = new Set(
  ('el la los las un una unos unas de del al y o u e a en con por para que se su sus lo le les mi mis es son fue este esta esto ese esa como pero muy mas ya si no me te nos ' +
    'yo tu el ella ellos nosotros vamos va van voy vas hay ha han he has estoy esta estan eso aqui alli ahi bien mal bueno buena todo todos toda nada algo tambien cuando donde porque ' +
    'pues entonces vale venga ostia joder tio tia gente chat directo vez veces cosa cosas dia dias tengo tiene tienes hacer hace hago').split(' '),
);

/** Minúsculas, sin tildes ni signos: para comparar palabras. */
export function normToken(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]/g, '');
}

/** Aproximación a cómo suena en español (para que «Marshall» y «Marsal» se parezcan). */
export function phonetic(s: string): string {
  return normToken(s)
    .replace(/sh/g, 's')
    .replace(/ch/g, 'X')
    .replace(/ll/g, 'y')
    .replace(/rr/g, 'r')
    .replace(/ss/g, 's')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'k')
    .replace(/c(?=[ei])/g, 's')
    .replace(/z/g, 's')
    .replace(/c/g, 'k')
    .replace(/v/g, 'b')
    .replace(/w/g, 'u')
    .replace(/h/g, '')
    .replace(/X/g, 'ch')
    .replace(/(.)\1+/g, '$1');
}

/** Distancia de edición (con tope: devuelve max+1 si se pasa). */
export function editDistance(a: string, b: string, max = 99): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (!len) return 1;
  return 1 - editDistance(a, b, len) / len;
}

/** Quita lo que no son letras ni números al principio y al final de una palabra, para devolverlo después. */
function splitPunct(t: string): { pre: string; core: string; post: string } {
  const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(t);
  return { pre: m?.[1] ?? '', core: m?.[2] ?? t, post: m?.[3] ?? '' };
}

const MAX_SPAN = 3;

/**
 * Aplica el vocabulario a unas palabras: primero las correcciones exactas (de una a tres palabras seguidas) y luego
 * las palabras que suenan casi igual que un término largo del vocabulario. Conserva los tiempos y la puntuación.
 */
export function applyVocabulary(words: Word[], v: Vocabulary): Word[] {
  if (!words.length || (!v.corrections.length && !v.terms.length)) return words;
  const exact = new Map<string, string>();
  for (const c of v.corrections) {
    const key = c.from.split(/\s+/).map(normToken).filter(Boolean).join(' ');
    if (key && c.to.trim()) exact.set(key, c.to.trim());
  }
  const fuzzy = v.terms
    .map((t) => ({ term: t, code: phonetic(t) }))
    .filter((t) => normToken(t.term).length >= FUZZY_MIN_LEN);
  if (!exact.size && !fuzzy.length) return words;
  const cores = words.map((w) => splitPunct(w.text));
  const keys = cores.map((c) => normToken(c.core));
  const out: Word[] = [];
  for (let i = 0; i < words.length; ) {
    let done = false;
    // correcciones exactas, de la frase más larga a la más corta
    for (let n = Math.min(MAX_SPAN, words.length - i); n >= 1 && !done; n--) {
      if (keys.slice(i, i + n).some((k) => !k)) continue;
      const to = exact.get(keys.slice(i, i + n).join(' '));
      if (to === undefined) continue;
      out.push({ text: `${cores[i].pre}${to}${cores[i + n - 1].post}`, start: words[i].start, end: words[i + n - 1].end });
      i += n;
      done = true;
    }
    if (done) continue;
    // parecido con un término largo del vocabulario (una palabra, o dos seguidas pegadas: «movidas marsan»)
    if (fuzzy.length) {
      for (let n = Math.min(2, words.length - i); n >= 1 && !done; n--) {
        const joined = keys.slice(i, i + n).join('');
        if (joined.length < 4 || keys.slice(i, i + n).some((k) => !k)) continue;
        if (n === 1 && COMMON.has(joined)) continue;
        const code = phonetic(joined);
        let best: { term: string; s: number } | null = null;
        for (const f of fuzzy) {
          if (code[0] !== f.code[0] || Math.abs(code.length - f.code.length) > 3) continue;
          const s = similarity(code, f.code);
          if (s >= FUZZY_MIN && (!best || s > best.s)) best = { term: f.term, s };
        }
        // si ya está bien escrita, no se toca; si es una palabra corriente del idioma, tampoco
        if (!best || normToken(best.term) === joined) continue;
        out.push({ text: `${cores[i].pre}${best.term}${cores[i + n - 1].post}`, start: words[i].start, end: words[i + n - 1].end });
        i += n;
        done = true;
      }
    }
    if (!done) out.push(words[i++]);
  }
  return out;
}

/** Texto para el prompt inicial de Whisper: ASCII (en Windows los argumentos con tildes llegan mal) y corto. */
export function whisperPrompt(v: Vocabulary, context: string[] = []): string {
  const ascii = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 .'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const terms = [...new Set([...v.terms, ...v.corrections.map((c) => c.to)].map(ascii).filter(Boolean))].slice(0, 40);
  const ctx = [...new Set(context.map(ascii).filter((c) => c.length >= 3))].slice(0, 10);
  const parts: string[] = [];
  if (ctx.length) parts.push(`Directo de Twitch en espanol sobre ${ctx.join(', ')}.`);
  if (terms.length) parts.push(`Nombres y palabras: ${terms.join(', ')}.`);
  return parts.join(' ').slice(0, 480);
}

/** «mal => bien» por línea para las correcciones; el resto de líneas son términos. */
export function parseVocabText(text: string, prev: Correction[] = []): Vocabulary {
  const terms: string[] = [];
  const corrections: Correction[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?)\s*(?:=>|->|=)\s*(.+)$/.exec(line);
    if (m) {
      const from = m[1].trim().slice(0, 80);
      const to = m[2].trim().slice(0, 80);
      const key = from.split(/\s+/).map(normToken).join(' ');
      if (from && to && key && !seen.has(`c:${key}`)) {
        seen.add(`c:${key}`);
        corrections.push({ from, to, n: prev.find((c) => c.from.split(/\s+/).map(normToken).join(' ') === key)?.n ?? 1 });
      }
    } else {
      const t = line.slice(0, 80);
      const key = normToken(t);
      if (key && !seen.has(`t:${key}`)) {
        seen.add(`t:${key}`);
        terms.push(t);
      }
    }
  }
  return { terms: terms.slice(0, MAX_TERMS), corrections: corrections.slice(0, MAX_CORRECTIONS) };
}

export function formatVocabText(v: Vocabulary): string {
  return [...v.terms, ...v.corrections.map((c) => `${c.from} => ${c.to}`)].join('\n');
}

/** Normaliza lo que llega del disco o de la interfaz. */
export function cleanVocabulary(x: unknown): Vocabulary {
  const o = (typeof x === 'object' && x !== null ? x : {}) as { terms?: unknown; corrections?: unknown };
  const terms = Array.isArray(o.terms) ? o.terms.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().slice(0, 80)) : null;
  const corr = Array.isArray(o.corrections)
    ? o.corrections
        .filter((c): c is Correction => typeof c === 'object' && c !== null && typeof (c as Correction).from === 'string' && typeof (c as Correction).to === 'string')
        .map((c) => ({ from: c.from.trim().slice(0, 80), to: c.to.trim().slice(0, 80), n: Number.isFinite(c.n) && c.n > 0 ? Math.min(9999, Math.floor(c.n)) : 1 }))
        .filter((c) => c.from && c.to)
    : [];
  const seenT = new Set<string>();
  const uniqueTerms = (terms ?? DEFAULT_TERMS).filter((t) => {
    const k = normToken(t);
    if (!k || seenT.has(k)) return false;
    seenT.add(k);
    return true;
  });
  return { terms: uniqueTerms.slice(0, MAX_TERMS), corrections: corr.slice(0, MAX_CORRECTIONS) };
}

/**
 * Qué ha cambiado el usuario al corregir un texto: pares «lo que salió» → «lo que puso». Alinea por palabras (LCS) y
 * solo apunta los cambios pequeños (1 a 3 palabras de cada lado); ignora los que son palabras corrientes cortas.
 */
export function learnCorrections(before: string[], after: string[]): { from: string; to: string }[] {
  const a = before.map(normToken);
  const b = after.map(normToken);
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { from: string; to: string }[] = [];
  let i = 0;
  let j = 0;
  let delA: string[] = [];
  let addB: string[] = [];
  const flush = () => {
    if (delA.length && addB.length && delA.length <= MAX_SPAN && addB.length <= MAX_SPAN) {
      const fromKey = delA.map(normToken).join(' ');
      const bad = !fromKey || fromKey === addB.map(normToken).join(' ') || (delA.length === 1 && (COMMON.has(fromKey) || fromKey.length < 3));
      if (!bad) out.push({ from: delA.map((w) => splitPunct(w).core).join(' '), to: addB.map((w) => splitPunct(w).core).join(' ') });
    }
    delA = [];
    addB = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) addB.push(after[j++]);
    else delA.push(before[i++]);
  }
  flush();
  return out.filter((c) => c.from && c.to);
}

/** Suma lo aprendido a las correcciones existentes (si ya estaba, sube el contador y se queda con lo último escrito). */
export function mergeCorrections(cur: Correction[], learned: { from: string; to: string }[]): Correction[] {
  const out = cur.map((c) => ({ ...c }));
  for (const l of learned) {
    const key = l.from.split(/\s+/).map(normToken).join(' ');
    const hit = out.find((c) => c.from.split(/\s+/).map(normToken).join(' ') === key);
    if (hit) {
      hit.to = l.to;
      hit.n += 1;
    } else out.push({ from: l.from, to: l.to, n: 1 });
  }
  return out.slice(-MAX_CORRECTIONS);
}

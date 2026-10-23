import type { Word } from './subtitles';
import { spreadWords } from './transcript';
import type { Range } from './timeline';

/** Una línea de subtítulo que el usuario puede corregir: sus palabras en el VOD (por tiempo) y su texto. */
export interface EditLine {
  /** Tiempo en el VOD de la primera y la última palabra de la línea. */
  start: number;
  end: number;
  text: string;
}

export const LINE_MAX_WORDS = 9;
export const LINE_MAX_GAP = 0.9;

/** Palabras del VOD que quedan dentro de lo que conserva el vídeo, agrupadas en líneas cortas y legibles. */
export function editableLines(words: Word[], ranges: Range[]): EditLine[] {
  const kept = words.filter((w) => ranges.some((r) => w.start >= r.start && w.start < r.end) && w.text.trim());
  const lines: EditLine[] = [];
  let cur: Word[] = [];
  const close = () => {
    if (!cur.length) return;
    lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text.trim()).join(' ') });
    cur = [];
  };
  for (const w of kept) {
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > LINE_MAX_GAP || cur.length >= LINE_MAX_WORDS)) close();
    cur.push(w);
    if (/[.!?…]$/.test(w.text.trim())) close();
  }
  close();
  return lines;
}

export interface LineChange {
  start: number;
  end: number;
  /** Texto nuevo ('' = quitar esa línea). */
  text: string;
}

/**
 * Sustituye las palabras de cada línea corregida por las nuevas, repartidas en el mismo intervalo de tiempo.
 * Devuelve las palabras nuevas y, por cada cambio, lo que había y lo que hay (para aprender).
 */
export function applyLineChanges(words: Word[], changes: LineChange[]): { words: Word[]; changed: { before: string[]; after: string[] }[] } {
  const sorted = [...changes].filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end >= c.start).sort((a, b) => a.start - b.start);
  const out: Word[] = [];
  const changed: { before: string[]; after: string[] }[] = [];
  let ci = 0;
  let i = 0;
  // una palabra pertenece a la línea si su centro cae dentro (las palabras van pegadas: el final de una es el principio de la siguiente)
  const mid = (w: Word) => (w.start + w.end) / 2;
  while (i < words.length) {
    while (ci < sorted.length && sorted[ci].end < mid(words[i]) - 0.001) ci++;
    const c = sorted[ci];
    if (c && mid(words[i]) >= c.start - 0.001) {
      const group: Word[] = [];
      while (i < words.length && mid(words[i]) <= c.end + 0.001) group.push(words[i++]);
      const after = c.text.trim().split(/\s+/).filter(Boolean);
      const before = group.map((w) => w.text.trim());
      if (after.join(' ') !== before.join(' ')) {
        changed.push({ before, after });
        if (after.length) out.push(...spreadWords(after.join(' '), group[0].start, Math.max(group[group.length - 1].end, group[0].start + 0.05 * after.length)));
      } else out.push(...group);
      ci++;
      continue;
    }
    out.push(words[i++]);
  }
  return { words: out, changed };
}

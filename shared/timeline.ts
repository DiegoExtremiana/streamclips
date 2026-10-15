/** Tramos del VOD que se conservan y paso del tiempo del VOD al tiempo del vídeo resultante. */
export interface Range {
  start: number;
  end: number;
}

/** Tramo más corto que se acepta al quitar partes de un clip (evita fragmentos de un parpadeo). */
export const MIN_KEPT_SEC = 0.3;
export const MIN_CUT_SEC = 0.1;

/** Resta los cortes a [start,end]: devuelve los tramos que se conservan, ordenados y sin solaparse. */
export function keptRanges(start: number, end: number, cuts: Range[] = []): Range[] {
  const sorted = cuts
    .map((c) => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  let cursor = start;
  for (const c of sorted) {
    if (c.start > cursor) out.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < end) out.push({ start: cursor, end });
  return out;
}

export const totalDuration = (ranges: Range[]): number => ranges.reduce((a, r) => a + (r.end - r.start), 0);

/** Instante del vídeo resultante que corresponde a un instante del VOD; null si ese instante se cortó. */
export function toOutputTime(t: number, ranges: Range[]): number | null {
  let offset = 0;
  for (const r of ranges) {
    if (t >= r.start && t <= r.end) return offset + (t - r.start);
    offset += r.end - r.start;
  }
  return null;
}

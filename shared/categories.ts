import type { Seg } from './highlights';

/** Tramo del VOD con una categoría de Twitch (el juego o actividad en ese momento). */
export interface Chapter {
  start: number;
  end: number;
  title: string;
}

/** Los límites de categoría no son exactos al segundo: un solapamiento menor que esto no cuenta como mezcla. */
export const CATEGORY_TOLERANCE_SEC = 3;

/** Lee los capítulos que devuelve yt-dlp (`%(chapters)j`); descarta lo que no sea válido. */
export function parseChapters(text: string): Chapter[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().split('\n').pop() ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Chapter[] = [];
  for (const c of raw as { start_time?: unknown; end_time?: unknown; title?: unknown }[]) {
    if (typeof c?.start_time !== 'number' || typeof c.end_time !== 'number' || c.end_time <= c.start_time) continue;
    out.push({ start: c.start_time, end: c.end_time, title: typeof c.title === 'string' && c.title.trim() ? c.title.trim() : 'Sin categoría' });
  }
  return out.sort((a, b) => a.start - b.start);
}

const overlap = (a: Seg, b: Seg): number => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/** Categorías distintas que ocupa un tramo (ignorando los solapamientos de borde). */
export function categoriesOf(chapters: Chapter[], seg: Seg): string[] {
  const names: string[] = [];
  for (const c of chapters) {
    if (overlap(seg, c) > CATEGORY_TOLERANCE_SEC && !names.includes(c.title)) names.push(c.title);
  }
  return names;
}

/** Motivo por el que unos tramos mezclan categorías, o null. Todos los tramos juntos tienen que ser de una sola. */
export function mixedCategories(chapters: Chapter[], segs: Seg[]): string | null {
  if (chapters.length < 2) return null;
  const names: string[] = [];
  for (const s of segs) for (const n of categoriesOf(chapters, s)) if (!names.includes(n)) names.push(n);
  return names.length > 1 ? `mezcla ${names.length} categorías del directo (${names.map((n) => `«${n}»`).join(' y ')}); cada clip o vídeo tiene que ser de una sola` : null;
}

/**
 * Recorta un tramo a la categoría en la que más tiempo está. Devuelve null si lo que queda es más corto que `minSec`.
 * (Los capítulos consecutivos con el mismo nombre se tratan como una sola categoría.)
 */
export function fitToCategory(seg: Seg, chapters: Chapter[], minSec: number): Seg | null {
  if (chapters.length < 2) return seg;
  const merged: Chapter[] = [];
  for (const c of chapters) {
    const last = merged[merged.length - 1];
    if (last && last.title === c.title && c.start - last.end < 1) last.end = c.end;
    else merged.push({ ...c });
  }
  // la categoría con más solapamiento (si hay varios capítulos con el mismo nombre, se suman por separado: gana el mayor)
  let best: Chapter | null = null;
  let bestOv = 0;
  for (const c of merged) {
    const ov = overlap(seg, c);
    if (ov > bestOv) {
      best = c;
      bestOv = ov;
    }
  }
  if (!best) return null;
  const out = { start: Math.max(seg.start, best.start), end: Math.min(seg.end, best.end) };
  return out.end - out.start >= minSec ? out : null;
}

/** Para un resumen de varios tramos: se queda con los de la categoría que más tiempo suma, recortados a ella. */
export function dominantCategory(segs: Seg[], chapters: Chapter[], minSec: number): { segs: Seg[]; category: string | null } {
  if (chapters.length < 2 || !segs.length) return { segs, category: null };
  const totals = new Map<string, number>();
  for (const s of segs) for (const c of chapters) totals.set(c.title, (totals.get(c.title) ?? 0) + overlap(s, c));
  const [name] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const mine = chapters.filter((c) => c.title === name);
  const out: Seg[] = [];
  for (const s of segs) {
    for (const c of mine) {
      const o = { start: Math.max(s.start, c.start), end: Math.min(s.end, c.end) };
      if (o.end - o.start >= minSec) out.push(o);
    }
  }
  return { segs: out.sort((a, b) => a.start - b.start), category: name };
}

/** Categoría en la que está un clip o vídeo (la que más tiempo ocupa de sus tramos); undefined si no se conoce. */
export function categoryOf(chapters: Chapter[], segs: Seg[]): string | undefined {
  const totals = new Map<string, number>();
  for (const s of segs) for (const c of chapters) totals.set(c.title, (totals.get(c.title) ?? 0) + overlap(s, c));
  const top = [...totals.entries()].filter(([, t]) => t > 0).sort((a, b) => b[1] - a[1])[0];
  return top?.[0];
}

const CATEGORY_LINE = /\n*Categoría: .*$/;

/** Descripción con la última línea «Categoría: …» (sustituye a la anterior si ya la había). */
export function withCategoryLine(description: string | undefined, category: string | undefined): string {
  const base = (description ?? '').replace(CATEGORY_LINE, '').replace(/\s+$/, '');
  if (!category) return base;
  return base ? `${base}\n\nCategoría: ${category}` : `Categoría: ${category}`;
}

export const hasCategoryLine = (description: string | undefined): boolean => CATEGORY_LINE.test(description ?? '');

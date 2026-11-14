import type { Range } from './timeline';

/** YouTube solo muestra capítulos si hay al menos 3, el primero está en 0:00 y ninguno dura menos de 10 s. */
export const CHAPTER_MIN = 3;
export const CHAPTER_MIN_SEC = 10;

export interface ChapterIn {
  /** Dónde empieza el tramo en el VÍDEO RESULTANTE (s). */
  at: number;
  label: string;
}

const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

/**
 * Dónde cae, en el vídeo montado, el principio de cada tramo original. `kept` son los trozos que se conservan
 * (ya sin silencios) en orden; cada uno está dentro de un solo tramo. El inicio de un tramo es la suma de lo
 * que se conserva antes de él.
 */
export function outputStarts(segs: Range[], kept: Range[]): number[] {
  // los trozos conservados vienen en el orden del montaje, cada uno dentro de un tramo: se recorren con un puntero sobre los
  // tramos, así vale también cuando el orden no es cronológico (un gancho del final al principio) o un trozo se repite
  const starts = segs.map(() => Infinity);
  let j = 0;
  let offset = 0;
  const inside = (k: Range, s: Range) => k.start >= s.start - 0.01 && k.end <= s.end + 0.01;
  for (const k of kept) {
    let n = j;
    while (n < segs.length && !inside(k, segs[n])) n++;
    if (n < segs.length) {
      j = n;
      starts[j] = Math.min(starts[j], offset);
    }
    offset += k.end - k.start;
  }
  // un tramo del que no quedó nada (todo silencio) empieza donde el siguiente
  for (let i = segs.length - 1; i >= 0; i--) if (!Number.isFinite(starts[i])) starts[i] = i + 1 < segs.length ? starts[i + 1] : offset;
  return starts;
}

/**
 * Bloque de capítulos para la descripción ("0:00 Intro\n3:15 …"). Devuelve '' si no cumple lo que pide YouTube:
 * se descartan los capítulos que durarían menos de 10 s y, si quedan menos de 3, no se pone ninguno.
 */
export function chapterBlock(items: ChapterIn[], totalSec: number, firstLabel = 'Inicio'): string {
  const sorted = [...items].filter((c) => Number.isFinite(c.at) && c.at >= 0 && c.label.trim()).sort((a, b) => a.at - b.at);
  const out: ChapterIn[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (prev && c.at - prev.at < CHAPTER_MIN_SEC) continue;
    out.push({ at: out.length === 0 ? 0 : c.at, label: c.label.trim().replace(/\s+/g, ' ').slice(0, 60) });
  }
  // el último tampoco puede durar menos de 10 s
  while (out.length > 1 && totalSec - out[out.length - 1].at < CHAPTER_MIN_SEC) out.pop();
  if (out.length < CHAPTER_MIN) return '';
  if (out[0].label === '') out[0].label = firstLabel;
  return out.map((c) => `${clock(c.at)} ${c.label}`).join('\n');
}

import { MAX_CLIP_SEC, MIN_CLIP_SEC } from './plan';

/** Recorte de un clip sobre la línea de tiempo del directo. Todo en segundos del VOD. */
export interface TrimRange {
  start: number;
  end: number;
}

export const TRIM_STEP = 0.1;
/** Segundos de directo que se muestran a cada lado del clip para poder alargarlo. */
export const TRIM_CONTEXT_SEC = 45;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Tramo del directo que se dibuja en la línea de tiempo: el clip con algo de margen, sin salirse del VOD. */
export function timelineWindow(r: TrimRange, vodDuration: number | null, pad = TRIM_CONTEXT_SEC): TrimRange {
  const start = Math.max(0, r.start - pad);
  const end = vodDuration && vodDuration > r.end ? Math.min(vodDuration, r.end + pad) : r.end + pad;
  return { start: round1(start), end: round1(Math.max(end, start + MIN_CLIP_SEC)) };
}

/** Mueve un extremo del recorte respetando la duración mínima/máxima de un clip y los límites del directo. */
export function moveHandle(which: 'start' | 'end', t: number, r: TrimRange, vodDuration: number | null): TrimRange {
  const hi = vodDuration && vodDuration > 0 ? vodDuration : Infinity;
  if (which === 'start') {
    const lo = Math.max(0, r.end - MAX_CLIP_SEC);
    const start = Math.min(Math.max(t, lo), r.end - MIN_CLIP_SEC);
    return { start: round1(Math.max(0, start)), end: r.end };
  }
  const end = Math.max(Math.min(t, hi, r.start + MAX_CLIP_SEC), r.start + MIN_CLIP_SEC);
  return { start: r.start, end: round1(end) };
}

/** Posición (0..1) de un instante dentro de la ventana, y el camino inverso. */
export const toFraction = (t: number, w: TrimRange): number => (w.end > w.start ? Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start))) : 0);
export const fromFraction = (f: number, w: TrimRange): number => w.start + Math.min(1, Math.max(0, f)) * (w.end - w.start);

/** 83 -> «1:23»; 83.4 -> «1:23.4» (las décimas solo si hacen falta). */
export function fmtTenths(sec: number): string {
  const v = Math.max(0, round1(sec));
  const whole = Math.floor(v);
  const frac = round1(v - whole);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = `${String(s).padStart(2, '0')}${frac > 0 ? `.${Math.round(frac * 10)}` : ''}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

import type { Word } from './subtitles';

/**
 * Puntuación interna de un clip del canal (0-10). Se enseña en cada clip de tu canal (x/10), se puede ordenar por ella y decide qué clips salen con el fondo dorado.
 * Valora solo el contenido real del clip: nunca las visualizaciones ni la popularidad (un clip con 50 vistas puede ser un 9,5
 * y uno con 100.000 un 5). Con modelo de lenguaje la nota sale de su valoración de lo que pasa y se dice; sin él, de señales
 * medibles del propio clip: reacción en el audio, cuánto se habla, palabras de subidón o risas y duración.
 */
export const GOLD_MIN = 8;
/** Cambiar el método de puntuar invalida las puntuaciones guardadas. */
export const SCORE_VERSION = 6;

export interface ClipSignals {
  durationSec: number;
  words: Word[];
  /** Volumen por segundo (dB), si se pudo medir. */
  energyDb?: number[];
  /** Fotogramas del clip (data URL JPEG) para que el modelo también lo vea; nunca se guardan. */
  frames?: string[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Cuánto sube el volumen en el pico respecto a lo normal del clip, en dB (0 si no hay audio medido). */
export function peakRise(energyDb?: number[]): number {
  const e = (energyDb ?? []).filter((x) => Number.isFinite(x) && x > -90);
  if (e.length < 4) return 0;
  const sorted = [...e].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted[Math.floor(sorted.length * 0.95)];
  return Math.max(0, peak - median);
}

/** Nota final con modelo de lenguaje: es su valoración del contenido (0-10), sin más. */
export function modelScore(judged: number): number {
  return Math.round(clamp(judged, 0, 10) * 10) / 10;
}

/** Dorado: la nota global llega a 8, o el potencial viral por sí solo llega a 8 (un clip puede ser flojo en todo y aun así viralizarse). */
export const isGold = (score: number | undefined, viral?: number): boolean => (typeof score === 'number' && score >= GOLD_MIN) || (typeof viral === 'number' && viral >= GOLD_MIN);

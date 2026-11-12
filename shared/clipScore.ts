import type { Word } from './subtitles';
import { HYPE } from './highlights';

/**
 * Puntuación interna de un clip del canal (0-10). Se enseña en cada clip de tu canal (x/10), se puede ordenar por ella y decide qué clips salen con el fondo dorado.
 * Valora solo el contenido real del clip: nunca las visualizaciones ni la popularidad (un clip con 50 vistas puede ser un 9,5
 * y uno con 100.000 un 5). Con modelo de lenguaje la nota sale de su valoración de lo que pasa y se dice; sin él, de señales
 * medibles del propio clip: reacción en el audio, cuánto se habla, palabras de subidón o risas y duración.
 */
export const GOLD_MIN = 8;
/** Cambiar el método de puntuar invalida las puntuaciones guardadas. */
export const SCORE_VERSION = 2;

export interface ClipSignals {
  durationSec: number;
  words: Word[];
  /** Volumen por segundo (dB), si se pudo medir. */
  energyDb?: number[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

const LAUGH = /\b(j[aeiou]{2,}j[aeiou]*|ja(ja)+|jeje+|jiji+|jajaja+|ajaja+)\b/i;

/** Cuánto sube el volumen en el pico respecto a lo normal del clip, en dB (0 si no hay audio medido). */
export function peakRise(energyDb?: number[]): number {
  const e = (energyDb ?? []).filter((x) => Number.isFinite(x) && x > -90);
  if (e.length < 4) return 0;
  const sorted = [...e].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const peak = sorted[Math.floor(sorted.length * 0.95)];
  return Math.max(0, peak - median);
}

/**
 * Nota sin modelo de lenguaje, solo con lo que se mide en el propio clip: la reacción en el audio (35 %), cuánto se habla
 * (20 %), los subidones y las risas en lo que se dice (35 %) y la duración (10 %). Está pensada para que un 8 sea raro: hace
 * falta que varias cosas coincidan.
 */
export function heuristicScore(s: ClipSignals): number {
  const dur = Math.max(1, s.durationSec);
  const reaction = clamp(peakRise(s.energyDb) / 14);
  const talk = clamp(s.words.length / dur / 2.5);
  const text = s.words.map((w) => w.text).join(' ');
  const hits = (text.match(new RegExp(HYPE.source, 'gi')) ?? []).length + (text.match(new RegExp(LAUGH.source, 'gi')) ?? []).length;
  const hype = clamp(hits / Math.max(2, dur / 8));
  // lo mejor son los clips de 15 a 45 s: muy cortos no cuentan nada, muy largos suelen arrastrar relleno
  const length = dur < 8 ? 0.2 : dur <= 45 ? 1 : clamp(1 - (dur - 45) / 75, 0.3, 1);
  const raw = 0.35 * reaction + 0.2 * talk + 0.35 * hype + 0.1 * length;
  // curva que deja la mayoría entre 2 y 7 y muy pocos por encima de 8
  return Math.round(10 * Math.pow(clamp(raw), 1.3) * 10) / 10;
}

/** Nota final con modelo de lenguaje: es su valoración del contenido (0-10), sin más. */
export function modelScore(judged: number): number {
  return Math.round(clamp(judged, 0, 10) * 10) / 10;
}

export const isGold = (score: number | undefined): boolean => typeof score === 'number' && score >= GOLD_MIN;

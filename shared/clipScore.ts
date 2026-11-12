import type { Word } from './subtitles';
import { HYPE } from './highlights';

/**
 * Puntuación interna de un clip del canal (0-10). No se enseña: solo decide qué clips salen con el fondo dorado.
 * Con modelo de lenguaje la nota sale de su valoración del contenido; sin él, de señales medibles del propio clip
 * (reacción en el audio, cuánto se habla y si hay palabras de subidón o risas) y de cuánto lo ha visto la gente.
 */
export const GOLD_MIN = 8;
/** Cambiar el método de puntuar invalida las puntuaciones guardadas. */
export const SCORE_VERSION = 1;

export interface ClipSignals {
  durationSec: number;
  words: Word[];
  /** Volumen por segundo (dB), si se pudo medir. */
  energyDb?: number[];
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

/** Qué parte de los clips del canal tienen menos visualizaciones que este (0 a 1). Sin con qué comparar, 0,5. */
export function viewsPercentile(views: number, all: number[]): number {
  const others = all.filter((v) => Number.isFinite(v));
  if (others.length < 5) return 0.5;
  const below = others.filter((v) => v < views).length;
  const equal = others.filter((v) => v === views).length;
  return (below + equal / 2) / others.length;
}

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
 * Nota sin modelo de lenguaje. Pesa la reacción en el audio (30 %), lo que se habla y los subidones/risas (30 %), la duración
 * (10 %) y las visualizaciones frente al resto de clips del canal (30 %). Está pensada para que un 8 sea raro: hace falta
 * que varias cosas coincidan.
 */
export function heuristicScore(s: ClipSignals, viewsPct: number): number {
  const dur = Math.max(1, s.durationSec);
  const reaction = clamp(peakRise(s.energyDb) / 14);
  const wps = s.words.length / dur;
  const talk = clamp(wps / 3);
  const text = s.words.map((w) => w.text).join(' ');
  const hits = (text.match(new RegExp(HYPE.source, 'gi')) ?? []).length + (text.match(new RegExp(LAUGH.source, 'gi')) ?? []).length;
  const hype = clamp(hits / Math.max(2, dur / 8));
  // lo mejor son los clips de 15 a 45 s: muy cortos no cuentan nada, muy largos suelen arrastrar relleno
  const length = dur < 8 ? 0.2 : dur <= 45 ? 1 : clamp(1 - (dur - 45) / 75, 0.3, 1);
  const raw = 0.3 * reaction + 0.15 * talk + 0.15 * hype + 0.1 * length + 0.3 * clamp(viewsPct);
  // curva que deja la mayoría entre 3 y 7 y pocos por encima de 8
  return Math.round(10 * Math.pow(clamp(raw), 1.35) * 10) / 10;
}

/** Nota final con modelo de lenguaje: lo que dice su valoración (0-10) pesa un 85 %; lo que ha visto la gente, un 15 %. */
export function modelScore(judged: number, viewsPct: number): number {
  return Math.round((0.85 * clamp(judged, 0, 10) + 0.15 * 10 * clamp(viewsPct)) * 10) / 10;
}

export const isGold = (score: number | undefined): boolean => typeof score === 'number' && score >= GOLD_MIN;

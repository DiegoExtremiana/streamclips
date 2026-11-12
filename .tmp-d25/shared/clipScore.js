"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGold = exports.SCORE_VERSION = exports.GOLD_MIN = void 0;
exports.peakRise = peakRise;
exports.modelScore = modelScore;
/**
 * Puntuación interna de un clip del canal (0-10). Se enseña en cada clip de tu canal (x/10), se puede ordenar por ella y decide qué clips salen con el fondo dorado.
 * Valora solo el contenido real del clip: nunca las visualizaciones ni la popularidad (un clip con 50 vistas puede ser un 9,5
 * y uno con 100.000 un 5). Con modelo de lenguaje la nota sale de su valoración de lo que pasa y se dice; sin él, de señales
 * medibles del propio clip: reacción en el audio, cuánto se habla, palabras de subidón o risas y duración.
 */
exports.GOLD_MIN = 8;
/** Cambiar el método de puntuar invalida las puntuaciones guardadas. */
exports.SCORE_VERSION = 4;
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
/** Cuánto sube el volumen en el pico respecto a lo normal del clip, en dB (0 si no hay audio medido). */
function peakRise(energyDb) {
    const e = (energyDb ?? []).filter((x) => Number.isFinite(x) && x > -90);
    if (e.length < 4)
        return 0;
    const sorted = [...e].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const peak = sorted[Math.floor(sorted.length * 0.95)];
    return Math.max(0, peak - median);
}
/** Nota final con modelo de lenguaje: es su valoración del contenido (0-10), sin más. */
function modelScore(judged) {
    return Math.round(clamp(judged, 0, 10) * 10) / 10;
}
const isGold = (score) => typeof score === 'number' && score >= exports.GOLD_MIN;
exports.isGold = isGold;

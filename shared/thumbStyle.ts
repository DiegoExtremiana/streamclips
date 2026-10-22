import { assColor, assEscape } from './subtitles';

/**
 * Estilo de portada tomado de lo que se ve en los canales grandes en español (Ibai, PokeAlexVGC, Sekiam,
 * IlloJuan, Rubius, ElXokas): una sola idea por imagen, el sujeto grande y con expresión, colores vivos y contrastados,
 * una frase de 1 a 3 palabras en mayúsculas, algo condensada, con contorno grueso (blanco y amarillo) a la izquierda y la cara a la derecha (muy de ElXokas) y, en las series,
 * el número del episodio muy grande en una esquina. No se copia ninguna portada: solo estos rasgos generales.
 */

export const COVER_W = 1280;
export const COVER_H = 720;
/** Máximo de palabras y de letras del texto de la portada: más no se lee en una miniatura pequeña. */
export const COVER_MAX_WORDS = 3;
export const COVER_MAX_CHARS = 22;

const YELLOW = '#FFE600';
const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** Palabras que no aportan nada en una portada. */
const FILLER = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'o', 'u', 'e', 'a', 'en', 'con', 'por', 'para',
  'que', 'se', 'su', 'sus', 'lo', 'le', 'les', 'mi', 'mis', 'es', 'son', 'fue', 'este', 'esta', 'esto', 'ese', 'esa', 'como', 'pero',
  'muy', 'más', 'mas', 'ya', 'si', 'sí', 'me', 'te', 'nos',
]);

/** Título sin el prefijo de serie ("Minecraft Día 3 - Parte 2") ni emojis, para quedarse con lo que dice el momento. */
const SERIES_TAIL = /\b(?:d[ií]a|day|cap[ií]tulo|episodio|ep\.?|parte)\s*#?\s*\d{1,4}\b/gi;
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/** Número de episodio o día que lleva el título (para el número grande de la esquina). */
export function coverBadge(title: string): number | null {
  const m = /\b(?:d[ií]a|day|cap[ií]tulo|episodio|ep\.?|parte|#)\s*#?\s*(\d{1,4})\b/i.exec(title) ?? /#\s*(\d{1,4})\b/.exec(title);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * Frase corta para la portada, en mayúsculas. Quita el número de serie, los emojis y las palabras vacías;
 * se queda con las primeras palabras con peso hasta COVER_MAX_WORDS / COVER_MAX_CHARS.
 * Si es una serie ("Minecraft extremo Día 3 - Resumen") usa el nombre de la serie.
 */
export function coverText(title: string): string {
  let t = title.replace(EMOJI, ' ').replace(SERIES_TAIL, ' ').replace(/[|–—]/g, ' - ');
  // "Nombre de la serie - Resumen" -> el nombre manda; "Directo - lo importante" -> lo importante
  const parts = t.split(/\s-\s/).map((p) => p.trim()).filter(Boolean);
  const generic = /^(resumen|parte|directo|clip|highlights?|mejores momentos)$/i;
  const useful = parts.filter((p) => !generic.test(p));
  t = (useful[0] ?? parts[0] ?? '').trim();
  const words = t
    .replace(/[^\p{L}\p{N}%$€'’.!?¡¿ -]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const strong = words.filter((w) => !FILLER.has(w.toLocaleLowerCase('es')));
  const pool = strong.length >= 1 ? strong : words;
  const out: string[] = [];
  for (const w of pool) {
    const next = [...out, w].join(' ');
    if (out.length >= COVER_MAX_WORDS || next.length > COVER_MAX_CHARS) break;
    out.push(w);
  }
  if (!out.length && pool[0]) out.push(pool[0].slice(0, COVER_MAX_CHARS));
  return out.join(' ').toLocaleUpperCase('es');
}

/** Reparte la frase en líneas (máx. 2) de largo parecido. */
export function coverLines(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1 || text.length <= 11) return [text].filter(Boolean);
  let best = 1;
  let diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (d < diff) {
      diff = d;
      best = i;
    }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')];
}

/** Retoque de color de una portada: más contraste y viveza, nitidez y viñeta suave que lleva la vista al centro. */
export const COVER_GRADE = 'eq=contrast=1.12:saturation=1.35:brightness=0.02:gamma=0.98,unsharp=5:5:0.9:3:3:0.4,vignette=angle=PI/6';

/**
 * ASS de la portada (1280×720). Texto arriba a la izquierda, línea 1 en amarillo y línea 2 en blanco,
 * ambas con contorno negro muy grueso; número de episodio grande abajo a la izquierda. Deja libre la parte
 * derecha, donde suele estar la cara o el sujeto. Sin texto ni número devuelve null.
 */
export function buildCoverAss(text: string, badge: number | null, w = COVER_W, h = COVER_H): string | null {
  const lines = coverLines(text);
  if (!lines.length && badge === null) return null;
  const longest = Math.max(1, ...lines.map((l) => l.length));
  // que la línea más larga ocupe como mucho el 58 % del ancho (Inter Bold ≈ 0.62 em por letra en mayúsculas)
  const fit = (0.58 * w) / (longest * 0.64 * 0.9);
  const fontPx = Math.round(Math.max(h * 0.1, Math.min(h * 0.21, fit)));
  const outPx = Math.max(4, Math.round(fontPx * 0.11));
  const badgePx = Math.round(h * 0.3);
  const margin = Math.round(w * 0.035);
  const style = (name: string, size: number, color: string, an: number, out: number) =>
    `Style: ${name},Inter,${size},${assColor(color)},${assColor(color)},${assColor(BLACK)},${assColor(BLACK, 0.6)},-1,0,0,0,${name === 'Hook' ? 90 : 100},100,0,0,1,${out},${Math.round(out * 0.5)},${an},${margin},${margin},${margin},1`;
  const out: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    style('Hook', fontPx, WHITE, 7, outPx),
    style('Badge', badgePx, YELLOW, 1, Math.round(badgePx * 0.07)),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  if (lines.length) {
    const body = lines.map((l, i) => `{\\1c${assColor(i === 0 && lines.length > 1 ? YELLOW : WHITE)}}${assEscape(l)}`).join('\\N');
    out.push(`Dialogue: 0,0:00:00.00,0:00:10.00,Hook,,0,0,0,,${body}`);
  }
  if (badge !== null) out.push(`Dialogue: 1,0:00:00.00,0:00:10.00,Badge,,0,0,0,,${badge}`);
  return `${out.join('\n')}\n`;
}

/** Puntuación de un fotograma para elegir portada: viveza de color y contraste (0..~2). Sale de signalstats. */
export function frameScore(s: { satAvg: number; yLow: number; yHigh: number; yAvg: number }): number {
  const sat = Math.min(1, s.satAvg / 90);
  const contrast = Math.min(1, Math.max(0, s.yHigh - s.yLow) / 200);
  // castiga las imágenes casi negras o casi blancas (transiciones, pantallas de carga)
  const exposure = 1 - Math.min(1, Math.abs(s.yAvg - 110) / 110);
  return sat * 0.8 + contrast * 0.8 + exposure * 0.4;
}

/** Instantes candidatos repartidos por el vídeo (sin los extremos, donde hay fundidos). */
export function candidateTimes(durationSec: number, n = 6): number[] {
  const d = Math.max(0, durationSec);
  if (d < 2) return [Math.max(0, d / 2)];
  const from = Math.min(1, d * 0.1);
  const to = Math.max(from, d - Math.min(1, d * 0.1));
  const k = Math.max(1, Math.min(n, Math.floor(d)));
  if (k === 1) return [(from + to) / 2];
  return Array.from({ length: k }, (_, i) => +(from + ((to - from) * i) / (k - 1)).toFixed(2));
}

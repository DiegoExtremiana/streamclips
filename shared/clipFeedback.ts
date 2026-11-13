import type { ClipCriteria } from './clipCriteria';

/** Criterios que el streamer puede corregir a mano; «Puede ser viral» lo sigue valorando solo la IA (una persona no puede saberlo). */
export const EDITABLE = ['historia', 'interes', 'humor'] as const;
export type Editable = (typeof EDITABLE)[number];
export type EditableScores = Record<Editable, number>;

/** Una corrección: lo que puso la IA, lo que pone el streamer y un trozo de lo que se decía en el clip. */
export interface ClipCorrection {
  clipId: string;
  title: string;
  /** Lo que se oye en el clip (recortado): sin esto la corrección no enseña nada. */
  text: string;
  ai: EditableScores;
  user: EditableScores;
  at: number;
}

const clamp = (x: number) => Math.min(10, Math.max(0, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Valida unos valores corregidos: 0 a 10, un decimal. */
export function cleanScores(raw: unknown): EditableScores | null {
  const o = raw as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;
  const out = {} as EditableScores;
  for (const k of EDITABLE) {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = r1(clamp(v));
  }
  return out;
}

/** Los criterios del clip con los tres corregidos y «viral» tal como lo dejó la IA. */
export const applyCorrection = (c: ClipCriteria, user: EditableScores): ClipCriteria => ({ ...c, humor: user.humor, historia: user.historia, interes: user.interes });

/** Con menos correcciones que esto no se saca ninguna tendencia: una sola no se convierte en regla. */
export const MIN_FOR_TREND = 3;
/** Diferencia media (puntos) a partir de la cual se avisa a la IA de que se queda corta o se pasa. */
export const TREND_THRESHOLD = 1;
const MAX_EXAMPLES = 6;

/** Cuánto corrige de media el streamer cada criterio (positivo: la IA se queda corta). Solo con suficientes correcciones. */
export function trend(list: ClipCorrection[]): Partial<EditableScores> {
  const out: Partial<EditableScores> = {};
  if (list.length < MIN_FOR_TREND) return out;
  for (const k of EDITABLE) {
    const mean = list.reduce((a, c) => a + (c.user[k] - c.ai[k]), 0) / list.length;
    if (Math.abs(mean) >= TREND_THRESHOLD) out[k] = r1(mean);
  }
  return out;
}

const NAME: Record<Editable, string> = { humor: 'humor', historia: '«se cuenta algo»', interes: '«momento interesante»' };

/**
 * Texto que se añade a la petición de la IA con lo aprendido de las correcciones del streamer: la tendencia (solo si hay varias) y
 * los ejemplos más recientes. Son una guía para calibrar, nunca una orden: la rúbrica y las pruebas siguen mandando.
 */
export function feedbackGuide(list: ClipCorrection[]): string {
  const usable = list.filter((c) => c.text.trim().length >= 20);
  if (!usable.length) return '';
  const t = trend(list);
  const lines: string[] = [];
  for (const k of EDITABLE) {
    const d = t[k];
    if (d === undefined) continue;
    lines.push(`- En ${list.length} correcciones suyas, de media pone el ${NAME[k]} ${Math.abs(d).toString().replace('.', ',')} puntos ${d > 0 ? 'MÁS alto' : 'MÁS bajo'} que tú. Ajusta tu criterio en esa dirección cuando haya pruebas.`);
  }
  const ex = [...usable].sort((a, b) => b.at - a.at).slice(0, MAX_EXAMPLES);
  const examples = ex.map((c) => `· «${c.text.replace(/\s+/g, ' ').trim().slice(0, 220)}» → tú: humor ${c.ai.humor}, historia ${c.ai.historia}, interés ${c.ai.interes}; él: humor ${c.user.humor}, historia ${c.user.historia}, interés ${c.user.interes}`);
  return (
    '\nCALIBRACIÓN con correcciones del propio streamer (úsala solo como referencia de su gusto; no copies sus notas, sigue puntuando con la rúbrica y las citas):\n' +
    (lines.length ? `${lines.join('\n')}\n` : '') +
    `Ejemplos de clips que corrigió:\n${examples.join('\n')}`
  );
}

/** Resumen para la interfaz: cuántas correcciones hay y qué tendencia se ha detectado. */
export function feedbackSummary(list: ClipCorrection[]): { count: number; trend: Partial<EditableScores>; enough: boolean } {
  return { count: list.length, trend: trend(list), enough: list.length >= MIN_FOR_TREND };
}

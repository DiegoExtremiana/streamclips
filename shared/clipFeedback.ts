import type { ClipCriteria } from './clipCriteria';

/** Criterios que el streamer puede corregir a mano. «Puede ser viral» también: decide el fondo dorado y la IA aprende de cómo lo corriges. */
export const EDITABLE = ['historia', 'interes', 'humor', 'viral'] as const;
export type Editable = (typeof EDITABLE)[number];
export type EditableScores = Pick<Record<Editable, number>, 'humor' | 'historia' | 'interes'> & { viral?: number };

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
    // «viral» es opcional (versiones anteriores solo corregían tres criterios): si falta, no se toca
    if (k === 'viral' && v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[k] = r1(clamp(v));
  }
  return out;
}

/** Los criterios del clip con los corregidos; «viral» se queda como lo dejó la IA si no lo has tocado. */
export const applyCorrection = (c: ClipCriteria, user: EditableScores): ClipCriteria => ({ ...c, humor: user.humor, historia: user.historia, interes: user.interes, viral: user.viral ?? c.viral });

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
    const rel = list.filter((c) => typeof c.user[k] === 'number' && typeof c.ai[k] === 'number');
    if (rel.length < MIN_FOR_TREND) continue;
    const mean = rel.reduce((a, c) => a + (c.user[k]! - c.ai[k]!), 0) / rel.length;
    if (Math.abs(mean) >= TREND_THRESHOLD) out[k] = r1(mean);
  }
  return out;
}

const NAME: Record<Editable, string> = { humor: 'humor', historia: '«se cuenta algo»', interes: '«momento interesante»', viral: '«puede ser viral»' };

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
  const examples = ex.map((c) => `· «${c.text.replace(/\s+/g, ' ').trim().slice(0, 220)}» → tú: humor ${c.ai.humor}, historia ${c.ai.historia}, interés ${c.ai.interes}${c.ai.viral !== undefined ? `, viral ${c.ai.viral}` : ''}; él: humor ${c.user.humor}, historia ${c.user.historia}, interés ${c.user.interes}${c.user.viral !== undefined ? `, viral ${c.user.viral}` : ''}`);
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

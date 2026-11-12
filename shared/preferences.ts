import type { Judged, MomentKind } from './judge';
import { KINDS } from './judge';

/**
 * Preferencias aprendidas de lo que haces al revisar momentos: cada vez que descartas un tipo de momento su ajuste baja un poco
 * y cada vez que incluyes uno que se había quedado fuera sube. El ajuste es pequeño y acotado (nunca decide solo), se ve en
 * Ajustes y se puede apagar o borrar.
 */
export interface Preferences {
  enabled: boolean;
  /** Ajuste de nota por tipo de momento (en puntos de 0 a 10). */
  kindBias: Partial<Record<MomentKind, number>>;
  /** Cuántas decisiones tuyas hay detrás de cada tipo. */
  counts: Partial<Record<MomentKind, number>>;
}

export const STEP = 0.25;
export const MAX_BIAS = 1.5;
/** Hasta no tener varias decisiones del mismo tipo el ajuste no se aplica: una sola vez no es una preferencia. */
export const MIN_DECISIONS = 3;

export const emptyPrefs = (): Preferences => ({ enabled: true, kindBias: {}, counts: {} });

export function cleanPrefs(raw: unknown): Preferences {
  const r = (raw ?? {}) as Partial<Preferences>;
  const out = emptyPrefs();
  out.enabled = r.enabled !== false;
  for (const k of KINDS) {
    const b = r.kindBias?.[k];
    const c = r.counts?.[k];
    if (typeof b === 'number' && Number.isFinite(b) && b !== 0) out.kindBias[k] = Math.max(-MAX_BIAS, Math.min(MAX_BIAS, Math.round(b * 100) / 100));
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) out.counts[k] = Math.min(10000, Math.floor(c));
  }
  return out;
}

/** Registra una decisión: `exclude` baja el tipo, `include` lo sube. Devuelve las preferencias nuevas (no modifica la entrada). */
export function learn(p: Preferences, kind: MomentKind, action: 'exclude' | 'include'): Preferences {
  if (!KINDS.includes(kind) || kind === 'otro') return p;
  const next = cleanPrefs(p);
  const b = (next.kindBias[kind] ?? 0) + (action === 'exclude' ? -STEP : STEP);
  next.kindBias[kind] = Math.max(-MAX_BIAS, Math.min(MAX_BIAS, Math.round(b * 100) / 100));
  next.counts[kind] = (next.counts[kind] ?? 0) + 1;
  return next;
}

/** Ajuste que se aplica hoy a un tipo (0 si está apagado o hay pocas decisiones). */
export function biasFor(p: Preferences, kind: MomentKind): number {
  if (!p.enabled || (p.counts[kind] ?? 0) < MIN_DECISIONS) return 0;
  return p.kindBias[kind] ?? 0;
}

/** Suma el ajuste a la nota de cada candidato (los momentos fijados o añadidos a mano no se tocan). */
export function applyPrefs(items: Judged[], p: Preferences): Judged[] {
  if (!p.enabled) return items;
  return items.map((it) => {
    if (it.total >= 10 || it.judgement.manual) return it;
    const b = biasFor(p, it.judgement.kind);
    return b ? { ...it, total: Math.max(0, Math.min(10, Math.round((it.total + b) * 100) / 100)) } : it;
  });
}

/** Resumen legible para Ajustes y para la nota del análisis. */
export function describePrefs(p: Preferences): { kind: MomentKind; bias: number; count: number; active: boolean }[] {
  return KINDS.filter((k) => (p.counts[k] ?? 0) > 0).map((k) => ({ kind: k, bias: p.kindBias[k] ?? 0, count: p.counts[k] ?? 0, active: biasFor(p, k) !== 0 }));
}

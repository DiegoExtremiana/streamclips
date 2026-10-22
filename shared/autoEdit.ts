import type { Effect } from './types';
import type { Word } from './subtitles';
import { keptRanges, type Range } from './timeline';
import { MAX_EFFECTS } from './plan';

export interface EditPlan {
  /** Partes que se quitan (silencios y tiempos muertos), en tiempo del VOD. */
  cuts: Range[];
  effects: Effect[];
}

export interface EditOpts {
  /** Pausa a partir de la cual se corta (s). */
  minGap?: number;
  /** Lo que se deja de pausa a cada lado del corte, para que no suene a salto brusco (s). */
  keepBefore?: number;
  keepAfter?: number;
  /** Separación mínima entre acercamientos (s). */
  punchSpacing?: number;
  maxCuts?: number;
}

const EMPHASIS = /^(no\s*puede|increíble|brutal|joder|madre|ostia|vamos|guau|wow|socorro|locura|qué\s*dices|pero\s*qué|no\s*me\s*lo|imposible|ganamos|gané|let'?s\s*go)/i;

/**
 * Ritmo tomado de los canales grandes en español (Ibai, Rubius, IlloJuan…): pausas cortas, acercamientos frecuentes
 * en las reacciones y golpes de sonido. Los valores son un criterio de edición, no una medición de esos vídeos.
 *
 * Plan de edición "de editor profesional" para un tramo a partir de lo que se dice:
 *  - corta las pausas largas (conservando un respiro) para que el ritmo no decaiga,
 *  - acerca la imagen (punch) en las frases exclamativas y de énfasis, con un golpe de sonido,
 *  - pone un "whoosh" en cada salto de corte,
 *  - fundido de entrada y salida y volumen parejo.
 * Sin habla suficiente solo aplica fundidos y volumen. Todo cae dentro de lo que se conserva.
 */
export function planEdit(words: Word[], seg: Range, o: EditOpts = {}): EditPlan {
  const minGap = o.minGap ?? 1.0;
  const keepBefore = o.keepBefore ?? 0.4;
  const keepAfter = o.keepAfter ?? 0.3;
  const spacing = o.punchSpacing ?? 6;
  const inside = words.filter((w) => w.start >= seg.start && w.end <= seg.end + 0.25).sort((a, b) => a.start - b.start);
  const dur = seg.end - seg.start;
  const effects: Effect[] = [];
  const cuts: Range[] = [];
  if (inside.length >= 6 && dur >= 8) {
    const gaps: Range[] = [];
    for (let i = 0; i + 1 < inside.length; i++) {
      const gap = inside[i + 1].start - inside[i].end;
      if (gap > minGap) gaps.push({ start: inside[i].end + keepBefore, end: inside[i + 1].start - keepAfter });
    }
    gaps
      .filter((g) => g.end - g.start >= 0.3 && g.start >= seg.start && g.end <= seg.end)
      .sort((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, o.maxCuts ?? 20)
      .sort((a, b) => a.start - b.start)
      .forEach((g) => cuts.push(g));
  }
  const kept = keptRanges(seg.start, seg.end, cuts);
  const isKept = (t: number) => kept.some((r) => t >= r.start && t <= r.end);
  // acercamientos en las frases con énfasis
  const maxPunch = Math.min(6, Math.floor(dur / 10));
  const punches: number[] = [];
  for (const w of inside) {
    if (punches.length >= maxPunch) break;
    const strong = /[!¡]/.test(w.text) || EMPHASIS.test(w.text);
    if (!strong) continue;
    const at = Math.max(seg.start, w.start - 0.1);
    if (!isKept(at) || !isKept(Math.min(seg.end, at + 1))) continue;
    if (punches.some((p) => Math.abs(p - at) < spacing)) continue;
    if (at - seg.start < 1.5 || seg.end - at < 2) continue;
    punches.push(at);
  }
  for (const at of punches) {
    effects.push({ type: 'punch', at, duration: 1, zoom: 1.15 });
    effects.push({ type: 'sfx', at, sound: 'hit' });
  }
  // un whoosh en cada salto de corte
  for (const c of cuts.slice(0, 8)) {
    const at = c.end + 0.02;
    if (isKept(at) && at < seg.end - 0.5) effects.push({ type: 'sfx', at, sound: 'whoosh' });
  }
  const fadeBudget = dur > 3;
  if (fadeBudget) {
    effects.push({ type: 'fadeIn', duration: 0.3 });
    effects.push({ type: 'fadeOut', duration: 0.5 });
  }
  effects.push({ type: 'polish' });
  return { cuts, effects: effects.slice(0, MAX_EFFECTS) };
}

/** Lo mismo para un vídeo hecho de varios tramos: devuelve los tramos ya sin los silencios y los efectos de todo el vídeo. */
export function planLong(words: Word[], segs: Range[], o: EditOpts = {}): { segments: Range[]; effects: Effect[] } {
  const segments: Range[] = [];
  const body: Effect[] = [];
  for (const s of segs) {
    const p = planEdit(words, s, o);
    segments.push(...keptRanges(s.start, s.end, p.cuts));
    body.push(...p.effects.filter((e) => e.type === 'punch' || e.type === 'sfx'));
  }
  const total = segments.reduce((a, r) => a + (r.end - r.start), 0);
  const effects: Effect[] = body.slice(0, MAX_EFFECTS - 3);
  if (total > 3) effects.push({ type: 'fadeIn', duration: 0.4 }, { type: 'fadeOut', duration: 0.8 });
  effects.push({ type: 'polish' });
  return { segments, effects };
}

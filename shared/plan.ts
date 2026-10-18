import type { ClipSpec, Effect, EditPlan, LongSpec } from './types';
import { isSubtitleStyleId } from './subtitles';
import { normalizeLayout, validateLayout } from './layout';
import { MIN_CUT_SEC, MIN_KEPT_SEC, keptRanges, totalDuration, type Range } from './timeline';

export const MIN_CLIP_SEC = 1;
export const MAX_CLIP_SEC = 180;
export const MAX_LONG_SEC = 60 * 60;
export const MAX_TITLE_LEN = 120;
export const MAX_CLIPS_PER_PLAN = 50;
export const MAX_LONG_SEGMENTS = 200;
export const MAX_CUTS = 40;
export const MAX_EFFECTS = 30;
export const PUNCH = { minDur: 0.3, maxDur: 3, defaultDur: 1, minZoom: 1.05, maxZoom: 1.5, defaultZoom: 1.2 };
export const FADE = { min: 0.1, max: 2, default: 0.5 };

/** Margen para diferencias de redondeo entre la duración de Twitch y la real del archivo. */
const END_TOLERANCE_SEC = 0.5;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function cleanTitle(v: unknown, fallback: string): string {
  const t = typeof v === 'string' ? v.trim() : '';
  return (t || fallback).slice(0, MAX_TITLE_LEN);
}

/** Devuelve el motivo del rechazo, o null si el clip es válido. */
export function validateClipSpec(c: unknown, vodDurationSec?: number): string | null {
  if (!isObj(c)) return 'no es un objeto';
  if (c.kind !== undefined && c.kind !== 'vertical' && c.kind !== 'horizontal' && c.kind !== 'both') {
    return 'el tipo debe ser "vertical", "horizontal" o "both" (o no indicarse)';
  }
  if (!isNum(c.start) || !isNum(c.end)) return 'inicio y fin deben ser números';
  if (c.start < 0) return 'el inicio no puede ser negativo';
  if (c.end <= c.start) return 'el fin debe ser posterior al inicio';
  const dur = c.end - c.start;
  if (dur < MIN_CLIP_SEC) return `dura menos de ${MIN_CLIP_SEC} segundo`;
  if (dur > MAX_CLIP_SEC) return `dura más de ${MAX_CLIP_SEC / 60} minutos`;
  if (vodDurationSec !== undefined && c.end > vodDurationSec + END_TOLERANCE_SEC) return 'acaba después del final del VOD';
  if (c.cropX !== undefined && (!isNum(c.cropX) || c.cropX < 0 || c.cropX > 1)) return 'cropX debe estar entre 0 y 1';
  if (c.layout !== undefined) {
    const lr = validateLayout(c.layout);
    if (lr) return lr;
  }
  if (c.title !== undefined && typeof c.title !== 'string') return 'el título debe ser texto';
  const kept = c.cuts === undefined ? [{ start: c.start, end: c.end }] : null;
  let ranges: Range[] = kept ?? [];
  if (c.cuts !== undefined) {
    const cutReason = validateCuts(c.cuts, c.start, c.end);
    if (cutReason) return cutReason;
    ranges = keptRanges(c.start, c.end, c.cuts as Range[]);
    if (totalDuration(ranges) < MIN_CLIP_SEC) return `tras los cortes dura menos de ${MIN_CLIP_SEC} segundo`;
  }
  const fx = validateEffects(c.effects, ranges);
  if (fx) return fx;
  if (c.subtitles !== undefined && !isSubtitleStyleId(c.subtitles)) return 'el estilo de subtítulos no existe';
  return null;
}

function validateCuts(cuts: unknown, start: number, end: number): string | null {
  if (!Array.isArray(cuts)) return '"cuts" debe ser una lista';
  if (cuts.length > MAX_CUTS) return `tiene más de ${MAX_CUTS} cortes`;
  const list: Range[] = [];
  for (let i = 0; i < cuts.length; i++) {
    const c: unknown = cuts[i];
    if (!isObj(c) || !isNum(c.start) || !isNum(c.end)) return `el corte ${i + 1} no tiene tiempos numéricos`;
    if (c.start < start || c.end > end) return `el corte ${i + 1} cae fuera del clip`;
    if (c.end - c.start < MIN_CUT_SEC) return `el corte ${i + 1} dura menos de ${MIN_CUT_SEC} s`;
    list.push({ start: c.start, end: c.end });
  }
  list.sort((a, b) => a.start - b.start);
  for (let i = 1; i < list.length; i++) if (list[i].start < list[i - 1].end) return 'hay cortes que se solapan';
  const kept = keptRanges(start, end, list);
  if (kept.some((r) => r.end - r.start < MIN_KEPT_SEC)) return `entre cortes queda un tramo de menos de ${MIN_KEPT_SEC} s`;
  return null;
}

/** Los efectos se miden en tiempo del VOD: deben caer dentro de lo que se conserva. */
export function validateEffects(effects: unknown, ranges: Range[]): string | null {
  if (effects === undefined) return null;
  if (!Array.isArray(effects)) return '"effects" debe ser una lista';
  if (effects.length > MAX_EFFECTS) return `tiene más de ${MAX_EFFECTS} efectos`;
  const fades = new Set<string>();
  let polish = false;
  const total = totalDuration(ranges);
  for (let i = 0; i < effects.length; i++) {
    const e: unknown = effects[i];
    if (!isObj(e)) return `el efecto ${i + 1} no es un objeto`;
    if (e.type === 'punch') {
      const at = e.at;
      if (!isNum(at)) return `el efecto ${i + 1} (punch) necesita "at" numérico`;
      if (!ranges.some((r) => at >= r.start && at <= r.end)) return `el efecto ${i + 1} (punch) cae en una parte cortada o fuera del clip`;
      if (e.duration !== undefined && (!isNum(e.duration) || e.duration < PUNCH.minDur || e.duration > PUNCH.maxDur)) {
        return `el efecto ${i + 1}: duration debe estar entre ${PUNCH.minDur} y ${PUNCH.maxDur} s`;
      }
      if (e.zoom !== undefined && (!isNum(e.zoom) || e.zoom < PUNCH.minZoom || e.zoom > PUNCH.maxZoom)) {
        return `el efecto ${i + 1}: zoom debe estar entre ${PUNCH.minZoom} y ${PUNCH.maxZoom}`;
      }
    } else if (e.type === 'fadeIn' || e.type === 'fadeOut') {
      if (fades.has(e.type)) return `solo puede haber un ${e.type}`;
      fades.add(e.type);
      if (e.duration !== undefined && (!isNum(e.duration) || e.duration < FADE.min || e.duration > FADE.max)) {
        return `el efecto ${i + 1}: duration debe estar entre ${FADE.min} y ${FADE.max} s`;
      }
      if ((e.duration ?? FADE.default) * 2 > total) return `el efecto ${i + 1}: el fundido es más largo que el vídeo`;
    } else if (e.type === 'sfx') {
      const at = e.at;
      if (!isNum(at)) return `el efecto ${i + 1} (sfx) necesita "at" numérico`;
      if (!ranges.some((r) => at >= r.start && at <= r.end)) return `el efecto ${i + 1} (sfx) cae en una parte cortada o fuera del clip`;
      if (e.sound !== undefined && e.sound !== 'whoosh' && e.sound !== 'pop' && e.sound !== 'hit') return `el efecto ${i + 1}: sound debe ser whoosh, pop o hit`;
    } else if (e.type === 'polish') {
      if (polish) return 'solo puede haber un polish';
      polish = true;
    } else {
      return `el efecto ${i + 1} tiene un tipo desconocido (usa punch, fadeIn, fadeOut, sfx o polish)`;
    }
  }
  return null;
}

export function validateLongSpec(l: unknown, vodDurationSec?: number): string | null {
  if (!isObj(l)) return 'no es un objeto';
  if (!Array.isArray(l.segments) || l.segments.length === 0) return 'no tiene tramos';
  if (l.segments.length > MAX_LONG_SEGMENTS) return `tiene más de ${MAX_LONG_SEGMENTS} tramos`;
  let total = 0;
  for (let i = 0; i < l.segments.length; i++) {
    const s: unknown = l.segments[i];
    if (!isObj(s) || !isNum(s.start) || !isNum(s.end)) return `el tramo ${i + 1} no tiene tiempos numéricos`;
    if (s.start < 0 || s.end <= s.start) return `el tramo ${i + 1} tiene tiempos no válidos`;
    if (s.end - s.start < MIN_CLIP_SEC) return `el tramo ${i + 1} dura menos de ${MIN_CLIP_SEC} segundo`;
    if (vodDurationSec !== undefined && s.end > vodDurationSec + END_TOLERANCE_SEC) {
      return `el tramo ${i + 1} acaba después del final del VOD`;
    }
    total += s.end - s.start;
  }
  if (total > MAX_LONG_SEC) return `dura más de ${MAX_LONG_SEC / 60} minutos en total`;
  if (l.title !== undefined && typeof l.title !== 'string') return 'el título debe ser texto';
  const fx = validateEffects(l.effects, l.segments as Range[]);
  if (fx) return fx;
  if (l.subtitles !== undefined && !isSubtitleStyleId(l.subtitles)) return 'el estilo de subtítulos no existe';
  return null;
}

/** Normaliza un clip ya validado (título recortado, valores por defecto). */
export function normalizeClip(c: ClipSpec, fallbackTitle: string): ClipSpec {
  const out: ClipSpec = { kind: c.kind ?? 'both', start: c.start, end: c.end, title: cleanTitle(c.title, fallbackTitle), cropX: c.cropX };
  if (c.cuts?.length) out.cuts = c.cuts.map((x) => ({ start: x.start, end: x.end })).sort((a, b) => a.start - b.start);
  if (c.effects?.length) out.effects = normalizeEffects(c.effects);
  if (c.subtitles) out.subtitles = c.subtitles;
  if (c.layout) out.layout = normalizeLayout(c.layout);
  return out;
}

export function normalizeEffects(list: Effect[]): Effect[] {
  return list.map((e): Effect => {
    if (e.type === 'punch') return { type: 'punch', at: e.at, duration: e.duration ?? PUNCH.defaultDur, zoom: e.zoom ?? PUNCH.defaultZoom };
    if (e.type === 'sfx') return { type: 'sfx', at: e.at, sound: e.sound ?? 'pop' };
    if (e.type === 'polish') return { type: 'polish' };
    return { type: e.type, duration: e.duration ?? FADE.default };
  });
}

export function normalizeLong(l: LongSpec): LongSpec {
  const out: LongSpec = {
    title: cleanTitle(l.title, 'Vídeo largo'),
    segments: l.segments.map((s) => ({ start: s.start, end: s.end })),
  };
  if (l.effects?.length) out.effects = normalizeEffects(l.effects);
  if (l.subtitles) out.subtitles = l.subtitles;
  return out;
}

/**
 * Valida el JSON de decisiones de edición (el que devolverá Claude) contra la duración del VOD.
 * Lanza si el JSON no es utilizable; lo que sea inválido por elementos se descarta y se avisa.
 */
export function parsePlan(json: string, vodDurationSec: number): { plan: EditPlan; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`JSON no válido: ${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new Error('El plan debe ser un objeto con "clips" y/o "long".');
  if (raw.clips !== undefined && !Array.isArray(raw.clips)) throw new Error('"clips" debe ser una lista.');
  if (raw.clips === undefined && raw.long === undefined) throw new Error('El plan no contiene clips ni vídeo largo.');

  const errors: string[] = [];
  const clips: ClipSpec[] = [];
  const rawClips: unknown[] = Array.isArray(raw.clips) ? raw.clips : [];
  if (rawClips.length > MAX_CLIPS_PER_PLAN) {
    errors.push(`el plan tiene ${rawClips.length} clips; solo se usan los primeros ${MAX_CLIPS_PER_PLAN}`);
  }
  rawClips.slice(0, MAX_CLIPS_PER_PLAN).forEach((c, i) => {
    const reason = validateClipSpec(c, vodDurationSec);
    if (reason) errors.push(`clip ${i + 1}: ${reason}`);
    else clips.push(normalizeClip(c as ClipSpec, `Clip ${i + 1}`));
  });

  let long: LongSpec | undefined;
  if (raw.long !== undefined) {
    const reason = validateLongSpec(raw.long, vodDurationSec);
    if (reason) errors.push(`vídeo largo: ${reason}`);
    else long = normalizeLong(raw.long as LongSpec);
  }
  return { plan: { clips, long }, errors };
}

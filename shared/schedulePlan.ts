import type { OutputItem, OutputKind, Platform, Publication } from './types';
import { localDayKey } from './agenda';

/** Una «subida» en la línea de tiempo: un vídeo a una hora, con todas las redes que van a esa hora juntas. */
export interface Block {
  id: string;
  outputId: string;
  title: string;
  /** Vídeo largo (solo YouTube) o clip (todas las redes). */
  kind: OutputKind;
  /** Instante en ms. */
  at: number;
  platforms: Platform[];
  /** Claves de las publicaciones que forman el bloque. */
  keys: string[];
  /** Si se está publicando ahora mismo no se puede mover. */
  locked: boolean;
  note?: string;
}

export const STEP_MIN = 15;
const PAST_GRACE_MS = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Agrupa lo programado por vídeo y hora: las redes de un mismo vídeo a la misma hora se mueven juntas. */
export function groupBlocks(pubs: readonly Publication[], outputs: readonly OutputItem[]): Block[] {
  const map = new Map<string, Block>();
  for (const p of pubs) {
    if (p.status !== 'scheduled' && p.status !== 'publishing') continue;
    const at = Date.parse(p.scheduledAt);
    if (Number.isNaN(at)) continue;
    const id = `${p.outputId}@${at}`;
    const b = map.get(id) ?? { id, outputId: p.outputId, title: outputs.find((o) => o.id === p.outputId)?.title ?? 'Vídeo borrado', kind: outputs.find((o) => o.id === p.outputId)?.kind ?? 'clip', at, platforms: [], keys: [], locked: false };
    b.platforms.push(p.platform);
    b.keys.push(p.key);
    if (p.status === 'publishing') b.locked = true;
    if (p.note) b.note = p.note;
    map.set(id, b);
  }
  return [...map.values()].sort((a, b) => a.at - b.at || a.title.localeCompare(b.title));
}

/** Minutos desde las 00:00 locales. */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Redondea a múltiplos de `step` y lo deja dentro del día (0 … 23:45). */
export function snapMinutes(m: number, step = STEP_MIN): number {
  const s = Math.round(m / step) * step;
  return Math.max(0, Math.min(24 * 60 - step, s));
}

export function dayStartMs(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

/** Instante local de un día y unos minutos (resiste el cambio de hora). */
export function atFromDayMinutes(dayKey: string, minutes: number): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minutes / 60), minutes % 60, 0, 0).getTime();
}

/** Cambia el día conservando la hora local. */
export function moveToDay(at: number, dayKey: string): number {
  return atFromDayMinutes(dayKey, minutesOfDay(at));
}

/** `null` si se puede mover ahí; si no, el motivo. */
export function validateMove(newAt: number, now: number): string | null {
  return newAt < now - PAST_GRACE_MS ? 'Esa hora ya ha pasado. Elige una hora futura.' : null;
}

/** Día (AAAA-MM-DD) y `count - 1` siguientes a partir de un instante. */
export function daysFrom(anchor: number, count: number): string[] {
  const d = new Date(anchor);
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, 12).getTime()));
  return out;
}

export function addDays(dayKey: string, n: number): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + n, 12).getTime());
}

/** Rejilla de un mes: 6 semanas × 7 días, empezando en lunes. Incluye los días de los meses vecinos. */
export function monthGrid(year: number, month0: number): string[][] {
  const first = new Date(year, month0, 1, 12);
  const offset = (first.getDay() + 6) % 7; // lunes = 0
  const start = new Date(year, month0, 1 - offset, 12);
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: string[] = [];
    for (let d = 0; d < 7; d++) row.push(localDayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d, 12).getTime()));
    weeks.push(row);
  }
  return weeks;
}

/**
 * Reparte los bloques de un día en carriles para que no se tapen: dos bloques comparten carril solo si
 * están separados al menos `widthMin` minutos (lo que ocupa un bloque en el eje).
 */
export function layoutLanes(items: readonly { id: string; at: number }[], widthMin: number): { lanes: Map<string, number>; count: number } {
  const sorted = [...items].sort((a, b) => minutesOfDay(a.at) - minutesOfDay(b.at) || a.id.localeCompare(b.id));
  const laneEnd: number[] = [];
  const lanes = new Map<string, number>();
  for (const it of sorted) {
    const start = minutesOfDay(it.at);
    let lane = laneEnd.findIndex((end) => end <= start);
    if (lane < 0) {
      lane = laneEnd.length;
      laneEnd.push(0);
    }
    laneEnd[lane] = start + widthMin;
    lanes.set(it.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnd.length) };
}

/** Vídeos que aún no tienen ninguna subida (ni programada, ni en curso, ni publicada). */
export function unscheduledOutputs(outputs: readonly OutputItem[], pubs: readonly Publication[]): OutputItem[] {
  const used = new Set(pubs.filter((p) => p.status === 'scheduled' || p.status === 'publishing' || p.status === 'published').map((p) => p.outputId));
  return outputs.filter((o) => !used.has(o.id));
}

/** Hora por defecto al soltar un vídeo en un día: la primera hora habitual que aún no ha pasado, o la última del día. */
export function defaultWhenForDay(dayKey: string, now: number, slots: readonly string[]): string {
  const times = [...slots].filter((s) => /^\d{2}:\d{2}$/.test(s)).sort();
  const list = times.length ? times : ['16:00'];
  for (const t of list) {
    const [h, m] = t.split(':').map(Number);
    if (atFromDayMinutes(dayKey, h * 60 + m) > now) return `${dayKey}T${t}`;
  }
  // todas pasadas (es hoy): la próxima hora en punto
  const d = new Date(now + 3_600_000);
  d.setMinutes(0, 0, 0);
  const sameDay = localDayKey(d.getTime()) === dayKey;
  return sameDay ? `${dayKey}T${pad(d.getHours())}:00` : `${dayKey}T${list[list.length - 1]}`;
}

/** Texto de la hora de un bloque, «16:15». */
export const hhmm = (ms: number): string => `${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;

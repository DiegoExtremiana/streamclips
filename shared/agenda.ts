import type { OutputItem, Platform, Publication } from './types';

export interface AgendaEntry {
  pub: Publication;
  title: string;
}
export interface AgendaDay {
  /** Clave AAAA-MM-DD en hora local. */
  key: string;
  /** Primera hora del día, para ordenar y poner el nombre del día. */
  at: number;
  entries: AgendaEntry[];
}

const pad = (n: number) => String(n).padStart(2, '0');
export const localDayKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Agrupa lo programado por día (hora local) y ordena por hora. Dentro de un día puede haber todas las subidas
 * que se quiera. Lo ya publicado o fallido no entra: es una agenda de lo que está por venir.
 */
export function buildAgenda(pubs: readonly Publication[], outputs: readonly OutputItem[]): AgendaDay[] {
  const days = new Map<string, AgendaDay>();
  const upcoming = pubs.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
  for (const pub of [...upcoming].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.key.localeCompare(b.key))) {
    const at = Date.parse(pub.scheduledAt);
    const key = localDayKey(at);
    const day = days.get(key) ?? { key, at, entries: [] };
    day.entries.push({ pub, title: outputs.find((o) => o.id === pub.outputId)?.title ?? 'Vídeo borrado' });
    days.set(key, day);
  }
  return [...days.values()].sort((a, b) => a.at - b.at);
}

/** Nombre humano de un día: «Hoy», «Mañana» o «jueves 15 de octubre». */
export function dayLabel(key: string, now: number = Date.now()): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now);
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diff = Math.round((date.getTime() - startToday) / 86_400_000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  const long = date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  return long;
}

/** Redes en las que un vídeo todavía se puede programar (no está publicado ni publicándose). */
export function freePlatforms(outputId: string, pubs: readonly Publication[], all: readonly Platform[]): Platform[] {
  return all.filter((pl) => {
    const p = pubs.find((x) => x.outputId === outputId && x.platform === pl);
    return !p || (p.status !== 'published' && p.status !== 'publishing');
  });
}

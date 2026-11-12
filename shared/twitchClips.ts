import type { OutputItem, TwitchClip, VodJob } from './types';

export type ClipLibraryState = 'library' | 'preparing' | 'none';

/**
 * Dónde está un clip de Twitch ahora mismo: ya en la Biblioteca (hay un vídeo creado a partir de él),
 * preparándose (descargado o descargándose, aún sin vídeo) o fuera. Se calcula con lo que hay en este momento,
 * así que si lo borras de la Biblioteca vuelve a poder añadirse.
 */
export function clipLibraryState(clipId: string, vods: VodJob[], outputs: OutputItem[]): ClipLibraryState {
  const vod = vods.find((v) => v.twitchId === clipId && v.origin === 'clip' && v.status !== 'error');
  if (!vod) return 'none';
  return outputs.some((o) => o.vodId === vod.id) ? 'library' : 'preparing';
}

const plain = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export type ClipSort = 'fecha' | 'nombre' | 'nota';
export type SortDir = 'asc' | 'desc';

/** Sentido por defecto de cada orden: lo más reciente, de la A a la Z y la mejor nota primero. */
export const defaultDir = (sort: ClipSort): SortDir => (sort === 'nombre' ? 'asc' : 'desc');

/**
 * Solo los que contienen el texto en el nombre (sin distinguir mayúsculas ni tildes), ordenados por fecha (por defecto, los más
 * recientes arriba), por nombre o por nota, en el sentido que se pida (ascendente o descendente; por defecto el de `defaultDir`).
 * Los clips aún sin nota quedan siempre al final al ordenar por nota, en cualquier sentido; entre iguales, los más recientes.
 */
export function filterClips(clips: TwitchClip[], query: string, sort: ClipSort = 'fecha', dir: SortDir = defaultDir(sort)): TwitchClip[] {
  const q = plain(query.trim());
  // en cada orden, «descendente» es: fecha, la más reciente primero; nombre, de la Z a la A; nota, la más alta primero
  const sign = dir === 'desc' ? 1 : -1;
  const date = (a: TwitchClip, b: TwitchClip) => b.createdAt.localeCompare(a.createdAt) * (sort === 'fecha' ? sign : 1);
  const cmp = (a: TwitchClip, b: TwitchClip): number => {
    if (sort === 'nombre') return -sign * plain(a.title).localeCompare(plain(b.title), 'es') || date(a, b);
    if (sort === 'nota') {
      if (a.score === undefined || b.score === undefined) return a.score === b.score ? date(a, b) : a.score === undefined ? 1 : -1;
      return sign * (b.score - a.score) || date(a, b);
    }
    return date(a, b);
  };
  return [...clips].sort(cmp).filter((c) => !q || plain(c.title).includes(q));
}

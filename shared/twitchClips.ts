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

const byDate = (a: TwitchClip, b: TwitchClip) => b.createdAt.localeCompare(a.createdAt);

/**
 * Solo los que contienen el texto en el nombre (sin distinguir mayúsculas ni tildes), ordenados por fecha (más recientes arriba,
 * por defecto), por nombre (de la A a la Z) o por nota (de mayor a menor; los aún sin valorar al final, y entre iguales, los más recientes).
 */
export function filterClips(clips: TwitchClip[], query: string, sort: ClipSort = 'fecha'): TwitchClip[] {
  const q = plain(query.trim());
  const cmp =
    sort === 'nombre'
      ? (a: TwitchClip, b: TwitchClip) => plain(a.title).localeCompare(plain(b.title), 'es') || byDate(a, b)
      : sort === 'nota'
        ? (a: TwitchClip, b: TwitchClip) => (b.score ?? -1) - (a.score ?? -1) || byDate(a, b)
        : byDate;
  return [...clips].sort(cmp).filter((c) => !q || plain(c.title).includes(q));
}

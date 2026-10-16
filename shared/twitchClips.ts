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

/** Más recientes arriba y, si hay texto, solo los que lo contienen en el nombre (sin distinguir mayúsculas ni tildes). */
export function filterClips(clips: TwitchClip[], query: string): TwitchClip[] {
  const q = plain(query.trim());
  return [...clips]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((c) => !q || plain(c.title).includes(q));
}

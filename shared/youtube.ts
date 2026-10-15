import type { OutputItem } from './types';

/** Límites de YouTube. El título y la descripción no admiten los signos < y >. */
export const YT_TITLE_MAX = 100;
export const YT_DESC_MAX = 5000;
export const YT_PLAYLIST_MAX = 150;

const ANGLE = /[<>]/;

/** Motivos por los que un vídeo largo no se podría subir tal cual a YouTube (lista vacía = todo bien). */
export function youtubeProblems(o: Pick<OutputItem, 'title' | 'description' | 'playlist'>): string[] {
  const out: string[] = [];
  if (o.title.length > YT_TITLE_MAX) out.push(`El nombre tiene ${o.title.length} caracteres y YouTube admite ${YT_TITLE_MAX}.`);
  if (ANGLE.test(o.title)) out.push('El nombre no puede contener < ni >.');
  if ((o.description ?? '').length > YT_DESC_MAX) out.push(`La descripción pasa de ${YT_DESC_MAX} caracteres.`);
  if (ANGLE.test(o.description ?? '')) out.push('La descripción no puede contener < ni >.');
  if ((o.playlist ?? '').length > YT_PLAYLIST_MAX) out.push(`El nombre de la lista pasa de ${YT_PLAYLIST_MAX} caracteres.`);
  return out;
}

export const hasAngle = (s: string): boolean => ANGLE.test(s);

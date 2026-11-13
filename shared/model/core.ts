/** Qué se renderiza (cada uno es un archivo con su medida). */
export type RenderKind = 'vertical' | 'horizontal' | 'long';
/** Qué es un elemento de la Biblioteca: un clip (con versión vertical y horizontal) o un vídeo largo. */
export type OutputKind = 'clip' | 'long';
/** Versiones que se piden al crear un clip. */
export type ClipFormat = 'both' | 'vertical' | 'horizontal';
export type Platform = 'youtube' | 'tiktok' | 'instagram';
export const ALL_PLATFORMS: readonly Platform[] = ['youtube', 'tiktok', 'instagram'];
/** Los vídeos largos solo se publican en YouTube; los clips, en todas las redes. */
export const VIDEO_PLATFORMS: readonly Platform[] = ['youtube'];
export const platformsFor = (kind: OutputKind): readonly Platform[] => (kind === 'long' ? VIDEO_PLATFORMS : ALL_PLATFORMS);
export const VIDEO_ONLY_YOUTUBE = 'Los vídeos solo se publican en YouTube; los clips pueden ir a todas las redes.';

/** Resultado que cruza la frontera IPC: así los errores llegan limpios a la interfaz. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

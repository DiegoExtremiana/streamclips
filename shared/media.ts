/** Esquema propio para que la interfaz reproduzca los vídeos locales sin acceso al disco. */
export const MEDIA_SCHEME = 'sc-media';

export type MediaPart = 'vertical' | 'horizontal' | 'long' | 'thumb';

/** `rev` solo sirve para saltarse la caché cuando el archivo cambia. */
export function mediaUrl(outputId: string, part: MediaPart, rev = ''): string {
  const q = rev ? `?v=${encodeURIComponent(rev)}` : '';
  return `${MEDIA_SCHEME}://o/${encodeURIComponent(outputId)}/${part}${q}`;
}

/** Interpreta una URL de medios; null si no es del formato esperado. */
export function parseMediaUrl(raw: string): { outputId: string; part: MediaPart } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== `${MEDIA_SCHEME}:` || u.hostname !== 'o') return null;
  const m = /^\/([^/]+)\/(vertical|horizontal|long|thumb)$/.exec(u.pathname);
  if (!m) return null;
  try {
    return { outputId: decodeURIComponent(m[1]), part: m[2] as MediaPart };
  } catch {
    return null;
  }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEDIA_SCHEME = void 0;
exports.mediaUrl = mediaUrl;
exports.parseMediaUrl = parseMediaUrl;
/** Esquema propio para que la interfaz reproduzca los vídeos locales sin acceso al disco. */
exports.MEDIA_SCHEME = 'sc-media';
/** `rev` solo sirve para saltarse la caché cuando el archivo cambia. */
function mediaUrl(outputId, part, rev = '') {
    const q = rev ? `?v=${encodeURIComponent(rev)}` : '';
    return `${exports.MEDIA_SCHEME}://o/${encodeURIComponent(outputId)}/${part}${q}`;
}
/** Interpreta una URL de medios; null si no es del formato esperado. */
function parseMediaUrl(raw) {
    let u;
    try {
        u = new URL(raw);
    }
    catch {
        return null;
    }
    if (u.protocol !== `${exports.MEDIA_SCHEME}:` || u.hostname !== 'o')
        return null;
    const m = /^\/([^/]+)\/(vertical|horizontal|long|thumb)$/.exec(u.pathname);
    if (!m)
        return null;
    try {
        return { outputId: decodeURIComponent(m[1]), part: m[2] };
    }
    catch {
        return null;
    }
}

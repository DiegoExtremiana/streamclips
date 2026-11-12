"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAngle = exports.YT_PLAYLIST_MAX = exports.YT_DESC_MAX = exports.YT_TITLE_MAX = void 0;
exports.youtubeProblems = youtubeProblems;
/** Límites de YouTube. El título y la descripción no admiten los signos < y >. */
exports.YT_TITLE_MAX = 100;
exports.YT_DESC_MAX = 5000;
exports.YT_PLAYLIST_MAX = 150;
const ANGLE = /[<>]/;
/** Motivos por los que un vídeo largo no se podría subir tal cual a YouTube (lista vacía = todo bien). */
function youtubeProblems(o) {
    const out = [];
    if (o.title.length > exports.YT_TITLE_MAX)
        out.push(`El nombre tiene ${o.title.length} caracteres y YouTube admite ${exports.YT_TITLE_MAX}.`);
    if (ANGLE.test(o.title))
        out.push('El nombre no puede contener < ni >.');
    if ((o.description ?? '').length > exports.YT_DESC_MAX)
        out.push(`La descripción pasa de ${exports.YT_DESC_MAX} caracteres.`);
    if (ANGLE.test(o.description ?? ''))
        out.push('La descripción no puede contener < ni >.');
    if ((o.playlist ?? '').length > exports.YT_PLAYLIST_MAX)
        out.push(`El nombre de la lista pasa de ${exports.YT_PLAYLIST_MAX} caracteres.`);
    return out;
}
const hasAngle = (s) => ANGLE.test(s);
exports.hasAngle = hasAngle;

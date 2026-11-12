"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RENDER_MIN_BYTES = void 0;
exports.slug = slug;
exports.uniqueOutputPath = uniqueOutputPath;
exports.isInside = isInside;
exports.isAbsoluteAnyOs = isAbsoluteAnyOs;
exports.stripQuotes = stripQuotes;
exports.thumbnailPath = thumbnailPath;
exports.freeBytes = freeBytes;
exports.ensureFreeSpace = ensureFreeSpace;
exports.vodBytesEstimate = vodBytesEstimate;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Texto -> nombre de archivo seguro (sin tildes, minúsculas, solo [a-z0-9-]). */
function slug(s) {
    return (s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'video');
}
/** Ruta única para un vídeo de salida: <dir>/<tipo>/<titulo>-<fecha>-<azar>.mp4 */
function uniqueOutputPath(outputDir, kind, title) {
    const stamp = Date.now().toString(36);
    const rand = node_crypto_1.default.randomBytes(3).toString('hex');
    return node_path_1.default.join(outputDir, kind, `${slug(title)}-${stamp}-${rand}.mp4`);
}
/** ¿`child` está dentro de `parent` (o es el propio `parent`)? Resuelve `..` antes de comparar. */
function isInside(parent, child) {
    const rel = node_path_1.default.relative(node_path_1.default.resolve(parent), node_path_1.default.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !node_path_1.default.isAbsolute(rel));
}
/** Ruta absoluta en Windows o en el sistema actual (para validar ajustes sin depender del SO de pruebas). */
function isAbsoluteAnyOs(p) {
    return node_path_1.default.isAbsolute(p) || node_path_1.default.win32.isAbsolute(p);
}
/** Windows "Copiar como ruta" pega la ruta entre comillas: se las quitamos. */
function stripQuotes(p) {
    return p.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
}
/** Ruta nueva para la miniatura de un vídeo (el nombre cambia en cada versión para evitar cachés). */
function thumbnailPath(outputDir, outputId) {
    return node_path_1.default.join(outputDir, 'miniaturas', `${outputId}-${node_crypto_1.default.randomBytes(3).toString('hex')}.jpg`);
}
const GB = 1024 ** 3;
/** Bytes libres en el disco donde está (o estará) `dir`; null si no se puede saber. */
function freeBytes(dir) {
    let d = node_path_1.default.resolve(dir);
    for (let i = 0; i < 64; i++) {
        try {
            const st = node_fs_1.default.statfsSync(d);
            return Number(st.bavail) * Number(st.bsize);
        }
        catch {
            const up = node_path_1.default.dirname(d);
            if (up === d)
                return null;
            d = up;
        }
    }
    return null;
}
/** Lanza un error claro si no queda espacio para `neededBytes`. Si no se puede medir, no bloquea. */
function ensureFreeSpace(dir, neededBytes, what, free = freeBytes) {
    const have = free(dir);
    if (have === null || have >= neededBytes)
        return;
    const f = (b) => (b / GB).toFixed(1).replace('.', ',');
    throw new Error(`No hay espacio suficiente en el disco para ${what}: quedan ${f(have)} GB y hacen falta unos ${f(neededBytes)} GB. Libera espacio o cambia la carpeta de salida en Ajustes.`);
}
/** Estimación del espacio de un VOD de Twitch a calidad de origen (≈3 GB por hora, con margen). */
function vodBytesEstimate(durationSec) {
    if (!durationSec || durationSec <= 0)
        return 6 * GB;
    return Math.ceil((durationSec / 3600) * 3.2 * GB + 1 * GB);
}
exports.RENDER_MIN_BYTES = 2 * GB;

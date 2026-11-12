"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMedia = resolveMedia;
exports.planMediaResponse = planMediaResponse;
const node_fs_1 = __importDefault(require("node:fs"));
const media_1 = require("../../shared/media");
/**
 * Traduce una URL sc-media://o/<id>/video|thumb al archivo real.
 * Solo existen los archivos que la aplicación tiene registrados: no hay forma de pedir una ruta cualquiera.
 */
function resolveMedia(ctx, rawUrl) {
    const parsed = (0, media_1.parseMediaUrl)(rawUrl);
    if (!parsed)
        return null;
    const o = ctx.store.data.outputs.find((x) => x.id === parsed.outputId);
    if (!o)
        return null;
    const file = parsed.part === 'thumb' ? o.thumbnail : o.files[parsed.part];
    if (!file || !node_fs_1.default.existsSync(file))
        return null;
    return file;
}
const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
/**
 * Respuesta con soporte de «Range»: sin él el reproductor no puede saltar a otro punto del vídeo.
 * Sin cabecera Range (o con varios rangos) se envía el archivo entero.
 */
function planMediaResponse(file, range) {
    const size = node_fs_1.default.statSync(file).size;
    const type = MIME[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
    const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const whole = {
        status: 200,
        headers: { ...base, 'Content-Length': String(size) },
        start: 0,
        end: Math.max(0, size - 1),
    };
    const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
    if (!m || (m[1] === '' && m[2] === ''))
        return whole;
    let start;
    let end;
    if (m[1] === '') {
        const n = Number(m[2]); // «los últimos n bytes»
        start = Math.max(0, size - n);
        end = size - 1;
    }
    else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    }
    if (size === 0 || start >= size || start > end) {
        return { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` }, start: 0, end: 0 };
    }
    return {
        status: 206,
        headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
        start,
        end,
    };
}

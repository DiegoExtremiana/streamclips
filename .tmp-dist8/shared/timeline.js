"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.totalDuration = exports.MIN_CUT_SEC = exports.MIN_KEPT_SEC = void 0;
exports.keptRanges = keptRanges;
exports.toOutputTime = toOutputTime;
/** Tramo más corto que se acepta al quitar partes de un clip (evita fragmentos de un parpadeo). */
exports.MIN_KEPT_SEC = 0.3;
exports.MIN_CUT_SEC = 0.1;
/** Resta los cortes a [start,end]: devuelve los tramos que se conservan, ordenados y sin solaparse. */
function keptRanges(start, end, cuts = []) {
    const sorted = cuts
        .map((c) => ({ start: Math.max(start, c.start), end: Math.min(end, c.end) }))
        .filter((c) => c.end > c.start)
        .sort((a, b) => a.start - b.start);
    const out = [];
    let cursor = start;
    for (const c of sorted) {
        if (c.start > cursor)
            out.push({ start: cursor, end: c.start });
        cursor = Math.max(cursor, c.end);
    }
    if (cursor < end)
        out.push({ start: cursor, end });
    return out;
}
const totalDuration = (ranges) => ranges.reduce((a, r) => a + (r.end - r.start), 0);
exports.totalDuration = totalDuration;
/** Instante del vídeo resultante que corresponde a un instante del VOD; null si ese instante se cortó. */
function toOutputTime(t, ranges) {
    let offset = 0;
    for (const r of ranges) {
        if (t >= r.start && t <= r.end)
            return offset + (t - r.start);
        offset += r.end - r.start;
    }
    return null;
}

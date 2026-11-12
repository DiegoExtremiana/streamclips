"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINE_MAX_GAP = exports.LINE_MAX_WORDS = void 0;
exports.editableLines = editableLines;
exports.applyLineChanges = applyLineChanges;
const transcript_1 = require("./transcript");
exports.LINE_MAX_WORDS = 9;
exports.LINE_MAX_GAP = 0.9;
/** Palabras del VOD que quedan dentro de lo que conserva el vídeo, agrupadas en líneas cortas y legibles. */
function editableLines(words, ranges) {
    const kept = words.filter((w) => ranges.some((r) => w.start >= r.start && w.start < r.end) && w.text.trim());
    const lines = [];
    let cur = [];
    const close = () => {
        if (!cur.length)
            return;
        lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text.trim()).join(' ') });
        cur = [];
    };
    for (const w of kept) {
        const prev = cur[cur.length - 1];
        if (prev && (w.start - prev.end > exports.LINE_MAX_GAP || cur.length >= exports.LINE_MAX_WORDS))
            close();
        cur.push(w);
        if (/[.!?…]$/.test(w.text.trim()))
            close();
    }
    close();
    return lines;
}
/**
 * Sustituye las palabras de cada línea corregida por las nuevas, repartidas en el mismo intervalo de tiempo.
 * Devuelve las palabras nuevas y, por cada cambio, lo que había y lo que hay (para aprender).
 */
function applyLineChanges(words, changes) {
    const sorted = [...changes].filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end >= c.start).sort((a, b) => a.start - b.start);
    const out = [];
    const changed = [];
    let ci = 0;
    let i = 0;
    // una palabra pertenece a la línea si su centro cae dentro (las palabras van pegadas: el final de una es el principio de la siguiente)
    const mid = (w) => (w.start + w.end) / 2;
    while (i < words.length) {
        while (ci < sorted.length && sorted[ci].end < mid(words[i]) - 0.001)
            ci++;
        const c = sorted[ci];
        if (c && mid(words[i]) >= c.start - 0.001) {
            const group = [];
            while (i < words.length && mid(words[i]) <= c.end + 0.001)
                group.push(words[i++]);
            const after = c.text.trim().split(/\s+/).filter(Boolean);
            const before = group.map((w) => w.text.trim());
            if (after.join(' ') !== before.join(' ')) {
                changed.push({ before, after });
                if (after.length)
                    out.push(...(0, transcript_1.spreadWords)(after.join(' '), group[0].start, Math.max(group[group.length - 1].end, group[0].start + 0.05 * after.length)));
            }
            else
                out.push(...group);
            ci++;
            continue;
        }
        out.push(words[i++]);
    }
    return { words: out, changed };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_LEN = exports.MIN_LEN = exports.momentKey = exports.emptyEdits = void 0;
exports.cleanEdits = cleanEdits;
exports.applyEdits = applyEdits;
const emptyEdits = () => ({ exclude: [], pin: [], trims: {}, extra: [] });
exports.emptyEdits = emptyEdits;
const momentKey = (start) => String(Math.round(start));
exports.momentKey = momentKey;
const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
/** Lee lo guardado en disco sin fiarse de él: lo que no tenga sentido se ignora. */
function cleanEdits(raw) {
    const r = (raw ?? {});
    const keys = (a) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && /^\d+$/.test(x)))].slice(0, 500) : []);
    const trims = {};
    if (r.trims && typeof r.trims === 'object') {
        for (const [k, v] of Object.entries(r.trims)) {
            const s = num(v?.start);
            const e = num(v?.end);
            if (/^\d+$/.test(k) && s !== null && e !== null && e - s >= exports.MIN_LEN && e - s <= exports.MAX_LEN)
                trims[k] = { start: s, end: e };
        }
    }
    const extra = (Array.isArray(r.extra) ? r.extra : []).flatMap((x) => {
        const s = num(x?.start);
        const e = num(x?.end);
        if (s === null || e === null || e - s < exports.MIN_LEN || e - s > exports.MAX_LEN)
            return [];
        const title = typeof x.title === 'string' ? x.title.replace(/[<>]/g, '').trim().slice(0, 60) : '';
        return [{ start: s, end: e, ...(title ? { title } : {}) }];
    });
    return { exclude: keys(r.exclude), pin: keys(r.pin), trims, extra: extra.slice(0, 100) };
}
exports.MIN_LEN = 8;
exports.MAX_LEN = 180;
/**
 * Aplica las correcciones a los candidatos valorados: lo excluido se descarta, lo fijado pasa siempre (nota 10), el recorte
 * manual manda sobre el del modelo y lo añadido a mano entra como un momento más con nota máxima.
 */
function applyEdits(items, edits) {
    const ex = new Set(edits.exclude);
    const pin = new Set(edits.pin);
    const out = items.map((it) => {
        const k = (0, exports.momentKey)(it.start);
        const trim = edits.trims[k];
        const j = { ...it.judgement, ...(trim ? { trim, manual: true } : {}), ...(ex.has(k) ? { discard: true } : pin.has(k) ? { discard: false } : {}) };
        return { ...it, judgement: j, total: pin.has(k) && !ex.has(k) ? Math.max(it.total, 10) : it.total };
    });
    for (const x of edits.extra) {
        if (ex.has((0, exports.momentKey)(x.start)))
            continue;
        out.push({
            id: `m${(0, exports.momentKey)(x.start)}`,
            start: x.start,
            end: x.end,
            signal: 10,
            total: 10,
            judgement: { id: `m${(0, exports.momentKey)(x.start)}`, scores: { humor: 10, originalidad: 10, interaccion: 10, reaccion: 10, contexto: 10, autonomia: 10 }, kind: 'otro', reason: 'Añadido por ti', discard: false, manual: true, ...(x.title ? { title: x.title } : {}) },
        });
    }
    return out;
}

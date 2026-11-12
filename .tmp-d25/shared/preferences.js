"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyPrefs = exports.MIN_DECISIONS = exports.MAX_BIAS = exports.STEP = void 0;
exports.cleanPrefs = cleanPrefs;
exports.learn = learn;
exports.biasFor = biasFor;
exports.applyPrefs = applyPrefs;
exports.describePrefs = describePrefs;
const judge_1 = require("./judge");
exports.STEP = 0.25;
exports.MAX_BIAS = 1.5;
/** Hasta no tener varias decisiones del mismo tipo el ajuste no se aplica: una sola vez no es una preferencia. */
exports.MIN_DECISIONS = 3;
const emptyPrefs = () => ({ enabled: true, kindBias: {}, counts: {} });
exports.emptyPrefs = emptyPrefs;
function cleanPrefs(raw) {
    const r = (raw ?? {});
    const out = (0, exports.emptyPrefs)();
    out.enabled = r.enabled !== false;
    for (const k of judge_1.KINDS) {
        const b = r.kindBias?.[k];
        const c = r.counts?.[k];
        if (typeof b === 'number' && Number.isFinite(b) && b !== 0)
            out.kindBias[k] = Math.max(-exports.MAX_BIAS, Math.min(exports.MAX_BIAS, Math.round(b * 100) / 100));
        if (typeof c === 'number' && Number.isFinite(c) && c > 0)
            out.counts[k] = Math.min(10000, Math.floor(c));
    }
    return out;
}
/** Registra una decisión: `exclude` baja el tipo, `include` lo sube. Devuelve las preferencias nuevas (no modifica la entrada). */
function learn(p, kind, action) {
    if (!judge_1.KINDS.includes(kind) || kind === 'otro')
        return p;
    const next = cleanPrefs(p);
    const b = (next.kindBias[kind] ?? 0) + (action === 'exclude' ? -exports.STEP : exports.STEP);
    next.kindBias[kind] = Math.max(-exports.MAX_BIAS, Math.min(exports.MAX_BIAS, Math.round(b * 100) / 100));
    next.counts[kind] = (next.counts[kind] ?? 0) + 1;
    return next;
}
/** Ajuste que se aplica hoy a un tipo (0 si está apagado o hay pocas decisiones). */
function biasFor(p, kind) {
    if (!p.enabled || (p.counts[kind] ?? 0) < exports.MIN_DECISIONS)
        return 0;
    return p.kindBias[kind] ?? 0;
}
/** Suma el ajuste a la nota de cada candidato (los momentos fijados o añadidos a mano no se tocan). */
function applyPrefs(items, p) {
    if (!p.enabled)
        return items;
    return items.map((it) => {
        if (it.total >= 10 || it.judgement.manual)
            return it;
        const b = biasFor(p, it.judgement.kind);
        return b ? { ...it, total: Math.max(0, Math.min(10, Math.round((it.total + b) * 100) / 100)) } : it;
    });
}
/** Resumen legible para Ajustes y para la nota del análisis. */
function describePrefs(p) {
    return judge_1.KINDS.filter((k) => (p.counts[k] ?? 0) > 0).map((k) => ({ kind: k, bias: p.kindBias[k] ?? 0, count: p.counts[k] ?? 0, active: biasFor(p, k) !== 0 }));
}

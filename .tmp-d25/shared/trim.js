"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromFraction = exports.toFraction = exports.round1 = exports.TRIM_CONTEXT_SEC = exports.TRIM_STEP = void 0;
exports.timelineWindow = timelineWindow;
exports.moveHandle = moveHandle;
exports.fmtTenths = fmtTenths;
const plan_1 = require("./plan");
exports.TRIM_STEP = 0.1;
/** Segundos de directo que se muestran a cada lado del clip para poder alargarlo. */
exports.TRIM_CONTEXT_SEC = 45;
const round1 = (n) => Math.round(n * 10) / 10;
exports.round1 = round1;
/** Tramo del directo que se dibuja en la línea de tiempo: el clip con algo de margen, sin salirse del VOD. */
function timelineWindow(r, vodDuration, pad = exports.TRIM_CONTEXT_SEC) {
    const start = Math.max(0, r.start - pad);
    const end = vodDuration && vodDuration > r.end ? Math.min(vodDuration, r.end + pad) : r.end + pad;
    return { start: (0, exports.round1)(start), end: (0, exports.round1)(Math.max(end, start + plan_1.MIN_CLIP_SEC)) };
}
/** Mueve un extremo del recorte respetando la duración mínima/máxima de un clip y los límites del directo. */
function moveHandle(which, t, r, vodDuration) {
    const hi = vodDuration && vodDuration > 0 ? vodDuration : Infinity;
    if (which === 'start') {
        const lo = Math.max(0, r.end - plan_1.MAX_CLIP_SEC);
        const start = Math.min(Math.max(t, lo), r.end - plan_1.MIN_CLIP_SEC);
        return { start: (0, exports.round1)(Math.max(0, start)), end: r.end };
    }
    const end = Math.max(Math.min(t, hi, r.start + plan_1.MAX_CLIP_SEC), r.start + plan_1.MIN_CLIP_SEC);
    return { start: r.start, end: (0, exports.round1)(end) };
}
/** Posición (0..1) de un instante dentro de la ventana, y el camino inverso. */
const toFraction = (t, w) => (w.end > w.start ? Math.min(1, Math.max(0, (t - w.start) / (w.end - w.start))) : 0);
exports.toFraction = toFraction;
const fromFraction = (f, w) => w.start + Math.min(1, Math.max(0, f)) * (w.end - w.start);
exports.fromFraction = fromFraction;
/** 83 -> «1:23»; 83.4 -> «1:23.4» (las décimas solo si hacen falta). */
function fmtTenths(sec) {
    const v = Math.max(0, (0, exports.round1)(sec));
    const whole = Math.floor(v);
    const frac = (0, exports.round1)(v - whole);
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    const ss = `${String(s).padStart(2, '0')}${frac > 0 ? `.${Math.round(frac * 10)}` : ''}`;
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

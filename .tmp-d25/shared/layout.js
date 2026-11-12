"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clamp = exports.defaultPreset = exports.findPreset = exports.presetsFor = exports.PRESETS = exports.MIN_DST = exports.MIN_SRC = exports.MAX_WINDOWS = exports.OUT_H = exports.OUT_W = void 0;
exports.srcWidthFor = srcWidthFor;
exports.fitSrc = fitSrc;
exports.layoutFromPreset = layoutFromPreset;
exports.applyPresetKeeping = applyPresetKeeping;
exports.moveSrc = moveSrc;
exports.resizeSrc = resizeSrc;
exports.layoutFromCropX = layoutFromCropX;
exports.validateLayout = validateLayout;
exports.normalizeLayout = normalizeLayout;
exports.dstPixels = dstPixels;
exports.resizeFromCorner = resizeFromCorner;
exports.rowsOf = rowsOf;
exports.setWindowHeight = setWindowHeight;
exports.setWindowWidth = setWindowWidth;
exports.dividers = dividers;
exports.moveDivider = moveDivider;
exports.OUT_W = 1080;
exports.OUT_H = 1920;
exports.MAX_WINDOWS = 3;
exports.MIN_SRC = 0.06; // tamaño mínimo de lo que se recoge del origen (fracción del fotograma)
exports.MIN_DST = 0.1;
const EPS = 1e-6;
const r = (x, y, w, h) => ({ x, y, w, h });
exports.PRESETS = [
    { id: 'una', label: 'Pantalla completa', count: 1, focus: ['game'], dst: [r(0, 0, 1, 1)] },
    { id: 'dos-camara-arriba', label: 'Cámara arriba', count: 2, focus: ['cam', 'game'], dst: [r(0, 0, 1, 0.35), r(0, 0.35, 1, 0.65)] },
    { id: 'dos-mitad', label: 'Mitad y mitad', count: 2, focus: ['cam', 'game'], dst: [r(0, 0, 1, 0.5), r(0, 0.5, 1, 0.5)] },
    { id: 'dos-juego-arriba', label: 'Juego arriba', count: 2, focus: ['game', 'cam'], dst: [r(0, 0, 1, 0.65), r(0, 0.65, 1, 0.35)] },
    { id: 'tres-franjas', label: 'Cámara, juego y chat', count: 3, focus: ['cam', 'game', 'chat'], dst: [r(0, 0, 1, 0.25), r(0, 0.25, 1, 0.5), r(0, 0.75, 1, 0.25)] },
    { id: 'tres-dos-arriba', label: 'Dos arriba y juego', count: 3, focus: ['cam', 'chat', 'game'], dst: [r(0, 0, 0.5, 0.3), r(0.5, 0, 0.5, 0.3), r(0, 0.3, 1, 0.7)] },
    { id: 'tres-dos-abajo', label: 'Juego y dos abajo', count: 3, focus: ['game', 'cam', 'chat'], dst: [r(0, 0, 1, 0.6), r(0, 0.6, 0.5, 0.4), r(0.5, 0.6, 0.5, 0.4)] },
];
const presetsFor = (count) => exports.PRESETS.filter((p) => p.count === count);
exports.presetsFor = presetsFor;
const findPreset = (id) => exports.PRESETS.find((p) => p.id === id);
exports.findPreset = findPreset;
const defaultPreset = (count) => (0, exports.presetsFor)(count)[0] ?? exports.PRESETS[0];
exports.defaultPreset = defaultPreset;
/** Punto de partida de cada tipo de ventana sobre un fotograma típico de directo (cámara arriba a la izquierda…). */
const FOCUS = {
    cam: { cx: 0.14, cy: 0.2, h: 0.36 },
    game: { cx: 0.5, cy: 0.5, h: 1 },
    chat: { cx: 0.1, cy: 0.72, h: 0.5 },
};
/**
 * Anchura (0..1 del fotograma) que debe tener un recuadro de origen para que, al llenar el hueco `dst`,
 * no se deforme ni se recorte: misma proporción en píxeles. `frameAspect` = ancho/alto del fotograma.
 */
function srcWidthFor(dst, h, frameAspect) {
    const dstAspect = (dst.w * exports.OUT_W) / (dst.h * exports.OUT_H);
    return (h * dstAspect) / frameAspect;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
exports.clamp = clamp;
/** Recuadro con la proporción del hueco, centrado en (cx, cy) y con la altura pedida (reducida si no cabe). */
function fitSrc(dst, cx, cy, h, frameAspect) {
    const maxH = Math.min(1, 1 / (srcWidthFor(dst, 1, frameAspect) || 1));
    const hh = (0, exports.clamp)(h, exports.MIN_SRC, maxH);
    const ww = srcWidthFor(dst, hh, frameAspect);
    return { x: (0, exports.clamp)(cx - ww / 2, 0, 1 - ww), y: (0, exports.clamp)(cy - hh / 2, 0, 1 - hh), w: ww, h: hh };
}
/** Disposición de partida: el hueco de cada ventana y un recuadro de origen razonable. */
function layoutFromPreset(preset, frameAspect) {
    return {
        preset: preset.id,
        windows: preset.dst.map((dst, i) => {
            const f = FOCUS[preset.focus[i]];
            return { dst: { ...dst }, src: fitSrc(dst, f.cx, f.cy, f.h, frameAspect) };
        }),
    };
}
/** Cambia el hueco de las ventanas manteniendo lo que cada una estaba recogiendo (centro y alto). */
function applyPresetKeeping(layout, preset, frameAspect) {
    if (layout.windows.length !== preset.count)
        return layoutFromPreset(preset, frameAspect);
    return {
        preset: preset.id,
        windows: preset.dst.map((dst, i) => {
            const s = layout.windows[i].src;
            return { dst: { ...dst }, src: fitSrc(dst, s.x + s.w / 2, s.y + s.h / 2, s.h, frameAspect) };
        }),
    };
}
/** Mueve un recuadro sin salirse del fotograma. */
function moveSrc(src, dx, dy) {
    return { ...src, x: (0, exports.clamp)(src.x + dx, 0, 1 - src.w), y: (0, exports.clamp)(src.y + dy, 0, 1 - src.h) };
}
/** Cambia el tamaño manteniendo la proporción y la esquina superior izquierda fija (o el centro si no cabe). */
function resizeSrc(src, dst, newH, frameAspect) {
    const cx = src.x + src.w / 2;
    const cy = src.y + src.h / 2;
    return fitSrc(dst, cx, cy, newH, frameAspect);
}
/** Equivalente de un encuadre antiguo (`cropX`): una sola ventana a pantalla completa. */
function layoutFromCropX(cropX, frameAspect) {
    const dst = r(0, 0, 1, 1);
    const h = 1;
    const w = srcWidthFor(dst, h, frameAspect);
    const x = (1 - Math.min(1, w)) * (0, exports.clamp)(cropX, 0, 1);
    return { preset: 'una', windows: [{ dst, src: { x, y: 0, w: Math.min(1, w), h } }] };
}
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
function rectReason(rc, min, what) {
    if (!rc || typeof rc !== 'object')
        return `${what} no es un rectángulo`;
    const { x, y, w, h } = rc;
    if (![x, y, w, h].every(isNum))
        return `${what} tiene valores que no son números`;
    if (x < -EPS || y < -EPS || x + w > 1 + EPS || y + h > 1 + EPS)
        return `${what} se sale del fotograma`;
    if (w < min - EPS || h < min - EPS)
        return `${what} es demasiado pequeño`;
    return null;
}
/** Motivo por el que una composición no vale, o null. */
function validateLayout(l) {
    if (!l || typeof l !== 'object' || !Array.isArray(l.windows))
        return 'la composición vertical no es válida';
    const ws = l.windows;
    if (ws.length < 1 || ws.length > exports.MAX_WINDOWS)
        return `la composición vertical lleva de 1 a ${exports.MAX_WINDOWS} ventanas`;
    for (const [i, w] of ws.entries()) {
        const a = rectReason(w?.src, exports.MIN_SRC, `el recuadro de la ventana ${i + 1}`);
        if (a)
            return a;
        const b = rectReason(w?.dst, exports.MIN_DST, `el hueco de la ventana ${i + 1}`);
        if (b)
            return b;
    }
    return null;
}
/** Copia limpia (solo los campos conocidos, redondeados) para guardarla. */
function normalizeLayout(l) {
    const q = (n) => Math.round(n * 10000) / 10000;
    const nr = (rc) => ({ x: q((0, exports.clamp)(rc.x, 0, 1)), y: q((0, exports.clamp)(rc.y, 0, 1)), w: q(rc.w), h: q(rc.h) });
    return { ...(l.preset ? { preset: l.preset } : {}), ...(l.custom ? { custom: true } : {}), windows: l.windows.map((w) => ({ src: nr(w.src), dst: nr(w.dst) })) };
}
/** Rectángulo en píxeles del lienzo de salida, con bordes pares y sin huecos entre ventanas contiguas. */
function dstPixels(dst) {
    const ev = (n) => Math.round(n / 2) * 2;
    const x0 = ev(dst.x * exports.OUT_W);
    const y0 = ev(dst.y * exports.OUT_H);
    const x1 = ev((dst.x + dst.w) * exports.OUT_W);
    const y1 = ev((dst.y + dst.h) * exports.OUT_H);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/**
 * Cambia el tamaño arrastrando la esquina inferior derecha: la esquina superior izquierda no se mueve, la proporción
 * se conserva y el recuadro no se sale del fotograma. (px, py) es la posición del puntero (0..1 del fotograma).
 */
function resizeFromCorner(src, dst, px, py, frameAspect) {
    const w1 = srcWidthFor(dst, 1, frameAspect) || 1; // anchura que corresponde a altura 1
    const wanted = Math.max(py - src.y, (px - src.x) / w1);
    const maxH = Math.max(exports.MIN_SRC, Math.min(1 - src.y, (1 - src.x) / w1));
    const h = (0, exports.clamp)(wanted, exports.MIN_SRC, maxH);
    return { x: src.x, y: src.y, w: h * w1, h };
}
/* ---- Tamaño de cada ventana (como en el editor de clips de Twitch): al cambiar una, las demás se adaptan ---- */
const SAME = 0.002;
/** Franjas horizontales del lienzo: las ventanas que empiezan a la misma altura forman una franja. */
function rowsOf(layout) {
    const rows = [];
    layout.windows.forEach((w, i) => {
        const row = rows.find((q) => Math.abs(q.top - w.dst.y) < SAME);
        if (row)
            row.items.push(i);
        else
            rows.push({ top: w.dst.y, h: w.dst.h, items: [i] });
    });
    for (const row of rows)
        row.items.sort((a, b) => layout.windows[a].dst.x - layout.windows[b].dst.x);
    return rows.sort((a, b) => a.top - b.top);
}
/** Reparte `total` entre tamaños con los pesos dados, sin bajar de `min` (si hay que subir alguno, se le quita a los demás). */
function distribute(weights, total, min) {
    const sum = weights.reduce((a, b) => a + b, 0) || weights.length;
    let sizes = weights.map((w) => ((w || 1) / sum) * total);
    for (let pass = 0; pass < 4; pass++) {
        const low = sizes.map((x) => x < min);
        if (!low.some(Boolean))
            break;
        const fixed = low.reduce((a, l) => a + (l ? min : 0), 0);
        const freeSum = sizes.reduce((a, x, i) => a + (low[i] ? 0 : x), 0) || 1;
        sizes = sizes.map((x, i) => (low[i] ? min : (x / freeSum) * (total - fixed)));
    }
    return sizes;
}
/** Cada ventana conserva lo que recoge (centro y alto) al cambiar su hueco; la anchura sale de la proporción nueva. */
function rebuild(layout, dsts, aspect) {
    return {
        ...layout,
        custom: true,
        windows: layout.windows.map((w, i) => ({ dst: dsts[i], src: fitSrc(dsts[i], w.src.x + w.src.w / 2, w.src.y + w.src.h / 2, w.src.h, aspect) })),
    };
}
/** Huecos nuevos a partir de las alturas de las franjas (contiguas desde arriba) y los anchos de las ventanas de cada una. */
function layoutDsts(layout, rows, heights, widths) {
    const out = layout.windows.map((w) => ({ ...w.dst }));
    let y = rows[0]?.top ?? 0;
    rows.forEach((row, ri) => {
        let x = layout.windows[row.items[0]].dst.x;
        for (const i of row.items) {
            const w = widths.get(i) ?? layout.windows[i].dst.w;
            out[i] = { x, y, w, h: heights[ri] };
            x += w;
        }
        y += heights[ri];
    });
    return out;
}
/** Alto de la ventana `index` (0..1 del lienzo): las demás franjas se reparten lo que sobra en proporción a lo que ya ocupaban. */
function setWindowHeight(layout, index, h, aspect) {
    const rows = rowsOf(layout);
    const ri = rows.findIndex((r) => r.items.includes(index));
    if (ri < 0 || rows.length < 2)
        return layout;
    const total = rows.reduce((a, r) => a + r.h, 0);
    const mine = (0, exports.clamp)(h, exports.MIN_DST, total - exports.MIN_DST * (rows.length - 1));
    const others = distribute(rows.filter((_, k) => k !== ri).map((r) => r.h), total - mine, exports.MIN_DST);
    let k = 0;
    const heights = rows.map((_, q) => (q === ri ? mine : others[k++]));
    return rebuild(layout, layoutDsts(layout, rows, heights, new Map()), aspect);
}
/** Ancho de la ventana `index` dentro de su franja (0..1 del lienzo): las otras de la franja se adaptan. */
function setWindowWidth(layout, index, w, aspect) {
    const rows = rowsOf(layout);
    const row = rows.find((r) => r.items.includes(index));
    if (!row || row.items.length < 2)
        return layout;
    const total = row.items.reduce((a, i) => a + layout.windows[i].dst.w, 0);
    const mine = (0, exports.clamp)(w, exports.MIN_DST, total - exports.MIN_DST * (row.items.length - 1));
    const rest = row.items.filter((i) => i !== index);
    const others = distribute(rest.map((i) => layout.windows[i].dst.w), total - mine, exports.MIN_DST);
    const widths = new Map([[index, mine]]);
    rest.forEach((i, k) => widths.set(i, others[k]));
    return rebuild(layout, layoutDsts(layout, rows, rows.map((r) => r.h), widths), aspect);
}
/** Líneas que se pueden arrastrar para cambiar el tamaño de las ventanas. */
function dividers(layout) {
    const rows = rowsOf(layout);
    const out = [];
    rows.forEach((row, ri) => {
        row.items.slice(1).forEach((i, k) => {
            const prev = row.items[k];
            out.push({ kind: 'v', pos: layout.windows[i].dst.x, from: row.top, to: row.top + row.h, before: prev, after: i });
        });
        const next = rows[ri + 1];
        if (next)
            out.push({ kind: 'h', pos: next.top, from: 0, to: 1, before: row.items[0], after: next.items[0] });
    });
    return out;
}
/** Mueve un divisor a la posición `pos` (0..1 del lienzo): la ventana anterior crece o encoge y la siguiente se adapta. */
function moveDivider(layout, d, pos, aspect) {
    const a = layout.windows[d.before].dst;
    if (d.kind === 'h')
        return setWindowHeight(layout, d.before, pos - a.y, aspect);
    return setWindowWidth(layout, d.before, pos - a.x, aspect);
}

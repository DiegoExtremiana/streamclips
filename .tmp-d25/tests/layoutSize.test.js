"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const layout_1 = require("../shared/layout");
const A = 16 / 9;
const make = (id) => (0, layout_1.layoutFromPreset)((0, layout_1.findPreset)(id), A);
const near = (a, b) => strict_1.default.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const tiles = (l) => {
    // las ventanas cubren el lienzo sin huecos ni solapes: la suma de áreas es 1
    const area = l.windows.reduce((s, w) => s + w.dst.w * w.dst.h, 0);
    near(area, 1);
};
(0, node_test_1.describe)('tamaño de cada ventana', () => {
    (0, node_test_1.it)('dos ventanas: cambiar el alto de la primera hace que la segunda ocupe lo que sobra', () => {
        const l = (0, layout_1.setWindowHeight)(make('dos-camara-arriba'), 0, 0.5, A);
        near(l.windows[0].dst.h, 0.5);
        near(l.windows[1].dst.y, 0.5);
        near(l.windows[1].dst.h, 0.5);
        strict_1.default.equal(l.custom, true);
        tiles(l);
        strict_1.default.equal((0, layout_1.validateLayout)(l), null);
    });
    (0, node_test_1.it)('tres franjas: las demás se reparten lo que queda en proporción a lo que ocupaban', () => {
        const base = make('tres-franjas'); // 0.25 / 0.5 / 0.25
        const l = (0, layout_1.setWindowHeight)(base, 1, 0.6, A);
        near(l.windows[1].dst.h, 0.6);
        near(l.windows[0].dst.h, 0.2);
        near(l.windows[2].dst.h, 0.2);
        near(l.windows[0].dst.y, 0);
        near(l.windows[1].dst.y, 0.2);
        near(l.windows[2].dst.y, 0.8);
        tiles(l);
    });
    (0, node_test_1.it)('nunca deja una ventana por debajo del mínimo, ni la que se cambia ni las demás', () => {
        const l = (0, layout_1.setWindowHeight)(make('tres-franjas'), 1, 5, A);
        for (const w of l.windows)
            strict_1.default.ok(w.dst.h >= layout_1.MIN_DST - 1e-9);
        tiles(l);
        const s = (0, layout_1.setWindowHeight)(make('tres-franjas'), 1, 0, A);
        strict_1.default.ok(s.windows[1].dst.h >= layout_1.MIN_DST - 1e-9);
        tiles(s);
    });
    (0, node_test_1.it)('dos arriba y juego: el ancho de una de las dos de arriba adapta la otra; el alto afecta a la franja entera', () => {
        const base = make('tres-dos-arriba'); // 0.5 / 0.5 arriba (alto 0.3), juego abajo
        const w = (0, layout_1.setWindowWidth)(base, 0, 0.7, A);
        near(w.windows[0].dst.w, 0.7);
        near(w.windows[1].dst.x, 0.7);
        near(w.windows[1].dst.w, 0.3);
        near(w.windows[2].dst.h, 0.7);
        tiles(w);
        const h = (0, layout_1.setWindowHeight)(w, 0, 0.45, A);
        near(h.windows[0].dst.h, 0.45);
        near(h.windows[1].dst.h, 0.45);
        near(h.windows[2].dst.y, 0.45);
        near(h.windows[2].dst.h, 0.55);
        // el ancho de la franja no cambia al cambiar su alto
        near(h.windows[0].dst.w, 0.7);
        tiles(h);
    });
    (0, node_test_1.it)('una ventana sola o sin vecinas no cambia (no hay con qué adaptarse)', () => {
        const one = make('una');
        strict_1.default.equal((0, layout_1.setWindowHeight)(one, 0, 0.5, A), one);
        strict_1.default.equal((0, layout_1.setWindowWidth)(make('dos-mitad'), 0, 0.3, A).windows[0].dst.w, 1);
    });
    (0, node_test_1.it)('lo que recoge cada ventana se conserva (centro y alto) y sigue llenando su hueco sin deformarse', () => {
        const base = make('dos-camara-arriba');
        const c0 = { x: base.windows[1].src.x + base.windows[1].src.w / 2, y: base.windows[1].src.y + base.windows[1].src.h / 2 };
        const l = (0, layout_1.setWindowHeight)(base, 0, 0.55, A);
        const s = l.windows[1].src;
        const d = l.windows[1].dst;
        // misma proporción en píxeles que el hueco
        near(s.w, (0, layout_1.srcWidthFor)(d, s.h, A));
        // el centro se mantiene salvo que se salga del fotograma
        strict_1.default.ok(Math.abs(s.x + s.w / 2 - c0.x) < 0.2 && Math.abs(s.y + s.h / 2 - c0.y) < 0.2);
        strict_1.default.equal((0, layout_1.validateLayout)(l), null);
    });
    (0, node_test_1.it)('divisores: hay uno entre cada par de ventanas y arrastrarlo cambia a la anterior y adapta a la siguiente', () => {
        const l = make('tres-dos-arriba');
        const ds = (0, layout_1.dividers)(l);
        strict_1.default.deepEqual(ds.map((d) => [d.kind, d.before, d.after]), [['v', 0, 1], ['h', 0, 2]]);
        const v = (0, layout_1.moveDivider)(l, ds[0], 0.3, A);
        near(v.windows[0].dst.w, 0.3);
        near(v.windows[1].dst.w, 0.7);
        const h = (0, layout_1.moveDivider)(l, ds[1], 0.5, A);
        near(h.windows[0].dst.h, 0.5);
        near(h.windows[2].dst.y, 0.5);
        near(h.windows[2].dst.h, 0.5);
        tiles(h);
        strict_1.default.equal((0, layout_1.dividers)(make('una')).length, 0);
    });
    (0, node_test_1.it)('se guarda como personalizada y se valida; rowsOf ordena franjas y ventanas', () => {
        const l = (0, layout_1.setWindowHeight)(make('tres-franjas'), 0, 0.4, A);
        strict_1.default.equal((0, layout_1.normalizeLayout)(l).custom, true);
        strict_1.default.equal((0, layout_1.normalizeLayout)(make('tres-franjas')).custom, undefined);
        const rows = (0, layout_1.rowsOf)(make('tres-dos-abajo'));
        strict_1.default.deepEqual(rows.map((r) => r.items), [[0], [1, 2]]);
    });
});

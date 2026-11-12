import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dividers, findPreset, layoutFromPreset, MIN_DST, moveDivider, normalizeLayout, rowsOf, setWindowHeight, setWindowWidth, srcWidthFor, validateLayout, type VerticalLayout } from '../shared/layout';

const A = 16 / 9;
const make = (id: string): VerticalLayout => layoutFromPreset(findPreset(id)!, A);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const tiles = (l: VerticalLayout) => {
  // las ventanas cubren el lienzo sin huecos ni solapes: la suma de áreas es 1
  const area = l.windows.reduce((s, w) => s + w.dst.w * w.dst.h, 0);
  near(area, 1);
};

describe('tamaño de cada ventana', () => {
  it('dos ventanas: cambiar el alto de la primera hace que la segunda ocupe lo que sobra', () => {
    const l = setWindowHeight(make('dos-camara-arriba'), 0, 0.5, A);
    near(l.windows[0].dst.h, 0.5);
    near(l.windows[1].dst.y, 0.5);
    near(l.windows[1].dst.h, 0.5);
    assert.equal(l.custom, true);
    tiles(l);
    assert.equal(validateLayout(l), null);
  });

  it('tres franjas: las demás se reparten lo que queda en proporción a lo que ocupaban', () => {
    const base = make('tres-franjas'); // 0.25 / 0.5 / 0.25
    const l = setWindowHeight(base, 1, 0.6, A);
    near(l.windows[1].dst.h, 0.6);
    near(l.windows[0].dst.h, 0.2);
    near(l.windows[2].dst.h, 0.2);
    near(l.windows[0].dst.y, 0);
    near(l.windows[1].dst.y, 0.2);
    near(l.windows[2].dst.y, 0.8);
    tiles(l);
  });

  it('nunca deja una ventana por debajo del mínimo, ni la que se cambia ni las demás', () => {
    const l = setWindowHeight(make('tres-franjas'), 1, 5, A);
    for (const w of l.windows) assert.ok(w.dst.h >= MIN_DST - 1e-9);
    tiles(l);
    const s = setWindowHeight(make('tres-franjas'), 1, 0, A);
    assert.ok(s.windows[1].dst.h >= MIN_DST - 1e-9);
    tiles(s);
  });

  it('dos arriba y juego: el ancho de una de las dos de arriba adapta la otra; el alto afecta a la franja entera', () => {
    const base = make('tres-dos-arriba'); // 0.5 / 0.5 arriba (alto 0.3), juego abajo
    const w = setWindowWidth(base, 0, 0.7, A);
    near(w.windows[0].dst.w, 0.7);
    near(w.windows[1].dst.x, 0.7);
    near(w.windows[1].dst.w, 0.3);
    near(w.windows[2].dst.h, 0.7);
    tiles(w);
    const h = setWindowHeight(w, 0, 0.45, A);
    near(h.windows[0].dst.h, 0.45);
    near(h.windows[1].dst.h, 0.45, );
    near(h.windows[2].dst.y, 0.45);
    near(h.windows[2].dst.h, 0.55);
    // el ancho de la franja no cambia al cambiar su alto
    near(h.windows[0].dst.w, 0.7);
    tiles(h);
  });

  it('una ventana sola o sin vecinas no cambia (no hay con qué adaptarse)', () => {
    const one = make('una');
    assert.equal(setWindowHeight(one, 0, 0.5, A), one);
    assert.equal(setWindowWidth(make('dos-mitad'), 0, 0.3, A).windows[0].dst.w, 1);
  });

  it('lo que recoge cada ventana se conserva (centro y alto) y sigue llenando su hueco sin deformarse', () => {
    const base = make('dos-camara-arriba');
    const c0 = { x: base.windows[1].src.x + base.windows[1].src.w / 2, y: base.windows[1].src.y + base.windows[1].src.h / 2 };
    const l = setWindowHeight(base, 0, 0.55, A);
    const s = l.windows[1].src;
    const d = l.windows[1].dst;
    // misma proporción en píxeles que el hueco
    near(s.w, srcWidthFor(d, s.h, A));
    // el centro se mantiene salvo que se salga del fotograma
    assert.ok(Math.abs(s.x + s.w / 2 - c0.x) < 0.2 && Math.abs(s.y + s.h / 2 - c0.y) < 0.2);
    assert.equal(validateLayout(l), null);
  });

  it('divisores: hay uno entre cada par de ventanas y arrastrarlo cambia a la anterior y adapta a la siguiente', () => {
    const l = make('tres-dos-arriba');
    const ds = dividers(l);
    assert.deepEqual(ds.map((d) => [d.kind, d.before, d.after]), [['v', 0, 1], ['h', 0, 2]]);
    const v = moveDivider(l, ds[0], 0.3, A);
    near(v.windows[0].dst.w, 0.3);
    near(v.windows[1].dst.w, 0.7);
    const h = moveDivider(l, ds[1], 0.5, A);
    near(h.windows[0].dst.h, 0.5);
    near(h.windows[2].dst.y, 0.5);
    near(h.windows[2].dst.h, 0.5);
    tiles(h);
    assert.equal(dividers(make('una')).length, 0);
  });

  it('se guarda como personalizada y se valida; rowsOf ordena franjas y ventanas', () => {
    const l = setWindowHeight(make('tres-franjas'), 0, 0.4, A);
    assert.equal(normalizeLayout(l).custom, true);
    assert.equal(normalizeLayout(make('tres-franjas')).custom, undefined);
    const rows = rowsOf(make('tres-dos-abajo'));
    assert.deepEqual(rows.map((r) => r.items), [[0], [1, 2]]);
  });
});

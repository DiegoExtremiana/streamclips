import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_H, COVER_W, emptyDesign, emptyHistory, fitSize, hit, newImageLayer, newRectLayer, newTextLayer, normalizeDesign, pushState, redo, reorder, undo,
} from '../shared/coverDesign';

describe('diseño de portadas', () => {
  it('un diseño roto o vacío se queda en un lienzo vacío', () => {
    assert.deepEqual(normalizeDesign(null).layers, []);
    assert.deepEqual(normalizeDesign('hola').layers, []);
    assert.deepEqual(normalizeDesign({ layers: 5 }).layers, []);
    assert.equal(normalizeDesign({ background: 'rojo' }).background, emptyDesign().background);
  });
  it('limpia los valores fuera de rango y descarta lo desconocido', () => {
    const d = normalizeDesign({
      background: '#112233',
      layers: [
        { type: 'text', text: 'Hola', size: 9999, strokeWidth: -4, color: 'nope', align: 'raro', opacity: 7, x: 'a' },
        { type: 'image', assetId: 'no-valido' },
        { type: 'image', assetId: 'a1b2c3d4e5f6', w: 0, h: 99999, adjust: { brightness: 900, blur: -1 } },
        { type: 'rect', color: '#ff0000', radius: 9999 },
        { type: 'ovni' },
        null,
      ],
    });
    assert.equal(d.layers.length, 3);
    const [t, im, re] = d.layers;
    assert.equal(t.type === 'text' && t.size, 600);
    assert.equal(t.type === 'text' && t.strokeWidth, 0);
    assert.equal(t.type === 'text' && t.color, '#ffffff');
    assert.equal(t.type === 'text' && t.align, 'center');
    assert.equal(t.opacity, 1);
    assert.equal(t.x, COVER_W / 2);
    assert.ok(im.type === 'image' && im.w >= 8 && im.h <= COVER_H * 4 && im.adjust.brightness === 250 && im.adjust.blur === 0);
    assert.ok(re.type === 'rect' && re.radius === 400);
  });
  it('los identificadores repetidos se arreglan', () => {
    const d = normalizeDesign({ layers: [{ type: 'rect', id: 'x' }, { type: 'rect', id: 'x' }] });
    assert.notEqual(d.layers[0].id, d.layers[1].id);
  });
  it('una imagen nueva cabe en el lienzo y un fondo lo cubre', () => {
    const f = fitSize(4000, 1000);
    assert.ok(f.w <= COVER_W * 0.8 + 1 && f.h <= COVER_H * 0.8 + 1);
    const c = fitSize(1000, 1000, true);
    assert.ok(c.w >= COVER_W && c.h >= COVER_H);
    const l = newImageLayer('a1b2c3d4e5f6', 'Yo', 600, 800);
    assert.equal(l.x, COVER_W / 2);
  });
  it('reordenar capas sube y baja sin salirse', () => {
    const a = newRectLayer(); const b = newRectLayer(); const c = newTextLayer();
    assert.deepEqual(reorder([a, b, c], a.id, 1).map((l) => l.id), [b.id, a.id, c.id]);
    assert.deepEqual(reorder([a, b, c], a.id, -1).map((l) => l.id), [a.id, b.id, c.id], 'la de abajo no baja más');
    assert.deepEqual(reorder([a, b, c], c.id, 1).map((l) => l.id), [a.id, b.id, c.id], 'la de arriba no sube más');
  });
  it('el clic acierta en capas giradas', () => {
    const r = { ...newRectLayer(), x: 100, y: 100, w: 200, h: 20, rotation: 90 };
    assert.equal(hit(r, 100, 190), true, 'girado 90° ahora es alto');
    assert.equal(hit(r, 190, 100), false);
  });
  it('deshacer y rehacer', () => {
    const d0 = emptyDesign();
    const d1 = { ...d0, background: '#ffffff' };
    let h = pushState(emptyHistory(), d0);
    const u = undo(h, d1)!;
    assert.equal(u.design.background, d0.background);
    h = u.history;
    assert.equal(redo(h, u.design)!.design.background, '#ffffff');
    assert.equal(undo(emptyHistory(), d1), null);
  });
});

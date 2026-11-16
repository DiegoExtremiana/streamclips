import test from 'node:test';
import assert from 'node:assert/strict';
import { planEdit } from '../shared/autoEdit';
import { mapFocus, punchFilter } from '../electron/services/ffmpeg';

const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });
const face = () => ({ x: 0.14, y: 0.2 });

test('zoom: solo en reacciones fuertes que además suenan fuertes, y siempre hacia su objetivo', () => {
  const words = [w('vamos', 3), w('¡hola!', 8), w('madre', 14), w('¡NO', 20), w('PUEDE!!', 20.5), w('vale', 40), w('¡joder!', 50)];
  const seg = { start: 0, end: 60 };
  const punches = (o: Parameters<typeof planEdit>[2]) => planEdit(words, seg, { minGap: 100, ...o }).effects.filter((x) => x.type === 'punch') as { at: number; x?: number; y?: number; zoom?: number }[];
  const quiet = Array.from({ length: 60 }, () => -30);
  const peakAt20 = quiet.map((v, i) => (i === 20 ? -10 : v));
  const p = punches({ energyDb: peakAt20, focusAt: face });
  assert.deepEqual(p.map((x) => x.at), [20.4]);
  assert.deepEqual([p[0].x, p[0].y], [0.14, 0.2], 'va hacia la cara, no al centro');
  assert.ok((p[0].zoom ?? 0) >= 1.28, 'reacción muy fuerte: más zoom');
  assert.equal(punches({}).length, 0, 'sin objetivo no hay zoom');
  assert.equal(punches({ focusAt: () => null }).length, 0);
  assert.equal(planEdit(words.slice(0, 3), seg, { minGap: 100, focusAt: face }).effects.filter((x) => x.type === 'punch').length, 0, 'una exclamación suelta no basta');
});

test('zoom: sin tope fijo por minuto, pero sin pisarse', () => {
  const words = Array.from({ length: 9 }, (_, i) => w('¡¡VAMOS!!', 2 + i * 7));
  const p = planEdit(words, { start: 0, end: 66 }, { minGap: 100, focusAt: face }).effects.filter((x) => x.type === 'punch') as { at: number }[];
  assert.equal(p.length, 9, 'cada reacción de verdad lleva su zoom: nueve en un minuto');
  const close = Array.from({ length: 6 }, (_, i) => w('¡¡VAMOS!!', 2 + i * 2));
  const q = planEdit(close, { start: 0, end: 20 }, { minGap: 100, focusAt: face }).effects.filter((x) => x.type === 'punch') as { at: number }[];
  for (let i = 1; i < q.length; i++) assert.ok(q[i].at - q[i - 1].at >= 6, 'dos zooms no se pisan');
});

test('el filtro se acerca al punto pedido y el objetivo se adapta al encuadre', () => {
  const f = punchFilter(1920, 1080, [{ a: 1, dur: 1.4, zoom: 1.4, x: 0.14, y: 0.2 }]);
  assert.match(f, /crop=w=1920:h=1080:x='max\(0,min\(iw-ow,\(0\.5\+\(-0\.360\)\*between/);
  assert.deepEqual(mapFocus({ x: 0.3, y: 0.4 }, {}), { x: 0.3, y: 0.4 });
  const col = mapFocus({ x: 0.5, y: 0.4 }, { vertical: true, cropX: 0.5 });
  assert.ok(col && Math.abs(col.x - 0.5) < 1e-9);
  assert.equal(mapFocus({ x: 0.05, y: 0.4 }, { vertical: true, cropX: 0.5 }), null, 'fuera de la columna vertical: no se ve, no hay zoom');
  const lay = { windows: [{ src: { x: 0, y: 0, w: 0.3, h: 0.4 }, dst: { x: 0, y: 0, w: 1, h: 0.35 } }, { src: { x: 0.3, y: 0, w: 0.7, h: 1 }, dst: { x: 0, y: 0.35, w: 1, h: 0.65 } }] };
  const cam = mapFocus({ x: 0.15, y: 0.2 }, { vertical: true, layout: lay });
  assert.ok(cam && Math.abs(cam.x - 0.5) < 1e-9 && Math.abs(cam.y - 0.175) < 1e-9, 'la cara cae en la ventana de la cámara');
});

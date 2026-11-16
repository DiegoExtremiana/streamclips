import test from 'node:test';
import assert from 'node:assert/strict';
import { chronicleCandidates, chronicleChunks, chronicleMap, chunkText, parseChronicle, parseClock } from '../shared/chronicle';
import { focusFinder, parseVisual, streamFace } from '../shared/visual';

test('cronista: el directo se parte en tramos y el último corto se une al anterior', () => {
  assert.deepEqual(chronicleChunks(3 * 3600 + 200).map((s) => [s.start, s.end]).slice(-2), [[8400, 9600], [9600, 11000]]);
  assert.equal(chronicleChunks(4 * 3600).length, 12);
  assert.deepEqual(chronicleChunks(600), [{ start: 0, end: 600 }]);
});

test('cronista: texto con marcas de tiempo, repartido si no cabe', () => {
  const words = Array.from({ length: 400 }, (_, i) => ({ text: `palabra${i}`, start: 1200 + i * 3, end: 1200 + i * 3 + 0.5 }));
  const t = chunkText(words, { start: 1200, end: 2400 });
  assert.match(t, /^\[0:20:00\] palabra0/);
  const small = chunkText(words, { start: 1200, end: 2400 }, 500);
  assert.ok(small.length <= 600 && /\[0:3\d:\d\d\]/.test(small), 'si no cabe, toma líneas de todo el tramo, no solo del principio');
});

test('cronista: ficha con momentos en tiempo del directo (también si vienen relativos al tramo)', () => {
  const seg = { start: 3600, end: 4800 };
  const c = parseChronicle({ resumen: 'Hablan de <b>NVIDIA</b>.', temas: ['NVIDIA', ''], momentos: [{ t: '1:05:00', que: 'Se ríe de la gráfica' }, { t: '2:00', que: 'relativo' }, { t: '9:00:00', que: 'fuera' }] }, seg)!;
  assert.equal(c.summary, 'Hablan de NVIDIA.');
  assert.deepEqual(c.topics, ['NVIDIA']);
  assert.deepEqual(c.moments.map((m) => m.at), [3900, 3720]);
  assert.equal(parseChronicle({ resumen: '', momentos: [] }, seg), null);
  assert.equal(parseClock('1:02:03'), 3723);
  assert.match(chronicleMap([c]), /MAPA DEL DIRECTO[\s\S]*1:00:00-1:20:00: Hablan de NVIDIA\. Temas: NVIDIA\./);
  const cands = chronicleCandidates([c], [{ start: 3880, end: 3950 }], 20000);
  assert.deepEqual(cands.map((x) => x.start), [3705], 'no pisa a los que ya hay');
});

test('visión: foco y cara, y hacia dónde va el zoom en cada instante', () => {
  const v = parseVisual({ imagen: [{ id: 'a', visual: 7, nota: 'grita', foco: { x: 0.8, y: 0.6 }, cara: { x: 0.12, y: 0.2 } }, { id: 'b', visual: 5, cara: { x: 0.14, y: 0.22 } }, { id: 'c', visual: 5, foco: { x: 3, y: 0 } }] }, new Set(['a', 'b', 'c']));
  assert.deepEqual(v[0].focus, { x: 0.8, y: 0.6 });
  assert.equal(v[2].focus, undefined, 'un punto fuera de la imagen no vale');
  const judged = [
    { start: 100, end: 140, visual: { focus: { x: 0.8, y: 0.6 }, face: { x: 0.12, y: 0.2 } } },
    { start: 500, end: 540, visual: { face: { x: 0.14, y: 0.22 } } },
    { start: 900, end: 940, visual: { face: { x: 0.13, y: 0.21 } } },
  ];
  assert.deepEqual(streamFace(judged), { x: 0.13, y: 0.21 });
  const f = focusFinder(judged)!;
  assert.deepEqual(f(120), { x: 0.8, y: 0.6 }, 'dentro de un momento mirado: su foco');
  assert.deepEqual(f(2000), { x: 0.13, y: 0.21 }, 'fuera: la cámara del streamer');
  assert.equal(focusFinder([{ start: 0, end: 10 }]), undefined, 'sin visión no hay objetivo');
});

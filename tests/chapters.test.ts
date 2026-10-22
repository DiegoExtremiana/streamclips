import assert from 'node:assert/strict';
import test from 'node:test';
import { chapterBlock, outputStarts } from '../shared/chapters';

test('outputStarts: suma lo que se conserva antes de cada tramo, con silencios quitados', () => {
  const segs = [{ start: 100, end: 160 }, { start: 400, end: 460 }, { start: 900, end: 960 }];
  // el primer tramo pierde 10 s de silencio en medio
  const kept = [{ start: 100, end: 120 }, { start: 130, end: 160 }, { start: 400, end: 460 }, { start: 900, end: 960 }];
  assert.deepEqual(outputStarts(segs, kept), [0, 50, 110]);
  assert.deepEqual(outputStarts(segs, segs), [0, 60, 120]);
});

test('chapterBlock: formato de YouTube, primero en 0:00, horas cuando hacen falta', () => {
  const b = chapterBlock([{ at: 0, label: 'Inicio' }, { at: 75, label: 'Primer susto' }, { at: 3725, label: 'El final' }], 4000);
  assert.equal(b, '0:00 Inicio\n1:15 Primer susto\n1:02:05 El final');
});

test('chapterBlock: sin 3 capítulos válidos no pone ninguno', () => {
  assert.equal(chapterBlock([{ at: 0, label: 'A' }, { at: 60, label: 'B' }], 200), '');
  // dos capítulos a menos de 10 s: se junta uno y quedan 2
  assert.equal(chapterBlock([{ at: 0, label: 'A' }, { at: 5, label: 'B' }, { at: 60, label: 'C' }], 200), '');
  assert.equal(chapterBlock([], 100), '');
});

test('chapterBlock: el último capítulo no puede durar menos de 10 s y el primero siempre es 0:00', () => {
  const b = chapterBlock([{ at: 3, label: 'A' }, { at: 40, label: 'B' }, { at: 90, label: 'C' }, { at: 195, label: 'D' }], 200);
  assert.equal(b, '0:00 A\n0:40 B\n1:30 C');
});

test('chapterBlock: limpia y recorta las etiquetas', () => {
  const b = chapterBlock([{ at: 0, label: '  Inicio  ' }, { at: 30, label: 'x'.repeat(100) }, { at: 60, label: 'a   b' }], 100);
  const lines = b.split('\n');
  assert.equal(lines[0], '0:00 Inicio');
  assert.equal(lines[1].length, '0:30 '.length + 60);
  assert.equal(lines[2], '1:00 a b');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Word } from '../shared/subtitles';
import { dropLoops, LOOP_KEEP } from '../shared/loops';

const seq = (texts: string[], t0 = 0): Word[] => texts.map((text, i) => ({ text, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.3 }));
const loop = (phrase: string, times: number) => Array.from({ length: times }, () => phrase.split(' ')).flat();
const speech = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`);

test('un bucle de Whisper se recorta y el resto del texto no se toca', () => {
  const ws = seq([...speech(40), ...loop('¿Qué pasa aquí?', 30), ...speech(40)]);
  const r = dropLoops(ws);
  // el habla de alrededor se conserva entera; del bucle quedan unas pocas palabras (las de la ventana de detección no cuentan)
  assert.ok(r.dropped >= 90 - LOOP_KEEP - 8 && r.dropped <= 90 - LOOP_KEEP, String(r.dropped));
  assert.deepEqual(r.words.slice(0, 40), ws.slice(0, 40));
  assert.deepEqual(r.words.slice(-40), ws.slice(-40));
});

test('un bucle con variaciones (puntuación, una palabra de más) también se detecta', () => {
  const ws = seq([...speech(30), ...Array.from({ length: 12 }, (_, i) => (i % 2 ? '¡Tentacruel está increíble, tío!' : '¿Tentacruel está increíble?').split(' ')).flat(), ...speech(30)]);
  assert.ok(dropLoops(ws).dropped > 20);
});

test('el habla normal, aunque repita alguna palabra, no pierde nada', () => {
  const real = 'no no no vale vale vale pero entonces eso es lo que te decía el otro día cuando fuimos a comprar el juego nuevo y resulta que no lo tenían así que volvimos a casa con las manos vacías y bastante cansados la verdad'.split(' ');
  const ws = seq([...real, ...real]);
  assert.equal(dropLoops(ws).dropped, 0);
  assert.equal(dropLoops(ws).words, ws, 'misma lista, sin copiar');
});

test('la risa seguida no es un bucle', () => {
  const ws = seq([...speech(30), ...loop('jajaja', 40), ...speech(30)]);
  assert.equal(dropLoops(ws).dropped, 0);
});

test('pocas palabras: no se toca; los tiempos de lo conservado no cambian', () => {
  const few = seq(['a', 'a', 'a', 'a']);
  assert.equal(dropLoops(few).words, few);
  const ws = seq(loop('sí', 50), 100);
  const r = dropLoops(ws);
  assert.equal(r.words.length, LOOP_KEEP);
  assert.equal(r.words[0].start, 100);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Word } from '../shared/subtitles';
import { planLong } from '../shared/autoEdit';
import { validateEffects } from '../shared/plan';

const words = (from: number, to: number): Word[] => Array.from({ length: Math.floor(to - from) }, (_, i) => ({ text: `palabra${i}`, start: from + i, end: from + i + 0.6 }));

test('un resumen con momentos separados lleva un whoosh en cada salto, no en el primero', () => {
  const segs = [{ start: 100, end: 140 }, { start: 400, end: 440 }, { start: 900, end: 940 }];
  const ws = segs.flatMap((s) => words(s.start, s.end));
  const p = planLong(ws, segs);
  const whooshes = p.effects.filter((e) => e.type === 'sfx' && e.sound === 'whoosh').map((e) => (e as { at: number }).at);
  assert.ok(whooshes.some((t) => Math.abs(t - 400.05) < 0.01), JSON.stringify(whooshes));
  assert.ok(whooshes.some((t) => Math.abs(t - 900.05) < 0.01));
  assert.ok(!whooshes.some((t) => t < 101), 'el primero no lleva transición');
  assert.equal(validateEffects(p.effects, p.segments), null, 'todos los efectos son válidos');
});

test('un tramo continuo (un solo bloque) no lleva transiciones', () => {
  const segs = [{ start: 100, end: 400 }];
  const p = planLong(words(100, 400), segs);
  assert.ok(!p.effects.some((e) => e.type === 'sfx' && e.sound === 'whoosh' && (e as { at: number }).at < 110 && (e as { at: number }).at > 100.04 && (e as { at: number }).at < 100.06));
});

test('tramos pegados (menos de 5 s) no se tratan como saltos', () => {
  const segs = [{ start: 100, end: 140 }, { start: 143, end: 180 }];
  const p = planLong([...words(100, 140), ...words(143, 180)], segs);
  assert.ok(!p.effects.some((e) => e.type === 'sfx' && e.sound === 'whoosh' && Math.abs((e as { at: number }).at - 143.05) < 0.01));
});

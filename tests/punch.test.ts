import test from 'node:test';
import assert from 'node:assert/strict';
import { planEdit } from '../shared/autoEdit';

const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });

test('zoom: no en cada exclamación; solo en la reacción fuerte y si además suena fuerte', () => {
  const words = [w('vamos', 3), w('¡hola!', 8), w('madre', 14), w('¡NO', 20), w('PUEDE!!', 20.5), w('vale', 40), w('¡joder!', 50)];
  const seg = { start: 0, end: 60 };
  const punches = (e?: number[]) => planEdit(words, seg, { energyDb: e, minGap: 100 }).effects.filter((x) => x.type === 'punch').map((x) => (x as { at: number }).at);
  const quiet = Array.from({ length: 60 }, () => -30);
  const peakAt20 = quiet.map((v, i) => (i === 20 ? -10 : v));
  assert.deepEqual(punches(peakAt20), [20.4]);
  assert.ok(punches().length <= 2, 'sin volumen, como mucho dos en un minuto');
  assert.equal(planEdit(words.slice(0, 3), seg, { minGap: 100 }).effects.filter((x) => x.type === 'punch').length, 0, 'una palabra suelta no basta');
});

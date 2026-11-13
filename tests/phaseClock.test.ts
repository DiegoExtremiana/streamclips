import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PhaseClock } from '../shared/phaseClock';

describe('cronómetro por fases', () => {
  it('suma el tiempo de cada fase y lo describe de lo más lento a lo más rápido', () => {
    let t = 0;
    const c = new PhaseClock(() => t);
    c.mark('volumen');
    t += 40_000;
    c.mark('transcripción');
    t += 200_000;
    c.mark('volumen'); // una fase puede repetirse: se suma
    t += 5_000;
    c.mark('nada');
    t += 400;
    c.mark(null);
    assert.deepEqual(c.seconds(), { volumen: 45, transcripción: 200, nada: 0.4 });
    assert.equal(c.describe(), 'transcripción 3 min, volumen 45 s');
  });
});

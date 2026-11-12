import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GOLD_MIN, heuristicScore, isGold, modelScore, peakRise, viewsPercentile } from '../shared/clipScore';

const words = (txt: string, dur: number) => txt.split(' ').map((text, i, a) => ({ text, start: (i / a.length) * dur, end: ((i + 0.8) / a.length) * dur }));
const quiet = Array.from({ length: 30 }, () => -40);
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];

describe('puntuación interna de clips', () => {
  it('percentil de visualizaciones: relativo a los demás y neutro si no hay con qué comparar', () => {
    const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(viewsPercentile(10, all), 0.95);
    assert.equal(viewsPercentile(1, all), 0.05);
    assert.equal(viewsPercentile(5, [1, 2]), 0.5);
    assert.equal(viewsPercentile(5, [NaN, 3, 4, 5, 6, 7, 8]), 3.5 / 6, 'ignora valores no numéricos');
  });

  it('pico de volumen: sube respecto a lo normal; sin audio o con silencio total es 0', () => {
    assert.ok(peakRise(loud) > 20);
    assert.equal(peakRise(quiet), 0);
    assert.equal(peakRise(undefined), 0);
    assert.equal(peakRise([-100, -100, -100, -100, -100]), 0);
  });

  it('un clip aburrido y poco visto queda bajo; uno con reacción, subidón, risas y muy visto llega a dorado', () => {
    const boring = heuristicScore({ durationSec: 30, words: words('vale pues sí', 30), energyDb: quiet }, 0.1);
    const great = heuristicScore({ durationSec: 30, words: words('no puede ser madre mía jajaja increíble vamos ostia no me lo creo siii qué brutal joder', 30).concat(words('jajaja ostia vamos no puede ser', 30)), energyDb: loud }, 0.98);
    assert.ok(boring < 3, String(boring));
    assert.ok(great >= GOLD_MIN, String(great));
    assert.equal(isGold(great), true);
  });

  it('ser muy visto no basta: sin nada más no llega a dorado, y los muy cortos o larguísimos puntúan menos', () => {
    const viral = heuristicScore({ durationSec: 30, words: words('hola', 30), energyDb: quiet }, 1);
    assert.ok(viral < GOLD_MIN, String(viral));
    const mk = (dur: number) => heuristicScore({ durationSec: dur, words: words('no puede ser madre mía jajaja increíble vamos', dur), energyDb: loud }, 0.9);
    assert.ok(mk(5) < mk(30));
    assert.ok(mk(120) < mk(30));
  });

  it('con modelo de lenguaje manda su valoración y las visualizaciones solo pesan un 15 %', () => {
    assert.equal(modelScore(9, 0.5), 8.4);
    assert.equal(modelScore(10, 1), 10);
    assert.equal(modelScore(4, 1), 4.9);
    assert.equal(modelScore(99, 5), 10);
    assert.equal(isGold(7.9), false);
    assert.equal(isGold(8), true);
    assert.equal(isGold(undefined), false);
  });
});

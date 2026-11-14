import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GOLD_MIN, isGold, modelScore, peakRise } from '../shared/clipScore';
import { heuristicScore } from '../shared/clipCriteria';

const words = (txt: string, dur: number) => txt.split(' ').map((text, i, a) => ({ text, start: (i / a.length) * dur, end: ((i + 0.8) / a.length) * dur }));
/** Habla densa (unas 2,5 palabras por segundo) repitiendo la frase, para que lo que se dice escale con la duración. */
const speech = (phrase: string, dur: number) => {
  const base = phrase.split(' ');
  return words(Array.from({ length: Math.round(dur * 2.5) }, (_, i) => base[i % base.length]).join(' '), dur);
};
const quiet = Array.from({ length: 30 }, () => -40);
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];

describe('puntuación interna de clips', () => {
  it('pico de volumen: sube respecto a lo normal; sin audio o con silencio total es 0', () => {
    assert.ok(peakRise(loud) > 20);
    assert.equal(peakRise(quiet), 0);
    assert.equal(peakRise(undefined), 0);
    assert.equal(peakRise([-100, -100, -100, -100, -100]), 0);
  });

  it('un clip aburrido queda bajo; uno con reacción, subidón y risas llega a dorado', () => {
    const boring = heuristicScore({ durationSec: 30, words: words('vale pues sí', 30), energyDb: quiet });
    const great = heuristicScore({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos ostia no me lo creo', 30), energyDb: loud });
    assert.ok(boring < 2, String(boring));
    assert.ok(great >= GOLD_MIN, String(great));
  });

  it('la nota no depende de las visualizaciones: la función ni las recibe', () => {
    assert.equal(heuristicScore.length, 1);
    assert.equal(modelScore.length, 1);
  });

  it('con un solo ingrediente no llega a dorado, y los muy cortos o larguísimos puntúan menos', () => {
    assert.ok(heuristicScore({ durationSec: 30, words: words('hola', 30), energyDb: loud }) < GOLD_MIN);
    assert.ok(heuristicScore({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos', 30), energyDb: quiet }) < GOLD_MIN);
    const mk = (dur: number) => heuristicScore({ durationSec: dur, words: speech('no puede ser madre mía jajaja increíble vamos', dur), energyDb: loud });
    assert.ok(mk(5) < mk(30));
    assert.ok(mk(120) < mk(30));
  });

  it('con modelo de lenguaje la nota es su valoración, acotada de 0 a 10', () => {
    assert.equal(modelScore(9.5), 9.5);
    assert.equal(modelScore(99), 10);
    assert.equal(modelScore(-3), 0);
    assert.equal(isGold(9.4), false);
    assert.equal(isGold(9.5), true);
    assert.equal(isGold(undefined), false);
  });
});

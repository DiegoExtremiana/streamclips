import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_CRITERIA, CRITERION_WEIGHT, clipJudgePrompt, criteriaFromSignals, heuristicScore, overall, parseClipJudgement, reasonFromCriteria } from '../shared/clipCriteria';

const speech = (phrase: string, dur: number, perSec = 2.5) => {
  const base = phrase.split(' ');
  const n = Math.round(dur * perSec);
  return Array.from({ length: n }, (_, i) => ({ text: base[i % base.length], start: (i / n) * dur, end: ((i + 0.8) / n) * dur }));
};
const quiet = Array.from({ length: 30 }, () => -40);
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];

describe('criterios de la nota de un clip', () => {
  it('los pesos suman 1 y la nota es su media ponderada', () => {
    assert.ok(Math.abs(CLIP_CRITERIA.reduce((a, k) => a + CRITERION_WEIGHT[k], 0) - 1) < 1e-9);
    assert.equal(overall({ humor: 10, historia: 10, viral: 10, interes: 10 }), 10);
    assert.equal(overall({ humor: 0, historia: 0, viral: 0, interes: 0 }), 0);
    assert.equal(overall({ humor: 8, historia: 4, viral: 6, interes: 6 }), 6.2);
  });

  it('risas y subidón dan humor; un relato con hilo da «se cuenta algo»; la charla plana no da nada', () => {
    const funny = criteriaFromSignals({ durationSec: 30, words: speech('jajaja no puede ser madre mía jajaja increíble vamos', 30), energyDb: loud });
    const story = criteriaFromSignals({ durationSec: 30, words: speech('entonces resulta que cuando llegué la puerta estaba abierta y luego vi que dentro había alguien pero no dije nada porque', 30), energyDb: quiet });
    const flat = criteriaFromSignals({ durationSec: 30, words: speech('vale pues sí', 30, 0.3), energyDb: quiet });
    assert.ok(funny.humor > story.humor + 2, JSON.stringify([funny, story]));
    assert.ok(story.historia > funny.historia, JSON.stringify([funny, story]));
    assert.ok(overall(flat) < 2, String(overall(flat)));
    for (const c of [funny, story, flat]) for (const k of CLIP_CRITERIA) assert.ok(c[k] >= 0 && c[k] <= 10);
  });

  it('un clip con todo a la vez llega a dorado y con un solo ingrediente no', () => {
    const all = heuristicScore({ durationSec: 30, words: speech('jajaja entonces no puede ser madre mía jajaja increíble vamos ostia porque resulta que', 30), energyDb: loud });
    assert.ok(all >= 8, String(all));
    assert.ok(heuristicScore({ durationSec: 30, words: speech('hola', 30), energyDb: loud }) < 8);
    assert.ok(heuristicScore({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos', 30), energyDb: quiet }) < 8);
  });

  it('el motivo dice qué criterios pesan y si no hubo modelo', () => {
    assert.match(reasonFromCriteria({ humor: 9, historia: 3, viral: 7, interes: 4 }, 'model'), /humor y puede ser viral/);
    assert.match(reasonFromCriteria({ humor: 1, historia: 1, viral: 1, interes: 1 }, 'signals'), /No destaca.*sin modelo de lenguaje/);
  });

  it('la respuesta del modelo se valida: sin los cuatro números no hay nota, y se acota de 0 a 10', () => {
    assert.equal(parseClipJudgement({ humor: 5, historia: 5, viral: 5 }), null);
    assert.equal(parseClipJudgement({ humor: '8', historia: 5, viral: 5, interes: 5 }), null);
    assert.equal(parseClipJudgement(null), null);
    const ok = parseClipJudgement({ humor: 12, historia: -2, viral: 7.26, interes: 5, motivo: '  Buen remate  ' })!;
    assert.deepEqual(ok.criteria, { humor: 10, historia: 0, viral: 7.3, interes: 5 });
    assert.equal(ok.reason, 'Buen remate');
  });

  it('el prompt incluye la transcripción y no menciona visualizaciones', () => {
    const p = clipJudgePrompt('Mi clip', speech('hola que tal', 4), 4);
    assert.match(p, /Transcripción:\nhola que tal/);
    assert.ok(!/vistas|visualizaciones/i.test(p.replace('Ignora', '')));
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLIP_CRITERIA, CRITERION_WEIGHT, RUBRIC, clipJudgePrompt, criteriaFromSignals, heuristicScore, overall, parseClipJudgement, reasonFromCriteria, viralMeasured, withMeasuredViral } from '../shared/clipCriteria';

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

  const answer = (n: number) => Object.fromEntries(CLIP_CRITERIA.map((k) => [k, Object.fromEntries(RUBRIC[k].map((it) => [it.key, n]))]));

  it('la rúbrica tiene cinco preguntas por criterio y la nota del criterio es la suma de sus respuestas (0 a 10)', () => {
    for (const k of CLIP_CRITERIA) assert.equal(RUBRIC[k].length, 5);
    const all2 = parseClipJudgement({ ...answer(2), motivo: 'Muy bueno' })!;
    assert.deepEqual(all2.criteria, { humor: 10, historia: 10, viral: 10, interes: 10 });
    const all1 = parseClipJudgement(answer(1))!;
    assert.deepEqual(all1.criteria, { humor: 5, historia: 5, viral: 5, interes: 5 });
    const mixed = parseClipJudgement({ ...answer(0), humor: { remate: 2, contraste: 2, locura: 1, actuacion: 0, sorpresa: 1 } })!;
    assert.equal(mixed.criteria.humor, 6);
    assert.equal(mixed.items['humor.remate'], 2);
    assert.equal(mixed.items['humor.actuacion'], 0);
  });

  it('la respuesta del modelo se valida: sin preguntas suficientes no hay nota y cada respuesta se acota a 0, 1 o 2', () => {
    assert.equal(parseClipJudgement(null), null);
    assert.equal(parseClipJudgement({ humor: 5, historia: 5, viral: 5, interes: 5 }), null, 'el formato antiguo de solo números ya no vale');
    const { viral: _v, ...sinViral } = answer(1) as Record<string, unknown>;
    assert.equal(parseClipJudgement(sinViral), null);
    assert.equal(parseClipJudgement({ ...answer(1), humor: { remate: 2, contraste: 1 } }), null, 'con menos de tres respuestas válidas no se acepta');
    const weird = parseClipJudgement({ ...answer(1), humor: { remate: 9, contraste: -3, locura: '2', actuacion: 1.4, sorpresa: 1 }, pruebas: { humor: '  «no me lo creo»  ', viral: 5 }, motivo: '  Buen remate  ' })!;
    assert.equal(weird.items['humor.remate'], 2);
    assert.equal(weird.items['humor.contraste'], 0);
    assert.equal(weird.items['humor.locura'], undefined, 'una respuesta que no es número se ignora');
    assert.equal(weird.criteria.humor, 2 + 0 + 1 + 1);
    assert.equal(weird.evidence.humor, '«no me lo creo»');
    assert.equal(weird.evidence.viral, undefined);
    assert.equal(weird.reason, 'Buen remate');
  });

  it('«puede ser viral» mezcla la rúbrica con lo medido: duración adecuada, que se hable pronto y el pico de volumen', () => {
    const good = { durationSec: 25, words: speech('hola que tal', 25), energyDb: loud };
    const bad = { durationSec: 150, words: speech('hola que tal', 150).map((w) => ({ ...w, start: w.start + 20, end: w.end + 20 })), energyDb: quiet };
    assert.ok(viralMeasured(good) > 7, String(viralMeasured(good)));
    assert.ok(viralMeasured(bad) < 3, String(viralMeasured(bad)));
    const base = { humor: 4, historia: 4, viral: 8, interes: 4 };
    assert.ok(withMeasuredViral(base, good).viral > withMeasuredViral(base, bad).viral);
    assert.equal(withMeasuredViral(base, good).humor, 4, 'solo cambia la viralidad');
    assert.ok(withMeasuredViral({ ...base, viral: 0 }, good).viral <= 2.5, 'lo medido por sí solo no da una viralidad alta');
  });

  it('el prompt incluye la rúbrica, pide citas, la transcripción y no menciona visualizaciones', () => {
    const p = clipJudgePrompt('Mi clip', speech('hola que tal', 4), 4);
    assert.match(p, /Transcripción:\nhola que tal/);
    for (const k of CLIP_CRITERIA) for (const it of RUBRIC[k]) assert.ok(p.includes(`${it.key}:`), it.key);
    assert.match(p, /pruebas/);
    assert.ok(!/vistas|visualizaciones/i.test(p.replace('Ignora', '')));
  });

  it('un «sí» sin cita real en la transcripción baja a «algo»; con cita real se respeta', () => {
    const all2 = { humor: { remate: 2, contraste: 2, locura: 2, actuacion: 2, sorpresa: 2 }, historia: { planteamiento: 2, desarrollo: 2, desenlace: 2, solo: 2, hilo: 2 }, viral: { gancho: 2, citable: 2, emocion: 2, universal: 2, cierre: 2 }, interes: { inesperado: 2, reaccion: 2, novedad: 2, protagonismo: 2, memorable: 2 } };
    const transcript = 'me cago en la leche otra vez se me ha caído el cubo de agua encima';
    const sinPrueba = parseClipJudgement({ ...all2, pruebas: { humor: 'una frase que nadie dijo jamás en el clip', viral: '' } }, { transcript })!;
    assert.equal(sinPrueba.criteria.humor, 5);
    assert.equal(sinPrueba.criteria.viral, 5);
    assert.equal(sinPrueba.evidence.humor, undefined);
    const conPrueba = parseClipJudgement({ ...all2, pruebas: { humor: '«Se me ha caído el cubo de agua»', viral: 'Imagen: derrama el cubo', historia: 'otra vez', interes: 'me cago en la leche' } }, { transcript, vision: true })!;
    assert.equal(conPrueba.criteria.humor, 10);
    assert.equal(conPrueba.criteria.viral, 10, 'con fotogramas, una prueba que empieza por «Imagen:» vale');
    const sinFotos = parseClipJudgement({ ...all2, pruebas: { viral: 'Imagen: derrama el cubo' } }, { transcript })!;
    assert.equal(sinFotos.criteria.viral, 5, 'sin fotogramas no se puede dar por vista una imagen');
  });
});

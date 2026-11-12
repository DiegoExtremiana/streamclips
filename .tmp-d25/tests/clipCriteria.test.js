"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const clipCriteria_1 = require("../shared/clipCriteria");
const speech = (phrase, dur, perSec = 2.5) => {
    const base = phrase.split(' ');
    const n = Math.round(dur * perSec);
    return Array.from({ length: n }, (_, i) => ({ text: base[i % base.length], start: (i / n) * dur, end: ((i + 0.8) / n) * dur }));
};
const quiet = Array.from({ length: 30 }, () => -40);
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];
(0, node_test_1.describe)('criterios de la nota de un clip', () => {
    (0, node_test_1.it)('los pesos suman 1 y la nota es su media ponderada', () => {
        strict_1.default.ok(Math.abs(clipCriteria_1.CLIP_CRITERIA.reduce((a, k) => a + clipCriteria_1.CRITERION_WEIGHT[k], 0) - 1) < 1e-9);
        strict_1.default.equal((0, clipCriteria_1.overall)({ humor: 10, historia: 10, viral: 10, interes: 10 }), 10);
        strict_1.default.equal((0, clipCriteria_1.overall)({ humor: 0, historia: 0, viral: 0, interes: 0 }), 0);
        strict_1.default.equal((0, clipCriteria_1.overall)({ humor: 8, historia: 4, viral: 6, interes: 6 }), 6.2);
    });
    (0, node_test_1.it)('risas y subidón dan humor; un relato con hilo da «se cuenta algo»; la charla plana no da nada', () => {
        const funny = (0, clipCriteria_1.criteriaFromSignals)({ durationSec: 30, words: speech('jajaja no puede ser madre mía jajaja increíble vamos', 30), energyDb: loud });
        const story = (0, clipCriteria_1.criteriaFromSignals)({ durationSec: 30, words: speech('entonces resulta que cuando llegué la puerta estaba abierta y luego vi que dentro había alguien pero no dije nada porque', 30), energyDb: quiet });
        const flat = (0, clipCriteria_1.criteriaFromSignals)({ durationSec: 30, words: speech('vale pues sí', 30, 0.3), energyDb: quiet });
        strict_1.default.ok(funny.humor > story.humor + 2, JSON.stringify([funny, story]));
        strict_1.default.ok(story.historia > funny.historia, JSON.stringify([funny, story]));
        strict_1.default.ok((0, clipCriteria_1.overall)(flat) < 2, String((0, clipCriteria_1.overall)(flat)));
        for (const c of [funny, story, flat])
            for (const k of clipCriteria_1.CLIP_CRITERIA)
                strict_1.default.ok(c[k] >= 0 && c[k] <= 10);
    });
    (0, node_test_1.it)('un clip con todo a la vez llega a dorado y con un solo ingrediente no', () => {
        const all = (0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: speech('jajaja entonces no puede ser madre mía jajaja increíble vamos ostia porque resulta que', 30), energyDb: loud });
        strict_1.default.ok(all >= 8, String(all));
        strict_1.default.ok((0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: speech('hola', 30), energyDb: loud }) < 8);
        strict_1.default.ok((0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos', 30), energyDb: quiet }) < 8);
    });
    (0, node_test_1.it)('el motivo dice qué criterios pesan y si no hubo modelo', () => {
        strict_1.default.match((0, clipCriteria_1.reasonFromCriteria)({ humor: 9, historia: 3, viral: 7, interes: 4 }, 'model'), /humor y puede ser viral/);
        strict_1.default.match((0, clipCriteria_1.reasonFromCriteria)({ humor: 1, historia: 1, viral: 1, interes: 1 }, 'signals'), /No destaca.*sin modelo de lenguaje/);
    });
    (0, node_test_1.it)('la respuesta del modelo se valida: sin los cuatro números no hay nota, y se acota de 0 a 10', () => {
        strict_1.default.equal((0, clipCriteria_1.parseClipJudgement)({ humor: 5, historia: 5, viral: 5 }), null);
        strict_1.default.equal((0, clipCriteria_1.parseClipJudgement)({ humor: '8', historia: 5, viral: 5, interes: 5 }), null);
        strict_1.default.equal((0, clipCriteria_1.parseClipJudgement)(null), null);
        const ok = (0, clipCriteria_1.parseClipJudgement)({ humor: 12, historia: -2, viral: 7.26, interes: 5, motivo: '  Buen remate  ' });
        strict_1.default.deepEqual(ok.criteria, { humor: 10, historia: 0, viral: 7.3, interes: 5 });
        strict_1.default.equal(ok.reason, 'Buen remate');
    });
    (0, node_test_1.it)('el prompt incluye la transcripción y no menciona visualizaciones', () => {
        const p = (0, clipCriteria_1.clipJudgePrompt)('Mi clip', speech('hola que tal', 4), 4);
        strict_1.default.match(p, /Transcripción:\nhola que tal/);
        strict_1.default.ok(!/vistas|visualizaciones/i.test(p.replace('Ignora', '')));
    });
});

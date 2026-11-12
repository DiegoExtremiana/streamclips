"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const clipScore_1 = require("../shared/clipScore");
const clipCriteria_1 = require("../shared/clipCriteria");
const words = (txt, dur) => txt.split(' ').map((text, i, a) => ({ text, start: (i / a.length) * dur, end: ((i + 0.8) / a.length) * dur }));
/** Habla densa (unas 2,5 palabras por segundo) repitiendo la frase, para que lo que se dice escale con la duración. */
const speech = (phrase, dur) => {
    const base = phrase.split(' ');
    return words(Array.from({ length: Math.round(dur * 2.5) }, (_, i) => base[i % base.length]).join(' '), dur);
};
const quiet = Array.from({ length: 30 }, () => -40);
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];
(0, node_test_1.describe)('puntuación interna de clips', () => {
    (0, node_test_1.it)('pico de volumen: sube respecto a lo normal; sin audio o con silencio total es 0', () => {
        strict_1.default.ok((0, clipScore_1.peakRise)(loud) > 20);
        strict_1.default.equal((0, clipScore_1.peakRise)(quiet), 0);
        strict_1.default.equal((0, clipScore_1.peakRise)(undefined), 0);
        strict_1.default.equal((0, clipScore_1.peakRise)([-100, -100, -100, -100, -100]), 0);
    });
    (0, node_test_1.it)('un clip aburrido queda bajo; uno con reacción, subidón y risas llega a dorado', () => {
        const boring = (0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: words('vale pues sí', 30), energyDb: quiet });
        const great = (0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos ostia no me lo creo', 30), energyDb: loud });
        strict_1.default.ok(boring < 2, String(boring));
        strict_1.default.ok(great >= clipScore_1.GOLD_MIN, String(great));
        strict_1.default.equal((0, clipScore_1.isGold)(great), true);
    });
    (0, node_test_1.it)('la nota no depende de las visualizaciones: la función ni las recibe', () => {
        strict_1.default.equal(clipCriteria_1.heuristicScore.length, 1);
        strict_1.default.equal(clipScore_1.modelScore.length, 1);
    });
    (0, node_test_1.it)('con un solo ingrediente no llega a dorado, y los muy cortos o larguísimos puntúan menos', () => {
        strict_1.default.ok((0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: words('hola', 30), energyDb: loud }) < clipScore_1.GOLD_MIN);
        strict_1.default.ok((0, clipCriteria_1.heuristicScore)({ durationSec: 30, words: speech('no puede ser madre mía jajaja increíble vamos', 30), energyDb: quiet }) < clipScore_1.GOLD_MIN);
        const mk = (dur) => (0, clipCriteria_1.heuristicScore)({ durationSec: dur, words: speech('no puede ser madre mía jajaja increíble vamos', dur), energyDb: loud });
        strict_1.default.ok(mk(5) < mk(30));
        strict_1.default.ok(mk(120) < mk(30));
    });
    (0, node_test_1.it)('con modelo de lenguaje la nota es su valoración, acotada de 0 a 10', () => {
        strict_1.default.equal((0, clipScore_1.modelScore)(9.5), 9.5);
        strict_1.default.equal((0, clipScore_1.modelScore)(99), 10);
        strict_1.default.equal((0, clipScore_1.modelScore)(-3), 0);
        strict_1.default.equal((0, clipScore_1.isGold)(7.9), false);
        strict_1.default.equal((0, clipScore_1.isGold)(8), true);
        strict_1.default.equal((0, clipScore_1.isGold)(undefined), false);
    });
});

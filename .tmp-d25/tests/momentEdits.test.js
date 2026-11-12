"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const momentEdits_1 = require("../shared/momentEdits");
const judge_1 = require("../shared/judge");
const mk = (start, total, kind = 'gracia') => ({
    id: `c${start}`,
    start,
    end: start + 40,
    signal: 5,
    total,
    judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: 'x', discard: false },
});
(0, node_test_1.describe)('correcciones manuales de momentos', () => {
    (0, node_test_1.it)('sin correcciones no cambia nada', () => {
        const a = [mk(100, 8), mk(300, 7)];
        strict_1.default.deepEqual((0, momentEdits_1.applyEdits)(a, (0, momentEdits_1.emptyEdits)()).map((x) => x.total), [8, 7]);
    });
    (0, node_test_1.it)('excluir descarta aunque tenga nota alta', () => {
        const e = { ...(0, momentEdits_1.emptyEdits)(), exclude: [(0, momentEdits_1.momentKey)(100)] };
        const sel = (0, judge_1.selectBest)((0, momentEdits_1.applyEdits)([mk(100, 9), mk(300, 7)], e), { maxSec: Infinity, minTotal: 6.5 });
        strict_1.default.deepEqual(sel.chosen.map((c) => c.start), [300]);
    });
    (0, node_test_1.it)('fijar mete un momento flojo por encima del suelo de calidad', () => {
        const e = { ...(0, momentEdits_1.emptyEdits)(), pin: [(0, momentEdits_1.momentKey)(500)] };
        const sel = (0, judge_1.selectBest)((0, momentEdits_1.applyEdits)([mk(100, 8), mk(500, 3)], e), { maxSec: Infinity, minTotal: 6.5 });
        strict_1.default.deepEqual(sel.chosen.map((c) => c.start), [100, 500]);
    });
    (0, node_test_1.it)('excluir gana a fijar', () => {
        const e = { ...(0, momentEdits_1.emptyEdits)(), pin: [(0, momentEdits_1.momentKey)(500)], exclude: [(0, momentEdits_1.momentKey)(500)] };
        const sel = (0, judge_1.selectBest)((0, momentEdits_1.applyEdits)([mk(500, 3)], e), { maxSec: Infinity, minTotal: 6.5 });
        strict_1.default.equal(sel.chosen.length, 0);
    });
    (0, node_test_1.it)('el recorte manual manda y no se acorta aunque supere el largo máximo', () => {
        const e = { ...(0, momentEdits_1.emptyEdits)(), trims: { [(0, momentEdits_1.momentKey)(100)]: { start: 90, end: 190 } } };
        const sel = (0, judge_1.selectBest)((0, momentEdits_1.applyEdits)([mk(100, 8)], e), { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
        strict_1.default.deepEqual(sel.chosen[0].seg, { start: 90, end: 190 });
        // sin recorte manual el largo máximo sí se aplica
        const sel2 = (0, judge_1.selectBest)([{ ...mk(100, 8), end: 200 }], { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
        strict_1.default.equal(sel2.chosen[0].seg.end - sel2.chosen[0].seg.start, 60);
    });
    (0, node_test_1.it)('un momento añadido a mano entra con su título y sin acortarse', () => {
        const e = { ...(0, momentEdits_1.emptyEdits)(), extra: [{ start: 700, end: 770, title: 'Mi momento' }] };
        const out = (0, momentEdits_1.applyEdits)([mk(100, 8)], e);
        const sel = (0, judge_1.selectBest)(out, { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
        const m = sel.chosen.find((c) => c.start === 700);
        strict_1.default.equal(m.judgement.title, 'Mi momento');
        strict_1.default.equal(m.seg.end - m.seg.start, 70);
        strict_1.default.equal(m.judgement.reason, 'Añadido por ti');
    });
    (0, node_test_1.it)('lo guardado en disco se limpia: claves, tiempos y largos absurdos se ignoran', () => {
        const c = (0, momentEdits_1.cleanEdits)({
            exclude: ['12', 'x', '12', 5],
            pin: 'no',
            trims: { '10': { start: 10, end: 50 }, '11': { start: 10, end: 12 }, z: { start: 1, end: 60 }, '13': { start: -5, end: 40 } },
            extra: [{ start: 5, end: 60, title: '<b>Hola</b>' }, { start: 5, end: 6 }, null],
        });
        strict_1.default.deepEqual(c.exclude, ['12']);
        strict_1.default.deepEqual(c.pin, []);
        strict_1.default.deepEqual(Object.keys(c.trims), ['10']);
        strict_1.default.equal(c.extra.length, 1);
        strict_1.default.equal(c.extra[0].title, 'bHola/b');
        strict_1.default.deepEqual((0, momentEdits_1.cleanEdits)(null), (0, momentEdits_1.emptyEdits)());
    });
});

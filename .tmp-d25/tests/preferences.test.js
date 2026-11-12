"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const preferences_1 = require("../shared/preferences");
const mk = (kind, total, manual = false) => ({
    id: kind,
    start: 0,
    end: 40,
    signal: 5,
    total,
    judgement: { id: kind, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: '', discard: false, ...(manual ? { manual: true } : {}) },
});
(0, node_test_1.describe)('preferencias aprendidas', () => {
    (0, node_test_1.it)('una sola decisión no cambia nada; varias sí, y el ajuste está acotado', () => {
        let p = (0, preferences_1.emptyPrefs)();
        p = (0, preferences_1.learn)(p, 'discusion', 'exclude');
        strict_1.default.equal((0, preferences_1.biasFor)(p, 'discusion'), 0);
        for (let i = 1; i < preferences_1.MIN_DECISIONS; i++)
            p = (0, preferences_1.learn)(p, 'discusion', 'exclude');
        strict_1.default.equal((0, preferences_1.biasFor)(p, 'discusion'), -0.75);
        for (let i = 0; i < 40; i++)
            p = (0, preferences_1.learn)(p, 'discusion', 'exclude');
        strict_1.default.equal(p.kindBias.discusion, -preferences_1.MAX_BIAS);
    });
    (0, node_test_1.it)('incluir sube el tipo y excluir lo baja', () => {
        let p = (0, preferences_1.emptyPrefs)();
        for (let i = 0; i < 4; i++)
            p = (0, preferences_1.learn)(p, 'fail', 'include');
        p = (0, preferences_1.learn)(p, 'fail', 'exclude');
        strict_1.default.equal(p.kindBias.fail, 0.75);
        strict_1.default.equal(p.counts.fail, 5);
    });
    (0, node_test_1.it)('aplicar suma el ajuste a la nota, sin pasar de 10 ni tocar lo manual ni lo fijado', () => {
        let p = (0, preferences_1.emptyPrefs)();
        for (let i = 0; i < 4; i++)
            p = (0, preferences_1.learn)(p, 'gracia', 'include');
        const out = (0, preferences_1.applyPrefs)([mk('gracia', 6), mk('gracia', 9.8), mk('gracia', 5, true), mk('gracia', 10), mk('fail', 6)], p);
        strict_1.default.deepEqual(out.map((x) => x.total), [7, 10, 5, 10, 6]);
    });
    (0, node_test_1.it)('apagadas no se aplican y los tipos «otro» no se aprenden', () => {
        let p = (0, preferences_1.emptyPrefs)();
        for (let i = 0; i < 5; i++)
            p = (0, preferences_1.learn)(p, 'epico', 'include');
        strict_1.default.equal((0, preferences_1.applyPrefs)([mk('epico', 6)], { ...p, enabled: false })[0].total, 6);
        strict_1.default.equal((0, preferences_1.learn)(p, 'otro', 'exclude'), p);
    });
    (0, node_test_1.it)('learn no modifica la entrada y cleanPrefs ignora basura', () => {
        const p = (0, preferences_1.emptyPrefs)();
        (0, preferences_1.learn)(p, 'fail', 'exclude');
        strict_1.default.deepEqual(p, (0, preferences_1.emptyPrefs)());
        const c = (0, preferences_1.cleanPrefs)({ enabled: false, kindBias: { fail: 99, x: 1, gracia: 'a' }, counts: { fail: -3, gracia: 2.7 } });
        strict_1.default.equal(c.enabled, false);
        strict_1.default.deepEqual(c.kindBias, { fail: preferences_1.MAX_BIAS });
        strict_1.default.deepEqual(c.counts, { gracia: 2 });
        strict_1.default.deepEqual((0, preferences_1.cleanPrefs)(null), (0, preferences_1.emptyPrefs)());
    });
    (0, node_test_1.it)('describe indica qué tipos están ya activos', () => {
        let p = (0, preferences_1.emptyPrefs)();
        for (let i = 0; i < 3; i++)
            p = (0, preferences_1.learn)(p, 'historia', 'exclude');
        p = (0, preferences_1.learn)(p, 'epico', 'include');
        strict_1.default.deepEqual((0, preferences_1.describePrefs)(p), [
            { kind: 'historia', bias: -0.75, count: 3, active: true },
            { kind: 'epico', bias: 0.25, count: 1, active: false },
        ]);
    });
});

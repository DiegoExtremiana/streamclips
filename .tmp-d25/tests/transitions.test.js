"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const autoEdit_1 = require("../shared/autoEdit");
const plan_1 = require("../shared/plan");
const words = (from, to) => Array.from({ length: Math.floor(to - from) }, (_, i) => ({ text: `palabra${i}`, start: from + i, end: from + i + 0.6 }));
(0, node_test_1.default)('un resumen con momentos separados lleva un whoosh en cada salto, no en el primero', () => {
    const segs = [{ start: 100, end: 140 }, { start: 400, end: 440 }, { start: 900, end: 940 }];
    const ws = segs.flatMap((s) => words(s.start, s.end));
    const p = (0, autoEdit_1.planLong)(ws, segs);
    const whooshes = p.effects.filter((e) => e.type === 'sfx' && e.sound === 'whoosh').map((e) => e.at);
    strict_1.default.ok(whooshes.some((t) => Math.abs(t - 400.05) < 0.01), JSON.stringify(whooshes));
    strict_1.default.ok(whooshes.some((t) => Math.abs(t - 900.05) < 0.01));
    strict_1.default.ok(!whooshes.some((t) => t < 101), 'el primero no lleva transición');
    strict_1.default.equal((0, plan_1.validateEffects)(p.effects, p.segments), null, 'todos los efectos son válidos');
});
(0, node_test_1.default)('un tramo continuo (un solo bloque) no lleva transiciones', () => {
    const segs = [{ start: 100, end: 400 }];
    const p = (0, autoEdit_1.planLong)(words(100, 400), segs);
    strict_1.default.ok(!p.effects.some((e) => e.type === 'sfx' && e.sound === 'whoosh' && e.at < 110 && e.at > 100.04 && e.at < 100.06));
});
(0, node_test_1.default)('tramos pegados (menos de 5 s) no se tratan como saltos', () => {
    const segs = [{ start: 100, end: 140 }, { start: 143, end: 180 }];
    const p = (0, autoEdit_1.planLong)([...words(100, 140), ...words(143, 180)], segs);
    strict_1.default.ok(!p.effects.some((e) => e.type === 'sfx' && e.sound === 'whoosh' && Math.abs(e.at - 143.05) < 0.01));
});

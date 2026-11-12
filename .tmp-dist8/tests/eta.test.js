"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const tasks_1 = require("../electron/domain/tasks");
const helpers_1 = require("./helpers");
(0, node_test_1.describe)('tiempo estimado', () => {
    (0, node_test_1.it)('por la velocidad medida: a mitad de camino tras 10 min faltan otros 10', () => {
        const s = (0, tasks_1.estimateEta)({ now: 600_000, firstAt: 0, firstPct: 0, pct: 50, startedAt: 0 });
        strict_1.default.equal(Math.round(s), 600);
    });
    (0, node_test_1.it)('un trabajo retomado al 77 % no sale con una cifra absurda: cuenta desde el avance medido', () => {
        // empieza ya en 77 %; en 60 s avanza hasta 80 %: faltan 20 puntos a 3 puntos/min
        const s = (0, tasks_1.estimateEta)({ now: 60_000, firstAt: 0, firstPct: 77, pct: 80, startedAt: 0 });
        strict_1.default.equal(Math.round(s), 400);
    });
    (0, node_test_1.it)('sin avance suficiente usa la duración esperada, y sin nada no inventa', () => {
        strict_1.default.equal((0, tasks_1.estimateEta)({ now: 5000, firstAt: 0, firstPct: 0, pct: 0, startedAt: 0, expectedSec: 3600 }), 3600);
        strict_1.default.equal((0, tasks_1.estimateEta)({ now: 5000, firstAt: 0, firstPct: 0, pct: 1, startedAt: 0, expectedSec: 3600 }), 3564);
        strict_1.default.equal((0, tasks_1.estimateEta)({ now: 5000, firstAt: 0, firstPct: 0, pct: 1, startedAt: 0 }), undefined);
        strict_1.default.equal((0, tasks_1.estimateEta)({ now: 5000, pct: 100, startedAt: 0 }), 0);
    });
    (0, node_test_1.it)('la tarea publica etaAt mientras corre y lo quita al terminar', () => {
        let t = 1_000_000;
        const tr = new tasks_1.TaskTracker(new helpers_1.RecordingNotifier(), () => t);
        const h = tr.start('analyze', 'x', 'vod1');
        strict_1.default.equal(h.info.ref, 'vod1');
        h.estimate(1200);
        strict_1.default.equal(Date.parse(h.info.etaAt) - t, 1_200_000);
        h.update(0);
        t += 30_000;
        h.update(10);
        strict_1.default.equal(Math.round((Date.parse(h.info.etaAt) - t) / 1000), 270);
        h.done();
        strict_1.default.equal(h.info.etaAt, undefined);
    });
});

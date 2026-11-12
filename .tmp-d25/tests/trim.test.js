"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const trim_1 = require("../shared/trim");
const time_1 = require("../shared/time");
(0, node_test_1.describe)('recorte de clips', () => {
    (0, node_test_1.it)('la ventana añade margen a cada lado sin salirse del directo', () => {
        strict_1.default.deepEqual((0, trim_1.timelineWindow)({ start: 100, end: 130 }, 1000), { start: 55, end: 175 });
        strict_1.default.deepEqual((0, trim_1.timelineWindow)({ start: 10, end: 30 }, 1000), { start: 0, end: 75 });
        strict_1.default.deepEqual((0, trim_1.timelineWindow)({ start: 960, end: 990 }, 1000), { start: 915, end: 1000 });
        strict_1.default.deepEqual((0, trim_1.timelineWindow)({ start: 100, end: 130 }, null), { start: 55, end: 175 });
    });
    (0, node_test_1.it)('los extremos respetan 1 s mínimo, 3 min máximo y los límites del directo', () => {
        const r = { start: 100, end: 130 };
        strict_1.default.deepEqual((0, trim_1.moveHandle)('start', 120, r, 1000), { start: 120, end: 130 });
        strict_1.default.deepEqual((0, trim_1.moveHandle)('start', 129.95, r, 1000), { start: 129, end: 130 }, 'no pasa de 1 s de clip');
        strict_1.default.deepEqual((0, trim_1.moveHandle)('start', -5, r, 1000), { start: 0, end: 130 }, 'ni antes del inicio del directo');
        strict_1.default.deepEqual((0, trim_1.moveHandle)('start', 0, { start: 400, end: 500 }, 1000), { start: 320, end: 500 }, 'máximo 180 s');
        strict_1.default.deepEqual((0, trim_1.moveHandle)('end', 101, r, 1000), { start: 100, end: 101 });
        strict_1.default.deepEqual((0, trim_1.moveHandle)('end', 100, r, 1000), { start: 100, end: 101 });
        strict_1.default.deepEqual((0, trim_1.moveHandle)('end', 5000, r, 1000), { start: 100, end: 280 }, 'máximo 180 s');
        strict_1.default.deepEqual((0, trim_1.moveHandle)('end', 5000, { start: 900, end: 950 }, 1000), { start: 900, end: 1000 }, 'ni más allá del final del directo');
        strict_1.default.deepEqual((0, trim_1.moveHandle)('end', 133.33, r, 1000), { start: 100, end: 133.3 }, 'décimas de segundo');
    });
    (0, node_test_1.it)('posiciones y tiempos en la línea', () => {
        const w = { start: 50, end: 150 };
        strict_1.default.equal((0, trim_1.toFraction)(100, w), 0.5);
        strict_1.default.equal((0, trim_1.toFraction)(0, w), 0);
        strict_1.default.equal((0, trim_1.toFraction)(999, w), 1);
        strict_1.default.equal((0, trim_1.fromFraction)(0.25, w), 75);
        strict_1.default.equal((0, trim_1.fromFraction)(2, w), 150);
    });
    (0, node_test_1.it)('el tiempo se escribe y se vuelve a leer sin perder nada', () => {
        for (const t of [0, 5, 83, 83.4, 3723.5, 59.9])
            strict_1.default.equal((0, time_1.parseTime)((0, trim_1.fmtTenths)(t)), t, (0, trim_1.fmtTenths)(t));
        strict_1.default.equal((0, trim_1.fmtTenths)(83), '1:23');
        strict_1.default.equal((0, trim_1.fmtTenths)(83.4), '1:23.4');
        strict_1.default.equal((0, trim_1.fmtTenths)(3723), '1:02:03');
    });
});

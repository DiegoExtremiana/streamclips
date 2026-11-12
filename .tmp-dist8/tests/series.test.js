"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const series_1 = require("../shared/series");
(0, node_test_1.describe)('series de directos', () => {
    (0, node_test_1.it)('detecta serie y día en el título del directo', () => {
        strict_1.default.deepEqual((0, series_1.detectSeries)('Minecraft Extremo Día 3'), { name: 'Minecraft Extremo', day: 3 });
        strict_1.default.deepEqual((0, series_1.detectSeries)('MINECRAFT EXTREMO - dia 12 | Directo'), { name: 'MINECRAFT EXTREMO', day: 12 });
        strict_1.default.deepEqual((0, series_1.detectSeries)('Locke en chanclas: Episodio 7'), { name: 'Locke en chanclas', day: 7 });
        strict_1.default.equal((0, series_1.detectSeries)('Jugando a cosas'), null);
        strict_1.default.equal((0, series_1.detectSeries)('Día 3'), null, 'sin nombre de serie no vale');
        strict_1.default.equal((0, series_1.detectSeries)('Hoy es un gran día 0'), null);
    });
    (0, node_test_1.it)('usa la serie configurada cuando el título no dice nada', () => {
        strict_1.default.deepEqual((0, series_1.seriesFor)('Directo', { name: ' Minecraft extremo ', nextDay: 4 }), { name: 'Minecraft extremo', day: 4, fromTitle: false });
        strict_1.default.equal((0, series_1.seriesFor)('Directo', { name: '', nextDay: 1 }), null);
        strict_1.default.equal((0, series_1.seriesFor)('Minecraft extremo día 9', { name: 'Otra', nextDay: 1 })?.day, 9, 'el título manda');
        strict_1.default.equal((0, series_1.seriesFor)('Minecraft extremo día 9', { name: 'Otra', nextDay: 1 })?.fromTitle, true);
    });
    (0, node_test_1.it)('nombra el resumen y las partes', () => {
        strict_1.default.deepEqual((0, series_1.seriesTitles)({ name: 'Minecraft extremo', day: 1 }, 1), { summary: 'Minecraft extremo Día 1 - Resumen', mains: ['Minecraft extremo Día 1'] });
        strict_1.default.deepEqual((0, series_1.seriesTitles)({ name: 'Minecraft extremo', day: 2 }, 3).mains, ['Minecraft extremo Día 2 - Parte 1', 'Minecraft extremo Día 2 - Parte 2', 'Minecraft extremo Día 2 - Parte 3']);
    });
});

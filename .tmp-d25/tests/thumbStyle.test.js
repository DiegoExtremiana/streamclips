"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const thumbStyle_1 = require("../shared/thumbStyle");
(0, node_test_1.default)('coverText: quita número de serie, emojis y palabras vacías y va en mayúsculas', () => {
    strict_1.default.equal((0, thumbStyle_1.coverText)('Minecraft extremo Día 12 - Resumen'), 'MINECRAFT EXTREMO');
    strict_1.default.equal((0, thumbStyle_1.coverText)('¡No me lo puedo creer! El mejor momento del directo'), '¡NO PUEDO CREER!');
    strict_1.default.equal((0, thumbStyle_1.coverText)('😱 Locura total 🔥'), 'LOCURA TOTAL');
});
(0, node_test_1.default)('coverText: nunca pasa del máximo de palabras y letras, ni queda vacío con un título normal', () => {
    const t = (0, thumbStyle_1.coverText)('Una conversación larguísima sobre absolutamente todo lo que pasó ayer en el directo');
    strict_1.default.ok(t.split(' ').length <= thumbStyle_1.COVER_MAX_WORDS);
    strict_1.default.ok(t.length <= thumbStyle_1.COVER_MAX_CHARS, t);
    strict_1.default.ok(t.length > 0);
    strict_1.default.equal((0, thumbStyle_1.coverText)(''), '');
    strict_1.default.ok((0, thumbStyle_1.coverText)('Supercalifragilisticoespialidosoextraordinario').length <= thumbStyle_1.COVER_MAX_CHARS);
});
(0, node_test_1.default)('coverBadge: número de episodio o día', () => {
    strict_1.default.equal((0, thumbStyle_1.coverBadge)('Pokémon Locke Toca Ep.9 - Algo'), 9);
    strict_1.default.equal((0, thumbStyle_1.coverBadge)('Minecraft Día 12 - Parte 2'), 12);
    strict_1.default.equal((0, thumbStyle_1.coverBadge)('Directo #7'), 7);
    strict_1.default.equal((0, thumbStyle_1.coverBadge)('Un clip sin número'), null);
});
(0, node_test_1.default)('coverLines: como mucho dos líneas equilibradas', () => {
    strict_1.default.deepEqual((0, thumbStyle_1.coverLines)('GOL'), ['GOL']);
    strict_1.default.deepEqual((0, thumbStyle_1.coverLines)('NO PUEDO CREER'), ['NO PUEDO', 'CREER']);
    strict_1.default.equal((0, thumbStyle_1.coverLines)('A B C').length <= 2, true);
    strict_1.default.deepEqual((0, thumbStyle_1.coverLines)(''), []);
});
(0, node_test_1.default)('buildCoverAss: texto, número y escape; null si no hay nada', () => {
    strict_1.default.equal((0, thumbStyle_1.buildCoverAss)('', null), null);
    const a = (0, thumbStyle_1.buildCoverAss)('HOLA {X} MUNDO', 5);
    strict_1.default.match(a, /PlayResX: 1280/);
    strict_1.default.match(a, /Dialogue: 0,.*Hook/);
    strict_1.default.match(a, /Dialogue: 1,.*Badge,,0,0,0,,5$/m);
    strict_1.default.ok(!a.includes('{X}'), 'las llaves se eliminan');
    strict_1.default.ok((0, thumbStyle_1.buildCoverAss)('', 3).includes('Badge'));
    strict_1.default.ok(!(0, thumbStyle_1.buildCoverAss)('', 3).includes('Hook,,'));
});
(0, node_test_1.default)('frameScore prefiere imágenes vivas y contrastadas a las apagadas u oscuras', () => {
    const vivid = (0, thumbStyle_1.frameScore)({ satAvg: 80, yLow: 10, yHigh: 230, yAvg: 120 });
    const dull = (0, thumbStyle_1.frameScore)({ satAvg: 10, yLow: 90, yHigh: 130, yAvg: 110 });
    const black = (0, thumbStyle_1.frameScore)({ satAvg: 0, yLow: 16, yHigh: 17, yAvg: 16 });
    strict_1.default.ok(vivid > dull && dull > black);
});
(0, node_test_1.default)('candidateTimes: dentro del vídeo, ordenados y sin extremos', () => {
    const t = (0, thumbStyle_1.candidateTimes)(100);
    strict_1.default.equal(t.length, 6);
    strict_1.default.ok(t[0] > 0 && t[t.length - 1] < 100);
    strict_1.default.deepEqual([...t].sort((a, b) => a - b), t);
    strict_1.default.deepEqual((0, thumbStyle_1.candidateTimes)(0.5), [0.25]);
    strict_1.default.equal((0, thumbStyle_1.candidateTimes)(3).length <= 3, true);
});

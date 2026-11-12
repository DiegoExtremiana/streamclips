"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const styleProfile_1 = require("../shared/styleProfile");
(0, node_test_1.describe)('perfil de estilo', () => {
    (0, node_test_1.it)('los valores por defecto son los de la entrevista', () => {
        const d = (0, styleProfile_1.defaultStyle)();
        strict_1.default.equal(d.silenceMaxSec, 2);
        strict_1.default.equal(d.shortShotMaxSec, 3);
        strict_1.default.deepEqual([d.shortMinSec, d.shortMaxSec, d.longMinSec, d.longMaxSec], [15, 120, 600, 900]);
        strict_1.default.equal(d.subtitlesDefaultOn, false);
        strict_1.default.equal(d.titleStyle, 'estetico');
        strict_1.default.equal(d.music.royaltyFreeOnly, true);
        strict_1.default.ok(d.music.level <= 0.2, 'la música va baja');
    });
    (0, node_test_1.it)('lo que llega roto se sanea sin perder lo bueno', () => {
        const c = (0, styleProfile_1.cleanStyle)({ silenceMaxSec: 'x', shortShotMaxSec: 99999, shortMinSec: 100, shortMaxSec: 20, titleStyle: 'raro', music: { level: 7, genre: '  jazz ' } });
        strict_1.default.equal(c.silenceMaxSec, 2);
        strict_1.default.equal(c.shortShotMaxSec, 30);
        strict_1.default.equal(c.shortMaxSec, 100, 'el máximo nunca baja del mínimo');
        strict_1.default.equal(c.titleStyle, 'estetico');
        strict_1.default.equal(c.music.level, 0.5);
        strict_1.default.equal(c.music.genre, 'jazz');
        strict_1.default.deepEqual((0, styleProfile_1.cleanStyle)(null), (0, styleProfile_1.defaultStyle)());
    });
    (0, node_test_1.it)('patchStyle cambia solo lo que se pide', () => {
        const p = (0, styleProfile_1.patchStyle)((0, styleProfile_1.defaultStyle)(), { silenceMaxSec: 1.5, music: { enabled: false } });
        strict_1.default.equal(p.silenceMaxSec, 1.5);
        strict_1.default.equal(p.music.enabled, false);
        strict_1.default.equal(p.music.genre, 'lofi');
        strict_1.default.equal(p.longMaxSec, 900);
    });
    (0, node_test_1.it)('el lore se añade, no admite duplicados ni vacíos y se quita', () => {
        let s = (0, styleProfile_1.defaultStyle)();
        s = (0, styleProfile_1.addLore)(s, 'El pollo', 'Chiste de 2021', ['pollo', ' POLLO ', 'el pollo']);
        strict_1.default.equal(s.lore.length, 1);
        strict_1.default.deepEqual(s.lore[0].triggers, ['pollo', 'el pollo']);
        strict_1.default.throws(() => (0, styleProfile_1.addLore)(s, 'el pollo'), /ya está/);
        strict_1.default.throws(() => (0, styleProfile_1.addLore)(s, '  '), /nombre/);
        s = (0, styleProfile_1.removeLore)(s, s.lore[0].id);
        strict_1.default.equal(s.lore.length, 0);
    });
    (0, node_test_1.it)('reconoce el lore nombrado en una transcripción', () => {
        const s = (0, styleProfile_1.addLore)((0, styleProfile_1.addLore)((0, styleProfile_1.defaultStyle)(), 'El pollo', '', ['pollo frito']), 'Gorens');
        strict_1.default.deepEqual((0, styleProfile_1.loreIn)(s.lore, 'otra vez el POLLO FRITO, tío').map((l) => l.name), ['El pollo']);
        strict_1.default.deepEqual((0, styleProfile_1.loreIn)(s.lore, 'dice gorens que sí').map((l) => l.name), ['Gorens']);
        strict_1.default.deepEqual((0, styleProfile_1.loreIn)(s.lore, 'nada de nada'), []);
    });
});

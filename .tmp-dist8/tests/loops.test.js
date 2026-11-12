"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const loops_1 = require("../shared/loops");
const seq = (texts, t0 = 0) => texts.map((text, i) => ({ text, start: t0 + i * 0.4, end: t0 + i * 0.4 + 0.3 }));
const loop = (phrase, times) => Array.from({ length: times }, () => phrase.split(' ')).flat();
const speech = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`);
(0, node_test_1.default)('un bucle de Whisper se recorta y el resto del texto no se toca', () => {
    const ws = seq([...speech(40), ...loop('¿Qué pasa aquí?', 30), ...speech(40)]);
    const r = (0, loops_1.dropLoops)(ws);
    // el habla de alrededor se conserva entera; del bucle quedan unas pocas palabras (las de la ventana de detección no cuentan)
    strict_1.default.ok(r.dropped >= 90 - loops_1.LOOP_KEEP - 8 && r.dropped <= 90 - loops_1.LOOP_KEEP, String(r.dropped));
    strict_1.default.deepEqual(r.words.slice(0, 40), ws.slice(0, 40));
    strict_1.default.deepEqual(r.words.slice(-40), ws.slice(-40));
});
(0, node_test_1.default)('un bucle con variaciones (puntuación, una palabra de más) también se detecta', () => {
    const ws = seq([...speech(30), ...Array.from({ length: 12 }, (_, i) => (i % 2 ? '¡Tentacruel está increíble, tío!' : '¿Tentacruel está increíble?').split(' ')).flat(), ...speech(30)]);
    strict_1.default.ok((0, loops_1.dropLoops)(ws).dropped > 20);
});
(0, node_test_1.default)('el habla normal, aunque repita alguna palabra, no pierde nada', () => {
    const real = 'no no no vale vale vale pero entonces eso es lo que te decía el otro día cuando fuimos a comprar el juego nuevo y resulta que no lo tenían así que volvimos a casa con las manos vacías y bastante cansados la verdad'.split(' ');
    const ws = seq([...real, ...real]);
    strict_1.default.equal((0, loops_1.dropLoops)(ws).dropped, 0);
    strict_1.default.equal((0, loops_1.dropLoops)(ws).words, ws, 'misma lista, sin copiar');
});
(0, node_test_1.default)('la risa seguida no es un bucle', () => {
    const ws = seq([...speech(30), ...loop('jajaja', 40), ...speech(30)]);
    strict_1.default.equal((0, loops_1.dropLoops)(ws).dropped, 0);
});
(0, node_test_1.default)('pocas palabras: no se toca; los tiempos de lo conservado no cambian', () => {
    const few = seq(['a', 'a', 'a', 'a']);
    strict_1.default.equal((0, loops_1.dropLoops)(few).words, few);
    const ws = seq(loop('sí', 50), 100);
    const r = (0, loops_1.dropLoops)(ws);
    strict_1.default.equal(r.words.length, loops_1.LOOP_KEEP);
    strict_1.default.equal(r.words[0].start, 100);
});

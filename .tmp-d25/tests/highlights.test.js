"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const highlights_1 = require("../shared/highlights");
/** Directo de 1 hora con ruido bajo y dos explosiones (en 600 s y 2400 s). */
function stream(dur = 3600) {
    const energy = Array.from({ length: dur }, (_, i) => -35 + Math.sin(i / 7) * 1.5);
    const chat = Array.from({ length: dur }, (_, i) => (i % 5 === 0 ? 1 : 0));
    for (const c of [600, 2400]) {
        for (let i = c - 10; i < c + 10; i++) {
            energy[i] = -12;
            chat[i] = 9;
        }
    }
    return { durationSec: dur, energyDb: energy, chat };
}
(0, node_test_1.describe)('highlights: utilidades', () => {
    (0, node_test_1.it)('smooth: media móvil centrada, sin desbordes en los bordes', () => {
        strict_1.default.deepEqual((0, highlights_1.smooth)([0, 0, 9, 0, 0], 3).map((x) => Math.round(x)), [0, 3, 3, 3, 0]);
        strict_1.default.deepEqual((0, highlights_1.smooth)([4], 5), [4]);
        strict_1.default.deepEqual((0, highlights_1.smooth)([], 3), []);
    });
    (0, node_test_1.it)('robustZ: lo normal ~0 y lo raro muy por encima; sin variación no da NaN', () => {
        const z = (0, highlights_1.robustZ)([1, 2, 1, 2, 1, 2, 1, 20]);
        strict_1.default.ok(Math.abs(z[0]) < 1 && z[7] > 5);
        for (const v of (0, highlights_1.robustZ)([3, 3, 3, 3]))
            strict_1.default.ok(Number.isFinite(v));
    });
    (0, node_test_1.it)('mergeSegments une los que se tocan y respeta los separados', () => {
        strict_1.default.deepEqual((0, highlights_1.mergeSegments)([{ start: 50, end: 60 }, { start: 0, end: 10 }, { start: 9, end: 20 }, { start: 21, end: 25 }]), [{ start: 0, end: 25 }, { start: 50, end: 60 }]);
    });
    (0, node_test_1.it)('scoreSeconds sin señales devuelve ceros', () => {
        strict_1.default.deepEqual((0, highlights_1.scoreSeconds)({ durationSec: 3 }).score, [0, 0, 0]);
    });
});
(0, node_test_1.describe)('highlights: momentos', () => {
    (0, node_test_1.it)('encuentra las dos explosiones, en orden y sin solaparse', () => {
        const m = (0, highlights_1.findMoments)(stream(), { count: 5 });
        strict_1.default.equal(m.length, 2, JSON.stringify(m));
        strict_1.default.ok(Math.abs(m[0].peak - 600) < 15 && Math.abs(m[1].peak - 2400) < 15);
        strict_1.default.ok(m[0].end <= m[1].start);
        for (const x of m) {
            strict_1.default.ok(x.end - x.start >= 20 && x.end - x.start <= 60, `${x.end - x.start}`);
            strict_1.default.ok(x.start <= x.peak && x.peak <= x.end);
            strict_1.default.ok(x.reasons.includes('chat') && x.reasons.includes('volumen'));
        }
    });
    (0, node_test_1.it)('respeta el máximo pedido y la distancia mínima entre picos', () => {
        const s = stream();
        for (const c of [620, 700])
            for (let i = c - 5; i < c + 5; i++) {
                s.energyDb[i] = -10;
                s.chat[i] = 12;
            }
        const m = (0, highlights_1.findMoments)(s, { count: 1 });
        strict_1.default.equal(m.length, 1);
        const m3 = (0, highlights_1.findMoments)(s, { count: 10, gap: 90 });
        for (let i = 1; i < m3.length; i++)
            strict_1.default.ok(m3[i].peak - m3[i - 1].peak >= 90);
    });
    (0, node_test_1.it)('un directo plano no inventa momentos', () => {
        const flat = { durationSec: 1800, energyDb: new Array(1800).fill(-30), chat: new Array(1800).fill(1) };
        strict_1.default.deepEqual((0, highlights_1.findMoments)(flat, { count: 5 }), []);
    });
    (0, node_test_1.it)('los límites quedan dentro del vídeo, incluso con un pico al principio o al final', () => {
        const s = stream(300);
        for (let i = 0; i < 6; i++) {
            s.energyDb[i] = -8;
            s.chat[i] = 15;
        }
        for (let i = 294; i < 300; i++) {
            s.energyDb[i] = -8;
            s.chat[i] = 15;
        }
        for (const m of (0, highlights_1.findMoments)(s, { count: 3, gap: 30 }))
            strict_1.default.ok(m.start >= 0 && m.end <= 300 && m.end > m.start);
    });
    (0, node_test_1.it)('con señales más cortas que el vídeo no se rompe', () => {
        const m = (0, highlights_1.findMoments)({ durationSec: 1000, energyDb: [-30, -30, -5, -5, -5, -30], chat: [] }, { count: 2 });
        for (const x of m)
            strict_1.default.ok(x.end <= 1000);
    });
    (0, node_test_1.it)('el resumen va en orden cronológico, sin solapes y no pasa del máximo', () => {
        const s = stream(7200);
        for (let k = 1; k <= 20; k++)
            for (let i = k * 300; i < k * 300 + 12; i++) {
                s.energyDb[i] = -15;
                s.chat[i] = 8;
            }
        const segs = (0, highlights_1.buildSummary)(s, { minSec: 300, maxSec: 900 });
        strict_1.default.ok(segs.length > 3);
        const total = segs.reduce((a, x) => a + x.end - x.start, 0);
        strict_1.default.ok(total <= 900 + 1 && total >= 300, `${total}`);
        for (let i = 1; i < segs.length; i++)
            strict_1.default.ok(segs[i].start > segs[i - 1].end);
    });
    (0, node_test_1.it)('bestStretch elige la zona más intensa y devuelve null si el vídeo es corto', () => {
        const s = stream(3600);
        for (let i = 1800; i < 2400; i++) {
            s.energyDb[i] = -14;
            s.chat[i] = 6;
        }
        const b = (0, highlights_1.bestStretch)(s, 600);
        strict_1.default.ok(b.start >= 1700 && b.end <= 2500 && b.end - b.start >= 500, JSON.stringify(b));
        strict_1.default.equal((0, highlights_1.bestStretch)({ durationSec: 100, energyDb: [] }, 600), null);
        strict_1.default.equal((0, highlights_1.bestStretch)({ durationSec: 3600, energyDb: new Array(3600).fill(-30), chat: new Array(3600).fill(1) }, 600), null);
    });
});
const W = (text, start, end = start + 0.3) => ({ text, start, end });
const SPEECH = [W('Estamos', 10), W('en', 10.4), W('la', 10.6), W('final.', 10.8), W('¡No', 12), W('puede', 12.3), W('ser,', 12.6), W('lo', 12.9), W('hemos', 13.1), W('ganado!', 13.4), W('Vale.', 20)];
(0, node_test_1.describe)('highlights: frases y títulos', () => {
    (0, node_test_1.it)('snapToSentences mueve los extremos al borde de la frase cercana', () => {
        const r = (0, highlights_1.snapToSentences)(12.5, 13.5, SPEECH);
        strict_1.default.ok(Math.abs(r.start - 11.7) < 0.01, `${r.start}`);
        strict_1.default.ok(Math.abs(r.end - 14.1) < 0.2, `${r.end}`);
    });
    (0, node_test_1.it)('sin palabras no cambia nada', () => {
        strict_1.default.deepEqual((0, highlights_1.snapToSentences)(5, 9, []), { start: 5, end: 9 });
    });
    (0, node_test_1.it)('textOf recorta por tiempo y por longitud', () => {
        strict_1.default.equal((0, highlights_1.textOf)(SPEECH, 12, 12.8, 700), '¡No puede ser,');
        strict_1.default.ok((0, highlights_1.textOf)(SPEECH, 0, 100, 10).endsWith('…'));
    });
    (0, node_test_1.it)('fallbackTitle prefiere la frase con exclamación, corta a 70 y tiene plan B', () => {
        strict_1.default.equal((0, highlights_1.fallbackTitle)(SPEECH, { start: 10, end: 14 }, 0), '¡No puede ser, lo hemos ganado!');
        strict_1.default.equal((0, highlights_1.fallbackTitle)([], { start: 0, end: 10 }, 2), 'Momento 3');
        const long = Array.from({ length: 40 }, (_, i) => W('palabra', i * 0.4));
        strict_1.default.ok((0, highlights_1.fallbackTitle)(long, { start: 0, end: 20 }, 0).length <= 70);
    });
});
(0, node_test_1.describe)('highlights: directos largos (3-4 h)', () => {
    (0, node_test_1.it)('4 horas de señales, con transcripción de ~40.000 palabras, se analizan en menos de 5 s', () => {
        const dur = 4 * 3600;
        const s = stream(dur);
        s.words = Array.from({ length: 40_000 }, (_, i) => ({ text: i % 9 === 8 ? 'vale.' : 'palabra', start: i * 0.36, end: i * 0.36 + 0.3 }));
        for (let k = 1; k <= 30; k++)
            for (let i = k * 450; i < k * 450 + 15; i++) {
                s.energyDb[i] = -12;
                s.chat[i] = 10;
            }
        const t0 = Date.now();
        const m = (0, highlights_1.findMoments)(s, { count: 12 });
        const sum = (0, highlights_1.buildSummary)(s, { minSec: 600, maxSec: 900 });
        const main = (0, highlights_1.bestStretch)(s, 600);
        strict_1.default.ok(Date.now() - t0 < 5000, `tardó ${Date.now() - t0} ms`);
        strict_1.default.equal(m.length, 12);
        const total = sum.reduce((a, x) => a + x.end - x.start, 0);
        strict_1.default.ok(total >= 600 && total <= 901, `${total}`);
        strict_1.default.ok(main && main.end - main.start >= 500);
    });
    (0, node_test_1.it)('bestStretches: varios tramos distintos, sin solaparse, en orden cronológico y respetando lo que se evita', () => {
        const dur = 7200;
        const energy = Array.from({ length: dur }, (_, i) => -35 + Math.sin(i / 7) * 1.5);
        for (const c of [900, 3000, 5400])
            for (let i = c - 120; i < c + 120; i++)
                energy[i] = -12;
        const sig = { durationSec: dur, energyDb: energy, chat: new Array(dur).fill(0) };
        const three = (0, highlights_1.bestStretches)(sig, 300, 3);
        strict_1.default.equal(three.length, 3);
        for (let i = 1; i < three.length; i++)
            strict_1.default.ok(three[i].start >= three[i - 1].end, JSON.stringify(three));
        strict_1.default.ok(three.some((s) => s.start < 900 && s.end > 900) && three.some((s) => s.start < 3000 && s.end > 3000) && three.some((s) => s.start < 5400 && s.end > 5400), JSON.stringify(three));
        const avoid = (0, highlights_1.bestStretches)(sig, 300, 1, [{ start: 800, end: 1000 }])[0];
        strict_1.default.ok(avoid.end <= 800 || avoid.start >= 1000, JSON.stringify(avoid));
        strict_1.default.deepEqual((0, highlights_1.bestStretches)(sig, 300, 0), []);
        strict_1.default.equal((0, highlights_1.bestStretches)({ durationSec: 100, energyDb: [] }, 300, 3).length, 0);
        // pide más de los que hay: devuelve solo los que de verdad destacan
        strict_1.default.ok((0, highlights_1.bestStretches)(sig, 300, 50).length < 50);
    });
});
(0, node_test_1.describe)('highlights: nombres cortos', () => {
    const speech = (txt) => {
        let t = 0;
        return txt.split(' ').map((x) => W(x, (t += 0.4)));
    };
    (0, node_test_1.it)('shortTitle da de 2 a 5 palabras, máximo 40 caracteres, de lo que se dice en el tramo', () => {
        const w = speech('Bueno chicos mirad esto vamos a entrar en la cueva y de repente aparece un creeper enorme. Ahora vamos a construir la casa del pueblo con madera de roble');
        const a = (0, highlights_1.shortTitle)(w, { start: 0, end: 8 }, 0);
        const b = (0, highlights_1.shortTitle)(w, { start: 8, end: 30 }, 1);
        for (const t of [a, b]) {
            strict_1.default.ok(t.split(' ').length >= 2 && t.split(' ').length <= 5, t);
            strict_1.default.ok(t.length <= 40, t);
        }
        strict_1.default.match(a, /creeper|cueva/i);
        strict_1.default.match(b, /casa|pueblo|madera|roble|construir/i);
        strict_1.default.notEqual(a, b);
    });
    (0, node_test_1.it)('shortTitle sin palabras o solo muletillas cae en «Momento n»', () => {
        strict_1.default.equal((0, highlights_1.shortTitle)([], { start: 0, end: 5 }, 2), 'Momento 3');
        strict_1.default.equal((0, highlights_1.shortTitle)(speech('vale bueno pues eso'), { start: 0, end: 5 }, 0), 'Momento 1');
    });
    (0, node_test_1.it)('dedupeTitles distingue los repetidos', () => {
        strict_1.default.deepEqual((0, highlights_1.dedupeTitles)(['Casa', 'Cueva', 'casa', 'Casa']), ['Casa', 'Cueva', 'casa 2', 'Casa 3']);
    });
    (0, node_test_1.it)('isAutoNameable: nunca lo escrito por el usuario; sí lo largo, lo genérico y lo puesto por el programa', () => {
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'x'.repeat(60), titleSource: 'manual' }), false);
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'Corto', titleSource: 'auto' }), true);
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'x'.repeat(41) }), true);
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'Clip de Twitch' }), true);
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'Momento 4' }), true);
        strict_1.default.equal((0, highlights_1.isAutoNameable)({ title: 'Mi clip favorito' }), false);
    });
});

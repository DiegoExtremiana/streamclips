import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bestStretch, bestStretches, buildSummary, dedupeTitles, fallbackTitle, shortTitle, findMoments, mergeSegments, robustZ, scoreSeconds, smooth, snapToSentences, textOf, type Signals } from '../shared/highlights';
import type { Word } from '../shared/subtitles';

/** Directo de 1 hora con ruido bajo y dos explosiones (en 600 s y 2400 s). */
function stream(dur = 3600): Signals {
  const energy = Array.from({ length: dur }, (_, i) => -35 + Math.sin(i / 7) * 1.5);
  const chat: number[] = Array.from({ length: dur }, (_, i) => (i % 5 === 0 ? 1 : 0));
  for (const c of [600, 2400]) {
    for (let i = c - 10; i < c + 10; i++) {
      energy[i] = -12;
      chat[i] = 9;
    }
  }
  return { durationSec: dur, energyDb: energy, chat };
}

describe('highlights: utilidades', () => {
  it('smooth: media móvil centrada, sin desbordes en los bordes', () => {
    assert.deepEqual(smooth([0, 0, 9, 0, 0], 3).map((x) => Math.round(x)), [0, 3, 3, 3, 0]);
    assert.deepEqual(smooth([4], 5), [4]);
    assert.deepEqual(smooth([], 3), []);
  });
  it('robustZ: lo normal ~0 y lo raro muy por encima; sin variación no da NaN', () => {
    const z = robustZ([1, 2, 1, 2, 1, 2, 1, 20]);
    assert.ok(Math.abs(z[0]) < 1 && z[7] > 5);
    for (const v of robustZ([3, 3, 3, 3])) assert.ok(Number.isFinite(v));
  });
  it('mergeSegments une los que se tocan y respeta los separados', () => {
    assert.deepEqual(mergeSegments([{ start: 50, end: 60 }, { start: 0, end: 10 }, { start: 9, end: 20 }, { start: 21, end: 25 }]), [{ start: 0, end: 25 }, { start: 50, end: 60 }]);
  });
  it('scoreSeconds sin señales devuelve ceros', () => {
    assert.deepEqual(scoreSeconds({ durationSec: 3 }).score, [0, 0, 0]);
  });
});

describe('highlights: momentos', () => {
  it('encuentra las dos explosiones, en orden y sin solaparse', () => {
    const m = findMoments(stream(), { count: 5 });
    assert.equal(m.length, 2, JSON.stringify(m));
    assert.ok(Math.abs(m[0].peak - 600) < 15 && Math.abs(m[1].peak - 2400) < 15);
    assert.ok(m[0].end <= m[1].start);
    for (const x of m) {
      assert.ok(x.end - x.start >= 20 && x.end - x.start <= 60, `${x.end - x.start}`);
      assert.ok(x.start <= x.peak && x.peak <= x.end);
      assert.ok(x.reasons.includes('chat') && x.reasons.includes('volumen'));
    }
  });
  it('respeta el máximo pedido y la distancia mínima entre picos', () => {
    const s = stream();
    for (const c of [620, 700]) for (let i = c - 5; i < c + 5; i++) { s.energyDb![i] = -10; s.chat![i] = 12; }
    const m = findMoments(s, { count: 1 });
    assert.equal(m.length, 1);
    const m3 = findMoments(s, { count: 10, gap: 90 });
    for (let i = 1; i < m3.length; i++) assert.ok(m3[i].peak - m3[i - 1].peak >= 90);
  });
  it('un directo plano no inventa momentos', () => {
    const flat: Signals = { durationSec: 1800, energyDb: new Array(1800).fill(-30), chat: new Array(1800).fill(1) };
    assert.deepEqual(findMoments(flat, { count: 5 }), []);
  });
  it('los límites quedan dentro del vídeo, incluso con un pico al principio o al final', () => {
    const s = stream(300);
    for (let i = 0; i < 6; i++) { s.energyDb![i] = -8; s.chat![i] = 15; }
    for (let i = 294; i < 300; i++) { s.energyDb![i] = -8; s.chat![i] = 15; }
    for (const m of findMoments(s, { count: 3, gap: 30 })) assert.ok(m.start >= 0 && m.end <= 300 && m.end > m.start);
  });
  it('con señales más cortas que el vídeo no se rompe', () => {
    const m = findMoments({ durationSec: 1000, energyDb: [-30, -30, -5, -5, -5, -30], chat: [] }, { count: 2 });
    for (const x of m) assert.ok(x.end <= 1000);
  });
  it('el resumen va en orden cronológico, sin solapes y no pasa del máximo', () => {
    const s = stream(7200);
    for (let k = 1; k <= 20; k++) for (let i = k * 300; i < k * 300 + 12; i++) { s.energyDb![i] = -15; s.chat![i] = 8; }
    const segs = buildSummary(s, { minSec: 300, maxSec: 900 });
    assert.ok(segs.length > 3);
    const total = segs.reduce((a, x) => a + x.end - x.start, 0);
    assert.ok(total <= 900 + 1 && total >= 300, `${total}`);
    for (let i = 1; i < segs.length; i++) assert.ok(segs[i].start > segs[i - 1].end);
  });
  it('bestStretch elige la zona más intensa y devuelve null si el vídeo es corto', () => {
    const s = stream(3600);
    for (let i = 1800; i < 2400; i++) { s.energyDb![i] = -14; s.chat![i] = 6; }
    const b = bestStretch(s, 600)!;
    assert.ok(b.start >= 1700 && b.end <= 2500 && b.end - b.start >= 500, JSON.stringify(b));
    assert.equal(bestStretch({ durationSec: 100, energyDb: [] }, 600), null);
    assert.equal(bestStretch({ durationSec: 3600, energyDb: new Array(3600).fill(-30), chat: new Array(3600).fill(1) }, 600), null);
  });
});

const W = (text: string, start: number, end = start + 0.3): Word => ({ text, start, end });
const SPEECH: Word[] = [W('Estamos', 10), W('en', 10.4), W('la', 10.6), W('final.', 10.8), W('¡No', 12), W('puede', 12.3), W('ser,', 12.6), W('lo', 12.9), W('hemos', 13.1), W('ganado!', 13.4), W('Vale.', 20)];

describe('highlights: frases y títulos', () => {
  it('snapToSentences mueve los extremos al borde de la frase cercana', () => {
    const r = snapToSentences(12.5, 13.5, SPEECH);
    assert.ok(Math.abs(r.start - 11.7) < 0.01, `${r.start}`);
    assert.ok(Math.abs(r.end - 14.1) < 0.2, `${r.end}`);
  });
  it('sin palabras no cambia nada', () => {
    assert.deepEqual(snapToSentences(5, 9, []), { start: 5, end: 9 });
  });
  it('textOf recorta por tiempo y por longitud', () => {
    assert.equal(textOf(SPEECH, 12, 12.8, 700), '¡No puede ser,');
    assert.ok(textOf(SPEECH, 0, 100, 10).endsWith('…'));
  });
  it('fallbackTitle prefiere la frase con exclamación, corta a 70 y tiene plan B', () => {
    assert.equal(fallbackTitle(SPEECH, { start: 10, end: 14 }, 0), '¡No puede ser, lo hemos ganado!');
    assert.equal(fallbackTitle([], { start: 0, end: 10 }, 2), 'Momento 3');
    const long = Array.from({ length: 40 }, (_, i) => W('palabra', i * 0.4));
    assert.ok(fallbackTitle(long, { start: 0, end: 20 }, 0).length <= 70);
  });
});

describe('highlights: directos largos (3-4 h)', () => {
  it('4 horas de señales, con transcripción de ~40.000 palabras, se analizan en menos de 5 s', () => {
    const dur = 4 * 3600;
    const s = stream(dur);
    s.words = Array.from({ length: 40_000 }, (_, i) => ({ text: i % 9 === 8 ? 'vale.' : 'palabra', start: i * 0.36, end: i * 0.36 + 0.3 }));
    for (let k = 1; k <= 30; k++) for (let i = k * 450; i < k * 450 + 15; i++) { s.energyDb![i] = -12; s.chat![i] = 10; }
    const t0 = Date.now();
    const m = findMoments(s, { count: 12 });
    const sum = buildSummary(s, { minSec: 600, maxSec: 900 });
    const main = bestStretch(s, 600);
    assert.ok(Date.now() - t0 < 5000, `tardó ${Date.now() - t0} ms`);
    assert.equal(m.length, 12);
    const total = sum.reduce((a, x) => a + x.end - x.start, 0);
    assert.ok(total >= 600 && total <= 901, `${total}`);
    assert.ok(main && main.end - main.start >= 500);
  });
  it('bestStretches: varios tramos distintos, sin solaparse, en orden cronológico y respetando lo que se evita', () => {
    const dur = 7200;
    const energy = Array.from({ length: dur }, (_, i) => -35 + Math.sin(i / 7) * 1.5);
    for (const c of [900, 3000, 5400]) for (let i = c - 120; i < c + 120; i++) energy[i] = -12;
    const sig: Signals = { durationSec: dur, energyDb: energy, chat: new Array(dur).fill(0) };
    const three = bestStretches(sig, 300, 3);
    assert.equal(three.length, 3);
    for (let i = 1; i < three.length; i++) assert.ok(three[i].start >= three[i - 1].end, JSON.stringify(three));
    assert.ok(three.some((s) => s.start < 900 && s.end > 900) && three.some((s) => s.start < 3000 && s.end > 3000) && three.some((s) => s.start < 5400 && s.end > 5400), JSON.stringify(three));
    const avoid = bestStretches(sig, 300, 1, [{ start: 800, end: 1000 }])[0];
    assert.ok(avoid.end <= 800 || avoid.start >= 1000, JSON.stringify(avoid));
    assert.deepEqual(bestStretches(sig, 300, 0), []);
    assert.equal(bestStretches({ durationSec: 100, energyDb: [] }, 300, 3).length, 0);
    // pide más de los que hay: devuelve solo los que de verdad destacan
    assert.ok(bestStretches(sig, 300, 50).length < 50);
  });
});

describe('highlights: nombres cortos', () => {
  const speech = (txt: string): Word[] => {
    let t = 0;
    return txt.split(' ').map((x) => W(x, (t += 0.4)));
  };
  it('shortTitle da de 2 a 5 palabras, máximo 40 caracteres, de lo que se dice en el tramo', () => {
    const w = speech('Bueno chicos mirad esto vamos a entrar en la cueva y de repente aparece un creeper enorme. Ahora vamos a construir la casa del pueblo con madera de roble');
    const a = shortTitle(w, { start: 0, end: 8 }, 0);
    const b = shortTitle(w, { start: 8, end: 30 }, 1);
    for (const t of [a, b]) {
      assert.ok(t.split(' ').length >= 2 && t.split(' ').length <= 5, t);
      assert.ok(t.length <= 40, t);
    }
    assert.match(a, /creeper|cueva/i);
    assert.match(b, /casa|pueblo|madera|roble|construir/i);
    assert.notEqual(a, b);
  });
  it('shortTitle sin palabras o solo muletillas cae en «Momento n»', () => {
    assert.equal(shortTitle([], { start: 0, end: 5 }, 2), 'Momento 3');
    assert.equal(shortTitle(speech('vale bueno pues eso'), { start: 0, end: 5 }, 0), 'Momento 1');
  });
  it('dedupeTitles distingue los repetidos', () => {
    assert.deepEqual(dedupeTitles(['Casa', 'Cueva', 'casa', 'Casa']), ['Casa', 'Cueva', 'casa 2', 'Casa 3']);
  });
});

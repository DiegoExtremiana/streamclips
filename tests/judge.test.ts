import assert from 'node:assert/strict';
import test from 'node:test';
import type { Word } from '../shared/subtitles';
import { CRITERIA, WEIGHTS, entertainment, judgeText, parseJudgements, selectBest, similarityOfText, toJudged, type Candidate, type Judgement } from '../shared/judge';

const cand = (id: string, start: number, end: number, signal = 1): Candidate => ({ id, start, end, signal });
const sc = (n: number) => ({ humor: n, originalidad: n, interaccion: n, reaccion: n, contexto: n, autonomia: n });
const raw = (id: string, n: number, extra: Record<string, unknown> = {}) => ({ id, ...sc(n), tipo: 'gracia', descartar: false, motivo: 'm', ...extra });
const W = (text: string, start: number): Word => ({ text, start, end: start + 0.3 });

test('los pesos de los criterios suman 1 y la nota va de 0 a 10', () => {
  assert.ok(Math.abs(CRITERIA.reduce((a, c) => a + WEIGHTS[c], 0) - 1) < 1e-9);
  assert.equal(entertainment({ scores: sc(10) }, 5), 10);
  assert.equal(entertainment({ scores: sc(0) }, 0), 0);
  // las señales de audio solo suman un 15 %
  assert.ok(entertainment({ scores: sc(5) }, 5) - entertainment({ scores: sc(5) }, 0) <= 1.51);
});

test('parseJudgements ignora lo incompleto, lo repetido y lo que no es de los candidatos; limita a 0-10', () => {
  const cs = [cand('a', 100, 160), cand('b', 300, 360)];
  const js = parseJudgements({ juicios: [raw('a', 14), { id: 'b', humor: 5 }, raw('zzz', 5), raw('a', 2), 'basura', null] }, cs);
  assert.equal(js.length, 1);
  assert.equal(js[0].id, 'a');
  assert.ok(CRITERIA.every((c) => js[0].scores[c] === 10));
  assert.deepEqual(parseJudgements({}, cs), []);
  assert.deepEqual(parseJudgements(null, cs), []);
});

test('parseJudgements: tipo desconocido pasa a «otro»; el recorte solo vale si es razonable', () => {
  const c = cand('a', 100, 160);
  const [ok] = parseJudgements({ juicios: [raw('a', 7, { tipo: 'rarisimo', inicio: 10, fin: 50 })] }, [c]);
  assert.equal(ok.kind, 'otro');
  assert.deepEqual(ok.trim, { start: 110, end: 150 });
  const [short] = parseJudgements({ juicios: [raw('a', 7, { inicio: 10, fin: 15 })] }, [c]);
  assert.equal(short.trim, undefined, 'menos de 10 s');
  const [tiny] = parseJudgements({ juicios: [raw('a', 7, { inicio: 30, fin: 45 })] }, [c]);
  assert.equal(tiny.trim, undefined, 'se come más de la mitad');
  const [out] = parseJudgements({ juicios: [raw('a', 7, { inicio: -5, fin: 999 })] }, [c]);
  assert.deepEqual(out.trim, { start: 100, end: 160 }, 'se limita al candidato');
  const [tags] = parseJudgements({ juicios: [raw('a', 7, { motivo: '<b>Muy</b>  gracioso' })] }, [c]);
  assert.equal(tags.reason, 'bMuy/b gracioso');
});

test('judgeText marca el tiempo relativo cada ~10 s y no pasa del límite', () => {
  const ws = Array.from({ length: 30 }, (_, i) => W(`p${i}`, 100 + i));
  const t = judgeText(ws, { start: 100, end: 130 });
  assert.match(t, /^\[0s\] p0/);
  assert.match(t, /\[10s\] p10/);
  assert.ok(judgeText(ws, { start: 100, end: 130 }, 30).length <= 31);
});

const judged = (specs: [string, number, number, number, Judgement['kind']?][], text: Record<string, string> = {}) => {
  const cs = specs.map(([id, s, e, sig]) => cand(id, s, e, sig));
  const js: Judgement[] = specs.map(([id, , , , kind], i) => ({ id, scores: sc(specs[i][3]), kind: kind ?? 'gracia', reason: text[id] ?? '', discard: false }));
  return toJudged(cs, js);
};

test('selectBest: el suelo de calidad manda, no se rellena y sale en orden cronológico', () => {
  const items = judged([['a', 100, 160, 9], ['b', 400, 460, 8], ['c', 800, 860, 4], ['d', 1200, 1260, 3]]);
  const sel = selectBest(items, { maxSec: 10_000, minTotal: 6 });
  assert.deepEqual(sel.chosen.map((c) => c.id), ['a', 'b']);
  assert.equal(sel.eligible, 2);
  assert.equal(sel.totalSec, 120);
  assert.deepEqual(selectBest(items, { maxSec: 10_000, minTotal: 9.9 }).chosen, []);
});

test('selectBest: respeta la duración máxima y el número máximo', () => {
  const items = judged([['a', 0, 100, 9], ['b', 300, 400, 9], ['c', 600, 700, 9]]);
  assert.equal(selectBest(items, { maxSec: 250, minTotal: 5 }).chosen.length, 2);
  assert.equal(selectBest(items, { maxSec: 1000, minTotal: 5, maxCount: 1 }).chosen.length, 1);
});

test('selectBest: da variedad (no todo del mismo tipo) y descarta lo marcado', () => {
  const items = judged([['g1', 0, 60, 8, 'gracia'], ['g2', 200, 260, 8, 'gracia'], ['g3', 400, 460, 8, 'gracia'], ['f1', 600, 660, 7, 'fail']]);
  const sel = selectBest(items, { maxSec: 10_000, minTotal: 5, maxCount: 3, kindPenalty: 1.5 });
  assert.ok(sel.chosen.some((c) => c.id === 'f1'), 'entra el fail aunque tenga menos nota');
  const d = judged([['a', 0, 60, 9]]);
  d[0].judgement.discard = true;
  assert.equal(selectBest(d, { maxSec: 999, minTotal: 1 }).chosen.length, 0);
});

test('selectBest: no repite tramos que hablan de lo mismo ni tramos pegados', () => {
  const items = judged([['a', 0, 60, 9], ['b', 300, 360, 8.5], ['c', 700, 760, 8], ['d', 770, 830, 8]]);
  const texts: Record<number, string> = { 0: 'el creeper explotó la casa construida con diamantes', 300: 'el creeper explotó la casa construida con diamantes otra vez', 700: 'hablando de pizza hawaiana y piña', 770: 'otra cosa distinta completamente sobre cohetes espaciales' };
  const sel = selectBest(items, { maxSec: 9999, minTotal: 5, textFor: (s) => texts[Math.round(s.start)] ?? '', minGap: 20 });
  assert.deepEqual(sel.chosen.map((c) => c.id), ['a', 'c'], 'b repite a; d está pegado a c');
});

test('selectBest: aplica el recorte del modelo y limita el largo alrededor del centro', () => {
  const items = judged([['a', 100, 200, 9]]);
  items[0].judgement.trim = { start: 120, end: 190 };
  const [c] = selectBest(items, { maxSec: 999, minTotal: 5 }).chosen;
  assert.deepEqual(c.seg, { start: 120, end: 190 });
  const [d] = selectBest(items, { maxSec: 999, minTotal: 5, maxLen: 40 }).chosen;
  assert.equal(d.seg.end - d.seg.start, 40);
  assert.ok(d.seg.start >= 120 && d.seg.end <= 190);
});

test('similarityOfText: lo parecido sube y lo distinto es 0', () => {
  assert.ok(similarityOfText('el creeper explotó la casa', 'la casa explotó por el creeper') > 0.7);
  assert.equal(similarityOfText('pizza hawaiana', 'cohetes espaciales'), 0);
  assert.equal(similarityOfText('', 'algo'), 0);
});

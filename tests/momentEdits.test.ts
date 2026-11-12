import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, cleanEdits, emptyEdits, momentKey } from '../shared/momentEdits';
import { selectBest, type Judged } from '../shared/judge';

const mk = (start: number, total: number, kind: 'gracia' | 'fail' = 'gracia'): Judged => ({
  id: `c${start}`,
  start,
  end: start + 40,
  signal: 5,
  total,
  judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: 'x', discard: false },
});

describe('correcciones manuales de momentos', () => {
  it('sin correcciones no cambia nada', () => {
    const a = [mk(100, 8), mk(300, 7)];
    assert.deepEqual(applyEdits(a, emptyEdits()).map((x) => x.total), [8, 7]);
  });

  it('excluir descarta aunque tenga nota alta', () => {
    const e = { ...emptyEdits(), exclude: [momentKey(100)] };
    const sel = selectBest(applyEdits([mk(100, 9), mk(300, 7)], e), { maxSec: Infinity, minTotal: 6.5 });
    assert.deepEqual(sel.chosen.map((c) => c.start), [300]);
  });

  it('fijar mete un momento flojo por encima del suelo de calidad', () => {
    const e = { ...emptyEdits(), pin: [momentKey(500)] };
    const sel = selectBest(applyEdits([mk(100, 8), mk(500, 3)], e), { maxSec: Infinity, minTotal: 6.5 });
    assert.deepEqual(sel.chosen.map((c) => c.start), [100, 500]);
  });

  it('excluir gana a fijar', () => {
    const e = { ...emptyEdits(), pin: [momentKey(500)], exclude: [momentKey(500)] };
    const sel = selectBest(applyEdits([mk(500, 3)], e), { maxSec: Infinity, minTotal: 6.5 });
    assert.equal(sel.chosen.length, 0);
  });

  it('el recorte manual manda y no se acorta aunque supere el largo máximo', () => {
    const e = { ...emptyEdits(), trims: { [momentKey(100)]: { start: 90, end: 190 } } };
    const sel = selectBest(applyEdits([mk(100, 8)], e), { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
    assert.deepEqual(sel.chosen[0].seg, { start: 90, end: 190 });
    // sin recorte manual el largo máximo sí se aplica
    const sel2 = selectBest([{ ...mk(100, 8), end: 200 }], { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
    assert.equal(sel2.chosen[0].seg.end - sel2.chosen[0].seg.start, 60);
  });

  it('un momento añadido a mano entra con su título y sin acortarse', () => {
    const e = { ...emptyEdits(), extra: [{ start: 700, end: 770, title: 'Mi momento' }] };
    const out = applyEdits([mk(100, 8)], e);
    const sel = selectBest(out, { maxSec: Infinity, minTotal: 6.5, maxLen: 60 });
    const m = sel.chosen.find((c) => c.start === 700)!;
    assert.equal(m.judgement.title, 'Mi momento');
    assert.equal(m.seg.end - m.seg.start, 70);
    assert.equal(m.judgement.reason, 'Añadido por ti');
  });

  it('lo guardado en disco se limpia: claves, tiempos y largos absurdos se ignoran', () => {
    const c = cleanEdits({
      exclude: ['12', 'x', '12', 5],
      pin: 'no',
      trims: { '10': { start: 10, end: 50 }, '11': { start: 10, end: 12 }, z: { start: 1, end: 60 }, '13': { start: -5, end: 40 } },
      extra: [{ start: 5, end: 60, title: '<b>Hola</b>' }, { start: 5, end: 6 }, null],
    });
    assert.deepEqual(c.exclude, ['12']);
    assert.deepEqual(c.pin, []);
    assert.deepEqual(Object.keys(c.trims), ['10']);
    assert.equal(c.extra.length, 1);
    assert.equal(c.extra[0].title, 'bHola/b');
    assert.deepEqual(cleanEdits(null), emptyEdits());
  });
});

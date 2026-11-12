import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPrefs, biasFor, cleanPrefs, describePrefs, emptyPrefs, learn, MAX_BIAS, MIN_DECISIONS } from '../shared/preferences';
import type { Judged, MomentKind } from '../shared/judge';

const mk = (kind: MomentKind, total: number, manual = false): Judged => ({
  id: kind,
  start: 0,
  end: 40,
  signal: 5,
  total,
  judgement: { id: kind, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: '', discard: false, ...(manual ? { manual: true } : {}) },
});

describe('preferencias aprendidas', () => {
  it('una sola decisión no cambia nada; varias sí, y el ajuste está acotado', () => {
    let p = emptyPrefs();
    p = learn(p, 'discusion', 'exclude');
    assert.equal(biasFor(p, 'discusion'), 0);
    for (let i = 1; i < MIN_DECISIONS; i++) p = learn(p, 'discusion', 'exclude');
    assert.equal(biasFor(p, 'discusion'), -0.75);
    for (let i = 0; i < 40; i++) p = learn(p, 'discusion', 'exclude');
    assert.equal(p.kindBias.discusion, -MAX_BIAS);
  });

  it('incluir sube el tipo y excluir lo baja', () => {
    let p = emptyPrefs();
    for (let i = 0; i < 4; i++) p = learn(p, 'fail', 'include');
    p = learn(p, 'fail', 'exclude');
    assert.equal(p.kindBias.fail, 0.75);
    assert.equal(p.counts.fail, 5);
  });

  it('aplicar suma el ajuste a la nota, sin pasar de 10 ni tocar lo manual ni lo fijado', () => {
    let p = emptyPrefs();
    for (let i = 0; i < 4; i++) p = learn(p, 'gracia', 'include');
    const out = applyPrefs([mk('gracia', 6), mk('gracia', 9.8), mk('gracia', 5, true), mk('gracia', 10), mk('fail', 6)], p);
    assert.deepEqual(out.map((x) => x.total), [7, 10, 5, 10, 6]);
  });

  it('apagadas no se aplican y los tipos «otro» no se aprenden', () => {
    let p = emptyPrefs();
    for (let i = 0; i < 5; i++) p = learn(p, 'epico', 'include');
    assert.equal(applyPrefs([mk('epico', 6)], { ...p, enabled: false })[0].total, 6);
    assert.equal(learn(p, 'otro', 'exclude'), p);
  });

  it('learn no modifica la entrada y cleanPrefs ignora basura', () => {
    const p = emptyPrefs();
    learn(p, 'fail', 'exclude');
    assert.deepEqual(p, emptyPrefs());
    const c = cleanPrefs({ enabled: false, kindBias: { fail: 99, x: 1, gracia: 'a' }, counts: { fail: -3, gracia: 2.7 } });
    assert.equal(c.enabled, false);
    assert.deepEqual(c.kindBias, { fail: MAX_BIAS });
    assert.deepEqual(c.counts, { gracia: 2 });
    assert.deepEqual(cleanPrefs(null), emptyPrefs());
  });

  it('describe indica qué tipos están ya activos', () => {
    let p = emptyPrefs();
    for (let i = 0; i < 3; i++) p = learn(p, 'historia', 'exclude');
    p = learn(p, 'epico', 'include');
    assert.deepEqual(describePrefs(p), [
      { kind: 'historia', bias: -0.75, count: 3, active: true },
      { kind: 'epico', bias: 0.25, count: 1, active: false },
    ]);
  });
});

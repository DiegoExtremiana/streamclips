import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TaskTracker, estimateEta } from '../electron/domain/tasks';
import { RecordingNotifier } from './helpers';

describe('tiempo estimado', () => {
  it('por la velocidad medida: a mitad de camino tras 10 min faltan otros 10', () => {
    const s = estimateEta({ now: 600_000, firstAt: 0, firstPct: 0, pct: 50, startedAt: 0 });
    assert.equal(Math.round(s!), 600);
  });
  it('un trabajo retomado al 77 % no sale con una cifra absurda: cuenta desde el avance medido', () => {
    // empieza ya en 77 %; en 60 s avanza hasta 80 %: faltan 20 puntos a 3 puntos/min
    const s = estimateEta({ now: 60_000, firstAt: 0, firstPct: 77, pct: 80, startedAt: 0 });
    assert.equal(Math.round(s!), 400);
  });
  it('sin avance suficiente usa la duración esperada, y sin nada no inventa', () => {
    assert.equal(estimateEta({ now: 5000, firstAt: 0, firstPct: 0, pct: 0, startedAt: 0, expectedSec: 3600 }), 3600);
    assert.equal(estimateEta({ now: 5000, firstAt: 0, firstPct: 0, pct: 1, startedAt: 0, expectedSec: 3600 }), 3564);
    assert.equal(estimateEta({ now: 5000, firstAt: 0, firstPct: 0, pct: 1, startedAt: 0 }), undefined);
    assert.equal(estimateEta({ now: 5000, pct: 100, startedAt: 0 }), 0);
  });
  it('la tarea publica etaAt mientras corre y lo quita al terminar', () => {
    let t = 1_000_000;
    const tr = new TaskTracker(new RecordingNotifier(), () => t);
    const h = tr.start('analyze', 'x', 'vod1');
    assert.equal(h.info.ref, 'vod1');
    h.estimate(1200);
    assert.equal(Date.parse(h.info.etaAt!) - t, 1_200_000);
    h.update(0);
    t += 30_000;
    h.update(10);
    assert.equal(Math.round((Date.parse(h.info.etaAt!) - t) / 1000), 270);
    h.done();
    assert.equal(h.info.etaAt, undefined);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildThreads, parseTopics, topicPrompt } from '../shared/topics';
import type { Judged } from '../shared/judge';

const j = (id: string, start: number, len: number, total: number, extra: Partial<Judged['judgement']> = {}): Judged => ({
  id,
  start,
  end: start + len,
  signal: 1,
  total,
  judgement: { id, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind: 'historia', reason: '', discard: false, ...extra },
});

describe('vídeos por tema', () => {
  const items = [j('c1', 600, 90, 8), j('c2', 4000, 80, 7), j('c3', 9000, 100, 6), j('c4', 2000, 60, 7), j('c5', 12000, 60, 4)];
  it('valida la respuesta del modelo: ids conocidos, sin repetir y con 2 o más', () => {
    const t = parseTopics({ temas: [{ titulo: 'La pelea  del bar', ids: ['c1', 'c2', 'zz', 'c1'] }, { titulo: 'Otro', ids: ['c2', 'c3'] }, { titulo: 'Solo uno', ids: ['c4'] }, { titulo: 3, ids: [] }] }, new Set(items.map((x) => x.id)));
    assert.deepEqual(t, [{ title: 'La pelea del bar', ids: ['c1', 'c2'] }]);
    assert.deepEqual(parseTopics('basura', new Set()), []);
  });
  it('junta los momentos del tema en orden cronológico aunque estén separados horas', () => {
    const [th] = buildThreads(items, [{ title: 'El reto', ids: ['c3', 'c1', 'c2'] }], { targetSec: 600, minSec: 100 });
    assert.equal(th.pieces, 3);
    assert.deepEqual(th.segs.map((s) => s.start), [600, 4000, 9000]);
    assert.ok(th.totalSec >= 250);
  });
  it('puede pasarse un poco del objetivo pero no mucho, y se queda corto si no hay más', () => {
    const many = Array.from({ length: 8 }, (_, i) => j(`m${i}`, i * 1000, 100, 8 - i * 0.3));
    const [th] = buildThreads(many, [{ title: 'Largo', ids: many.map((m) => m.id) }], { targetSec: 300, overshoot: 1.25 });
    assert.ok(th.totalSec >= 300 && th.totalSec <= 375, `${th.totalSec}`);
    assert.equal(buildThreads(items, [{ title: 'Corto', ids: ['c4', 'c5'] }], { minSec: 200 }).length, 0, 'demasiado corto para ser un vídeo');
  });
  it('descarta lo marcado como descartar, usa el recorte del modelo y une lo que se toca', () => {
    const a = j('a', 100, 80, 7, { trim: { start: 110, end: 150 } });
    const b = j('b', 152, 60, 7);
    const c = j('c', 500, 80, 7, { discard: true });
    const [th] = buildThreads([a, b, c], [{ title: 'T', ids: ['a', 'b', 'c'] }], { minSec: 60 });
    assert.equal(th.pieces, 2);
    assert.deepEqual(th.segs, [{ start: 110, end: 212 }]);
  });
  it('el texto para el modelo lleva id, hora y título', () => {
    const p = JSON.parse(topicPrompt([{ text: 'hola', start: 601, end: 602 }], [j('c1', 600, 90, 8, { title: 'Intro' })]));
    assert.equal(p.fragmentos[0].id, 'c1');
    assert.equal(p.fragmentos[0].hora, '0h10');
    assert.equal(p.fragmentos[0].titulo, 'Intro');
  });
});

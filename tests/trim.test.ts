import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fmtTenths, fromFraction, moveHandle, timelineWindow, toFraction } from '../shared/trim';
import { parseTime } from '../shared/time';

describe('recorte de clips', () => {
  it('la ventana añade margen a cada lado sin salirse del directo', () => {
    assert.deepEqual(timelineWindow({ start: 100, end: 130 }, 1000), { start: 55, end: 175 });
    assert.deepEqual(timelineWindow({ start: 10, end: 30 }, 1000), { start: 0, end: 75 });
    assert.deepEqual(timelineWindow({ start: 960, end: 990 }, 1000), { start: 915, end: 1000 });
    assert.deepEqual(timelineWindow({ start: 100, end: 130 }, null), { start: 55, end: 175 });
  });
  it('los extremos respetan 1 s mínimo, 3 min máximo y los límites del directo', () => {
    const r = { start: 100, end: 130 };
    assert.deepEqual(moveHandle('start', 120, r, 1000), { start: 120, end: 130 });
    assert.deepEqual(moveHandle('start', 129.95, r, 1000), { start: 129, end: 130 }, 'no pasa de 1 s de clip');
    assert.deepEqual(moveHandle('start', -5, r, 1000), { start: 0, end: 130 }, 'ni antes del inicio del directo');
    assert.deepEqual(moveHandle('start', 0, { start: 400, end: 500 }, 1000), { start: 320, end: 500 }, 'máximo 180 s');
    assert.deepEqual(moveHandle('end', 101, r, 1000), { start: 100, end: 101 });
    assert.deepEqual(moveHandle('end', 100, r, 1000), { start: 100, end: 101 });
    assert.deepEqual(moveHandle('end', 5000, r, 1000), { start: 100, end: 280 }, 'máximo 180 s');
    assert.deepEqual(moveHandle('end', 5000, { start: 900, end: 950 }, 1000), { start: 900, end: 1000 }, 'ni más allá del final del directo');
    assert.deepEqual(moveHandle('end', 133.33, r, 1000), { start: 100, end: 133.3 }, 'décimas de segundo');
  });
  it('posiciones y tiempos en la línea', () => {
    const w = { start: 50, end: 150 };
    assert.equal(toFraction(100, w), 0.5);
    assert.equal(toFraction(0, w), 0);
    assert.equal(toFraction(999, w), 1);
    assert.equal(fromFraction(0.25, w), 75);
    assert.equal(fromFraction(2, w), 150);
  });
  it('el tiempo se escribe y se vuelve a leer sin perder nada', () => {
    for (const t of [0, 5, 83, 83.4, 3723.5, 59.9]) assert.equal(parseTime(fmtTenths(t)), t, fmtTenths(t));
    assert.equal(fmtTenths(83), '1:23');
    assert.equal(fmtTenths(83.4), '1:23.4');
    assert.equal(fmtTenths(3723), '1:02:03');
  });
});

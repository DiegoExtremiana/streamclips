import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OutputItem, Publication } from '../shared/types';
import { addDays, atFromDayMinutes, dayStartMs, daysFrom, defaultWhenForDay, groupBlocks, hhmm, layoutLanes, minutesOfDay, monthGrid, moveToDay, snapMinutes, unscheduledOutputs, validateMove } from '../shared/schedulePlan';

const T = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const pub = (outputId: string, platform: Publication['platform'], at: number, status: Publication['status'] = 'scheduled', note?: string): Publication => ({ key: `${outputId}:${platform}`, outputId, platform, scheduledAt: new Date(at).toISOString(), status, ...(note ? { note } : {}) });
const out = (id: string, title = id): OutputItem => ({ id, kind: 'clip', title, files: {}, durationSec: 1, createdAt: 'x' });

describe('schedulePlan', () => {
  it('agrupa por vídeo y hora: las redes del mismo vídeo a la misma hora van juntas', () => {
    const bs = groupBlocks([pub('a', 'youtube', T(16, 8)), pub('a', 'tiktok', T(16, 8)), pub('a', 'instagram', T(16, 20)), pub('b', 'youtube', T(16, 8))], [out('a', 'Resumen'), out('b', 'Principal')]);
    assert.equal(bs.length, 3);
    // a la misma hora se ordena por título: Principal, Resumen (a las 8) y luego Resumen (a las 20)
    assert.deepEqual(bs.map((b) => b.title), ['Principal', 'Resumen', 'Resumen']);
    assert.deepEqual(bs[1].platforms, ['youtube', 'tiktok']);
    assert.deepEqual(bs[1].keys, ['a:youtube', 'a:tiktok']);
  });
  it('ignora lo publicado o fallido, bloquea lo que se está publicando y avisa de vídeos borrados', () => {
    const bs = groupBlocks([pub('a', 'youtube', T(16, 8), 'published'), pub('b', 'youtube', T(16, 9), 'failed'), pub('c', 'youtube', T(16, 10), 'publishing'), pub('z', 'youtube', T(16, 11), 'scheduled', 'En espera')], [out('c')]);
    assert.deepEqual(bs.map((b) => [b.title, b.locked, b.note]), [['c', true, undefined], ['Vídeo borrado', false, 'En espera']]);
  });
  it('snapMinutes: redondea a 15 min y se queda dentro del día', () => {
    assert.equal(snapMinutes(7), 0);
    assert.equal(snapMinutes(8), 15);
    assert.equal(snapMinutes(16 * 60 + 7), 16 * 60);
    assert.equal(snapMinutes(-30), 0);
    assert.equal(snapMinutes(99999), 23 * 60 + 45);
    assert.equal(snapMinutes(37, 5), 35);
  });
  it('conversión día + minutos y mover de día conservando la hora', () => {
    assert.equal(atFromDayMinutes('2026-10-16', 16 * 60 + 15), T(16, 16, 15));
    assert.equal(minutesOfDay(T(16, 7, 30)), 450);
    assert.equal(moveToDay(T(16, 7, 30), '2026-10-20'), T(20, 7, 30));
    assert.equal(hhmm(T(1, 7, 5)), '07:05');
  });
  it('mover de día resiste el cambio de hora de octubre (25 oct 2026 en Europa)', () => {
    const at = new Date(2026, 9, 24, 16, 0).getTime();
    const moved = moveToDay(at, '2026-10-26');
    assert.equal(new Date(moved).getHours(), 16);
    assert.equal(new Date(moved).getDate(), 26);
  });
  it('validateMove: no se puede llevar al pasado (con un minuto de margen)', () => {
    const now = T(16, 12);
    assert.match(validateMove(T(16, 11), now)!, /ya ha pasado/);
    assert.equal(validateMove(T(16, 12), now), null);
    assert.equal(validateMove(now - 30_000, now), null);
  });
  it('daysFrom y addDays dan días consecutivos aunque cambie el mes o la hora', () => {
    assert.deepEqual(daysFrom(T(30, 22), 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-10-24', 2), '2026-10-26');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  });
  it('monthGrid: 6 semanas de lunes a domingo con el día 1 en su columna', () => {
    const g = monthGrid(2026, 9); // octubre de 2026: el día 1 es jueves
    assert.equal(g.length, 6);
    assert.ok(g.every((w) => w.length === 7));
    assert.equal(g[0][3], '2026-10-01');
    assert.equal(g[0][0], '2026-09-28');
    assert.equal(g[5][6], '2026-11-08');
    assert.equal(new Set(g.flat()).size, 42);
    assert.equal(monthGrid(2026, 1)[0][6], '2026-02-01'); // febrero de 2026 empieza en domingo
  });
  it('layoutLanes: bloques cercanos van en carriles distintos y los lejanos comparten', () => {
    const items = [{ id: 'a', at: T(16, 8, 0) }, { id: 'b', at: T(16, 8, 30) }, { id: 'c', at: T(16, 12, 0) }, { id: 'd', at: T(16, 8, 45) }];
    const { lanes, count } = layoutLanes(items, 60);
    assert.equal(lanes.get('a'), 0);
    assert.equal(lanes.get('b'), 1);
    assert.equal(lanes.get('d'), 2);
    assert.equal(lanes.get('c'), 0);
    assert.equal(count, 3);
    assert.equal(layoutLanes([], 60).count, 1);
  });
  it('unscheduledOutputs: solo vídeos sin ninguna subida', () => {
    const o = [out('a'), out('b'), out('c'), out('d')];
    const p = [pub('a', 'youtube', T(16, 8)), pub('b', 'youtube', T(16, 8), 'published'), pub('c', 'youtube', T(16, 8), 'failed')];
    assert.deepEqual(unscheduledOutputs(o, p).map((x) => x.id), ['c', 'd']);
  });
  it('defaultWhenForDay: primera hora habitual futura; hoy con todo pasado, la próxima hora en punto', () => {
    const now = T(15, 17, 20);
    assert.equal(defaultWhenForDay('2026-10-16', now, ['07:00', '16:00', '20:00']), '2026-10-16T07:00');
    assert.equal(defaultWhenForDay('2026-10-15', now, ['07:00', '16:00', '20:00']), '2026-10-15T20:00');
    assert.equal(defaultWhenForDay('2026-10-15', T(15, 21, 10), ['07:00', '16:00', '20:00']), '2026-10-15T22:00');
    assert.equal(defaultWhenForDay('2026-10-16', now, []), '2026-10-16T16:00');
    assert.equal(dayStartMs('2026-10-16'), T(16, 0));
  });
});

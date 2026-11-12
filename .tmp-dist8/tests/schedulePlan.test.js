"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const schedulePlan_1 = require("../shared/schedulePlan");
const T = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();
const pub = (outputId, platform, at, status = 'scheduled', note) => ({ key: `${outputId}:${platform}`, outputId, platform, scheduledAt: new Date(at).toISOString(), status, ...(note ? { note } : {}) });
const out = (id, title = id) => ({ id, kind: 'clip', title, files: {}, durationSec: 1, createdAt: 'x' });
(0, node_test_1.describe)('schedulePlan', () => {
    (0, node_test_1.it)('agrupa por vídeo y hora: las redes del mismo vídeo a la misma hora van juntas', () => {
        const bs = (0, schedulePlan_1.groupBlocks)([pub('a', 'youtube', T(16, 8)), pub('a', 'tiktok', T(16, 8)), pub('a', 'instagram', T(16, 20)), pub('b', 'youtube', T(16, 8))], [out('a', 'Resumen'), out('b', 'Principal')]);
        strict_1.default.equal(bs.length, 3);
        // a la misma hora se ordena por título: Principal, Resumen (a las 8) y luego Resumen (a las 20)
        strict_1.default.deepEqual(bs.map((b) => b.title), ['Principal', 'Resumen', 'Resumen']);
        strict_1.default.deepEqual(bs[1].platforms, ['youtube', 'tiktok']);
        strict_1.default.deepEqual(bs[1].keys, ['a:youtube', 'a:tiktok']);
    });
    (0, node_test_1.it)('ignora lo publicado o fallido, bloquea lo que se está publicando y avisa de vídeos borrados', () => {
        const bs = (0, schedulePlan_1.groupBlocks)([pub('a', 'youtube', T(16, 8), 'published'), pub('b', 'youtube', T(16, 9), 'failed'), pub('c', 'youtube', T(16, 10), 'publishing'), pub('z', 'youtube', T(16, 11), 'scheduled', 'En espera')], [out('c')]);
        strict_1.default.deepEqual(bs.map((b) => [b.title, b.locked, b.note]), [['c', true, undefined], ['Vídeo borrado', false, 'En espera']]);
    });
    (0, node_test_1.it)('snapMinutes: redondea a 15 min y se queda dentro del día', () => {
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(7), 0);
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(8), 15);
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(16 * 60 + 7), 16 * 60);
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(-30), 0);
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(99999), 23 * 60 + 45);
        strict_1.default.equal((0, schedulePlan_1.snapMinutes)(37, 5), 35);
    });
    (0, node_test_1.it)('conversión día + minutos y mover de día conservando la hora', () => {
        strict_1.default.equal((0, schedulePlan_1.atFromDayMinutes)('2026-10-16', 16 * 60 + 15), T(16, 16, 15));
        strict_1.default.equal((0, schedulePlan_1.minutesOfDay)(T(16, 7, 30)), 450);
        strict_1.default.equal((0, schedulePlan_1.moveToDay)(T(16, 7, 30), '2026-10-20'), T(20, 7, 30));
        strict_1.default.equal((0, schedulePlan_1.hhmm)(T(1, 7, 5)), '07:05');
    });
    (0, node_test_1.it)('mover de día resiste el cambio de hora de octubre (25 oct 2026 en Europa)', () => {
        const at = new Date(2026, 9, 24, 16, 0).getTime();
        const moved = (0, schedulePlan_1.moveToDay)(at, '2026-10-26');
        strict_1.default.equal(new Date(moved).getHours(), 16);
        strict_1.default.equal(new Date(moved).getDate(), 26);
    });
    (0, node_test_1.it)('validateMove: no se puede llevar al pasado (con un minuto de margen)', () => {
        const now = T(16, 12);
        strict_1.default.match((0, schedulePlan_1.validateMove)(T(16, 11), now), /ya ha pasado/);
        strict_1.default.equal((0, schedulePlan_1.validateMove)(T(16, 12), now), null);
        strict_1.default.equal((0, schedulePlan_1.validateMove)(now - 30_000, now), null);
    });
    (0, node_test_1.it)('daysFrom y addDays dan días consecutivos aunque cambie el mes o la hora', () => {
        strict_1.default.deepEqual((0, schedulePlan_1.daysFrom)(T(30, 22), 4), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
        strict_1.default.equal((0, schedulePlan_1.addDays)('2026-10-31', 1), '2026-11-01');
        strict_1.default.equal((0, schedulePlan_1.addDays)('2026-10-24', 2), '2026-10-26');
        strict_1.default.equal((0, schedulePlan_1.addDays)('2026-01-01', -1), '2025-12-31');
    });
    (0, node_test_1.it)('monthGrid: 6 semanas de lunes a domingo con el día 1 en su columna', () => {
        const g = (0, schedulePlan_1.monthGrid)(2026, 9); // octubre de 2026: el día 1 es jueves
        strict_1.default.equal(g.length, 6);
        strict_1.default.ok(g.every((w) => w.length === 7));
        strict_1.default.equal(g[0][3], '2026-10-01');
        strict_1.default.equal(g[0][0], '2026-09-28');
        strict_1.default.equal(g[5][6], '2026-11-08');
        strict_1.default.equal(new Set(g.flat()).size, 42);
        strict_1.default.equal((0, schedulePlan_1.monthGrid)(2026, 1)[0][6], '2026-02-01'); // febrero de 2026 empieza en domingo
    });
    (0, node_test_1.it)('layoutLanes: bloques cercanos van en carriles distintos y los lejanos comparten', () => {
        const items = [{ id: 'a', at: T(16, 8, 0) }, { id: 'b', at: T(16, 8, 30) }, { id: 'c', at: T(16, 12, 0) }, { id: 'd', at: T(16, 8, 45) }];
        const { lanes, count } = (0, schedulePlan_1.layoutLanes)(items, 60);
        strict_1.default.equal(lanes.get('a'), 0);
        strict_1.default.equal(lanes.get('b'), 1);
        strict_1.default.equal(lanes.get('d'), 2);
        strict_1.default.equal(lanes.get('c'), 0);
        strict_1.default.equal(count, 3);
        strict_1.default.equal((0, schedulePlan_1.layoutLanes)([], 60).count, 1);
    });
    (0, node_test_1.it)('unscheduledOutputs: solo vídeos sin ninguna subida', () => {
        const o = [out('a'), out('b'), out('c'), out('d')];
        const p = [pub('a', 'youtube', T(16, 8)), pub('b', 'youtube', T(16, 8), 'published'), pub('c', 'youtube', T(16, 8), 'failed')];
        strict_1.default.deepEqual((0, schedulePlan_1.unscheduledOutputs)(o, p).map((x) => x.id), ['c', 'd']);
    });
    (0, node_test_1.it)('defaultWhenForDay: primera hora habitual futura; hoy con todo pasado, la próxima hora en punto', () => {
        const now = T(15, 17, 20);
        strict_1.default.equal((0, schedulePlan_1.defaultWhenForDay)('2026-10-16', now, ['07:00', '16:00', '20:00']), '2026-10-16T07:00');
        strict_1.default.equal((0, schedulePlan_1.defaultWhenForDay)('2026-10-15', now, ['07:00', '16:00', '20:00']), '2026-10-15T20:00');
        strict_1.default.equal((0, schedulePlan_1.defaultWhenForDay)('2026-10-15', T(15, 21, 10), ['07:00', '16:00', '20:00']), '2026-10-15T22:00');
        strict_1.default.equal((0, schedulePlan_1.defaultWhenForDay)('2026-10-16', now, []), '2026-10-16T16:00');
        strict_1.default.equal((0, schedulePlan_1.dayStartMs)('2026-10-16'), T(16, 0));
    });
    (0, node_test_1.it)('entriesForBlockEdit: cambia solo ese bloque y conserva las demás subidas del vídeo', () => {
        const pubs = [pub('a', 'youtube', T(16, 8)), pub('a', 'tiktok', T(16, 8)), pub('a', 'instagram', T(17, 19)), pub('a', 'youtube', T(18, 9), 'published')];
        const blocks = (0, schedulePlan_1.groupBlocks)(pubs, [out('a')]);
        const first = blocks.find((b) => b.at === T(16, 8));
        // nueva hora y solo YouTube: TikTok del bloque se quita, Instagram (otro día) se queda
        const e = (0, schedulePlan_1.entriesForBlockEdit)(first, pubs, { at: T(16, 12), platforms: ['youtube'] });
        strict_1.default.deepEqual(e.map((x) => [x.platform, Date.parse(x.atIso)]), [['instagram', T(17, 19)], ['youtube', T(16, 12)]]);
        // añadir una red al bloque
        const e2 = (0, schedulePlan_1.entriesForBlockEdit)(first, pubs, { at: T(16, 8), platforms: ['youtube', 'tiktok', 'instagram'] });
        strict_1.default.deepEqual(e2.map((x) => x.platform).sort(), ['instagram', 'tiktok', 'youtube']);
        strict_1.default.ok(e2.filter((x) => x.platform === 'instagram').every((x) => Date.parse(x.atIso) === T(16, 8)), 'la red añadida al bloque toma la hora del bloque');
    });
});

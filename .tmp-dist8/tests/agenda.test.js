"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const agenda_1 = require("../shared/agenda");
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const pub = (key, outputId, platform, when, status = 'scheduled') => ({ key, outputId, platform, scheduledAt: when, status });
const out = (id, title) => ({ id, kind: 'clip', title, files: {}, durationSec: 1, createdAt: 'x' });
(0, node_test_1.describe)('agenda', () => {
    (0, node_test_1.it)('agrupa por día local, ordena por hora y admite varias subidas el mismo día', () => {
        const days = (0, agenda_1.buildAgenda)([pub('b:youtube', 'b', 'youtube', at(16, 16)), pub('a:youtube', 'a', 'youtube', at(16, 7)), pub('c:tiktok', 'c', 'tiktok', at(17, 9)), pub('a:tiktok', 'a', 'tiktok', at(16, 7))], [out('a', 'Resumen'), out('b', 'Principal'), out('c', 'Clip')]);
        strict_1.default.deepEqual(days.map((d) => [d.key, d.entries.length]), [['2026-10-16', 3], ['2026-10-17', 1]]);
        strict_1.default.deepEqual(days[0].entries.map((e) => e.title), ['Resumen', 'Resumen', 'Principal']);
    });
    (0, node_test_1.it)('solo cuenta lo que está por venir y avisa de los vídeos borrados', () => {
        const days = (0, agenda_1.buildAgenda)([pub('a:youtube', 'a', 'youtube', at(16, 7), 'published'), pub('b:youtube', 'b', 'youtube', at(16, 8), 'failed'), pub('z:youtube', 'z', 'youtube', at(16, 9)), pub('c:youtube', 'c', 'youtube', at(16, 10), 'publishing')], [out('c', 'C')]);
        strict_1.default.deepEqual(days[0].entries.map((e) => e.title), ['Vídeo borrado', 'C']);
    });
    (0, node_test_1.it)('dayLabel: hoy, mañana y fecha larga', () => {
        const now = new Date(2026, 9, 15, 22, 0).getTime();
        strict_1.default.equal((0, agenda_1.dayLabel)('2026-10-15', now), 'Hoy');
        strict_1.default.equal((0, agenda_1.dayLabel)('2026-10-16', now), 'Mañana');
        strict_1.default.match((0, agenda_1.dayLabel)('2026-10-20', now), /martes.*20.*octubre/);
        strict_1.default.equal((0, agenda_1.localDayKey)(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
    });
    (0, node_test_1.it)('freePlatforms descarta las redes donde ya se publicó o se está publicando', () => {
        const ps = [pub('a:youtube', 'a', 'youtube', at(16, 7), 'published'), pub('a:tiktok', 'a', 'tiktok', at(16, 7), 'scheduled'), pub('a:instagram', 'a', 'instagram', at(16, 7), 'publishing')];
        strict_1.default.deepEqual((0, agenda_1.freePlatforms)('a', ps, ['youtube', 'tiktok', 'instagram']), ['tiktok']);
    });
});

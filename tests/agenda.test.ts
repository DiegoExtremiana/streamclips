import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OutputItem, Publication } from '../shared/types';
import { buildAgenda, dayLabel, freePlatforms, localDayKey } from '../shared/agenda';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const pub = (key: string, outputId: string, platform: Publication['platform'], when: string, status: Publication['status'] = 'scheduled'): Publication => ({ key, outputId, platform, scheduledAt: when, status });
const out = (id: string, title: string): OutputItem => ({ id, kind: 'clip', title, files: {}, durationSec: 1, createdAt: 'x' });

describe('agenda', () => {
  it('agrupa por día local, ordena por hora y admite varias subidas el mismo día', () => {
    const days = buildAgenda(
      [pub('b:youtube', 'b', 'youtube', at(16, 16)), pub('a:youtube', 'a', 'youtube', at(16, 7)), pub('c:tiktok', 'c', 'tiktok', at(17, 9)), pub('a:tiktok', 'a', 'tiktok', at(16, 7))],
      [out('a', 'Resumen'), out('b', 'Principal'), out('c', 'Clip')],
    );
    assert.deepEqual(days.map((d) => [d.key, d.entries.length]), [['2026-10-16', 3], ['2026-10-17', 1]]);
    assert.deepEqual(days[0].entries.map((e) => e.title), ['Resumen', 'Resumen', 'Principal']);
  });
  it('solo cuenta lo que está por venir y avisa de los vídeos borrados', () => {
    const days = buildAgenda(
      [pub('a:youtube', 'a', 'youtube', at(16, 7), 'published'), pub('b:youtube', 'b', 'youtube', at(16, 8), 'failed'), pub('z:youtube', 'z', 'youtube', at(16, 9)), pub('c:youtube', 'c', 'youtube', at(16, 10), 'publishing')],
      [out('c', 'C')],
    );
    assert.deepEqual(days[0].entries.map((e) => e.title), ['Vídeo borrado', 'C']);
  });
  it('dayLabel: hoy, mañana y fecha larga', () => {
    const now = new Date(2026, 9, 15, 22, 0).getTime();
    assert.equal(dayLabel('2026-10-15', now), 'Hoy');
    assert.equal(dayLabel('2026-10-16', now), 'Mañana');
    assert.match(dayLabel('2026-10-20', now), /martes.*20.*octubre/);
    assert.equal(localDayKey(new Date(2026, 0, 5, 23, 59).getTime()), '2026-01-05');
  });
  it('freePlatforms descarta las redes donde ya se publicó o se está publicando', () => {
    const ps = [pub('a:youtube', 'a', 'youtube', at(16, 7), 'published'), pub('a:tiktok', 'a', 'tiktok', at(16, 7), 'scheduled'), pub('a:instagram', 'a', 'instagram', at(16, 7), 'publishing')];
    assert.deepEqual(freePlatforms('a', ps, ['youtube', 'tiktok', 'instagram']), ['tiktok']);
  });
});

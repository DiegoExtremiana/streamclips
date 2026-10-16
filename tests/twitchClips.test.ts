import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { OutputItem, TwitchClip, VodJob } from '../shared/types';
import { clipLibraryState, filterClips } from '../shared/twitchClips';

const clip = (id: string, title: string, createdAt: string): TwitchClip => ({ id, title, url: `https://clips.twitch.tv/${id}`, durationSec: 10, createdAt, creator: 'x', views: 0, thumbnail: '' });
const vod = (id: string, twitchId: string, status: VodJob['status'] = 'downloaded', origin: VodJob['origin'] = 'clip'): VodJob => ({ id, url: 'u', title: 't', status, progress: 100, createdAt: '2026-10-01T00:00:00Z', twitchId, origin });
const out = (id: string, vodId: string): OutputItem => ({ id, vodId, kind: 'clip', title: 'c', files: {}, durationSec: 1, createdAt: '2026-10-01T00:00:00Z' });

describe('clips de Twitch en la interfaz', () => {
  it('se ordenan del más reciente al más antiguo', () => {
    const l = filterClips([clip('a', 'A', '2026-10-01T00:00:00Z'), clip('b', 'B', '2026-10-03T00:00:00Z'), clip('c', 'C', '2026-10-02T00:00:00Z')], '');
    assert.deepEqual(l.map((c) => c.id), ['b', 'c', 'a']);
  });
  it('la búsqueda es por nombre, sin mayúsculas ni tildes, y no altera la lista original', () => {
    const src = [clip('a', 'Pentakill increíble', '2026-10-01T00:00:00Z'), clip('b', 'Fallo ÉPICO', '2026-10-02T00:00:00Z')];
    assert.deepEqual(filterClips(src, ' epico ').map((c) => c.id), ['b']);
    assert.deepEqual(filterClips(src, 'INCREIBLE').map((c) => c.id), ['a']);
    assert.deepEqual(filterClips(src, 'zzz'), []);
    assert.equal(src[0].id, 'a');
  });
  it('estado en la Biblioteca: fuera, preparándose o dentro, según lo que hay ahora', () => {
    assert.equal(clipLibraryState('x', [], []), 'none');
    assert.equal(clipLibraryState('x', [vod('v1', 'x', 'downloading')], []), 'preparing');
    assert.equal(clipLibraryState('x', [vod('v1', 'x')], []), 'preparing');
    assert.equal(clipLibraryState('x', [vod('v1', 'x')], [out('o1', 'v1')]), 'library');
    // si se borra de la Biblioteca (y su descarga), vuelve a poder añadirse
    assert.equal(clipLibraryState('x', [], [out('o1', 'v1')]), 'none');
  });
  it('una descarga fallida o un VOD con el mismo id que no es un clip no cuentan', () => {
    assert.equal(clipLibraryState('x', [vod('v1', 'x', 'error')], []), 'none');
    assert.equal(clipLibraryState('x', [vod('v1', 'x', 'downloaded', 'live')], [out('o1', 'v1')]), 'none');
  });
});

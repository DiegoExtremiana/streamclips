import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addOutput, makeEnv } from './helpers';
import { platformsFor } from '../shared/types';
import { groupBlocks } from '../shared/schedulePlan';

describe('vídeos solo a YouTube, clips a todas las redes', () => {
  const setup = () => {
    const e = makeEnv();
    addOutput(e, 'clip1');
    const v = addOutput(e, 'vid1');
    v.kind = 'long';
    v.files = { long: v.files.vertical! };
    return e;
  };
  const when = () => new Date(Date.now() + 3600_000).toISOString();

  it('platformsFor', () => {
    assert.deepEqual([...platformsFor('long')], ['youtube']);
    assert.deepEqual([...platformsFor('clip')], ['youtube', 'tiktok', 'instagram']);
  });

  it('un clip se programa en las tres redes', () => {
    const e = setup();
    assert.equal(e.ctx.pubs.schedule('clip1', ['youtube', 'tiktok', 'instagram'], when()).scheduled.length, 3);
    e.cleanup();
  });

  it('un vídeo solo admite YouTube: el resto de redes se omite con motivo', () => {
    const e = setup();
    const r = e.ctx.pubs.schedule('vid1', ['youtube', 'tiktok', 'instagram'], when());
    assert.deepEqual(r.scheduled.map((p) => p.platform), ['youtube']);
    assert.deepEqual(r.skipped.map((s) => s.platform).sort(), ['instagram', 'tiktok']);
    assert.match(r.skipped[0].reason, /solo se publican en YouTube/);
    assert.equal(e.ctx.store.data.publications.length, 1);
    e.cleanup();
  });

  it('un vídeo solo en TikTok se rechaza sin crear nada', () => {
    const e = setup();
    assert.throws(() => e.ctx.pubs.schedule('vid1', ['tiktok'], when()), /solo se publican en YouTube/);
    assert.equal(e.ctx.store.data.publications.length, 0);
    e.cleanup();
  });

  it('setSchedule rechaza redes no permitidas para un vídeo y no cambia nada', () => {
    const e = setup();
    e.ctx.pubs.schedule('vid1', ['youtube'], when());
    assert.throws(() => e.ctx.pubs.setSchedule('vid1', [{ platform: 'youtube', atIso: when() }, { platform: 'instagram', atIso: when() }]), /solo se publican en YouTube/);
    assert.equal(e.ctx.store.data.publications.length, 1);
    assert.doesNotThrow(() => e.ctx.pubs.setSchedule('clip1', [{ platform: 'instagram', atIso: when() }]));
    e.cleanup();
  });

  it('los bloques de la línea de tiempo indican si son vídeo o clip', () => {
    const e = setup();
    e.ctx.pubs.schedule('vid1', ['youtube'], when());
    e.ctx.pubs.schedule('clip1', ['tiktok'], when());
    const b = groupBlocks(e.ctx.store.data.publications, e.ctx.store.data.outputs);
    assert.deepEqual(b.map((x) => x.kind).sort(), ['clip', 'long']);
    e.cleanup();
  });
});

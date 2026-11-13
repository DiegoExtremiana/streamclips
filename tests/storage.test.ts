import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addDownloadedVod, makeEnv, makeVideo, tmpDir, type TestEnv } from './helpers';
import { formatBytes } from '../shared/storage';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

describe('espacio en disco', () => {
  it('formatea tamaños', () => {
    assert.equal(formatBytes(1536 * 1024 ** 2), '1,5 GB');
    assert.equal(formatBytes(320 * 1024 ** 2), '320 MB');
  });

  it('cuenta lo que ocupa cada cosa y solo libera los directos de los que ya salió algo', async () => {
    const env = makeEnv();
    envs.push(env);
    const dir = tmpDir();
    const used = addDownloadedVod(env, makeVideo(path.join(dir, 'used.mp4'), { dur: 6 }), 'used');
    const unused = addDownloadedVod(env, makeVideo(path.join(dir, 'unused.mp4'), { dur: 6 }), 'unused');
    await env.ctx.clips.createClip(used.id, { kind: 'both', start: 1, end: 4, title: 'Clip', cropX: 0.5 });
    const before = env.ctx.storage.report();
    assert.equal(before.reclaimableVods, 1);
    assert.ok(before.items.find((i) => i.id === 'vods')!.bytes > 0);
    assert.ok(before.items.find((i) => i.id === 'library')!.bytes > 0);
    const freed = env.ctx.storage.free();
    assert.equal(freed.vods, 1);
    assert.ok(freed.freedBytes > 0);
    assert.equal(fs.existsSync(unused.filePath!), true, 'el directo sin clips no se toca');
    assert.equal(env.ctx.storage.report().reclaimableVods, 0);
    assert.equal(env.ctx.store.data.outputs.length, 1, 'el clip se conserva');
  });
});

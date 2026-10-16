import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { dominantColor, addDownloadedVod, makeEnv, makeVideo, rmDir, tmpDir, type TestEnv } from './helpers';
import { fitSrc, layoutFromPreset, defaultPreset } from '../shared/layout';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});
let root: string;
let split: string;
before(() => {
  root = tmpDir();
  split = makeVideo(path.join(root, 'split.mp4'), { split: true, dur: 12 }); // izquierda roja, derecha azul
});
after(() => rmDir(root));

const oneWindow = (cx: number) => {
  const l = layoutFromPreset(defaultPreset(1), 16 / 9);
  l.windows[0].src = fitSrc(l.windows[0].dst, cx, 0.5, 0.5, 16 / 9);
  return l;
};

describe('Biblioteca: composición vertical de un clip', () => {
  it('se guarda con el clip, cambia solo la versión vertical visible y se conserva al recortar', async () => {
    const env = makeEnv();
    envs.push(env);
    const vod = addDownloadedVod(env, split);
    const clip = await env.ctx.clips.createClip(vod.id, { kind: 'both', start: 2, end: 6, title: 'Clip', cropX: 0 });
    assert.equal(clip.layout, undefined);
    assert.equal(dominantColor(clip.files.vertical!, 1), 'red');

    const blue = await env.ctx.library.reeditClip(clip.id, { layout: oneWindow(0.85) });
    assert.equal(blue.layout?.windows.length, 1);
    assert.equal(dominantColor(blue.files.vertical!, 1), 'blue');

    const trimmed = await env.ctx.library.reeditClip(clip.id, { start: 3, end: 5 }); // sin layout nuevo: se conserva
    assert.equal(dominantColor(trimmed.files.vertical!, 1), 'blue');
    assert.deepEqual(trimmed.layout, blue.layout);

    const back = await env.ctx.library.reeditClip(clip.id, { layout: null, cropX: 0 }); // vuelve al encuadre simple
    assert.equal(back.layout, undefined);
    assert.equal(dominantColor(back.files.vertical!, 1), 'red');
  });

  it('un encuadre simple nuevo sustituye a la composición; una composición no válida se rechaza sin tocar nada', async () => {
    const env = makeEnv();
    envs.push(env);
    const vod = addDownloadedVod(env, split);
    const clip = await env.ctx.clips.createClip(vod.id, { kind: 'both', start: 2, end: 6, title: 'Clip' });
    await env.ctx.library.reeditClip(clip.id, { layout: oneWindow(0.85) });
    const simple = await env.ctx.library.reeditClip(clip.id, { cropX: 0 });
    assert.equal(simple.layout, undefined);

    const before = { ...env.ctx.store.data.outputs[0].files };
    const bad = layoutFromPreset(defaultPreset(2), 16 / 9);
    bad.windows[0].src.x = 0.95;
    await assert.rejects(env.ctx.library.reeditClip(clip.id, { layout: bad }), /Composición no válida/);
    assert.deepEqual(env.ctx.store.data.outputs[0].files, before);
  });

  it('un vídeo largo no admite composición', async () => {
    const env = makeEnv();
    envs.push(env);
    const vod = addDownloadedVod(env, split);
    const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 3 }] });
    await assert.rejects(env.ctx.library.reeditClip(long.id, { layout: oneWindow(0.5) }), /solo se pueden cambiar los subtítulos/);
  });
});

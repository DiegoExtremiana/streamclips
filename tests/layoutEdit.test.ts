import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

  it('sin el VOD se reencuadra y se acorta desde el propio vídeo horizontal del clip', async () => {
    const env = makeEnv();
    envs.push(env);
    const own = path.join(root, 'own.mp4'); // copia propia: se borra durante la prueba
    fs.copyFileSync(split, own);
    const vod = addDownloadedVod(env, own);
    const clip = await env.ctx.clips.createClip(vod.id, { kind: 'both', start: 2, end: 8, title: 'Clip', cropX: 0 });
    const orig = path.join(root, 'orig.mp4');
    fs.copyFileSync(own, orig);
    fs.rmSync(own, { force: true }); // el directo se borró para liberar espacio
    const ctx = await env.ctx.library.clipContext(clip.id);
    assert.equal(ctx.clipOnly, true);
    const frame = await env.ctx.library.framingPreview(clip.id);
    assert.ok(frame.width > 0 && frame.height > 0);
    const blue = await env.ctx.library.reeditClip(clip.id, { layout: oneWindow(0.85) });
    assert.equal(dominantColor(blue.files.vertical!, 1), 'blue');
    assert.equal(blue.start, 2);
    const shorter = await env.ctx.library.reeditClip(clip.id, { start: 3, end: 6 });
    assert.equal(shorter.start, 3);
    assert.ok(Math.abs(shorter.durationSec - 3) < 0.6);
    assert.equal(dominantColor(shorter.files.vertical!, 1), 'blue');
    // alargar o mover pide solo el trozo necesario a Twitch (aquí simulado con una copia del original)
    const asked: number[][] = [];
    let disposed = 0;
    (env.ctx.vods as unknown as { fetchSection: unknown }).fetchSection = async (_id: string, s: number, e: number) => {
      asked.push([s, e]);
      const off = Math.max(0, s - 1);
      const file = path.join(root, `sec-${asked.length}.mp4`);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(off), '-t', String(e + 1 - off), '-i', orig, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', file]);
      return { file, offset: off, dispose: () => { disposed++; fs.rmSync(file, { force: true }); } };
    };
    const longer = await env.ctx.library.reeditClip(clip.id, { start: 1, end: 9 });
    assert.deepEqual(asked, [[1, 9]]);
    assert.equal(disposed, 1);
    assert.equal(longer.start, 1);
    assert.equal(longer.end, 9);
    assert.ok(Math.abs(longer.durationSec - 8) < 0.7, `dura ${longer.durationSec}`);
    assert.equal(dominantColor(longer.files.vertical!, 1), 'blue', 'conserva las ventanas');
    const moved = await env.ctx.library.reeditClip(clip.id, { start: 4, end: 10 });
    assert.equal(moved.start, 4);
    assert.ok(Math.abs(moved.durationSec - 6) < 0.7);
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

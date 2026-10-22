import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { autoThumbnail, bestFrameTime } from '../electron/services/thumbnails';
import { probe } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { makeVideo, rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');
const fonts = path.join(__dirname, '..', '..', 'resources', 'fonts');

describe('portadas con estilo (ffmpeg real)', () => {
  let root: string;
  let video: string;
  before(() => {
    root = tmpDir();
    video = path.join(root, 'v.mp4');
    makeVideo(video, { dur: 6 });
  });
  after(() => rmDir(root));

  it('horizontal: JPG de 1280×720 con la frase y el número', async () => {
    const out = await autoThumbnail(tools, root, 'a', 'horizontal', video, 6, { title: 'Minecraft extremo Día 3 - Resumen', fontsDir: fonts });
    const info = await probe(tools, out);
    assert.equal(info.width, 1280);
    assert.equal(info.height, 720);
    assert.ok(fs.statSync(out).size > 5000);
  });

  it('sin estilo o en vertical se hace el fotograma sencillo de siempre', async () => {
    const plain = await autoThumbnail(tools, root, 'b', 'horizontal', video, 6, { title: 'X', styled: false });
    assert.equal((await probe(tools, plain)).width, 640);
    const vert = await autoThumbnail(tools, root, 'c', 'vertical', video, 6, { title: 'X' });
    assert.equal((await probe(tools, vert)).width, 360);
  });

  it('si la portada con estilo falla (fuente o filtro), cae al fotograma sencillo', async () => {
    const out = await autoThumbnail(tools, root, 'd', 'horizontal', video, 6, { title: 'Hola', fontsDir: path.join(root, 'no-existe') });
    assert.ok(fs.existsSync(out));
  });

  it('bestFrameTime devuelve un instante dentro del vídeo', async () => {
    const t = await bestFrameTime(tools, video, 6);
    assert.ok(t >= 0 && t <= 6);
  });
});

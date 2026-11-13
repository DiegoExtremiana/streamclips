import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderLong } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');
const luma = (file: string, t: number) => execFileSync(tools.ffmpeg, ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 })[0];

describe('transiciones entre momentos separados', () => {
  let root: string;
  let src: string;
  before(() => {
    root = tmpDir();
    src = path.join(root, 'src.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=30:d=80', '-f', 'lavfi', '-i', 'sine=f=300:d=80', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src]);
  });
  after(() => rmDir(root));

  it('con joints el salto entre momentos lejanos pasa por negro y el corte de silencio cercano no', async () => {
    const out = path.join(root, 'out.mp4');
    // 0-10 | 12-20 (hueco corto: no es salto) | 60-70 (salto de 40 s)
    await renderLong(tools, src, { title: 't', segments: [{ start: 0, end: 10 }, { start: 12, end: 20 }, { start: 60, end: 70 }], effects: [{ type: 'joints', duration: 0.4 }] }, out);
    const dur = Number(execFileSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
    assert.ok(Math.abs(dur - 28) < 0.6, `${dur}`);
    assert.ok(luma(out, 5) > 200, 'en mitad de un tramo es blanco');
    assert.ok(luma(out, 10.1) > 200, 'el hueco corto no lleva transición');
    assert.ok(luma(out, 17.95) < 120, 'justo antes del salto grande se funde a negro');
    assert.ok(luma(out, 18.05) < 120, 'y vuelve desde negro');
    assert.ok(luma(out, 25) > 200);
  });
});

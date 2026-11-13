import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { renderClip } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');

/** Frecuencia aproximada (Hz) del audio, por ventanas de medio segundo, contando cruces por cero. */
function freqs(file: string): number[] {
  const raw = execFileSync(tools.ffmpeg, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const a = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const w = 8000;
  const out: number[] = [];
  for (let i = 0; i + w <= a.length; i += w) {
    let zc = 0;
    let max = 0;
    for (let j = i + 1; j < i + w; j++) {
      if (Math.sign(a[j]) !== Math.sign(a[j - 1])) zc++;
      max = Math.max(max, Math.abs(a[j]));
    }
    out.push(max < 300 ? 0 : zc / 2 / 0.5);
  }
  return out;
}

const channels = (file: string) => Number(execFileSync(tools.ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'csv=p=0', file]).toString().trim());

describe('audio: montaje con varios tramos y efectos de sonido', () => {
  let root: string;
  let src: string;
  before(() => {
    root = tmpDir();
    src = path.join(root, 'src.mp4');
    // audio estéreo con una frecuencia que sube sin parar: si el audio se repite o se queda congelado, se nota
    execFileSync(tools.ffmpeg, [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=70',
      '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*(200*t+8*t*t))|0.5*sin(2*PI*(200*t+8*t*t))':s=48000:d=70",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', src,
    ]);
  });
  after(() => rmDir(root));

  it('todos los tramos salen en estéreo y el audio avanza siempre (sin bucles al final)', async () => {
    const cuts = Array.from({ length: 6 }, (_, i) => ({ start: 13 + i * 7, end: 15.5 + i * 7 }));
    const effects = [{ type: 'polish' as const }, ...Array.from({ length: 5 }, (_, i) => ({ type: 'sfx' as const, at: 11 + i * 9, sound: (['hit', 'whoosh', 'pop'] as const)[i % 3] }))];
    const out = path.join(root, 'out.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 5, end: 65, cuts, effects }, out);
    assert.equal(channels(out), 2);
    const f = freqs(out).filter((x) => x > 0);
    assert.ok(f.length > 30);
    // salvo el ruido de un efecto de sonido, la frecuencia no puede bajar ni quedarse clavada tramos largos
    let flat = 0;
    let worst = 0;
    for (let i = 1; i < f.length; i++) {
      if (Math.abs(f[i] - f[i - 1]) < 4) flat++;
      else flat = 0;
      worst = Math.max(worst, flat);
    }
    assert.ok(worst < 4, `el audio se queda repetido (${worst} ventanas iguales seguidas)`);
    assert.ok(f[f.length - 1] > f[0] * 2, 'el audio llega al final de la fuente');
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { audioEnergy } from '../electron/services/audioEnergy';
import { makeVideo, rmDir, tmpDir } from './helpers';

let dir: string;
before(() => {
  dir = tmpDir();
});
after(() => rmDir(dir));
const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' };

describe('energía de audio', () => {
  it('detecta el tramo fuerte entre dos silenciosos', async () => {
    const f = path.join(dir, 'a.mp4');
    // 6 s flojos, 4 s fuertes, 6 s flojos
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=16',
      '-f', 'lavfi', '-i', "aevalsrc='if(between(t,6,10),0.8,0.02)*sin(2*PI*300*t)':d=16:s=16000",
      '-c:v', 'libx264', '-c:a', 'aac', '-shortest', f]);
    const e = await audioEnergy(tools, f);
    assert.ok(e.length >= 15 && e.length <= 17, `${e.length}`);
    const quiet = e[2];
    const loud = e[8];
    assert.ok(loud - quiet > 20, `${loud} vs ${quiet}`);
    assert.ok(e[13] < loud - 20);
  });
  it('un vídeo sin audio da error claro y un archivo roto también', async () => {
    const f = path.join(dir, 'mute.mp4');
    makeVideo(f, { dur: 3, audio: false, w: 160, h: 90 });
    const e = await audioEnergy(tools, f).catch((x: Error) => x);
    // sin pista de audio no hay datos: o falla con mensaje o devuelve vacío, nunca se cuelga
    assert.ok(e instanceof Error || (Array.isArray(e) && e.length === 0));
    await assert.rejects(() => audioEnergy(tools, path.join(dir, 'no-existe.mp4')), /ffmpeg/);
  });
  it('un audio de 1 hora se analiza en flujo y da un valor por segundo', async () => {
    const f = path.join(dir, 'long.m4a');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3600:sample_rate=16000', '-c:a', 'aac', '-b:a', '16k', f]);
    const t0 = Date.now();
    const e = await audioEnergy(tools, f);
    assert.ok(e.length >= 3598 && e.length <= 3601, `${e.length}`);
    assert.ok(Date.now() - t0 < 60_000, `${Date.now() - t0} ms`);
    assert.ok(e.every((x) => Number.isFinite(x)));
  });
});

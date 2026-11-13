import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { renderClip } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { SFX, setAssetFolders } from '../electron/services/soundBank';
import { hasBackgroundSound, lofiGraph, musicFile } from '../electron/services/music';
import { MUSIC_MOODS, guessMood } from '../shared/music';
import { SOUND_IDS, soundCues } from '../shared/sounds';
import { validateEffects } from '../shared/plan';
import { rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');
const meanDb = (file: string, ss = 0, t = 0): number => {
  const args = ['-hide_banner', '-nostdin', ...(t ? ['-ss', String(ss), '-t', String(t)] : []), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'];
  const r = spawnSync(tools.ffmpeg, args, { encoding: 'utf8' });
  return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)?.[1] ?? NaN);
};
const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });

describe('efectos de sonido por lo que se dice', () => {
  it('pone el sonido que toca, separado, solo en lo conservado y sin pisar otros golpes', () => {
    const words = [w('Hola', 0), w('ganamos', 5), w('dinero', 14), w('dinero', 22), w('MORÍ', 30), w('nada', 40)];
    const kept = (t: number) => t < 38;
    const cues = soundCues(words, { start: 0, end: 60 }, kept, [], { spacing: 7 });
    assert.deepEqual(cues.map((c) => c.sound), ['tada', 'coin', 'coin', 'fail']);
    assert.equal(soundCues(words, { start: 0, end: 60 }, kept, [5.02]).some((c) => c.sound === 'tada'), false);
    assert.ok(soundCues(words, { start: 0, end: 10 }, kept).length <= 1, 'pocos efectos en un vídeo corto');
  });
  it('el ambiente de la música sale de las palabras', () => {
    assert.equal(guessMood('me tomo un café con una tostada, el desayuno'), 'cafe');
    assert.equal(guessMood('el avión, el hotel y la playa del viaje'), 'viaje');
    assert.equal(guessMood('hoy no sé qué decir'), 'charla');
  });
  it('valida efectos music y los sonidos nuevos', () => {
    const r = [{ start: 0, end: 20 }];
    assert.equal(validateEffects([{ type: 'music', mood: 'cafe', volume: 0.15 }, { type: 'sfx', at: 3, sound: 'tada' }], r), null);
    assert.match(validateEffects([{ type: 'music', mood: 'rock' }], r) ?? '', /mood/);
    assert.match(validateEffects([{ type: 'music', mood: 'cafe' }, { type: 'music', mood: 'noche' }], r) ?? '', /una música/);
    assert.match(validateEffects([{ type: 'sfx', at: 3, sound: 'sirena' }], r) ?? '', /sound/);
  });
});

describe('sonidos y música generados con ffmpeg', () => {
  let root: string;
  before(() => {
    root = tmpDir();
    setAssetFolders({ sounds: path.join(root, 'sonidos'), music: path.join(root, 'musica') });
  });
  after(() => {
    setAssetFolders({});
    rmDir(root);
  });

  it('todos los efectos suenan (no salen en silencio)', () => {
    for (const id of SOUND_IDS) {
      const f = path.join(root, `${id}.wav`);
      execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', SFX[id].src, f]);
      const db = meanDb(f);
      assert.ok(db > -60, `${id} suena demasiado bajo o nada (${db} dB)`);
    }
  });

  it('cada ambiente genera su bucle lofi y se guarda', async () => {
    for (const m of MUSIC_MOODS) {
      const f = await musicFile(tools, m);
      assert.ok(f && fs.statSync(f).size > 10_000, m);
      const dur = Number(execFileSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
      assert.ok(Math.abs(dur - lofiGraph(m).seconds) < 0.6, `${m}: ${dur}`);
      assert.ok(meanDb(f) > -45, `${m} casi en silencio`);
    }
  });

  it('la música del usuario manda sobre la generada', async () => {
    const own = path.join(root, 'musica', 'cafe.mp3');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=300:d=2', own]);
    assert.equal(await musicFile(tools, 'cafe'), own);
    fs.rmSync(own);
  });

  it('el montaje con música mantiene vídeo, duración y estéreo, y la música queda más baja que la voz', async () => {
    const src = path.join(root, 'src.mp4');
    // «voz»: tono fuerte durante 6 s y silencio después
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=12', '-f', 'lavfi', '-i', "aevalsrc='0.5*sin(2*PI*220*t)*lt(t,6)':s=48000:d=12", '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', src]);
    const out = path.join(root, 'out.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 0, end: 12, effects: [{ type: 'music', mood: 'cafe', volume: 0.2 }] }, out);
    const info = JSON.parse(execFileSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,channels,width:format=duration', '-of', 'json', out]).toString());
    assert.ok(Math.abs(Number(info.format.duration) - 12) < 0.5);
    assert.equal(info.streams.find((s: { codec_type: string }) => s.codec_type === 'audio').channels, 2);
    assert.equal(info.streams.find((s: { codec_type: string }) => s.codec_type === 'video').width, 1920);
    const talking = meanDb(out, 1, 4);
    const quiet = meanDb(out, 8, 3);
    assert.ok(quiet > -50, 'la música suena en los silencios');
    assert.ok(talking - quiet > 8, `la música debe ir por debajo de la voz (${talking} vs ${quiet})`);
  });

  it('detecta si ya suena algo de fondo en las pausas', async () => {
    const quiet = path.join(root, 'quiet.mp4');
    const busy = path.join(root, 'busy.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '10', '-c:a', 'aac', quiet]);
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=330:d=10', '-af', 'volume=0.3', '-c:a', 'aac', busy]);
    const gaps = [{ start: 1, end: 3 }, { start: 5, end: 7 }];
    assert.equal(await hasBackgroundSound(tools, quiet, gaps), false);
    assert.equal(await hasBackgroundSound(tools, busy, gaps), true);
    assert.equal(await hasBackgroundSound(tools, busy, []), false);
  });
});

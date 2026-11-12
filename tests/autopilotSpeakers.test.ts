import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DiarizeEngine } from '../electron/services/diarize';
import { addDownloadedVod, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

let root: string;
let video: string;
before(() => {
  root = tmpDir();
  video = path.join(root, 'live.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=240',
    '-f', 'lavfi', '-i', "aevalsrc='(0.02+0.9*(between(t,55,70)+between(t,165,180)))*sin(2*PI*300*t)':d=240:s=16000",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
});
after(() => rmDir(root));

const unit = (i: number) => Array.from({ length: 16 }, (_, k) => (k === i ? 1 : 0.02));

/** Motor de mentira: alterna dos voces cada 10 s; la primera voz de cada análisis suena a «A» y la segunda a «B». */
function fake(calls: { n: number }): () => DiarizeEngine {
  return () => {
    let k = 0;
    return {
      process: (s) => {
        calls.n++;
        k = 0;
        const out: { start: number; end: number; speaker: number }[] = [];
        for (let t = 0; t < s.length / 16000; t += 10) out.push({ start: t, end: Math.min(t + 10, s.length / 16000), speaker: (t / 10) % 2 });
        return out;
      },
      embed: () => unit(k++ % 2),
    };
  };
}

const WORDS = [
  ...Array.from({ length: 12 }, (_, i) => ({ text: `uno${i}`, start: 52 + i * 0.8, end: 52.5 + i * 0.8 })),
  ...Array.from({ length: 12 }, (_, i) => ({ text: `dos${i}`, start: 162 + i * 0.8, end: 162.5 + i * 0.8 })),
];

function setup(auto: Record<string, unknown> = {}, engine = true) {
  const calls = { n: 0 };
  const e = makeEnv(engine ? { diarizationEngine: fake(calls) } : {});
  envs.push(e);
  const vod = addDownloadedVod(e, video);
  const tr = path.join(root, `tr-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tr, JSON.stringify({ words: WORDS }));
  e.ctx.transcripts.importFile(vod.id, tr);
  e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 1, requireApproval: true, platforms: ['youtube'], cleanup: false, ...auto } });
  return { e, vod, calls };
}

describe('hablantes', () => {
  it('el piloto identifica las voces de lo elegido, las recuerda y las pone en las palabras', async () => {
    const { e, vod, calls } = setup();
    await e.ctx.autopilot.run(vod.id);
    const v = e.ctx.store.data.vods[0];
    assert.equal(v.autopilot?.status, 'done', v.autopilot?.note);
    assert.match(v.autopilot?.note ?? '', /Hablantes: 2 voz/);
    assert.ok(calls.n >= 1);
    assert.equal(e.ctx.speakers.profiles().length, 2);
    const ws = e.ctx.transcripts.words(vod.id);
    const spk = new Set(ws.filter((w) => w.spk !== undefined).map((w) => w.spk));
    assert.equal(spk.size, 2, 'las palabras de lo elegido llevan hablante');
    assert.ok(ws.some((w) => w.spk === undefined), 'lo que no se analizó queda sin atribuir');
    // lo guardado en disco no se toca
    const dir = path.join(e.userData, 'transcripts');
    const raw = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8')) as { words: { spk?: number }[] };
    assert.ok(raw.words.every((w) => w.spk === undefined));
  });

  it('no repite el análisis de lo ya analizado', async () => {
    const { e, vod, calls } = setup();
    await e.ctx.autopilot.run(vod.id);
    const before = calls.n;
    const r = await e.ctx.speakers.diarize(vod.id, [{ start: 50, end: 66 }]);
    assert.equal(r.sec, 0);
    assert.equal(calls.n, before);
  });

  it('una voz que ya se conoce se reconoce en otro directo (no se crea otra)', async () => {
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    assert.equal(e.ctx.speakers.profiles().length, 2);
    const vod2 = addDownloadedVod(e, video, 'vod2');
    await e.ctx.speakers.diarize(vod2.id, [{ start: 0, end: 60 }]);
    assert.equal(e.ctx.speakers.profiles().length, 2, 'mismas dos voces');
    assert.ok(e.ctx.speakers.overlay('vod2')!.segs.every((s) => [1, 2].includes(s.speaker)));
  });

  it('alias, «soy yo» y unir voces se guardan y se aplican a todos los directos', async () => {
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    const [a, b] = e.ctx.speakers.profiles();
    e.ctx.speakers.rename(a.id, '  Marçal <b> ');
    assert.equal(e.ctx.speakers.profiles()[0].alias, 'Marçal b');
    e.ctx.speakers.rename(a.id, '');
    assert.equal(e.ctx.speakers.profiles()[0].named, false);
    e.ctx.speakers.setSelf(b.id);
    const ws = e.ctx.transcripts.words(vod.id);
    const colors = e.ctx.speakers.colorsFor(ws)!;
    assert.equal(colors[b.id], '#FFFFFF', 'tu voz en blanco');
    assert.notEqual(colors[a.id], '#FFFFFF');
    e.ctx.speakers.setSelf(a.id);
    assert.equal(e.ctx.speakers.profiles().filter((p) => p.self).length, 1, 'solo una voz es la tuya');
    e.ctx.speakers.merge(a.id, b.id);
    assert.equal(e.ctx.speakers.profiles().length, 1);
    assert.equal(e.ctx.speakers.profiles()[0].self, true, 'conserva lo de ser tú');
    assert.equal(new Set(e.ctx.transcripts.words(vod.id).filter((w) => w.spk !== undefined).map((w) => w.spk)).size, 1);
    assert.equal(e.ctx.speakers.colorsFor(e.ctx.transcripts.words(vod.id)), undefined, 'con una sola voz no se colorea');
    assert.throws(() => e.ctx.speakers.merge(b.id, b.id), /distintos/);
    assert.throws(() => e.ctx.speakers.rename(999, 'x'), /no existe/);
    // sobrevive a cerrar y abrir
    e.ctx.store.save();
    const saved = JSON.parse(fs.readFileSync(path.join(e.userData, 'data.json'), 'utf8')) as { speakers: { profiles: { id: number }[] } };
    assert.equal(saved.speakers.profiles.length, 1);
  });

  it('con la opción desactivada no se identifica a nadie', async () => {
    const { e, vod, calls } = setup({ speakers: false });
    await e.ctx.autopilot.run(vod.id);
    assert.equal(calls.n, 0);
    assert.equal(e.ctx.speakers.profiles().length, 0);
  });

  it('si el módulo de diarización no está, el análisis sigue y lo avisa', async () => {
    const { e, vod } = setup({}, false);
    await e.ctx.autopilot.run(vod.id);
    const v = e.ctx.store.data.vods[0];
    assert.equal(v.autopilot?.status, 'done');
    assert.match(v.autopilot?.note ?? '', /Hablantes sin identificar/);
  });

  it('la configuración de colores se valida', () => {
    const { e } = setup();
    assert.throws(() => e.ctx.settings.set({ autopilot: { speakerColors: ['rojo'] } }), /#RRGGBB/);
    e.ctx.settings.set({ autopilot: { speakerColors: ['#ffffff', '#ff0000'] } });
    assert.deepEqual(e.ctx.store.data.settings.autopilot.speakerColors, ['#FFFFFF', '#FF0000']);
  });
});

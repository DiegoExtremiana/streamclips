import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { addDownloadedVod, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

/** Directo de 4 min con dos "momentos" (ruido fuerte) hacia el segundo 60 y el 170. */
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

function setup(extra: Parameters<typeof makeEnv>[0] = {}) {
  const e = makeEnv(extra);
  envs.push(e);
  const vod = addDownloadedVod(e, video);
  e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false } });
  return { e, vod };
}


describe('piloto automático: reanálisis y limpieza', () => {
  function setupCopy(cleanup: boolean) {
    const { e, vod } = setup();
    const copy = path.join(e.root, 'copia-live.mp4');
    fs.copyFileSync(video, copy);
    vod.filePath = copy;
    e.ctx.settings.set({ autopilot: { cleanup } });
    return { e, vod, copy };
  }

  it('al terminar borra el directo completo y deja los vídeos, los clips y sus transcripciones', async () => {
    const { e, vod, copy } = setupCopy(true);
    await e.ctx.autopilot.run(vod.id);
    assert.equal(fs.existsSync(copy), false, 'el archivo del directo se borra');
    assert.equal(e.ctx.store.data.vods[0].filePath, undefined);
    assert.ok(e.ctx.store.data.vods[0].cleaned && e.ctx.store.data.vods[0].cleaned.freedBytes > 0);
    assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Directo completo borrado/);
    const outs = e.ctx.store.data.outputs;
    assert.ok(outs.length >= 2);
    for (const o of outs) assert.ok(Object.values(o.files).every((f) => fs.existsSync(f!)), 'los vídeos y clips siguen en disco');
  });

  it('con la limpieza desactivada el directo se queda', async () => {
    const { e, vod, copy } = setupCopy(false);
    await e.ctx.autopilot.run(vod.id);
    assert.ok(fs.existsSync(copy));
    assert.equal(e.ctx.store.data.vods[0].cleaned, undefined);
  });

  it('un análisis ya empezado se puede cancelar y se puede volver a lanzar sin esperar', async () => {
    const { e, vod } = setupCopy(false);
    const first = e.ctx.autopilot.run(vod.id);
    first.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(e.ctx.autopilot.isRunning(vod.id));
    await assert.rejects(e.ctx.autopilot.run(vod.id), /ya está trabajando/);
    assert.equal(e.ctx.autopilot.cancel(vod.id), true);
    await assert.rejects(first);
    assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'error');
    assert.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /cancelado/i);
    assert.equal(e.ctx.autopilot.isRunning(vod.id), false);
    await e.ctx.autopilot.run(vod.id, { restart: true });
    assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
  });

  it('«Volver a analizar» durante un análisis en marcha lo reinicia, y sustituye lo pendiente de revisión', async () => {
    const { e, vod } = setupCopy(false);
    await e.ctx.autopilot.run(vod.id);
    const n = e.ctx.store.data.outputs.length;
    const second = e.ctx.autopilot.run(vod.id, { restart: true });
    second.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    const third = e.ctx.autopilot.run(vod.id, { restart: true });
    await assert.rejects(second);
    await third;
    assert.equal(e.ctx.store.data.outputs.length, n);
    assert.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
  });

  it('un análisis que quedó a medias al cerrar el programa se marca como interrumpido al arrancar', () => {
    const { e, vod } = setupCopy(false);
    vod.autopilot = { status: 'rendering', at: new Date().toISOString() };
    assert.equal(e.ctx.autopilot.recoverInterrupted(), 1);
    const st = e.ctx.store.data.vods[0].autopilot;
    assert.equal(st?.status, 'error');
    assert.match(st?.note ?? '', /interrumpi/);
    assert.equal(e.ctx.autopilot.recoverInterrupted(), 0);
  });

  it('«Liberar espacio» a mano borra el directo y conserva lo creado', async () => {
    const { e, vod, copy } = setupCopy(false);
    await e.ctx.autopilot.run(vod.id);
    const r = e.ctx.autopilot.discard(vod.id);
    assert.ok(r.freedBytes > 0 && r.kept >= 2);
    assert.equal(fs.existsSync(copy), false);
  });
});

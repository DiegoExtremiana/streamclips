import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { TwitchClient } from '../electron/services/twitch';
import type { TwitchVod } from '../shared/types';
import { checkWork, runEngine } from '../electron/engine/engine';
import { ENGINE_STATE_PATH, parsePayload, parseRunState, type EnginePayload } from '../electron/engine/payload';
import { engineCrons, engineWorkflowYaml } from '../electron/engine/workflow';
import { parseJob } from '../electron/services/cloud/jobs';
import { groupBlocks } from '../shared/schedulePlan';
import { fakeGithub } from './fakeGithub';
import { fakeWhisper, makeEnv, rmDir, tmpDir } from './helpers';

/** Directo de 4 min con dos momentos fuertes (como en las pruebas del piloto). */
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

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

/** Twitch de mentira: lo justo para el motor. */
function fakeTwitch(state: { live: boolean; vods: TwitchVod[] }) {
  return {
    streamStatus: async () => ({ live: state.live }),
    listVods: async () => state.vods,
  } as unknown as TwitchClient;
}

const fakeDownload = (calls: string[] = []) => async (_tools: unknown, url: string, outDir: string, onProgress: (p: number) => void) => {
  calls.push(url);
  fs.mkdirSync(outDir, { recursive: true });
  const f = path.join(outDir, 'v1.mp4');
  fs.copyFileSync(video, f);
  onProgress(100);
  return { title: 'Directo', filePath: f };
};

const VOD = (id = '111', createdHoursAgo = 3): TwitchVod => ({ id, title: 'Directo de prueba', url: `https://www.twitch.tv/videos/${id}`, durationSec: 3600, createdAt: hoursAgo(createdHoursAgo) });

/** El programa de escritorio con la nube y el motor ya configurados. */
async function desktop(gh: Awaited<ReturnType<typeof fakeGithub>>) {
  const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', engineSource: () => '// motor de prueba\n', cloudIntervalMs: 3_600_000, engineIntervalMs: 3_600_000 });
  cleanups.push(() => e.cleanup());
  e.ctx.settings.set({
    twitch: { clientId: 'TID', clientSecret: 'TSECRET', login: 'diego' },
    whisperModel: 'tiny',
    autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, platforms: ['youtube', 'tiktok', 'instagram'] },
  });
  await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
  return e;
}

function payloadOf(gh: Awaited<ReturnType<typeof fakeGithub>>): EnginePayload {
  return parsePayload(gh.decryptSecret('STREAMCLIPS_ENGINE', 'diego/motor'));
}

/** Carpeta de trabajo del motor con el modelo de Whisper «instalado» (sin descargar nada). */
function workDir(): string {
  const w = tmpDir('sc-engine-');
  cleanups.push(() => rmDir(w));
  const models = path.join(w, 'data', 'models');
  fs.mkdirSync(models, { recursive: true });
  const f = path.join(models, 'ggml-tiny.bin');
  fs.writeFileSync(f, '');
  fs.truncateSync(f, 71_000_000);
  return w;
}

describe('motor nocturno: piezas', () => {
  it('las ejecuciones cubren de las 20:00 a las 04:59 locales, en UTC y sin horas repetidas', () => {
    assert.deepEqual(engineCrons(-120), ['5,25,45 0,1,2,18,19,20,21,22,23 * * *']); // verano en España (UTC+2)
    assert.deepEqual(engineCrons(-60), ['5,25,45 0,1,2,3,19,20,21,22,23 * * *']); // invierno (UTC+1)
    assert.deepEqual(engineCrons(0, 20, 22), ['5,25,45 20,21,22 * * *']);
  });
  it('el flujo es YAML válido, instala las herramientas solo si hay trabajo y no lleva secretos escritos', () => {
    const y = engineWorkflowYaml(engineCrons(-120));
    const file = path.join(tmpDir(), 'm.yml');
    fs.writeFileSync(file, y);
    const j = JSON.parse(execFileSync('python3', ['-c', 'import sys,yaml,json; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', file]).toString()) as { jobs: { motor: { steps: { name?: string; if?: string }[]; 'timeout-minutes': number } } };
    const steps = j.jobs.motor.steps;
    assert.ok(steps.length >= 8);
    for (const s of steps.filter((x) => x.name && /Liberar|Instalar|Whisper|Compilar|Editar/.test(x.name))) assert.match(s.if ?? '', /steps\.check\.outputs\.work == 'true'/, s.name);
    assert.equal(j.jobs.motor['timeout-minutes'], 350);
    assert.match(y, /secrets\.STREAMCLIPS_ENGINE/);
    assert.ok(!/TSECRET|GHTOKEN/.test(y));
  });
  it('payload y estado: se validan y lo dañado no rompe nada', () => {
    assert.throws(() => parsePayload('no es json'), /no es válido/);
    assert.throws(() => parsePayload(JSON.stringify({ v: 1, twitch: { clientId: '', clientSecret: '', login: '' } })), /Twitch/);
    assert.deepEqual(parseRunState('basura'), { v: 1, done: [], tries: {} });
    assert.deepEqual(parseRunState(JSON.stringify({ done: ['a', 3], tries: { a: 1, b: 'x' } })), { v: 1, done: ['a'], tries: { a: 1 } });
  });
});

describe('motor nocturno: configuración desde el programa', () => {
  it('exige la nube, un repositorio público distinto y Twitch; instala motor, flujo y secreto cifrado', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false }, 'diego/otro-privado': { isPrivate: true } } });
    cleanups.push(gh.close);
    const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', engineSource: () => '// motor\n', cloudIntervalMs: 3_600_000, engineIntervalMs: 3_600_000 });
    cleanups.push(() => e.cleanup());
    await assert.rejects(() => e.ctx.engine.setup('diego/motor', 'GHTOKEN'), /publicación en la nube/);
    await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
    await assert.rejects(() => e.ctx.engine.setup('diego/motor', 'GHTOKEN'), /Rellena Twitch/);
    e.ctx.settings.set({ twitch: { clientId: 'TID', clientSecret: 'TSECRET', login: 'diego' } });
    await assert.rejects(() => e.ctx.engine.setup('diego/nube', 'GHTOKEN'), /distinto del privado/);
    await assert.rejects(() => e.ctx.engine.setup('diego/otro-privado', 'GHTOKEN'), /PÚBLICO/);
    await assert.rejects(() => e.ctx.engine.setup('diego/motor', 'MALO'), /rechazó el token/);
    assert.equal(e.ctx.engine.status().enabled, false);
    assert.equal(gh.repo('diego/otro-privado').files.size, 0, 'no escribe nada en un repositorio privado');

    const st = await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    assert.deepEqual([st.enabled, st.repo, st.cloudReady, st.hasToken], [true, 'diego/motor', true, true]);
    const pub = gh.repo('diego/motor');
    assert.equal(pub.files.get('engine/engine.js'), '// motor\n');
    assert.match(pub.files.get('.github/workflows/motor.yml')!, /name: Motor nocturno/);
    const p = payloadOf(gh);
    assert.deepEqual([p.twitch.login, p.cloud.repo, p.whisper.language, p.autopilot.videoTimes, p.autopilot.clipTimes, p.autopilot.visibility], ['diego', 'diego/nube', 'es', ['08:00', '12:00', '16:00', '21:30'], ['10:00', '14:00', '19:00'], 'public']);
    // el token de GitHub y el secreto de Twitch no quedan en claro en disco ni en el repositorio público
    const disk = fs.readFileSync(e.ctx.store.file, 'utf8');
    assert.ok(!disk.includes('GHTOKEN') && !disk.includes('TSECRET'));
    assert.ok([...pub.files.values()].every((t) => !t.includes('TSECRET') && !t.includes('GHTOKEN')));
  });

  it('si cambian los ajustes se vuelve a subir la configuración; si no, no se toca nada', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false } } });
    cleanups.push(gh.close);
    const e = await desktop(gh);
    await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    const before = gh.repo('diego/motor').secrets.get('STREAMCLIPS_ENGINE')!.value;
    const writes = () => gh.log.filter((l) => l.startsWith('PUT')).length;
    const before1 = writes();
    await e.ctx.engine.sync();
    assert.equal(writes(), before1, 'sin cambios no escribe nada en GitHub');
    assert.equal(gh.repo('diego/motor').secrets.get('STREAMCLIPS_ENGINE')!.value, before);
    e.ctx.settings.set({ autopilot: { clipTimes: ['09:00', '18:00'], maxVideos: 3 } });
    await e.ctx.engine.sync();
    const p = payloadOf(gh);
    assert.deepEqual([p.autopilot.clipTimes, p.autopilot.maxVideos], [['09:00', '18:00'], 3]);
    assert.equal(e.ctx.engine.status().error, null);
  });

  it('desactivar quita el flujo, el motor y el secreto', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false } } });
    cleanups.push(gh.close);
    const e = await desktop(gh);
    await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    const st = await e.ctx.engine.disable();
    assert.equal(st.enabled, false);
    const pub = gh.repo('diego/motor');
    assert.equal(pub.files.has('.github/workflows/motor.yml'), false);
    assert.equal(pub.files.has('engine/engine.js'), false);
    assert.equal(pub.secrets.has('STREAMCLIPS_ENGINE'), false);
  });
});

describe('motor nocturno: edita un directo de principio a fin', () => {
  it('descarga, transcribe, analiza, monta y deja todo programado en la cola; el programa lo trae y se puede cambiar', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false } } });
    cleanups.push(gh.close);
    const e = await desktop(gh);
    await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    const base = payloadOf(gh);
    const p = { ...base, autopilot: { ...base.autopilot, series: { name: 'Minecraft extremo', nextDay: 1 } }, since: hoursAgo(10) }; // el directo es posterior a la activación

    const tw = { live: false, vods: [VOD('111', 3)] };
    const downloads: string[] = [];
    const opts = { github: { api: gh.base, uploads: gh.base }, twitch: fakeTwitch(tw), download: fakeDownload(downloads), whisper: fakeWhisper(), sleepMs: 200, workDir: workDir(), log: () => undefined };

    // 1) el flujo mira si hay trabajo antes de instalar nada
    assert.deepEqual(await checkWork(p, opts), { work: true, live: false, vods: 1 });
    tw.live = true;
    assert.deepEqual(await checkWork(p, opts), { work: false, live: true, vods: 0 });
    assert.equal((await runEngine(p, opts)).status, 'live');
    assert.deepEqual(downloads, [], 'con el directo en marcha no descarga nada');
    tw.live = false;

    // 2) edición completa
    const r = await runEngine(p, opts);
    assert.deepEqual([r.status, r.processed, r.failed], ['done', ['111'], []], JSON.stringify(r));
    assert.deepEqual(downloads, ['https://www.twitch.tv/videos/111']);
    const queue = [...gh.files.keys()].filter((k) => k.startsWith('queue/'));
    // 2 vídeos (solo YouTube) + 2 clips × 3 redes
    assert.equal(queue.length, 2 + 2 * 3, queue.join(','));
    assert.equal(gh.releases.size, 8);
    const jobs = queue.map((k) => parseJob(gh.files.get(k)!)!);
    assert.ok(jobs.every((j) => j.status === 'queued' && j.file.size > 1000));
    const longs = jobs.filter((j) => j.kind === 'long');
    const clips = jobs.filter((j) => j.kind === 'clip');
    assert.deepEqual(longs.map((j) => j.platform), ['youtube', 'youtube']);
    assert.deepEqual(longs.map((j) => j.title).sort(), ['Minecraft extremo Día 1', 'Minecraft extremo Día 1 - Resumen'], 'los vídeos de la serie llevan el día');
    assert.deepEqual([...new Set(clips.map((j) => j.platform))].sort(), ['instagram', 'tiktok', 'youtube']);
    assert.ok(jobs.every((j) => j.visibility === 'public'), 'lo automático sale con la visibilidad elegida');
    const hhmm = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
    assert.ok(longs.every((j) => ['08:00', '12:00', '16:00', '21:30'].includes(hhmm(j.scheduledAt))), longs.map((j) => j.scheduledAt).join());
    assert.equal(new Set(longs.map((j) => j.scheduledAt)).size, 2, 'cada vídeo en su hueco');
    assert.ok(clips.every((j) => ['10:00', '14:00', '19:00'].includes(hhmm(j.scheduledAt))), clips.map((j) => j.scheduledAt).join());
    // las tres redes de un clip salen a la misma hora; dos clips, a horas distintas
    const byClip = new Map<string, Set<string>>();
    for (const j of clips) byClip.set(j.key.split(':')[0], (byClip.get(j.key.split(':')[0]) ?? new Set()).add(j.scheduledAt));
    assert.ok([...byClip.values()].every((s) => s.size === 1));
    assert.equal(new Set([...byClip.values()].map((s) => [...s][0])).size, 2);
    assert.match(gh.files.get('.github/workflows/publish.yml')!, /cron: /, 'la cola de publicación sabe a qué horas despertar');
    // la transcripción en castellano se pidió a Whisper
    // y el estado queda en el repositorio privado, no en el público
    const st = parseRunState(gh.files.get(ENGINE_STATE_PATH)!);
    assert.deepEqual(st.done, ['111']);
    assert.deepEqual(st.tries, {});
    assert.deepEqual(st.series, { name: 'Minecraft extremo', nextDay: 2, from: 1 }, 'el motor lleva la cuenta de los días');
    assert.equal(st.last?.processed, 1);
    assert.ok(!gh.repo('diego/motor').files.has(ENGINE_STATE_PATH));
    assert.ok(![...gh.repo('diego/motor').files.keys()].some((k) => k.startsWith('queue/')));

    // 3) otra ejecución: no repite nada
    const again = await runEngine(p, opts);
    assert.equal(again.status, 'idle');
    assert.equal(downloads.length, 1);
    assert.equal([...gh.files.keys()].filter((k) => k.startsWith('queue/')).length, 8);

    // 4) el programa del PC lo trae: aparece en el calendario, con sus datos, y se puede cambiar
    await e.ctx.cloud.sync();
    const outs = e.ctx.store.data.outputs;
    assert.equal(outs.length, 4);
    assert.ok(outs.every((o) => o.remote === true && Object.keys(o.files).length === 0));
    assert.equal(e.ctx.store.data.publications.length, 8);
    const blocks = groupBlocks(e.ctx.store.data.publications, outs);
    assert.equal(blocks.length, 4, 'un bloque por vídeo/clip (las redes de un clip salen juntas)');
    assert.deepEqual(blocks.filter((b) => b.kind === 'clip').map((b) => b.platforms.length), [3, 3]);
    // cambio de nombre, descripción y hora de un clip; se quita TikTok
    const clip = outs.find((o) => o.kind === 'clip')!;
    e.ctx.library.setMeta(clip.id, { title: 'Nuevo nombre', description: 'Nueva descripción' });
    const newAt = new Date(Date.now() + 30 * 3600_000).toISOString();
    e.ctx.pubs.setSchedule(clip.id, [{ platform: 'youtube', atIso: newAt }, { platform: 'instagram', atIso: newAt }]);
    await e.ctx.cloud.sync();
    const yt = parseJob(gh.files.get(`queue/${clip.id}__youtube.json`)!)!;
    assert.deepEqual([yt.title, yt.description, Date.parse(yt.scheduledAt)], ['Nuevo nombre', 'Nueva descripción', Date.parse(newAt)]);
    assert.equal(gh.files.has(`queue/${clip.id}__tiktok.json`), false, 'la red quitada desaparece de la cola');
    assert.equal(gh.releases.size, 7);
    // no se puede volver a añadir una red a un vídeo que solo vive en la nube
    e.ctx.pubs.schedule(clip.id, ['tiktok'], newAt);
    await e.ctx.cloud.sync();
    assert.equal(e.ctx.store.data.publications.find((x) => x.key === `${clip.id}:tiktok`)?.status, 'failed');
    // borrar un vídeo de la nube lo quita de la cola
    const long = outs.find((o) => o.kind === 'long')!;
    e.ctx.library.remove(long.id);
    for (const pub of e.ctx.store.data.publications.filter((x) => x.outputId === long.id)) e.ctx.pubs.cancel(pub.key);
    await e.ctx.cloud.sync();
    assert.equal(gh.files.has(`queue/${long.id}__youtube.json`), false);
  });

  it('un directo que falla se reintenta, y tras 3 intentos se deja; los demás siguen', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false } } });
    cleanups.push(gh.close);
    const e = await desktop(gh);
    await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    const p = { ...payloadOf(gh), since: hoursAgo(10) };
    const tw = { live: false, vods: [VOD('222', 3)] };
    let attempts = 0;
    const failing = async () => {
      attempts++;
      throw new Error('Twitch no deja descargar');
    };
    const opts = { github: { api: gh.base, uploads: gh.base }, twitch: fakeTwitch(tw), download: failing as never, whisper: fakeWhisper(), sleepMs: 20, log: () => undefined };
    for (let i = 1; i <= 3; i++) {
      const r = await runEngine(p, opts);
      assert.equal(r.status, 'error');
      assert.match(r.note ?? '', /descargar/);
      assert.equal(parseRunState(gh.files.get(ENGINE_STATE_PATH)!).tries['222'], i);
    }
    assert.equal(attempts, 3);
    assert.equal((await runEngine(p, opts)).status, 'idle', 'no insiste más');
    assert.equal(attempts, 3);
    assert.equal([...gh.files.keys()].filter((k) => k.startsWith('queue/')).length, 0);
  });

  it('no toca directos anteriores a la activación, ni cortos, ni recién terminados', async () => {
    const gh = await fakeGithub({ repos: { 'diego/motor': { isPrivate: false } } });
    cleanups.push(gh.close);
    const e = await desktop(gh);
    await e.ctx.engine.setup('diego/motor', 'GHTOKEN');
    const p = { ...payloadOf(gh), since: hoursAgo(10) };
    const old = VOD('1', 72); // anterior a «desde»
    const short = { ...VOD('2', 1), durationSec: 120 };
    const fresh = { ...VOD('3', 0.001), durationSec: 60 * 60 }; // creado ahora mismo con una hora de duración: aún no ha terminado
    const tw = { live: false, vods: [old, short, fresh] };
    const o = { github: { api: gh.base, uploads: gh.base } };
    assert.equal((await checkWork(p, { ...o, twitch: fakeTwitch(tw) })).work, false);
    tw.vods.push(VOD('5', 3)); // control: uno válido sí cuenta
    assert.deepEqual(await checkWork(p, { ...o, twitch: fakeTwitch(tw) }), { work: true, live: false, vods: 1 });
  });
});

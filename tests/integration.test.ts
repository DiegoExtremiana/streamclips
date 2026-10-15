import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { OutputItem, Platform } from '../shared/types';
import { AppContext } from '../electron/app/context';
import { NotConnectedError, type Publishers } from '../electron/domain/publishers';
import { probe } from '../electron/services/ffmpeg';
import { EXPECTED_SIZE } from '../electron/services/ffmpeg';
import type { RenderKind } from '../shared/types';
import { resolveToolPaths } from '../electron/services/tools';
import { fakeCipher, fakeYtdlp, makeEnv, makeVideo, RecordingNotifier, rmDir, sleep, tmpDir } from './helpers';

/**
 * Recorrido completo sin interfaz: URL del VOD -> descarga (yt-dlp simulado) -> plan de edición
 * -> render y validación reales con ffmpeg -> programación -> publicación -> reinicio de la app.
 */
describe('integración: de la URL del VOD a la publicación', () => {
  let root: string;
  let source: string;
  const saved = { ...process.env };

  before(() => {
    root = tmpDir();
    source = makeVideo(path.join(root, 'fixtures', 'directo.mp4'), { w: 1920, h: 1080, dur: 40, audio: true });
  });
  after(() => {
    rmDir(root);
    process.env = saved;
  });

  it('flujo completo y persistencia tras reiniciar', async () => {
    process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'ok', FAKE_ID: 'v123', FAKE_DELAY: '1' };
    const tools = resolveToolPaths('', '');

    // publicadores de prueba: YouTube funciona, TikTok aún "no está conectado"
    const published: { platform: Platform; output: OutputItem }[] = [];
    const publishers: Publishers = {
      youtube: { publish: async (o) => void published.push({ platform: 'youtube', output: o }) },
      tiktok: { publish: async () => { throw new NotConnectedError('TikTok aún no está conectado'); } },
      instagram: { publish: async (o) => void published.push({ platform: 'instagram', output: o }) },
    };

    const env = makeEnv({ publishers });
    const { ctx } = env;
    ctx.settings.set({ ytdlpPath: fakeYtdlp() });

    // 1) añadir el VOD por URL y esperar la descarga
    const vod = ctx.vods.add('https://www.twitch.tv/videos/123456789');
    await ctx.downloadQueue.idle();
    assert.equal(vod.status, 'downloaded', vod.error);
    assert.equal(vod.title, 'Título del VOD');
    assert.ok(fs.existsSync(vod.filePath!));
    assert.equal(path.dirname(vod.filePath!), path.join(env.outputDir, 'vods'));

    // 2) plan de edición con vertical + horizontal + largo (incluye un clip inválido)
    const plan = {
      clips: [
        { kind: 'vertical', start: 5, end: 25, title: 'Clip vertical 1', cropX: 0.4 },
        { kind: 'vertical', start: 30, end: 38, title: 'Clip vertical 2' },
        { kind: 'horizontal', start: 10, end: 30, title: 'Clip horizontal' },
        { kind: 'horizontal', start: 100, end: 120, title: 'Fuera del VOD' },
      ],
      long: { title: 'Resumen del directo', segments: [{ start: 0, end: 12 }, { start: 20, end: 32 }] },
    };
    const r = await ctx.clips.applyPlan(vod.id, JSON.stringify(plan));
    assert.equal(r.created.length, 4);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /clip 4: acaba después del final del VOD/);

    // 3) cada resultado existe, tiene el formato exacto y la duración pedida
    const expected: Record<string, [string, number]> = {
      'Clip vertical 1': ['vertical', 20],
      'Clip vertical 2': ['vertical', 8],
      'Clip horizontal': ['horizontal', 20],
      'Resumen del directo': ['long', 24],
    };
    for (const o of r.created) {
      const [kinds, dur] = expected[o.title];
      assert.deepEqual(Object.keys(o.files), [kinds], o.title);
      for (const [k, f] of Object.entries(o.files)) {
        const size = EXPECTED_SIZE[k as RenderKind];
        const info = await probe(tools, f);
        assert.deepEqual([info.width, info.height], [size.w, size.h], `${o.title} (${k})`);
        assert.ok(Math.abs(info.durationSec - dur) < 1.5, `${o.title}: ${info.durationSec}s`);
        assert.ok(info.hasAudio, `${o.title} conserva el audio`);
      }
    }

    // 4) programar: YouTube y TikTok para dentro de un instante
    const vertical = r.created.find((o) => o.title === 'Clip vertical 1')!;
    const soon = new Date(Date.now() + 150).toISOString();
    const s = ctx.pubs.schedule(vertical.id, ['youtube', 'tiktok'], soon);
    assert.equal(s.scheduled.length, 2);

    await ctx.scheduler.tick(); // todavía no es la hora
    assert.equal(published.length, 0);
    await sleep(250);
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();
    await ctx.scheduler.tick();

    const yt = ctx.store.data.publications.find((p) => p.platform === 'youtube')!;
    const tt = ctx.store.data.publications.find((p) => p.platform === 'tiktok')!;
    assert.equal(yt.status, 'published');
    assert.equal(tt.status, 'scheduled');
    assert.match(tt.note!, /En espera/);
    assert.equal(published.length, 1, 'YouTube se publicó exactamente una vez');
    assert.equal(published[0].output.id, vertical.id);

    // 5) reiniciar la app (nuevo contexto sobre los mismos datos): todo persiste y NO se republica
    const again = new AppContext({
      userDataDir: env.userData,
      defaultOutputDir: env.outputDir,
      cipher: fakeCipher,
      notifier: new RecordingNotifier(),
      publishers,
      schedulerIntervalMs: 3_600_000,
    });
    again.start(); // recupera lo interrumpido y hace una pasada
    await again.scheduler.tick();
    again.stop();
    assert.equal(again.store.data.vods[0].status, 'downloaded');
    assert.equal(again.store.data.outputs.length, 4);
    assert.equal(again.store.data.publications.find((p) => p.platform === 'youtube')!.status, 'published');
    assert.equal(published.length, 1, 'tras el reinicio no se vuelve a publicar lo ya publicado');

    // 6) intentar programar otra vez lo ya publicado se omite con explicación
    const again2 = again.pubs.schedule(vertical.id, ['youtube'], new Date(Date.now() + 60_000).toISOString());
    assert.equal(again2.scheduled.length, 0);
    assert.match(again2.skipped[0].reason, /ya está publicado/);

    // 7) el log registró el recorrido y no contiene secretos
    const log = fs.readFileSync(path.join(env.userData, 'logs', 'app.log'), 'utf8');
    assert.match(log, /Descarga completada/);
    assert.match(log, /Render validado \(vertical\)/);
    assert.match(log, /Publicado en youtube/);
    env.cleanup();
  });

  it('si la descarga falla, el VOD queda en error y se puede reintentar sin duplicar', async () => {
    process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'fail', FAKE_DELAY: '1' };
    const env = makeEnv();
    env.ctx.settings.set({ ytdlpPath: fakeYtdlp() });
    const url = 'https://www.twitch.tv/videos/999';
    const first = env.ctx.vods.add(url);
    await env.ctx.downloadQueue.idle();
    assert.equal(first.status, 'error');
    assert.match(first.error!, /403/);
    assert.equal(env.ctx.store.data.outputs.length, 0);

    process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'ok', FAKE_DELAY: '1' };
    const second = env.ctx.vods.add(url);
    assert.notEqual(second.id, first.id);
    await env.ctx.downloadQueue.idle();
    assert.equal(second.status, 'downloaded');
    assert.equal(env.ctx.vods.add(url).id, second.id, 'ya descargado: no se vuelve a bajar');
    env.cleanup();
  });
});

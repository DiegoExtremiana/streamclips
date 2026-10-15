import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { TwitchClip, TwitchStream, TwitchVod } from '../shared/types';
import { TwitchClient } from '../electron/services/twitch';
import { makeEnv, makeVideo, type TestEnv } from './helpers';

/** Twitch de mentira: lo que devuelve se cambia desde la prueba. */
class FakeTwitch extends TwitchClient {
  stream: TwitchStream = { live: false };
  vods: TwitchVod[] = [];
  clipList: TwitchClip[] = [];
  fail: string | null = null;
  async streamStatus(): Promise<TwitchStream> {
    if (this.fail) throw new Error(this.fail);
    return this.stream;
  }
  async listVods(): Promise<TwitchVod[]> {
    return this.vods;
  }
  async listClips(): Promise<TwitchClip[]> {
    return this.clipList;
  }
}

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

function setup() {
  const twitch = new FakeTwitch();
  const downloads: string[] = [];
  const e = makeEnv({
    twitch,
    download: async (_t, url, outDir) => {
      downloads.push(url);
      const f = path.join(outDir, `v${downloads.length}.mp4`);
      makeVideo(f, { dur: 6, w: 640, h: 360 });
      return { title: `Título de ${url.split('/').pop()}`, filePath: f };
    },
  });
  envs.push(e);
  e.ctx.settings.set({ twitch: { clientId: 'cid', clientSecret: 'sec', login: 'canal' } });
  return { e, twitch, downloads };
}

const vod = (id: string, createdAt: string, durationSec = 3600): TwitchVod => ({ id, title: `Directo ${id}`, url: `https://www.twitch.tv/videos/${id}`, durationSec, createdAt });
const T0 = '2026-10-15T18:00:00Z';

describe('vigilante del canal', () => {
  it('sin credenciales no hace nada ni da error', async () => {
    const e = makeEnv();
    envs.push(e);
    const s = await e.ctx.channel.poll();
    assert.equal(s.configured, false);
    assert.equal(s.error, null);
  });

  it('refleja si estás en directo y avisa a la interfaz', async () => {
    const { e, twitch } = setup();
    twitch.stream = { live: true, title: 'Hoy', viewers: 5, startedAt: T0 };
    const s = await e.ctx.channel.poll();
    assert.equal(s.configured, true);
    assert.equal(s.stream?.live, true);
    assert.ok(s.lastCheck);
    assert.equal(e.notifier.channels.at(-1)?.stream?.title, 'Hoy');
  });

  it('un fallo de Twitch se muestra y no rompe la siguiente vuelta', async () => {
    const { e, twitch } = setup();
    twitch.fail = 'Twitch no responde';
    assert.equal((await e.ctx.channel.poll()).error, 'Twitch no responde');
    twitch.fail = null;
    assert.equal((await e.ctx.channel.poll()).error, null);
  });

  it('la primera vez NO recoge los VODs antiguos', async () => {
    const { e, twitch, downloads } = setup();
    twitch.vods = [vod('1', '2026-10-01T18:00:00Z'), vod('2', '2026-10-10T18:00:00Z')];
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.equal(downloads.length, 0);
    assert.deepEqual(e.ctx.store.data.channel.seenVodIds.sort(), ['1', '2']);
  });

  it('al terminar un directo recoge su VOD una sola vez (tras confirmar que sigue sin directo)', async () => {
    const { e, twitch, downloads } = setup();
    twitch.vods = [vod('1', '2026-10-01T18:00:00Z')];
    await e.ctx.channel.poll(); // línea base
    // empieza el directo: su VOD ya existe pero NO se toca
    twitch.stream = { live: true, startedAt: new Date().toISOString() };
    twitch.vods = [vod('9', new Date().toISOString(), 120), ...twitch.vods];
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.equal(downloads.length, 0);
    // el directo termina: una lectura no basta
    twitch.stream = { live: false };
    await e.ctx.channel.poll();
    assert.equal(downloads.length, 0);
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.deepEqual(downloads, ['https://www.twitch.tv/videos/9']);
    const job = e.ctx.store.data.vods[0];
    assert.equal(job.origin, 'live');
    assert.equal(job.twitchId, '9');
    assert.equal(job.status, 'downloaded');
    assert.equal(e.ctx.channel.status().lastImported?.vodId, job.id);
    // no se vuelve a recoger
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.equal(downloads.length, 1);
  });

  it('si la app estaba cerrada durante el directo, lo recoge al abrirla', async () => {
    const { e, twitch, downloads } = setup();
    await e.ctx.channel.poll(); // línea base sin VODs
    // simula que la app estuvo cerrada: la vigilancia empezó hace horas
    e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3 * 3600_000).toISOString();
    twitch.vods = [vod('7', new Date(Date.now() - 2 * 3600_000).toISOString())];
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.deepEqual(downloads, ['https://www.twitch.tv/videos/7']);
  });

  it('ignora VODs que Twitch aún está cerrando (duración casi cero) y los recoge cuando están listos', async () => {
    const { e, twitch, downloads } = setup();
    await e.ctx.channel.poll();
    e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3600_000).toISOString();
    twitch.vods = [vod('5', new Date(Date.now() - 1800_000).toISOString(), 5)];
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    assert.equal(downloads.length, 0);
    twitch.vods = [vod('5', new Date(Date.now() - 1800_000).toISOString(), 1800)];
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.equal(downloads.length, 1);
  });

  it('con la recogida automática apagada no descarga nada, y al volver a encenderla no recoge lo pasado', async () => {
    const { e, twitch, downloads } = setup();
    await e.ctx.channel.poll();
    e.ctx.channel.setAutoImport(false);
    twitch.vods = [vod('3', new Date().toISOString())];
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    assert.equal(downloads.length, 0);
    e.ctx.channel.setAutoImport(true);
    await e.ctx.channel.poll(); // nueva línea base
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.equal(downloads.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(e.ctx.store.file, 'utf8')).channel.autoImport, true);
  });

  it('avisa a quien espera el VOD de un directo ya descargado', async () => {
    const { e, twitch } = setup();
    const ready: string[] = [];
    e.ctx.channel.onLiveVodReady((j) => ready.push(j.twitchId ?? ''));
    await e.ctx.channel.poll();
    e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3600_000).toISOString();
    twitch.vods = [vod('8', new Date(Date.now() - 1800_000).toISOString())];
    await e.ctx.channel.poll();
    await e.ctx.channel.poll();
    await e.ctx.downloadQueue.idle();
    assert.deepEqual(ready, ['8']);
  });
});

describe('clips del canal', () => {
  const clip = (id: string, durationSec = 5): TwitchClip => ({ id, title: `Clip ${id}`, url: `https://clips.twitch.tv/${id}`, durationSec, createdAt: T0, creator: 'x', views: 1, thumbnail: '' });

  it('lista los clips y marca los ya importados', async () => {
    const { e, twitch } = setup();
    twitch.clipList = [clip('a'), clip('b')];
    assert.deepEqual((await e.ctx.channel.clips()).map((c) => c.imported), [false, false]);
    await e.ctx.channel.importClip('a');
    assert.deepEqual((await e.ctx.channel.clips()).map((c) => c.imported), [true, false]);
  });

  it('importar descarga el clip y deja vertical y horizontal en la Biblioteca, sin repetirse', async () => {
    const { e, twitch, downloads } = setup();
    twitch.clipList = [clip('a')];
    const job = await e.ctx.channel.importClip('a');
    assert.equal(job.origin, 'clip');
    await e.ctx.downloadQueue.idle();
    await e.ctx.renderQueue.idle();
    // el render se encadena tras la descarga: se espera a que aparezca
    for (let i = 0; i < 100 && !e.ctx.store.data.outputs.length; i++) await new Promise((r) => setTimeout(r, 100));
    const out = e.ctx.store.data.outputs[0];
    assert.ok(out, 'debe haber un clip en la Biblioteca');
    assert.equal(out.kind, 'clip');
    assert.equal(out.title, 'Título de a');
    assert.ok(out.files.vertical && out.files.horizontal);
    assert.ok(fs.existsSync(out.files.vertical!) && fs.existsSync(out.files.horizontal!));
    // importarlo otra vez devuelve el mismo trabajo
    const again = await e.ctx.channel.importClip('a');
    assert.equal(again.id, job.id);
    assert.equal(downloads.length, 1);
    assert.equal(e.ctx.store.data.outputs.length, 1);
  });

  it('un clip que ya no existe da un error claro', async () => {
    const { e, twitch } = setup();
    twitch.clipList = [];
    await assert.rejects(() => e.ctx.channel.importClip('zzz'), /ya no está/);
  });
});

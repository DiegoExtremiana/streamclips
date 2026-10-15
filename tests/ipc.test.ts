import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CHANNELS, type Result } from '../shared/types';
import { registerIpc, type IpcLike, type IpcPlatform } from '../electron/ipc/register';
import { TwitchClient } from '../electron/services/twitch';
import { addDownloadedVod, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
const extraDirs: string[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
  while (extraDirs.length) rmDir(extraDirs.pop()!);
});

function setup(twitch?: TwitchClient) {
  const env = makeEnv(twitch ? { twitch } : {});
  envs.push(env);
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const ipc: IpcLike = { handle: (ch, fn) => void handlers.set(ch, fn) };
  const platformCalls = { shown: [] as string[], opened: [] as string[], picked: 0, image: null as string | null, transcript: null as string | null, savedAs: [] as string[], savePath: null as string | null };
  const platform: IpcPlatform = {
    pickFolder: async () => {
      platformCalls.picked++;
      return '/elegida';
    },
    pickImage: async () => platformCalls.image,
    pickTranscript: async () => platformCalls.transcript,
    pickSavePath: async (name) => {
      platformCalls.savedAs.push(name);
      return platformCalls.savePath;
    },
    showItem: (f) => void platformCalls.shown.push(f),
    openFolder: async (d) => void platformCalls.opened.push(d),
  };
  registerIpc(ipc, env.ctx, platform);
  const call = async <T = unknown>(ch: string, ...args: unknown[]): Promise<Result<T>> =>
    (await handlers.get(ch)!({}, ...args)) as Result<T>;
  return { env, handlers, call, platformCalls };
}

const failMsg = (r: Result<unknown>): string => {
  assert.equal(r.ok, false, 'se esperaba un error');
  return (r as { ok: false; error: string }).error;
};

describe('IPC', () => {
  it('registra un manejador por cada canal de petición (los eventos no)', () => {
    const { handlers } = setup();
    for (const [name, ch] of Object.entries(CHANNELS)) {
      if (ch.startsWith('event:')) assert.ok(!handlers.has(ch), `${name} no debe tener manejador`);
      else assert.ok(handlers.has(ch), `falta el manejador de ${name}`);
    }
  });

  it('devuelve siempre Result, con el mensaje de error limpio (sin prefijos de Electron)', async () => {
    const { call } = setup();
    const r = await call(CHANNELS.settingsSet, { outputDir: 'relativa' });
    assert.match(failMsg(r), /^La carpeta de salida debe ser una ruta absoluta\.$/);
  });

  it('settings: get enmascara el secreto, set lo guarda', async () => {
    const { call } = setup();
    const set = await call<{ twitch: { clientSecret: string } }>(CHANNELS.settingsSet, { twitch: { clientSecret: 'abc', clientId: 'id', login: 'diego' } });
    assert.ok(set.ok && set.value.twitch.clientSecret === '********');
    const get = await call<{ twitch: { login: string; clientSecret: string } }>(CHANNELS.settingsGet);
    assert.ok(get.ok && get.value.twitch.login === 'diego' && get.value.twitch.clientSecret === '********');
  });

  it('valida el tipo de cada parámetro antes de usarlo', async () => {
    const { call } = setup();
    for (const [ch, args] of [
      [CHANNELS.settingsSet, [null]],
      [CHANNELS.settingsSet, ['texto']],
      [CHANNELS.settingsSet, [[1, 2]]],
      [CHANNELS.vodsAdd, [123]],
      [CHANNELS.vodsAdd, [undefined]],
      [CHANNELS.clipsCreate, ['vod', 'no-objeto']],
      [CHANNELS.clipsCreate, [5, {}]],
      [CHANNELS.clipsLong, ['vod', null]],
      [CHANNELS.planApply, ['vod', { clips: [] }]],
      [CHANNELS.pubsSchedule, ['o', 'youtube', 'fecha']],
      [CHANNELS.pubsSchedule, ['o', ['youtube'], 12345]],
      [CHANNELS.pubsCancel, [{}]],
      [CHANNELS.shellOpen, [42]],
    ] as [string, unknown[]][]) {
      assert.match(failMsg(await call(ch, ...args)), /Parámetro no válido/, `${ch} ${JSON.stringify(args)}`);
    }
  });

  it('vods:add rechaza URLs peligrosas con un mensaje claro y no crea nada', async () => {
    const { call, env } = setup();
    for (const bad of ['--exec rm -rf /', 'file:///etc/passwd', 'javascript:alert(1)', '']) {
      assert.match(failMsg(await call(CHANNELS.vodsAdd, bad)), /URL no es válida/);
    }
    assert.equal(env.ctx.store.data.vods.length, 0);
  });

  it('pickFolder pasa por la plataforma', async () => {
    const { call, platformCalls } = setup();
    const r = await call(CHANNELS.pickFolder);
    assert.deepEqual(r, { ok: true, value: '/elegida' });
    assert.equal(platformCalls.picked, 1);
  });

  it('twitch: usa el cliente con las credenciales guardadas (descifradas) y devuelve sus resultados', async () => {
    const seen: string[] = [];
    const fake = new TwitchClient((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url + (init?.body ? ` ${String(init.body)}` : ''));
      if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
      if (url.includes('users')) return new Response(JSON.stringify({ data: [{ id: '1', display_name: 'Diego' }] }));
      return new Response(JSON.stringify({ data: [{ id: '9', title: 'V', url: 'https://www.twitch.tv/videos/9', duration: '1h', created_at: 'x' }] }));
    }) as typeof fetch);
    const { call } = setup(fake);
    await call(CHANNELS.settingsSet, { twitch: { clientId: 'cid', clientSecret: 'el-secreto', login: 'diego' } });
    const t = await call<{ ok: boolean; message: string }>(CHANNELS.twitchTest);
    assert.ok(t.ok && t.value.ok && /Diego/.test(t.value.message));
    assert.ok(seen.some((s) => s.includes('client_secret=el-secreto')), 'el secreto descifrado llega a Twitch');
    const v = await call<{ id: string; durationSec: number }[]>(CHANNELS.twitchVods);
    assert.ok(v.ok && v.value[0].id === '9' && v.value[0].durationSec === 3600);
  });

  it('twitch sin credenciales: la prueba informa; listar VODs da error claro', async () => {
    const { call } = setup();
    const t = await call<{ ok: boolean }>(CHANNELS.twitchTest);
    assert.ok(t.ok && t.value.ok === false);
    assert.match(failMsg(await call(CHANNELS.twitchVods)), /Faltan las credenciales/);
  });

  it('shell:open solo abre rutas de la aplicación', async () => {
    const { call, env, platformCalls } = setup();
    const inside = path.join(env.outputDir, 'vertical', 'a.mp4');
    fs.mkdirSync(path.dirname(inside), { recursive: true });
    fs.writeFileSync(inside, 'x');
    assert.deepEqual(await call(CHANNELS.shellOpen, inside), { ok: true, value: undefined });
    assert.deepEqual(platformCalls.shown, [inside]); // archivo -> se muestra en su carpeta

    await call(CHANNELS.shellOpen, env.outputDir);
    assert.deepEqual(platformCalls.opened, [env.outputDir]); // carpeta -> se abre

    for (const bad of ['/etc/passwd', '/', path.join(env.outputDir, '..', 'fuera.txt'), 'C:\\Windows\\System32\\cmd.exe', '../../etc']) {
      assert.match(failMsg(await call(CHANNELS.shellOpen, bad)), /no pertenece a la aplicación/, bad);
    }
    assert.equal(platformCalls.shown.length, 1);
    assert.equal(platformCalls.opened.length, 1);
  });

  it('shell:open admite archivos conocidos aunque estén fuera de la carpeta actual (se cambió de carpeta)', async () => {
    const { call, env, platformCalls } = setup();
    const other = tmpDir();
    extraDirs.push(other);
    const file = path.join(other, 'viejo.mp4');
    fs.writeFileSync(file, 'x');
    assert.match(failMsg(await call(CHANNELS.shellOpen, file)), /no pertenece/);
    addDownloadedVod(env, file);
    await call(CHANNELS.shellOpen, file);
    assert.deepEqual(platformCalls.shown, [file]);
  });

  it('programar y cancelar publicaciones de extremo a extremo por IPC', async () => {
    const { call, env } = setup();
    env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
    const when = new Date(Date.now() + 3600_000).toISOString();
    const s = await call<{ scheduled: unknown[]; skipped: unknown[] }>(CHANNELS.pubsSchedule, 'o1', ['youtube', 'tiktok'], when);
    assert.ok(s.ok && s.value.scheduled.length === 2);
    const l = await call<unknown[]>(CHANNELS.pubsList);
    assert.ok(l.ok && l.value.length === 2);
    assert.match(failMsg(await call(CHANNELS.pubsSchedule, 'o1', ['youtube'], new Date(Date.now() - 86400_000).toISOString())), /ya ha pasado/);
    await call(CHANNELS.pubsCancel, 'o1:youtube');
    const l2 = await call<unknown[]>(CHANNELS.pubsList);
    assert.ok(l2.ok && l2.value.length === 1);
  });

  it('Biblioteca: valida parámetros, cancelar el selector de imagen no cambia nada', async () => {
    const { call, env, platformCalls } = setup();
    env.ctx.store.data.outputs.push({ id: 'o1', kind: 'long', title: 't', files: { long: '/x' }, durationSec: 5, createdAt: 'x' });
    for (const [ch, args] of [
      [CHANNELS.outputsRename, ['o1', 5]],
      [CHANNELS.outputsMeta, ['o1', null]],
      [CHANNELS.outputsMeta, [3, {}]],
      [CHANNELS.outputsThumbFrame, ['o1', '3']],
      [CHANNELS.outputsReedit, ['o1', null]],
      [CHANNELS.pubsSet, ['o1', 'youtube']],
      [CHANNELS.pubsSet, ['o1', [{ platform: 1, atIso: 'x' }]]],
      [CHANNELS.groupsCreate, [5, 'theme', 'clips']],
      [CHANNELS.groupsUpdate, ['g', null]],
      [CHANNELS.outputsMove, [7, null]],
    ] as [string, unknown[]][]) {
      assert.match(failMsg(await call(ch, ...args)), /Parámetro no válido/, ch);
    }
    platformCalls.image = null;
    assert.deepEqual(await call(CHANNELS.outputsThumbImage, 'o1'), { ok: true, value: null });
    assert.match(failMsg(await call(CHANNELS.outputsThumbImage, 'nope')), /no existe/);
  });

  it('Biblioteca: carpetas por IPC (crear, mover, borrar conserva los vídeos)', async () => {
    const { call, env } = setup();
    env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
    const g = await call<{ id: string }>(CHANNELS.groupsCreate, 'Pokémon', 'theme', 'clips');
    assert.ok(g.ok);
    const sub = await call<{ id: string }>(CHANNELS.groupsCreate, 'Road to Master', 'series', 'clips', g.value.id);
    assert.ok(sub.ok);
    assert.ok((await call(CHANNELS.outputsMove, 'o1', sub.value.id)).ok);
    assert.ok((await call(CHANNELS.groupsDelete, sub.value.id)).ok);
    assert.equal(env.ctx.store.data.outputs[0].groupId, g.value.id);
    assert.match(failMsg(await call(CHANNELS.groupsMove, g.value.id, g.value.id)), /sí misma/);
  });

  it('descargar una versión: pregunta dónde guardar, copia el archivo y cancelar no hace nada', async () => {
    const { call, env, platformCalls } = setup();
    const src = path.join(env.outputDir, 'vertical', 'v.mp4');
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.writeFileSync(src, 'contenido');
    env.ctx.store.data.outputs.push({ id: 'c1', kind: 'clip', title: 'Mi Clip', files: { vertical: src }, durationSec: 5, createdAt: 'x' });
    platformCalls.savePath = null; // el usuario cancela
    assert.deepEqual(await call(CHANNELS.outputsExport, 'c1', 'vertical'), { ok: true, value: null });
    assert.deepEqual(platformCalls.savedAs, ['mi-clip-vertical.mp4']);
    platformCalls.savePath = path.join(env.root, 'copia.mp4');
    const r = await call<string>(CHANNELS.outputsExport, 'c1', 'vertical');
    assert.ok(r.ok && r.value === platformCalls.savePath);
    assert.equal(fs.readFileSync(platformCalls.savePath, 'utf8'), 'contenido');
    // versión inexistente: error claro y sin abrir el cuadro de guardado
    const before = platformCalls.savedAs.length;
    assert.match(failMsg(await call(CHANNELS.outputsExport, 'c1', 'horizontal')), /no tiene versión horizontal/);
    assert.equal(platformCalls.savedAs.length, before);
    assert.match(failMsg(await call(CHANNELS.outputsExport, 5, 'vertical')), /Parámetro no válido/);
  });

  it('shell:open admite los archivos de todas las versiones de un clip', async () => {
    const { call, env, platformCalls } = setup();
    const other = tmpDir();
    extraDirs.push(other);
    const f = path.join(other, 'h.mp4');
    fs.writeFileSync(f, 'x');
    env.ctx.store.data.outputs.push({ id: 'c1', kind: 'clip', title: 't', files: { horizontal: f }, durationSec: 5, createdAt: 'x' });
    assert.ok((await call(CHANNELS.shellOpen, f)).ok);
    assert.deepEqual(platformCalls.shown, [f]);
  });
});

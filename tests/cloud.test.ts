import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import sodium from 'libsodium-wrappers';
import { cronLines, workflowYaml } from '../electron/services/cloud/workflow';
import { jobPath, parseJob, releaseTag, serializeJob, type CloudJob } from '../electron/services/cloud/jobs';
import { parseRepo, sealSecret } from '../electron/domain/cloud';
import { Github } from '../electron/services/cloud/github';
import { runQueue } from '../electron/services/cloud/runner';
import { PROVIDERS, type OAuthProvider } from '../electron/services/oauth';
import { makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';
import { fakeGithub } from './fakeGithub';

/** YouTube de mentira (subida reanudable) + servidor de tokens de Google. */
async function fakeYoutube() {
  const uploads: { meta: Record<string, unknown>; bytes: number }[] = [];
  let pending: { meta: Record<string, unknown> } | null = null;
  let got = 0;
  const srv = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const url = req.url ?? '';
      const j = (v: unknown, s = 200, h: Record<string, string> = {}) => (res.writeHead(s, { 'content-type': 'application/json', ...h }), res.end(JSON.stringify(v)));
      if (url === '/token') return j({ access_token: 'FRESH', expires_in: 3600 });
      if (url.startsWith('/upload/videos')) {
        pending = { meta: JSON.parse(body.toString()) };
        got = 0;
        return j({}, 200, { location: `http://${req.headers.host}/session` });
      }
      if (url === '/session') {
        got += body.length;
        const total = Number(/\/(\d+)$/.exec(String(req.headers['content-range']))![1]);
        if (got < total) return j({}, 308, { range: `bytes=0-${got - 1}` });
        uploads.push({ meta: pending!.meta, bytes: got });
        return j({ id: 'YT1' });
      }
      if (url.startsWith('/playlists') || url.startsWith('/playlistItems')) return j({ items: [] });
      return void res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, uploads, close: () => { srv.close(); srv.closeAllConnections?.(); } };
}

const created: (() => void)[] = [];
afterEach(() => {
  while (created.length) created.pop()!();
});

describe('nube: piezas sueltas', () => {
  it('parseRepo acepta usuario/nombre y URLs, y rechaza lo demás', () => {
    assert.equal(parseRepo('diego/nube'), 'diego/nube');
    assert.equal(parseRepo(' https://github.com/diego/nube.git '), 'diego/nube');
    assert.equal(parseRepo('https://github.com/diego/nube/'), 'diego/nube');
    for (const bad of ['', 'diego', 'a/b/c', 'dié/go', '../x', 'a b/c']) assert.equal(parseRepo(bad), null, bad);
  });
  it('el secreto se cifra con la clave pública del repositorio y solo ella lo abre', async () => {
    await sodium.ready;
    const kp = sodium.crypto_box_keypair();
    const enc = await sealSecret(sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL), '{"a":"ñandú"}');
    assert.ok(!enc.includes('ñandú'));
    assert.equal(sodium.to_string(sodium.crypto_box_seal_open(sodium.from_base64(enc, sodium.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey)), '{"a":"ñandú"}');
  });
  it('cron: una línea por hora UTC distinta (un minuto después), más un repaso periódico; sin duplicados', () => {
    const lines = cronLines([new Date('2026-10-16T05:00:00Z'), new Date('2026-10-17T05:00:30Z'), new Date('2026-10-16T14:00:00Z')]);
    assert.equal(lines.length, 3);
    assert.equal(lines.filter((l) => l === '1 5 * * *').length, 1);
    assert.ok(lines.includes('1 14 * * *') && lines.includes('23 */3 * * *'));
    assert.ok(cronLines(new Array(50).fill(0).map((_, i) => new Date(Date.UTC(2026, 9, 16, i % 24, i)))).length <= 21);
  });
  it('el flujo generado tiene las cronologías, la concurrencia única y los secretos', () => {
    const y = workflowYaml(['1 5 * * *']);
    assert.match(y, /- cron: '1 5 \* \* \*'/);
    assert.match(y, /group: streamclips-publish/);
    assert.match(y, /cancel-in-progress: false/);
    assert.match(y, /STREAMCLIPS_CREDS: \$\{\{ secrets\.STREAMCLIPS_CREDS \}\}/);
    assert.match(y, /workflow_dispatch/);
  });
  it('trabajos: ruta, etiqueta y lectura segura', () => {
    assert.equal(jobPath('abc-1:youtube'), 'queue/abc-1__youtube.json');
    assert.equal(releaseTag('abc-1:youtube'), 'q-abc-1-youtube');
    assert.equal(parseJob('no json'), null);
    assert.equal(parseJob('{"v":2}'), null);
    assert.equal(parseJob(JSON.stringify({ v: 1, key: 'k', platform: 'youtube', scheduledAt: 'x', status: 'raro', file: {} })), null);
    const j: CloudJob = { v: 1, key: 'k', platform: 'youtube', scheduledAt: '2026-10-16T05:00:00.000Z', status: 'queued', title: 'T', kind: 'long', releaseId: 1, releaseTag: 'q-k', file: { name: 'a.mp4', assetId: 2, size: 3 }, updatedAt: 'x' };
    assert.deepEqual(parseJob(serializeJob(j)), j);
  });
});

describe('nube: de punta a punta', () => {
  async function connectYoutube(e: TestEnv) {
    // guarda unas claves como lo haría el flujo OAuth
    const secretsApi = (e.ctx.connections as unknown as { d: { secrets: { encode(s: string): string } } }).d.secrets;
    e.ctx.connections.setApp('youtube', 'CID', 'CSECRET');
    e.ctx.store.data.connections.youtube!.tokens = secretsApi.encode(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 0 }));
    e.ctx.store.data.connections.youtube!.account = 'Canal';
  }

  it('configurar: exige repositorio privado, instala publicador y flujo, y sube los permisos cifrados', async () => {
    const gh = await fakeGithub();
    created.push(gh.close);
    const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner de prueba\n', cloudIntervalMs: 3_600_000 });
    created.push(() => e.cleanup());
    await connectYoutube(e);
    const st = await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
    assert.equal(st.enabled, true);
    assert.equal(st.repo, 'diego/nube');
    assert.equal(gh.files.get('runner/runner.js'), '// runner de prueba\n');
    assert.match(gh.files.get('.github/workflows/publish.yml')!, /name: Publicar/);
    const creds = JSON.parse(gh.decryptSecret('STREAMCLIPS_CREDS'));
    assert.deepEqual(creds.youtube, { clientId: 'CID', clientSecret: 'CSECRET', refreshToken: 'RT' });
    // el token de GitHub no queda en claro en disco
    assert.ok(!fs.readFileSync(e.ctx.store.file, 'utf8').includes('GHTOKEN'));
  });
  it('rechaza repositorios públicos y tokens malos sin dejar nada activado', async () => {
    const pub = await fakeGithub({ isPrivate: false });
    created.push(pub.close);
    const e = makeEnv({ github: { api: pub.base, uploads: pub.base }, runnerSource: () => 'x' });
    created.push(() => e.cleanup());
    await assert.rejects(() => e.ctx.cloud.setup('diego/nube', 'GHTOKEN'), /PÚBLICO/);
    assert.equal(e.ctx.cloud.status().enabled, false);
    assert.equal(pub.files.size, 0, 'no escribe nada en un repositorio público');
    const gh = await fakeGithub();
    created.push(gh.close);
    const e2 = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => 'x' });
    created.push(() => e2.cleanup());
    await assert.rejects(() => e2.ctx.cloud.setup('diego/nube', 'MALO'), /rechazó el token/);
    await assert.rejects(() => e2.ctx.cloud.setup('esto no vale', 'x'), /usuario\/nombre/);
    assert.equal(e2.ctx.cloud.status().enabled, false);
  });

  it('lo programado sube a la cola; el PC deja de publicarlo; la nube lo publica, borra su copia y el PC lo da por publicado y borra la copia local', async () => {
    const gh = await fakeGithub();
    const yt = await fakeYoutube();
    created.push(gh.close, yt.close);
    const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
    created.push(() => e.cleanup());
    await connectYoutube(e);
    const longFile = path.join(e.outputDir, 'largo.mp4');
    fs.writeFileSync(longFile, Buffer.alloc(500_000, 3));
    e.ctx.store.data.outputs.push({ id: 'o1', kind: 'long', title: 'Resumen del directo', description: 'Lo mejor', visibility: 'public', files: { long: longFile }, durationSec: 600, createdAt: new Date().toISOString() });
    await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');

    const at = new Date(Date.now() + 3600_000).toISOString();
    e.ctx.pubs.schedule('o1', ['youtube'], at);
    await e.ctx.cloud.sync();
    const pub = e.ctx.store.data.publications[0];
    assert.equal(pub.cloud?.state, 'queued');
    assert.equal(e.ctx.cloud.status().queued, 1);
    const job = parseJob(gh.files.get('queue/o1__youtube.json')!)!;
    assert.deepEqual([job.status, job.title, job.kind, job.visibility], ['queued', 'Resumen del directo', 'long', 'public']);
    assert.equal([...gh.releases.values()].length, 1);
    assert.match(gh.files.get('.github/workflows/publish.yml')!, /cron: '\d+ \d+ \* \* \*'/);

    // el programador del PC lo ignora aunque llegue la hora
    let localCalls = 0;
    const sched = new (await import('../electron/domain/scheduler')).Scheduler(e.ctx.store, e.notifier, e.ctx.log, { youtube: { publish: async () => void localCalls++ }, tiktok: { publish: async () => undefined }, instagram: { publish: async () => undefined } }, 1000, () => Date.now() + 2 * 3600_000);
    await sched.tick();
    assert.equal(localCalls, 0, 'el PC no debe publicar lo que gestiona la nube');

    // llega la hora: se ejecuta el publicador de la nube (aquí, en el mismo proceso, contra YouTube simulado)
    const ghClient = new Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
    const providers = { ...PROVIDERS, google: { ...PROVIDERS.google, tokenUrl: `${yt.base}/token` } as OAuthProvider };
    const r = await runQueue(ghClient, JSON.parse(gh.decryptSecret('STREAMCLIPS_CREDS')), { providers, youtube: { upload: `${yt.base}/upload`, api: yt.base }, sleep: async () => undefined }, () => Date.now() + 2 * 3600_000);
    assert.deepEqual(r.published, ['o1:youtube']);
    assert.equal(yt.uploads.length, 1);
    assert.equal(yt.uploads[0].bytes, 500_000);
    assert.deepEqual((yt.uploads[0].meta as { status: unknown }).status, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
    assert.equal(gh.releases.size, 0, 'la copia de la nube se borra al publicar');
    assert.equal(parseJob(gh.files.get('queue/o1__youtube.json')!)!.status, 'published');

    // el programa se entera, marca publicado y, ya publicado en todas sus redes, borra su copia local
    await e.ctx.cloud.sync();
    assert.equal(e.ctx.store.data.publications[0].status, 'published');
    assert.equal(fs.existsSync(longFile), false, 'la copia local se borra al estar publicado');
    assert.equal(e.ctx.store.data.outputs.some((o) => o.id === 'o1'), false);
    assert.equal(e.ctx.cloud.status().queued, 0);
    // y el registro de la cola se limpia en la siguiente pasada sin tocar nada local
    await e.ctx.cloud.sync();
    assert.equal(gh.files.has('queue/o1__youtube.json'), false);
    assert.equal(e.ctx.store.data.publications[0].status, 'published');
  });

  it('una publicación ya vencida lanza el publicador de inmediato; cancelar la quita de la nube; cambiar la hora la actualiza', async () => {
    const gh = await fakeGithub();
    created.push(gh.close);
    const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
    created.push(() => e.cleanup());
    await connectYoutube(e);
    const f = path.join(e.outputDir, 'l.mp4');
    fs.writeFileSync(f, Buffer.alloc(1000, 1));
    for (const id of ['a', 'b']) e.ctx.store.data.outputs.push({ id, kind: 'long', title: `T ${id}`, files: { long: f }, durationSec: 1, createdAt: new Date().toISOString() });
    await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
    e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 30_000).toISOString());
    e.ctx.pubs.schedule('b', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
    await e.ctx.cloud.sync();
    assert.equal(gh.dispatches.length, 1, 'solo la que vence ya pide ejecución inmediata');
    // cambiar la hora de b
    const newAt = new Date(Date.now() + 10_800_000).toISOString();
    e.ctx.pubs.setSchedule('b', [{ platform: 'youtube', atIso: newAt }]);
    await e.ctx.cloud.sync();
    assert.equal(parseJob(gh.files.get('queue/b__youtube.json')!)!.scheduledAt, newAt);
    // cancelar a
    e.ctx.pubs.cancel('a:youtube');
    await e.ctx.cloud.sync();
    assert.equal(gh.files.has('queue/a__youtube.json'), false);
    assert.equal(gh.releases.size, 1);
    // un archivo que ya no existe se marca fallido sin romper el resto
    fs.rmSync(f);
    e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
    await e.ctx.cloud.sync();
    assert.equal(e.ctx.store.data.publications.find((p) => p.key === 'a:youtube')!.status, 'failed');
  });

  it('desactivar borra lo subido y devuelve la publicación al PC', async () => {
    const gh = await fakeGithub();
    created.push(gh.close);
    const e = makeEnv({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
    created.push(() => e.cleanup());
    await connectYoutube(e);
    const f = path.join(e.outputDir, 'l.mp4');
    fs.writeFileSync(f, Buffer.alloc(1000, 1));
    e.ctx.store.data.outputs.push({ id: 'a', kind: 'long', title: 'T', files: { long: f }, durationSec: 1, createdAt: new Date().toISOString() });
    await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
    e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
    await e.ctx.cloud.sync();
    assert.equal(gh.releases.size, 1);
    const st = await e.ctx.cloud.disable();
    assert.equal(st.enabled, false);
    assert.equal(gh.releases.size, 0);
    assert.equal(gh.files.has('queue/a__youtube.json'), false);
    assert.equal(e.ctx.store.data.publications[0].cloud, undefined);
    assert.equal(e.ctx.store.data.publications[0].status, 'scheduled');
  });

  it('el publicador: dos ejecuciones a la vez no publican lo mismo; lo interrumpido pasa a fallido; los fallos se anotan', async () => {
    const gh = await fakeGithub();
    const yt = await fakeYoutube();
    created.push(gh.close, yt.close);
    const client = new Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
    const f = path.join(tmpDir(), 'v.mp4');
    created.push(() => rmDir(path.dirname(f)));
    fs.writeFileSync(f, Buffer.alloc(2000, 2));
    const rel = await client.createRelease('q-x', 'x');
    const asset = await client.uploadAsset(rel.id, 'v.mp4', f, 'video/mp4');
    const mkJob = (key: string, over: Partial<CloudJob> = {}): CloudJob => ({ v: 1, key, platform: 'youtube', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'queued', title: key, kind: 'long', releaseId: rel.id, releaseTag: 'q-x', file: { name: 'v.mp4', assetId: asset.id, size: 2000 }, updatedAt: 'x', ...over });
    gh.files.set('queue/j1__youtube.json', serializeJob(mkJob('j1:youtube')));
    gh.files.set('queue/j2__youtube.json', serializeJob(mkJob('j2:youtube', { status: 'publishing' })));
    gh.files.set('queue/j3__youtube.json', serializeJob(mkJob('j3:youtube', { scheduledAt: new Date(Date.now() + 3600_000).toISOString() })));
    gh.files.set('queue/j4__tiktok.json', serializeJob(mkJob('j4:tiktok', { platform: 'tiktok', kind: 'clip' })));
    const providers = { ...PROVIDERS, google: { ...PROVIDERS.google, tokenUrl: `${yt.base}/token` } as OAuthProvider };
    const envr = { providers, youtube: { upload: `${yt.base}/upload`, api: yt.base }, sleep: async () => undefined };
    const creds = { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } };
    const [a, b] = await Promise.all([runQueue(client, creds, envr), runQueue(client, creds, envr)]);
    assert.equal(yt.uploads.length, 1, 'la reserva con sha impide publicar dos veces');
    assert.equal(a.published.length + b.published.length, 1);
    const j2 = parseJob(gh.files.get('queue/j2__youtube.json')!)!;
    assert.equal(j2.status, 'failed');
    assert.match(j2.note!, /interrumpió/);
    assert.equal(parseJob(gh.files.get('queue/j3__youtube.json')!)!.status, 'queued', 'lo futuro espera');
    const j4 = parseJob(gh.files.get('queue/j4__tiktok.json')!)!;
    assert.equal(j4.status, 'failed');
    assert.match(j4.note!, /Falta la conexión de tiktok/);
  });

  it('el publicador empaquetado (runner.js) arranca como en Actions, reserva el trabajo y anota el fallo sin credenciales', async () => {
    execFileSync('node', ['scripts/build-runner.mjs'], { cwd: process.cwd() });
    const gh = await fakeGithub();
    created.push(gh.close);
    const client = new Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
    const d = tmpDir();
    created.push(() => rmDir(d));
    const f = path.join(d, 'v.mp4');
    fs.writeFileSync(f, Buffer.alloc(500, 2));
    const rel = await client.createRelease('q-y', 'y');
    const asset = await client.uploadAsset(rel.id, 'v.mp4', f, 'video/mp4');
    gh.files.set('queue/z__youtube.json', serializeJob({ v: 1, key: 'z:youtube', platform: 'youtube', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'queued', title: 'Z', kind: 'long', releaseId: rel.id, releaseTag: 'q-y', file: { name: 'v.mp4', assetId: asset.id, size: 500 }, updatedAt: 'x' }));
    // asíncrono: el GitHub de mentira vive en este mismo proceso y debe poder contestar mientras corre el publicador
    const { stdout: out } = await promisify(execFile)('node', [path.resolve('resources/cloud/runner.js')], {
      env: { ...process.env, GITHUB_REPOSITORY: 'diego/nube', GITHUB_TOKEN: 'GHTOKEN', STREAMCLIPS_GITHUB_API: gh.base, STREAMCLIPS_GITHUB_UPLOADS: gh.base, STREAMCLIPS_CREDS: '{}', HTTPS_PROXY: '', HTTP_PROXY: '' },
      encoding: 'utf8',
    });
    assert.match(out, /Fallo en z:youtube: Falta la conexión de youtube/);
    assert.match(out, /Publicados: 0, fallidos: 1/);
    assert.equal(parseJob(gh.files.get('queue/z__youtube.json')!)!.status, 'failed');
    assert.ok(os.tmpdir());
  });
});

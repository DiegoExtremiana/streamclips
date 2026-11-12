"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const libsodium_wrappers_1 = __importDefault(require("libsodium-wrappers"));
const workflow_1 = require("../electron/services/cloud/workflow");
const jobs_1 = require("../electron/services/cloud/jobs");
const cloud_1 = require("../electron/domain/cloud");
const github_1 = require("../electron/services/cloud/github");
const runner_1 = require("../electron/services/cloud/runner");
const oauth_1 = require("../electron/services/oauth");
const helpers_1 = require("./helpers");
const fakeGithub_1 = require("./fakeGithub");
/** YouTube de mentira (subida reanudable) + servidor de tokens de Google. */
async function fakeYoutube() {
    const uploads = [];
    let pending = null;
    let got = 0;
    const srv = node_http_1.default.createServer((req, res) => {
        const parts = [];
        req.on('data', (c) => parts.push(c));
        req.on('end', () => {
            const body = Buffer.concat(parts);
            const url = req.url ?? '';
            const j = (v, s = 200, h = {}) => (res.writeHead(s, { 'content-type': 'application/json', ...h }), res.end(JSON.stringify(v)));
            if (url === '/token')
                return j({ access_token: 'FRESH', expires_in: 3600 });
            if (url.startsWith('/upload/videos')) {
                pending = { meta: JSON.parse(body.toString()) };
                got = 0;
                return j({}, 200, { location: `http://${req.headers.host}/session` });
            }
            if (url === '/session') {
                got += body.length;
                const total = Number(/\/(\d+)$/.exec(String(req.headers['content-range']))[1]);
                if (got < total)
                    return j({}, 308, { range: `bytes=0-${got - 1}` });
                uploads.push({ meta: pending.meta, bytes: got });
                return j({ id: 'YT1' });
            }
            if (url.startsWith('/playlists') || url.startsWith('/playlistItems'))
                return j({ items: [] });
            return void res.writeHead(404).end();
        });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${srv.address().port}`;
    return { base, uploads, close: () => { srv.close(); srv.closeAllConnections?.(); } };
}
const created = [];
(0, node_test_1.afterEach)(() => {
    while (created.length)
        created.pop()();
});
(0, node_test_1.describe)('nube: piezas sueltas', () => {
    (0, node_test_1.it)('parseRepo acepta usuario/nombre y URLs, y rechaza lo demás', () => {
        strict_1.default.equal((0, cloud_1.parseRepo)('diego/nube'), 'diego/nube');
        strict_1.default.equal((0, cloud_1.parseRepo)(' https://github.com/diego/nube.git '), 'diego/nube');
        strict_1.default.equal((0, cloud_1.parseRepo)('https://github.com/diego/nube/'), 'diego/nube');
        for (const bad of ['', 'diego', 'a/b/c', 'dié/go', '../x', 'a b/c'])
            strict_1.default.equal((0, cloud_1.parseRepo)(bad), null, bad);
    });
    (0, node_test_1.it)('el secreto se cifra con la clave pública del repositorio y solo ella lo abre', async () => {
        await libsodium_wrappers_1.default.ready;
        const kp = libsodium_wrappers_1.default.crypto_box_keypair();
        const enc = await (0, cloud_1.sealSecret)(libsodium_wrappers_1.default.to_base64(kp.publicKey, libsodium_wrappers_1.default.base64_variants.ORIGINAL), '{"a":"ñandú"}');
        strict_1.default.ok(!enc.includes('ñandú'));
        strict_1.default.equal(libsodium_wrappers_1.default.to_string(libsodium_wrappers_1.default.crypto_box_seal_open(libsodium_wrappers_1.default.from_base64(enc, libsodium_wrappers_1.default.base64_variants.ORIGINAL), kp.publicKey, kp.privateKey)), '{"a":"ñandú"}');
    });
    (0, node_test_1.it)('cron: una línea por hora UTC distinta (un minuto después), más un repaso periódico; sin duplicados', () => {
        const lines = (0, workflow_1.cronLines)([new Date('2026-10-16T05:00:00Z'), new Date('2026-10-17T05:00:30Z'), new Date('2026-10-16T14:00:00Z')]);
        strict_1.default.equal(lines.length, 3);
        strict_1.default.equal(lines.filter((l) => l === '1 5 * * *').length, 1);
        strict_1.default.ok(lines.includes('1 14 * * *') && lines.includes('23 */3 * * *'));
        strict_1.default.ok((0, workflow_1.cronLines)(new Array(50).fill(0).map((_, i) => new Date(Date.UTC(2026, 9, 16, i % 24, i)))).length <= 21);
    });
    (0, node_test_1.it)('el flujo generado tiene las cronologías, la concurrencia única y los secretos', () => {
        const y = (0, workflow_1.workflowYaml)(['1 5 * * *']);
        strict_1.default.match(y, /- cron: '1 5 \* \* \*'/);
        strict_1.default.match(y, /group: streamclips-publish/);
        strict_1.default.match(y, /cancel-in-progress: false/);
        strict_1.default.match(y, /STREAMCLIPS_CREDS: \$\{\{ secrets\.STREAMCLIPS_CREDS \}\}/);
        strict_1.default.match(y, /workflow_dispatch/);
    });
    (0, node_test_1.it)('trabajos: ruta, etiqueta y lectura segura', () => {
        strict_1.default.equal((0, jobs_1.jobPath)('abc-1:youtube'), 'queue/abc-1__youtube.json');
        strict_1.default.equal((0, jobs_1.releaseTag)('abc-1:youtube'), 'q-abc-1-youtube');
        strict_1.default.equal((0, jobs_1.parseJob)('no json'), null);
        strict_1.default.equal((0, jobs_1.parseJob)('{"v":2}'), null);
        strict_1.default.equal((0, jobs_1.parseJob)(JSON.stringify({ v: 1, key: 'k', platform: 'youtube', scheduledAt: 'x', status: 'raro', file: {} })), null);
        const j = { v: 1, key: 'k', platform: 'youtube', scheduledAt: '2026-10-16T05:00:00.000Z', status: 'queued', title: 'T', kind: 'long', releaseId: 1, releaseTag: 'q-k', file: { name: 'a.mp4', assetId: 2, size: 3 }, updatedAt: 'x' };
        strict_1.default.deepEqual((0, jobs_1.parseJob)((0, jobs_1.serializeJob)(j)), j);
    });
});
(0, node_test_1.describe)('nube: de punta a punta', () => {
    async function connectYoutube(e) {
        // guarda unas claves como lo haría el flujo OAuth
        const secretsApi = e.ctx.connections.d.secrets;
        e.ctx.connections.setApp('youtube', 'CID', 'CSECRET');
        e.ctx.store.data.connections.youtube.tokens = secretsApi.encode(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', expiresAt: 0 }));
        e.ctx.store.data.connections.youtube.account = 'Canal';
    }
    (0, node_test_1.it)('configurar: exige repositorio privado, instala publicador y flujo, y sube los permisos cifrados', async () => {
        const gh = await (0, fakeGithub_1.fakeGithub)();
        created.push(gh.close);
        const e = (0, helpers_1.makeEnv)({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner de prueba\n', cloudIntervalMs: 3_600_000 });
        created.push(() => e.cleanup());
        await connectYoutube(e);
        const st = await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
        strict_1.default.equal(st.enabled, true);
        strict_1.default.equal(st.repo, 'diego/nube');
        strict_1.default.equal(gh.files.get('runner/runner.js'), '// runner de prueba\n');
        strict_1.default.match(gh.files.get('.github/workflows/publish.yml'), /name: Publicar/);
        const creds = JSON.parse(gh.decryptSecret('STREAMCLIPS_CREDS'));
        strict_1.default.deepEqual(creds.youtube, { clientId: 'CID', clientSecret: 'CSECRET', refreshToken: 'RT' });
        // el token de GitHub no queda en claro en disco
        strict_1.default.ok(!node_fs_1.default.readFileSync(e.ctx.store.file, 'utf8').includes('GHTOKEN'));
    });
    (0, node_test_1.it)('rechaza repositorios públicos y tokens malos sin dejar nada activado', async () => {
        const pub = await (0, fakeGithub_1.fakeGithub)({ isPrivate: false });
        created.push(pub.close);
        const e = (0, helpers_1.makeEnv)({ github: { api: pub.base, uploads: pub.base }, runnerSource: () => 'x' });
        created.push(() => e.cleanup());
        await strict_1.default.rejects(() => e.ctx.cloud.setup('diego/nube', 'GHTOKEN'), /PÚBLICO/);
        strict_1.default.equal(e.ctx.cloud.status().enabled, false);
        strict_1.default.equal(pub.files.size, 0, 'no escribe nada en un repositorio público');
        const gh = await (0, fakeGithub_1.fakeGithub)();
        created.push(gh.close);
        const e2 = (0, helpers_1.makeEnv)({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => 'x' });
        created.push(() => e2.cleanup());
        await strict_1.default.rejects(() => e2.ctx.cloud.setup('diego/nube', 'MALO'), /rechazó el token/);
        await strict_1.default.rejects(() => e2.ctx.cloud.setup('esto no vale', 'x'), /usuario\/nombre/);
        strict_1.default.equal(e2.ctx.cloud.status().enabled, false);
    });
    (0, node_test_1.it)('lo programado sube a la cola; el PC deja de publicarlo; la nube lo publica, borra su copia y el PC lo da por publicado y borra la copia local', async () => {
        const gh = await (0, fakeGithub_1.fakeGithub)();
        const yt = await fakeYoutube();
        created.push(gh.close, yt.close);
        const e = (0, helpers_1.makeEnv)({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
        created.push(() => e.cleanup());
        await connectYoutube(e);
        const longFile = node_path_1.default.join(e.outputDir, 'largo.mp4');
        node_fs_1.default.writeFileSync(longFile, Buffer.alloc(500_000, 3));
        e.ctx.store.data.outputs.push({ id: 'o1', kind: 'long', title: 'Resumen del directo', description: 'Lo mejor', visibility: 'public', files: { long: longFile }, durationSec: 600, createdAt: new Date().toISOString() });
        await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
        const at = new Date(Date.now() + 3600_000).toISOString();
        e.ctx.pubs.schedule('o1', ['youtube'], at);
        await e.ctx.cloud.sync();
        const pub = e.ctx.store.data.publications[0];
        strict_1.default.equal(pub.cloud?.state, 'queued');
        strict_1.default.equal(e.ctx.cloud.status().queued, 1);
        const job = (0, jobs_1.parseJob)(gh.files.get('queue/o1__youtube.json'));
        strict_1.default.deepEqual([job.status, job.title, job.kind, job.visibility], ['queued', 'Resumen del directo', 'long', 'public']);
        strict_1.default.equal([...gh.releases.values()].length, 1);
        strict_1.default.match(gh.files.get('.github/workflows/publish.yml'), /cron: '\d+ \d+ \* \* \*'/);
        // el programador del PC lo ignora aunque llegue la hora
        let localCalls = 0;
        const sched = new (await Promise.resolve().then(() => __importStar(require('../electron/domain/scheduler')))).Scheduler(e.ctx.store, e.notifier, e.ctx.log, { youtube: { publish: async () => void localCalls++ }, tiktok: { publish: async () => undefined }, instagram: { publish: async () => undefined } }, 1000, () => Date.now() + 2 * 3600_000);
        await sched.tick();
        strict_1.default.equal(localCalls, 0, 'el PC no debe publicar lo que gestiona la nube');
        // llega la hora: se ejecuta el publicador de la nube (aquí, en el mismo proceso, contra YouTube simulado)
        const ghClient = new github_1.Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
        const providers = { ...oauth_1.PROVIDERS, google: { ...oauth_1.PROVIDERS.google, tokenUrl: `${yt.base}/token` } };
        const r = await (0, runner_1.runQueue)(ghClient, JSON.parse(gh.decryptSecret('STREAMCLIPS_CREDS')), { providers, youtube: { upload: `${yt.base}/upload`, api: yt.base }, sleep: async () => undefined }, () => Date.now() + 2 * 3600_000);
        strict_1.default.deepEqual(r.published, ['o1:youtube']);
        strict_1.default.equal(yt.uploads.length, 1);
        strict_1.default.equal(yt.uploads[0].bytes, 500_000);
        strict_1.default.deepEqual(yt.uploads[0].meta.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false });
        strict_1.default.equal(gh.releases.size, 0, 'la copia de la nube se borra al publicar');
        strict_1.default.equal((0, jobs_1.parseJob)(gh.files.get('queue/o1__youtube.json')).status, 'published');
        // el programa se entera, marca publicado y, ya publicado en todas sus redes, borra su copia local
        await e.ctx.cloud.sync();
        strict_1.default.equal(e.ctx.store.data.publications[0].status, 'published');
        strict_1.default.equal(node_fs_1.default.existsSync(longFile), false, 'la copia local se borra al estar publicado');
        strict_1.default.equal(e.ctx.store.data.outputs.some((o) => o.id === 'o1'), false);
        strict_1.default.equal(e.ctx.cloud.status().queued, 0);
        // y el registro de la cola se limpia en la siguiente pasada sin tocar nada local
        await e.ctx.cloud.sync();
        strict_1.default.equal(gh.files.has('queue/o1__youtube.json'), false);
        strict_1.default.equal(e.ctx.store.data.publications[0].status, 'published');
    });
    (0, node_test_1.it)('una publicación ya vencida lanza el publicador de inmediato; cancelar la quita de la nube; cambiar la hora la actualiza', async () => {
        const gh = await (0, fakeGithub_1.fakeGithub)();
        created.push(gh.close);
        const e = (0, helpers_1.makeEnv)({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
        created.push(() => e.cleanup());
        await connectYoutube(e);
        const f = node_path_1.default.join(e.outputDir, 'l.mp4');
        node_fs_1.default.writeFileSync(f, Buffer.alloc(1000, 1));
        for (const id of ['a', 'b'])
            e.ctx.store.data.outputs.push({ id, kind: 'long', title: `T ${id}`, files: { long: f }, durationSec: 1, createdAt: new Date().toISOString() });
        await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
        e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 30_000).toISOString());
        e.ctx.pubs.schedule('b', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
        await e.ctx.cloud.sync();
        strict_1.default.equal(gh.dispatches.length, 1, 'solo la que vence ya pide ejecución inmediata');
        // cambiar la hora de b
        const newAt = new Date(Date.now() + 10_800_000).toISOString();
        e.ctx.pubs.setSchedule('b', [{ platform: 'youtube', atIso: newAt }]);
        await e.ctx.cloud.sync();
        strict_1.default.equal((0, jobs_1.parseJob)(gh.files.get('queue/b__youtube.json')).scheduledAt, newAt);
        // cancelar a
        e.ctx.pubs.cancel('a:youtube');
        await e.ctx.cloud.sync();
        strict_1.default.equal(gh.files.has('queue/a__youtube.json'), false);
        strict_1.default.equal(gh.releases.size, 1);
        // un archivo que ya no existe se marca fallido sin romper el resto
        node_fs_1.default.rmSync(f);
        e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
        await e.ctx.cloud.sync();
        strict_1.default.equal(e.ctx.store.data.publications.find((p) => p.key === 'a:youtube').status, 'failed');
    });
    (0, node_test_1.it)('desactivar borra lo subido y devuelve la publicación al PC', async () => {
        const gh = await (0, fakeGithub_1.fakeGithub)();
        created.push(gh.close);
        const e = (0, helpers_1.makeEnv)({ github: { api: gh.base, uploads: gh.base }, runnerSource: () => '// runner\n', cloudIntervalMs: 3_600_000 });
        created.push(() => e.cleanup());
        await connectYoutube(e);
        const f = node_path_1.default.join(e.outputDir, 'l.mp4');
        node_fs_1.default.writeFileSync(f, Buffer.alloc(1000, 1));
        e.ctx.store.data.outputs.push({ id: 'a', kind: 'long', title: 'T', files: { long: f }, durationSec: 1, createdAt: new Date().toISOString() });
        await e.ctx.cloud.setup('diego/nube', 'GHTOKEN');
        e.ctx.pubs.schedule('a', ['youtube'], new Date(Date.now() + 7200_000).toISOString());
        await e.ctx.cloud.sync();
        strict_1.default.equal(gh.releases.size, 1);
        const st = await e.ctx.cloud.disable();
        strict_1.default.equal(st.enabled, false);
        strict_1.default.equal(gh.releases.size, 0);
        strict_1.default.equal(gh.files.has('queue/a__youtube.json'), false);
        strict_1.default.equal(e.ctx.store.data.publications[0].cloud, undefined);
        strict_1.default.equal(e.ctx.store.data.publications[0].status, 'scheduled');
    });
    (0, node_test_1.it)('el publicador: dos ejecuciones a la vez no publican lo mismo; lo interrumpido pasa a fallido; los fallos se anotan', async () => {
        const gh = await (0, fakeGithub_1.fakeGithub)();
        const yt = await fakeYoutube();
        created.push(gh.close, yt.close);
        const client = new github_1.Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
        const f = node_path_1.default.join((0, helpers_1.tmpDir)(), 'v.mp4');
        created.push(() => (0, helpers_1.rmDir)(node_path_1.default.dirname(f)));
        node_fs_1.default.writeFileSync(f, Buffer.alloc(2000, 2));
        const rel = await client.createRelease('q-x', 'x');
        const asset = await client.uploadAsset(rel.id, 'v.mp4', f, 'video/mp4');
        const mkJob = (key, over = {}) => ({ v: 1, key, platform: 'youtube', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'queued', title: key, kind: 'long', releaseId: rel.id, releaseTag: 'q-x', file: { name: 'v.mp4', assetId: asset.id, size: 2000 }, updatedAt: 'x', ...over });
        gh.files.set('queue/j1__youtube.json', (0, jobs_1.serializeJob)(mkJob('j1:youtube')));
        gh.files.set('queue/j2__youtube.json', (0, jobs_1.serializeJob)(mkJob('j2:youtube', { status: 'publishing' })));
        gh.files.set('queue/j3__youtube.json', (0, jobs_1.serializeJob)(mkJob('j3:youtube', { scheduledAt: new Date(Date.now() + 3600_000).toISOString() })));
        gh.files.set('queue/j4__tiktok.json', (0, jobs_1.serializeJob)(mkJob('j4:tiktok', { platform: 'tiktok', kind: 'clip' })));
        const providers = { ...oauth_1.PROVIDERS, google: { ...oauth_1.PROVIDERS.google, tokenUrl: `${yt.base}/token` } };
        const envr = { providers, youtube: { upload: `${yt.base}/upload`, api: yt.base }, sleep: async () => undefined };
        const creds = { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } };
        const [a, b] = await Promise.all([(0, runner_1.runQueue)(client, creds, envr), (0, runner_1.runQueue)(client, creds, envr)]);
        strict_1.default.equal(yt.uploads.length, 1, 'la reserva con sha impide publicar dos veces');
        strict_1.default.equal(a.published.length + b.published.length, 1);
        const j2 = (0, jobs_1.parseJob)(gh.files.get('queue/j2__youtube.json'));
        strict_1.default.equal(j2.status, 'failed');
        strict_1.default.match(j2.note, /interrumpió/);
        strict_1.default.equal((0, jobs_1.parseJob)(gh.files.get('queue/j3__youtube.json')).status, 'queued', 'lo futuro espera');
        const j4 = (0, jobs_1.parseJob)(gh.files.get('queue/j4__tiktok.json'));
        strict_1.default.equal(j4.status, 'failed');
        strict_1.default.match(j4.note, /Falta la conexión de tiktok/);
    });
    (0, node_test_1.it)('el publicador empaquetado (runner.js) arranca como en Actions, reserva el trabajo y anota el fallo sin credenciales', async () => {
        (0, node_child_process_1.execFileSync)('node', ['scripts/build-runner.mjs'], { cwd: process.cwd() });
        const gh = await (0, fakeGithub_1.fakeGithub)();
        created.push(gh.close);
        const client = new github_1.Github({ token: 'GHTOKEN', repo: 'diego/nube', api: gh.base, uploads: gh.base });
        const d = (0, helpers_1.tmpDir)();
        created.push(() => (0, helpers_1.rmDir)(d));
        const f = node_path_1.default.join(d, 'v.mp4');
        node_fs_1.default.writeFileSync(f, Buffer.alloc(500, 2));
        const rel = await client.createRelease('q-y', 'y');
        const asset = await client.uploadAsset(rel.id, 'v.mp4', f, 'video/mp4');
        gh.files.set('queue/z__youtube.json', (0, jobs_1.serializeJob)({ v: 1, key: 'z:youtube', platform: 'youtube', scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'queued', title: 'Z', kind: 'long', releaseId: rel.id, releaseTag: 'q-y', file: { name: 'v.mp4', assetId: asset.id, size: 500 }, updatedAt: 'x' }));
        // asíncrono: el GitHub de mentira vive en este mismo proceso y debe poder contestar mientras corre el publicador
        const { stdout: out } = await (0, node_util_1.promisify)(node_child_process_1.execFile)('node', [node_path_1.default.resolve('resources/cloud/runner.js')], {
            env: { ...process.env, GITHUB_REPOSITORY: 'diego/nube', GITHUB_TOKEN: 'GHTOKEN', STREAMCLIPS_GITHUB_API: gh.base, STREAMCLIPS_GITHUB_UPLOADS: gh.base, STREAMCLIPS_CREDS: '{}', HTTPS_PROXY: '', HTTP_PROXY: '' },
            encoding: 'utf8',
        });
        strict_1.default.match(out, /Fallo en z:youtube: Falta la conexión de youtube/);
        strict_1.default.match(out, /Publicados: 0, fallidos: 1/);
        strict_1.default.equal((0, jobs_1.parseJob)(gh.files.get('queue/z__youtube.json')).status, 'failed');
        strict_1.default.ok(node_os_1.default.tmpdir());
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const twitch_1 = require("../electron/services/twitch");
const helpers_1 = require("./helpers");
/** Twitch de mentira: lo que devuelve se cambia desde la prueba. */
class FakeTwitch extends twitch_1.TwitchClient {
    stream = { live: false };
    vods = [];
    clipList = [];
    fail = null;
    async streamStatus() {
        if (this.fail)
            throw new Error(this.fail);
        return this.stream;
    }
    async listVods() {
        return this.vods;
    }
    clipImpl;
    async listClips(c, o = {}) {
        return this.clipImpl ? this.clipImpl(c, o) : this.clipList;
    }
}
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
function setup() {
    const twitch = new FakeTwitch();
    const downloads = [];
    const e = (0, helpers_1.makeEnv)({
        twitch,
        download: async (_t, url, outDir) => {
            downloads.push(url);
            const f = node_path_1.default.join(outDir, `v${downloads.length}.mp4`);
            (0, helpers_1.makeVideo)(f, { dur: 6, w: 640, h: 360 });
            return { title: `Título de ${url.split('/').pop()}`, filePath: f };
        },
    });
    envs.push(e);
    // estas pruebas son del vigilante: el piloto automático no debe ponerse a editar en segundo plano
    e.ctx.settings.set({ twitch: { clientId: 'cid', clientSecret: 'sec', login: 'canal' }, autopilot: { enabled: false } });
    return { e, twitch, downloads };
}
const vod = (id, createdAt, durationSec = 3600) => ({ id, title: `Directo ${id}`, url: `https://www.twitch.tv/videos/${id}`, durationSec, createdAt });
const T0 = '2026-10-15T18:00:00Z';
(0, node_test_1.describe)('vigilante del canal', () => {
    (0, node_test_1.it)('sin credenciales no hace nada ni da error', async () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        const s = await e.ctx.channel.poll();
        strict_1.default.equal(s.configured, false);
        strict_1.default.equal(s.error, null);
    });
    (0, node_test_1.it)('refleja si estás en directo y avisa a la interfaz', async () => {
        const { e, twitch } = setup();
        twitch.stream = { live: true, title: 'Hoy', viewers: 5, startedAt: T0 };
        const s = await e.ctx.channel.poll();
        strict_1.default.equal(s.configured, true);
        strict_1.default.equal(s.stream?.live, true);
        strict_1.default.ok(s.lastCheck);
        strict_1.default.equal(e.notifier.channels.at(-1)?.stream?.title, 'Hoy');
    });
    (0, node_test_1.it)('un fallo de Twitch se muestra y no rompe la siguiente vuelta', async () => {
        const { e, twitch } = setup();
        twitch.fail = 'Twitch no responde';
        strict_1.default.equal((await e.ctx.channel.poll()).error, 'Twitch no responde');
        twitch.fail = null;
        strict_1.default.equal((await e.ctx.channel.poll()).error, null);
    });
    (0, node_test_1.it)('la primera vez NO recoge los VODs antiguos', async () => {
        const { e, twitch, downloads } = setup();
        twitch.vods = [vod('1', '2026-10-01T18:00:00Z'), vod('2', '2026-10-10T18:00:00Z')];
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(downloads.length, 0);
        strict_1.default.deepEqual(e.ctx.store.data.channel.seenVodIds.sort(), ['1', '2']);
    });
    (0, node_test_1.it)('al terminar un directo recoge su VOD una sola vez (tras confirmar que sigue sin directo)', async () => {
        const { e, twitch, downloads } = setup();
        twitch.vods = [vod('1', '2026-10-01T18:00:00Z')];
        await e.ctx.channel.poll(); // línea base
        // empieza el directo: su VOD ya existe pero NO se toca
        twitch.stream = { live: true, startedAt: new Date().toISOString() };
        twitch.vods = [vod('9', new Date().toISOString(), 120), ...twitch.vods];
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(downloads.length, 0);
        // el directo termina: una lectura no basta
        twitch.stream = { live: false };
        await e.ctx.channel.poll();
        strict_1.default.equal(downloads.length, 0);
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.deepEqual(downloads, ['https://www.twitch.tv/videos/9']);
        const job = e.ctx.store.data.vods[0];
        strict_1.default.equal(job.origin, 'live');
        strict_1.default.equal(job.twitchId, '9');
        strict_1.default.equal(job.status, 'downloaded');
        strict_1.default.equal(e.ctx.channel.status().lastImported?.vodId, job.id);
        // no se vuelve a recoger
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(downloads.length, 1);
    });
    (0, node_test_1.it)('si la app estaba cerrada durante el directo, lo recoge al abrirla', async () => {
        const { e, twitch, downloads } = setup();
        await e.ctx.channel.poll(); // línea base sin VODs
        // simula que la app estuvo cerrada: la vigilancia empezó hace horas
        e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3 * 3600_000).toISOString();
        twitch.vods = [vod('7', new Date(Date.now() - 2 * 3600_000).toISOString())];
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.deepEqual(downloads, ['https://www.twitch.tv/videos/7']);
    });
    (0, node_test_1.it)('ignora VODs que Twitch aún está cerrando (duración casi cero) y los recoge cuando están listos', async () => {
        const { e, twitch, downloads } = setup();
        await e.ctx.channel.poll();
        e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3600_000).toISOString();
        twitch.vods = [vod('5', new Date(Date.now() - 1800_000).toISOString(), 5)];
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        strict_1.default.equal(downloads.length, 0);
        twitch.vods = [vod('5', new Date(Date.now() - 1800_000).toISOString(), 1800)];
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(downloads.length, 1);
    });
    (0, node_test_1.it)('con la recogida automática apagada no descarga nada, y al volver a encenderla no recoge lo pasado', async () => {
        const { e, twitch, downloads } = setup();
        await e.ctx.channel.poll();
        e.ctx.channel.setAutoImport(false);
        twitch.vods = [vod('3', new Date().toISOString())];
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        strict_1.default.equal(downloads.length, 0);
        e.ctx.channel.setAutoImport(true);
        await e.ctx.channel.poll(); // nueva línea base
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(downloads.length, 0);
        strict_1.default.equal(JSON.parse(node_fs_1.default.readFileSync(e.ctx.store.file, 'utf8')).channel.autoImport, true);
    });
    (0, node_test_1.it)('avisa a quien espera el VOD de un directo ya descargado', async () => {
        const { e, twitch } = setup();
        const ready = [];
        e.ctx.channel.onLiveVodReady((j) => ready.push(j.twitchId ?? ''));
        await e.ctx.channel.poll();
        e.ctx.store.data.channel.autoSince = new Date(Date.now() - 3600_000).toISOString();
        twitch.vods = [vod('8', new Date(Date.now() - 1800_000).toISOString())];
        await e.ctx.channel.poll();
        await e.ctx.channel.poll();
        await e.ctx.downloadQueue.idle();
        strict_1.default.deepEqual(ready, ['8']);
    });
});
(0, node_test_1.describe)('analizar un directo cuando quieras', () => {
    (0, node_test_1.it)('descarga el directo pedido y avisa para analizarlo, aunque el piloto automático esté apagado y la recogida automática también', async () => {
        const { e, twitch, downloads } = setup();
        e.ctx.channel.setAutoImport(false);
        twitch.vods = [vod('5', '2026-10-01T18:00:00Z'), vod('6', '2026-10-02T18:00:00Z')];
        const ready = [];
        e.ctx.channel.onAnalyzeReady((j) => ready.push(j.twitchId ?? ''));
        const job = await e.ctx.channel.analyze('6');
        strict_1.default.equal(job.twitchId, '6');
        strict_1.default.equal(job.origin, 'live');
        strict_1.default.equal(job.streamStartedAt, '2026-10-02T18:00:00Z');
        await e.ctx.downloadQueue.idle();
        strict_1.default.deepEqual(downloads, ['https://www.twitch.tv/videos/6']);
        strict_1.default.deepEqual(ready, ['6'], 'al terminar la descarga se pide el análisis una sola vez');
        // ya descargado: analizar otra vez lo lanza al momento y no descarga de nuevo
        await e.ctx.channel.analyze('6');
        strict_1.default.deepEqual(ready, ['6', '6']);
        strict_1.default.equal(downloads.length, 1);
    });
    (0, node_test_1.it)('un directo que sigue en curso no se puede analizar; uno que Twitch ya no tiene da un error claro', async () => {
        const { e, twitch } = setup();
        const start = new Date().toISOString();
        twitch.stream = { live: true, startedAt: start };
        twitch.vods = [vod('9', start, 120)];
        await e.ctx.channel.poll();
        await strict_1.default.rejects(() => e.ctx.channel.analyze('9'), /sigue en curso/);
        await strict_1.default.rejects(() => e.ctx.channel.analyze('404'), /ya no tiene ese directo/);
    });
    (0, node_test_1.it)('tras un error de descarga se puede volver a pedir y crea una descarga nueva', async () => {
        const { e, twitch, downloads } = setup();
        twitch.vods = [vod('5', '2026-10-01T18:00:00Z')];
        const first = await e.ctx.channel.analyze('5');
        await e.ctx.downloadQueue.idle();
        first.status = 'error';
        const second = await e.ctx.channel.analyze('5');
        await e.ctx.downloadQueue.idle();
        strict_1.default.notEqual(second.id, first.id);
        strict_1.default.equal(downloads.length, 2);
    });
    (0, node_test_1.it)('sin credenciales de Twitch lo explica', async () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        await strict_1.default.rejects(() => e.ctx.channel.analyze('1'), /conectar tu canal/);
    });
});
(0, node_test_1.describe)('clips del canal', () => {
    const clip = (id, durationSec = 5) => ({ id, title: `Clip ${id}`, url: `https://clips.twitch.tv/${id}`, durationSec, createdAt: T0, creator: 'x', views: 1, thumbnail: '' });
    (0, node_test_1.it)('lista los clips y marca los ya importados', async () => {
        const { e, twitch } = setup();
        twitch.clipList = [clip('a'), clip('b')];
        strict_1.default.deepEqual((await e.ctx.channel.clips()).clips.map((c) => c.imported), [false, false]);
        await e.ctx.channel.importClip('a');
        strict_1.default.deepEqual((await e.ctx.channel.clips()).clips.map((c) => c.imported), [true, false]);
    });
    (0, node_test_1.it)('lo reciente sale enseguida y el historial sigue en segundo plano; un fallo del historial no vacía la lista', async () => {
        const { e, twitch } = setup();
        let release;
        const gate = new Promise((r) => (release = r));
        twitch.clipImpl = async (_c, o) => {
            o?.onProgress?.([clip('nuevo')]);
            await gate;
            o?.onWarning?.('Solo se han podido leer los clips hasta ayer');
            return [clip('nuevo'), clip('viejo')];
        };
        const a = await e.ctx.channel.clips();
        strict_1.default.deepEqual(a.clips.map((c) => c.id), ['nuevo']);
        strict_1.default.equal(a.loading, true);
        release();
        for (let i = 0; i < 50 && (await e.ctx.channel.clips()).loading; i++)
            await new Promise((r) => setTimeout(r, 20));
        const b = await e.ctx.channel.clips();
        strict_1.default.deepEqual(b.clips.map((c) => c.id).sort(), ['nuevo', 'viejo']);
        strict_1.default.equal(b.loading, false);
        strict_1.default.match(b.warning, /Solo se han podido leer/);
    });
    (0, node_test_1.it)('si Twitch falla y no hay nada en caché, el error se ve', async () => {
        const { e, twitch } = setup();
        twitch.clipImpl = async () => {
            throw new Error('Twitch rechazó las credenciales');
        };
        await strict_1.default.rejects(() => e.ctx.channel.clips(), /rechazó las credenciales/);
    });
    (0, node_test_1.it)('importar descarga el clip y deja vertical y horizontal en la Biblioteca, sin repetirse', async () => {
        const { e, twitch, downloads } = setup();
        twitch.clipList = [clip('a')];
        const job = await e.ctx.channel.importClip('a');
        strict_1.default.equal(job.origin, 'clip');
        await e.ctx.downloadQueue.idle();
        await e.ctx.renderQueue.idle();
        // el render se encadena tras la descarga: se espera a que aparezca
        for (let i = 0; i < 400 && !e.ctx.store.data.outputs.length; i++)
            await new Promise((r) => setTimeout(r, 100));
        const out = e.ctx.store.data.outputs[0];
        strict_1.default.ok(out, 'debe haber un clip en la Biblioteca');
        strict_1.default.equal(out.kind, 'clip');
        strict_1.default.equal(out.title, 'Título de a');
        strict_1.default.ok(out.files.vertical && out.files.horizontal);
        strict_1.default.ok(node_fs_1.default.existsSync(out.files.vertical) && node_fs_1.default.existsSync(out.files.horizontal));
        // importarlo otra vez devuelve el mismo trabajo
        const again = await e.ctx.channel.importClip('a');
        strict_1.default.equal(again.id, job.id);
        strict_1.default.equal(downloads.length, 1);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 1);
    });
    (0, node_test_1.it)('un clip que ya no existe da un error claro', async () => {
        const { e, twitch } = setup();
        twitch.clipList = [];
        await strict_1.default.rejects(() => e.ctx.channel.importClip('zzz'), /ya no está/);
    });
    (0, node_test_1.it)('ver un clip sin descargarlo: da la dirección directa y no añade nada a la Biblioteca', async () => {
        const { e, twitch, downloads } = setup();
        twitch.clipList = [{ id: 'a', title: 'A', url: 'https://clips.twitch.tv/a', durationSec: 10, createdAt: T0, creator: 'x', views: 1, thumbnail: '' }];
        e.ctx.settings.set({ ytdlpPath: (0, helpers_1.fakeYtdlp)() });
        const log = node_path_1.default.join(e.root, 'ytdlp.log');
        process.env.FAKE_LOG = log;
        process.env.FAKE_STREAM = 'https://clips.example.test/a.mp4';
        try {
            strict_1.default.equal(await e.ctx.channel.clipStream('a'), 'https://clips.example.test/a.mp4');
            const args = JSON.parse(node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n')[0]);
            strict_1.default.ok(args.includes('-g'));
            strict_1.default.equal(args.at(-2), '--');
            strict_1.default.equal(args.at(-1), 'https://clips.twitch.tv/a');
            process.env.FAKE_STREAM = 'file:///etc/passwd';
            await strict_1.default.rejects(() => e.ctx.channel.clipStream('a'), /dirección válida/);
            await strict_1.default.rejects(() => e.ctx.channel.clipStream('zzz'), /ya no está/);
        }
        finally {
            delete process.env.FAKE_LOG;
            delete process.env.FAKE_STREAM;
        }
        strict_1.default.equal(downloads.length, 0);
        strict_1.default.equal(e.ctx.store.data.vods.filter((v) => v.origin === 'clip').length, 0);
    });
});

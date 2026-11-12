"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const context_1 = require("../electron/app/context");
const publishers_1 = require("../electron/domain/publishers");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const ffmpeg_2 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
/**
 * Recorrido completo sin interfaz: URL del VOD -> descarga (yt-dlp simulado) -> plan de edición
 * -> render y validación reales con ffmpeg -> programación -> publicación -> reinicio de la app.
 */
(0, node_test_1.describe)('integración: de la URL del VOD a la publicación', () => {
    let root;
    let source;
    const saved = { ...process.env };
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        source = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'fixtures', 'directo.mp4'), { w: 1920, h: 1080, dur: 40, audio: true });
    });
    (0, node_test_1.after)(() => {
        (0, helpers_1.rmDir)(root);
        process.env = saved;
    });
    (0, node_test_1.it)('flujo completo y persistencia tras reiniciar', async () => {
        process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'ok', FAKE_ID: 'v123', FAKE_DELAY: '1' };
        const tools = (0, tools_1.resolveToolPaths)('', '');
        // publicadores de prueba: YouTube funciona, TikTok aún "no está conectado"
        const published = [];
        const publishers = {
            youtube: { publish: async (o) => void published.push({ platform: 'youtube', output: o }) },
            tiktok: { publish: async () => { throw new publishers_1.NotConnectedError('TikTok aún no está conectado'); } },
            instagram: { publish: async (o) => void published.push({ platform: 'instagram', output: o }) },
        };
        const env = (0, helpers_1.makeEnv)({ publishers });
        const { ctx } = env;
        ctx.settings.set({ ytdlpPath: (0, helpers_1.fakeYtdlp)() });
        // 1) añadir el VOD por URL y esperar la descarga
        const vod = ctx.vods.add('https://www.twitch.tv/videos/123456789');
        await ctx.downloadQueue.idle();
        strict_1.default.equal(vod.status, 'downloaded', vod.error);
        strict_1.default.equal(vod.title, 'Título del VOD');
        strict_1.default.ok(node_fs_1.default.existsSync(vod.filePath));
        strict_1.default.equal(node_path_1.default.dirname(vod.filePath), node_path_1.default.join(env.outputDir, 'vods'));
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
        strict_1.default.equal(r.created.length, 4);
        strict_1.default.equal(r.errors.length, 1);
        strict_1.default.match(r.errors[0], /clip 4: acaba después del final del VOD/);
        // 3) cada resultado existe, tiene el formato exacto y la duración pedida
        const expected = {
            'Clip vertical 1': ['vertical', 20],
            'Clip vertical 2': ['vertical', 8],
            'Clip horizontal': ['horizontal', 20],
            'Resumen del directo': ['long', 24],
        };
        for (const o of r.created) {
            const [kinds, dur] = expected[o.title];
            strict_1.default.deepEqual(Object.keys(o.files), [kinds], o.title);
            for (const [k, f] of Object.entries(o.files)) {
                const size = ffmpeg_2.EXPECTED_SIZE[k];
                const info = await (0, ffmpeg_1.probe)(tools, f);
                strict_1.default.deepEqual([info.width, info.height], [size.w, size.h], `${o.title} (${k})`);
                strict_1.default.ok(Math.abs(info.durationSec - dur) < 1.5, `${o.title}: ${info.durationSec}s`);
                strict_1.default.ok(info.hasAudio, `${o.title} conserva el audio`);
            }
        }
        // 4) programar: YouTube y TikTok para dentro de un instante
        const vertical = r.created.find((o) => o.title === 'Clip vertical 1');
        const soon = new Date(Date.now() + 150).toISOString();
        const s = ctx.pubs.schedule(vertical.id, ['youtube', 'tiktok'], soon);
        strict_1.default.equal(s.scheduled.length, 2);
        await ctx.scheduler.tick(); // todavía no es la hora
        strict_1.default.equal(published.length, 0);
        await (0, helpers_1.sleep)(250);
        await ctx.scheduler.tick();
        await ctx.scheduler.tick();
        await ctx.scheduler.tick();
        const yt = ctx.store.data.publications.find((p) => p.platform === 'youtube');
        const tt = ctx.store.data.publications.find((p) => p.platform === 'tiktok');
        strict_1.default.equal(yt.status, 'published');
        strict_1.default.equal(tt.status, 'scheduled');
        strict_1.default.match(tt.note, /En espera/);
        strict_1.default.equal(published.length, 1, 'YouTube se publicó exactamente una vez');
        strict_1.default.equal(published[0].output.id, vertical.id);
        // 5) reiniciar la app (nuevo contexto sobre los mismos datos): todo persiste y NO se republica
        const again = new context_1.AppContext({
            userDataDir: env.userData,
            defaultOutputDir: env.outputDir,
            cipher: helpers_1.fakeCipher,
            notifier: new helpers_1.RecordingNotifier(),
            publishers,
            schedulerIntervalMs: 3_600_000,
        });
        again.start(); // recupera lo interrumpido y hace una pasada
        await again.scheduler.tick();
        again.stop();
        strict_1.default.equal(again.store.data.vods[0].status, 'downloaded');
        strict_1.default.equal(again.store.data.outputs.length, 4);
        strict_1.default.equal(again.store.data.publications.find((p) => p.platform === 'youtube').status, 'published');
        strict_1.default.equal(published.length, 1, 'tras el reinicio no se vuelve a publicar lo ya publicado');
        // 6) intentar programar otra vez lo ya publicado se omite con explicación
        const again2 = again.pubs.schedule(vertical.id, ['youtube'], new Date(Date.now() + 60_000).toISOString());
        strict_1.default.equal(again2.scheduled.length, 0);
        strict_1.default.match(again2.skipped[0].reason, /ya está publicado/);
        // 7) el log registró el recorrido y no contiene secretos
        const log = node_fs_1.default.readFileSync(node_path_1.default.join(env.userData, 'logs', 'app.log'), 'utf8');
        strict_1.default.match(log, /Descarga completada/);
        strict_1.default.match(log, /Render validado \(vertical\)/);
        strict_1.default.match(log, /Publicado en youtube/);
        env.cleanup();
    });
    (0, node_test_1.it)('si la descarga falla, el VOD queda en error y se puede reintentar sin duplicar', async () => {
        process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'fail', FAKE_DELAY: '1' };
        const env = (0, helpers_1.makeEnv)();
        env.ctx.settings.set({ ytdlpPath: (0, helpers_1.fakeYtdlp)() });
        const url = 'https://www.twitch.tv/videos/999';
        const first = env.ctx.vods.add(url);
        await env.ctx.downloadQueue.idle();
        strict_1.default.equal(first.status, 'error');
        strict_1.default.match(first.error, /403/);
        strict_1.default.equal(env.ctx.store.data.outputs.length, 0);
        process.env = { ...saved, FAKE_SOURCE: source, FAKE_MODE: 'ok', FAKE_DELAY: '1' };
        const second = env.ctx.vods.add(url);
        strict_1.default.notEqual(second.id, first.id);
        await env.ctx.downloadQueue.idle();
        strict_1.default.equal(second.status, 'downloaded');
        strict_1.default.equal(env.ctx.vods.add(url).id, second.id, 'ya descargado: no se vuelve a bajar');
        env.cleanup();
    });
});

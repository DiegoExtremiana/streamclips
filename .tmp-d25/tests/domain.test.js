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
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../shared/types");
const scheduler_1 = require("../electron/domain/scheduler");
const publishers_1 = require("../electron/domain/publishers");
const logger_1 = require("../electron/services/logger");
const store_1 = require("../electron/services/store");
const notifier_1 = require("../electron/domain/notifier");
const publications_1 = require("../electron/domain/publications");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const envs = [];
const mkEnv = (extra = {}) => {
    const e = (0, helpers_1.makeEnv)(extra);
    envs.push(e);
    return e;
};
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
// ───────────────────────────── SettingsService ─────────────────────────────
(0, node_test_1.describe)('SettingsService', () => {
    (0, node_test_1.it)('el secreto de Twitch se guarda cifrado, nunca sale al exterior y el valor enmascarado no lo pisa', () => {
        const e = mkEnv();
        e.ctx.settings.set({ twitch: { clientId: ' cid ', clientSecret: 'super-secreto', login: '@Don_Diegons' } });
        const pub = e.ctx.settings.get();
        strict_1.default.equal(pub.twitch.clientSecret, types_1.MASKED_SECRET);
        strict_1.default.equal(pub.twitch.login, 'don_diegons');
        strict_1.default.equal(pub.twitch.clientId, 'cid');
        const onDisk = node_fs_1.default.readFileSync(node_path_1.default.join(e.userData, 'data.json'), 'utf8');
        strict_1.default.ok(!onDisk.includes('super-secreto'), 'el secreto no debe estar en claro en el disco');
        strict_1.default.match(onDisk, /"clientSecret": "enc:/);
        // reenviar lo que vio la interfaz (máscara) no destruye el secreto
        e.ctx.settings.set({ twitch: { clientSecret: types_1.MASKED_SECRET } });
        strict_1.default.equal(e.ctx.settings.twitchCreds().clientSecret, 'super-secreto');
        // vaciarlo sí lo borra
        e.ctx.settings.set({ twitch: { clientSecret: '' } });
        strict_1.default.equal(e.ctx.settings.get().twitch.clientSecret, '');
    });
    (0, node_test_1.it)('sin cifrado del sistema el secreto sigue sin guardarse en texto plano legible', () => {
        const e = mkEnv({ cipher: helpers_1.noCipher });
        e.ctx.settings.set({ twitch: { clientSecret: 'super-secreto' } });
        strict_1.default.ok(!node_fs_1.default.readFileSync(node_path_1.default.join(e.userData, 'data.json'), 'utf8').includes('super-secreto'));
        strict_1.default.equal(e.ctx.settings.twitchCreds().clientSecret, 'super-secreto');
    });
    (0, node_test_1.it)('es atómico: si una parte del parche es inválida no se aplica nada', () => {
        const e = mkEnv();
        const before = JSON.stringify(e.ctx.settings.get());
        strict_1.default.throws(() => e.ctx.settings.set({ twitch: { clientId: 'nuevo', login: 'no válido!' }, ffmpegPath: '' }), /nombre de canal/);
        strict_1.default.equal(JSON.stringify(e.ctx.settings.get()), before);
        strict_1.default.throws(() => e.ctx.settings.set({ twitch: { clientId: 'nuevo' }, outputDir: 'relativa/ruta' }), /absoluta/);
        strict_1.default.equal(e.ctx.settings.get().twitch.clientId, '');
    });
    (0, node_test_1.it)('valida la carpeta de salida: absoluta, creable, y quita las comillas de Windows', () => {
        const e = mkEnv();
        strict_1.default.throws(() => e.ctx.settings.set({ outputDir: '' }), /vacía/);
        strict_1.default.throws(() => e.ctx.settings.set({ outputDir: 'relativa' }), /absoluta/);
        const target = node_path_1.default.join(e.root, 'nueva', 'carpeta');
        const s = e.ctx.settings.set({ outputDir: `"${target}"` });
        strict_1.default.equal(s.outputDir, target);
        strict_1.default.ok(node_fs_1.default.statSync(target).isDirectory());
        // una ruta imposible (un archivo en medio) falla con mensaje claro
        const file = node_path_1.default.join(e.root, 'archivo.txt');
        node_fs_1.default.writeFileSync(file, 'x');
        strict_1.default.throws(() => e.ctx.settings.set({ outputDir: node_path_1.default.join(file, 'dentro') }), /No se puede escribir/);
    });
    (0, node_test_1.it)('valida las rutas de herramientas: absolutas, existentes y que sean archivos', () => {
        const e = mkEnv();
        strict_1.default.throws(() => e.ctx.settings.set({ ffmpegPath: 'ffmpeg.exe' }), /absoluta/);
        strict_1.default.throws(() => e.ctx.settings.set({ ytdlpPath: '/no/existe/yt-dlp' }), /No existe yt-dlp/);
        strict_1.default.throws(() => e.ctx.settings.set({ ytdlpPath: e.root }), /No existe yt-dlp/); // es una carpeta
        const s = e.ctx.settings.set({ ytdlpPath: `"${(0, helpers_1.fakeYtdlp)()}"` });
        strict_1.default.equal(s.ytdlpPath, (0, helpers_1.fakeYtdlp)());
        strict_1.default.equal(e.ctx.tools().ytdlp, (0, helpers_1.fakeYtdlp)());
        strict_1.default.equal(e.ctx.settings.set({ ytdlpPath: '' }).ytdlpPath, '');
        strict_1.default.equal(e.ctx.tools().ytdlp, 'yt-dlp');
    });
    (0, node_test_1.it)('login vacío borra el canal; sobrevive a un reinicio', () => {
        const e = mkEnv();
        e.ctx.settings.set({ twitch: { login: 'abc', clientId: 'x' } });
        const again = (0, helpers_1.makeEnv)({}, e.root); // mismo disco
        strict_1.default.equal(again.ctx.settings.get().twitch.login, 'abc');
        strict_1.default.equal(again.ctx.settings.set({ twitch: { login: '' } }).twitch.login, '');
    });
});
// ───────────────────────────── VodService ─────────────────────────────
(0, node_test_1.describe)('VodService', () => {
    const URL1 = 'https://www.twitch.tv/videos/111';
    (0, node_test_1.it)('rechaza URLs no válidas sin crear nada en la cola', () => {
        const e = mkEnv();
        for (const bad of ['', '--exec rm -rf /', 'file:///etc/passwd', 'hola', 'https://localhost/x']) {
            strict_1.default.throws(() => e.ctx.vods.add(bad), /URL no es válida/, bad);
        }
        strict_1.default.equal(e.ctx.store.data.vods.length, 0);
    });
    (0, node_test_1.it)('descarga con el flujo en cola -> descargando -> descargado y avisa a la interfaz', async () => {
        const calls = [];
        const e = mkEnv({
            download: async (_t, url, outDir, onProgress) => {
                calls.push(url);
                for (const p of [10, 50, 100])
                    onProgress(p);
                return { title: 'Título real', filePath: node_path_1.default.join(outDir, 'x.mp4') };
            },
        });
        const job = e.ctx.vods.add(URL1, 'Título provisional');
        strict_1.default.equal(job.status, 'queued');
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(job.status, 'downloaded');
        strict_1.default.equal(job.title, 'Título real');
        strict_1.default.equal(job.progress, 100);
        strict_1.default.equal(job.filePath, node_path_1.default.join(e.outputDir, 'vods', 'x.mp4'));
        strict_1.default.deepEqual([...new Set(e.notifier.vodEvents.map((v) => v.status))], ['downloading', 'downloaded']);
        // persistido
        strict_1.default.equal(JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(e.userData, 'data.json'), 'utf8')).vods[0].status, 'downloaded');
        strict_1.default.deepEqual(calls, [URL1]);
    });
    (0, node_test_1.it)('el mismo VOD no se descarga dos veces, pero tras un error se puede reintentar', async () => {
        let n = 0;
        const e = mkEnv({
            download: async (_t, _u, outDir) => {
                n++;
                if (n === 1)
                    throw new Error('403 Forbidden');
                return { title: 't', filePath: node_path_1.default.join(outDir, 'a.mp4') };
            },
        });
        const a = e.ctx.vods.add(URL1);
        const b = e.ctx.vods.add(`${URL1}#t=10`); // mismo VOD (el fragmento no cuenta)
        strict_1.default.equal(a.id, b.id);
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(a.status, 'error');
        strict_1.default.match(a.error, /403/);
        const retry = e.ctx.vods.add(URL1);
        strict_1.default.notEqual(retry.id, a.id);
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(retry.status, 'downloaded');
        strict_1.default.equal(n, 2);
    });
    (0, node_test_1.it)('las descargas van de una en una', async () => {
        let running = 0;
        let max = 0;
        const e = mkEnv({
            download: async (_t, url, outDir) => {
                running++;
                max = Math.max(max, running);
                await (0, helpers_1.sleep)(20);
                running--;
                return { title: url, filePath: node_path_1.default.join(outDir, 'a.mp4') };
            },
        });
        for (const i of [1, 2, 3])
            e.ctx.vods.add(`https://www.twitch.tv/videos/${i}`);
        await e.ctx.downloadQueue.idle();
        strict_1.default.equal(max, 1);
        strict_1.default.ok(e.ctx.store.data.vods.every((v) => v.status === 'downloaded'));
    });
    (0, node_test_1.it)('limita los avisos de progreso (no más de uno por cada 1 %)', async () => {
        const e = mkEnv({
            download: async (_t, _u, outDir, onProgress) => {
                for (let i = 0; i < 2000; i++)
                    onProgress(i / 20); // 2000 actualizaciones de 0 a 100
                return { title: 't', filePath: node_path_1.default.join(outDir, 'a.mp4') };
            },
        });
        e.ctx.vods.add(URL1);
        await e.ctx.downloadQueue.idle();
        strict_1.default.ok(e.notifier.vodEvents.length <= 110, `eventos: ${e.notifier.vodEvents.length}`);
    });
    (0, node_test_1.it)('al arrancar, lo que estaba descargándose se marca como error (no se queda colgado)', () => {
        const e = mkEnv();
        e.ctx.store.data.vods.push({ id: 'a', url: 'u1', title: '', status: 'downloading', progress: 40, createdAt: 'x' }, { id: 'b', url: 'u2', title: '', status: 'queued', progress: 0, createdAt: 'x' }, { id: 'c', url: 'u3', title: '', status: 'downloaded', progress: 100, filePath: '/x', createdAt: 'x' });
        strict_1.default.equal(e.ctx.vods.recoverInterrupted(), 2);
        strict_1.default.deepEqual(e.ctx.store.data.vods.map((v) => v.status), ['error', 'error', 'downloaded']);
        strict_1.default.match(e.ctx.store.data.vods[0].error, /interrumpió/);
        strict_1.default.equal(e.ctx.vods.recoverInterrupted(), 0);
    });
});
// ───────────────────────────── ClipService (ffmpeg real) ─────────────────────────────
(0, node_test_1.describe)('ClipService', () => {
    const tools = (0, tools_1.resolveToolPaths)('', '');
    function withVod(dur = 12) {
        const e = mkEnv();
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(e.outputDir, 'vods', 'src.mp4'), { w: 1280, h: 720, dur });
        const vod = (0, helpers_1.addDownloadedVod)(e, src);
        return { e, vod, src };
    }
    (0, node_test_1.it)('un clip se crea con sus dos versiones (vertical y horizontal), validadas, en su carpeta y registradas', async () => {
        const { e, vod } = withVod();
        const a = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Épico ñ' });
        const b = await e.ctx.clips.createClip(vod.id, { start: 2, end: 6, title: 'Reacción' });
        strict_1.default.equal(a.kind, 'clip');
        strict_1.default.deepEqual(Object.keys(a.files).sort(), ['horizontal', 'vertical']);
        for (const [k, w, hh] of [['vertical', 1080, 1920], ['horizontal', 1920, 1080]]) {
            const f = a.files[k];
            const info = await (0, ffmpeg_1.probe)(tools, f);
            strict_1.default.deepEqual([info.width, info.height], [w, hh], k);
            strict_1.default.ok(Math.abs(info.durationSec - 4) < 1);
            strict_1.default.equal(node_path_1.default.basename(node_path_1.default.dirname(f)), k);
            strict_1.default.ok(f.startsWith(e.outputDir));
        }
        strict_1.default.ok(a.thumbnail && node_fs_1.default.existsSync(a.thumbnail), 'miniatura horizontal');
        strict_1.default.equal(e.ctx.store.data.outputs.length, 2);
        strict_1.default.equal(e.ctx.store.data.outputs[0].id, b.id); // el último, primero
        strict_1.default.ok(e.notifier.changes >= 2);
    });
    (0, node_test_1.it)('se puede pedir una sola versión', async () => {
        const { e, vod } = withVod();
        const v = await e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 1, end: 5, title: 'Solo V' });
        strict_1.default.deepEqual(Object.keys(v.files), ['vertical']);
        const h = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 1, end: 5, title: 'Solo H' });
        strict_1.default.deepEqual(Object.keys(h.files), ['horizontal']);
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'cuadrado', start: 1, end: 5, title: 'x' }), /"both"/);
    });
    (0, node_test_1.it)('si falla una de las dos versiones no queda ninguna (ni archivos sueltos ni registro)', async () => {
        const { e, vod } = withVod();
        // ffmpeg envuelto: todo normal salvo el render vertical, que falla
        const bin = node_path_1.default.join(e.root, 'wrapbin');
        node_fs_1.default.mkdirSync(bin, { recursive: true });
        node_fs_1.default.writeFileSync(node_path_1.default.join(bin, 'ffmpeg'), '#!/bin/sh\ncase "$*" in *"ih*9/16"*) echo "fallo simulado" >&2; exit 1;; esac\nexec ffmpeg "$@"\n', { mode: 0o755 });
        node_fs_1.default.symlinkSync((0, node_child_process_1.execFileSync)('which', ['ffprobe']).toString().trim(), node_path_1.default.join(bin, 'ffprobe'));
        e.ctx.settings.set({ ffmpegPath: node_path_1.default.join(bin, 'ffmpeg') });
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Roto', cropX: 0.5 }), /fallo simulado/);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        for (const d of ['horizontal', 'vertical']) {
            const dir = node_path_1.default.join(e.outputDir, d);
            strict_1.default.deepEqual(node_fs_1.default.existsSync(dir) ? node_fs_1.default.readdirSync(dir) : [], [], `sin restos en ${d}`);
        }
        // con la herramienta arreglada el mismo clip se crea sin problema
        e.ctx.settings.set({ ffmpegPath: '' });
        strict_1.default.equal((await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Roto' })).kind, 'clip');
    });
    (0, node_test_1.it)('por defecto el clip vertical lleva dos ventanas (cámara arriba, pantalla debajo); con cropX explícito, una sola columna', async () => {
        const { e, vod } = withVod();
        const dflt = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Dos ventanas' });
        strict_1.default.equal(dflt.layout?.windows.length, 2);
        strict_1.default.equal(dflt.layout?.preset, 'dos-camara-arriba');
        strict_1.default.ok(dflt.layout.windows[0].dst.y < dflt.layout.windows[1].dst.y, 'la cámara va arriba');
        const crop = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Columna', cropX: 0.2 });
        strict_1.default.equal(crop.layout, undefined);
    });
    (0, node_test_1.it)('rechaza clips no válidos sin renderizar ni registrar nada', async () => {
        const { e, vod } = withVod();
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 5, end: 2, title: 't' }), /Clip no válido: el fin/);
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 500, title: 't' }), /más de 3 minutos/);
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 5, title: 't', cropX: 3 }), /cropX/);
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 10, end: 20, title: 't' }), /después del final del VOD/);
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, null), /no es un objeto/);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        strict_1.default.ok(!node_fs_1.default.existsSync(node_path_1.default.join(e.outputDir, 'vertical')), 'no debe quedar ni la carpeta');
    });
    (0, node_test_1.it)('errores claros si el VOD no existe, no está descargado o se ha borrado del disco', async () => {
        const { e, vod, src } = withVod();
        const spec = { kind: 'horizontal', start: 0, end: 3, title: 't' };
        await strict_1.default.rejects(e.ctx.clips.createClip('no-existe', spec), /El VOD no existe/);
        e.ctx.store.data.vods.unshift({ id: 'pend', url: 'u', title: '', status: 'downloading', progress: 5, createdAt: 'x' });
        await strict_1.default.rejects(e.ctx.clips.createClip('pend', spec), /todavía no está descargado/);
        node_fs_1.default.rmSync(src);
        vod.origin = 'clip'; // un clip de Twitch no se puede volver a descargar como un directo
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, spec), /ya no está en su sitio/);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
    });
    (0, node_test_1.it)('un origen corrupto falla sin dejar basura ni registros', async () => {
        const e = mkEnv();
        const bad = node_path_1.default.join(e.outputDir, 'vods', 'bad.mp4');
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(bad), { recursive: true });
        node_fs_1.default.writeFileSync(bad, 'no soy un vídeo');
        const vod = (0, helpers_1.addDownloadedVod)(e, bad, 'bad');
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 3, title: 't' }));
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
    });
    (0, node_test_1.it)('si el render no supera la validación se borra el archivo y no se registra', async () => {
        const e = mkEnv();
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(e.outputDir, 'vods', 'src.mp4'), { w: 640, h: 360, dur: 6 });
        const vod = (0, helpers_1.addDownloadedVod)(e, src);
        // ffmpeg "falso" que escribe basura y dice que todo fue bien; ffprobe real enlazado al lado
        const bin = node_path_1.default.join(e.root, 'bin');
        node_fs_1.default.mkdirSync(bin);
        node_fs_1.default.writeFileSync(node_path_1.default.join(bin, 'ffmpeg'), '#!/bin/sh\nfor last; do :; done\necho basura > "$last"\n', { mode: 0o755 });
        const realProbe = (await Promise.resolve().then(() => __importStar(require('node:child_process')))).execFileSync('which', ['ffprobe']).toString().trim();
        node_fs_1.default.symlinkSync(realProbe, node_path_1.default.join(bin, 'ffprobe'));
        e.ctx.settings.set({ ffmpegPath: node_path_1.default.join(bin, 'ffmpeg') });
        await strict_1.default.rejects(e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 3, title: 'bueno' }));
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        const left = node_fs_1.default.existsSync(node_path_1.default.join(e.outputDir, 'horizontal')) ? node_fs_1.default.readdirSync(node_path_1.default.join(e.outputDir, 'horizontal')) : [];
        strict_1.default.deepEqual(left, [], 'no debe quedar el archivo que no pasó la validación');
    });
    (0, node_test_1.it)('createLong monta los tramos y valida la duración total', async () => {
        const { e, vod } = withVod();
        const o = await e.ctx.clips.createLong(vod.id, { title: 'Resumen', segments: [{ start: 0, end: 3 }, { start: 6, end: 9 }] });
        strict_1.default.equal(o.kind, 'long');
        const info = await (0, ffmpeg_1.probe)(tools, o.files.long);
        strict_1.default.deepEqual([info.width, info.height], [1920, 1080]);
        strict_1.default.ok(Math.abs(info.durationSec - 6) < 1);
        await strict_1.default.rejects(e.ctx.clips.createLong(vod.id, { title: 'x', segments: [] }), /no tiene tramos/);
        await strict_1.default.rejects(e.ctx.clips.createLong(vod.id, { title: 'x', segments: [{ start: 0, end: 99 }] }), /después del final/);
    });
    (0, node_test_1.it)('applyPlan: lo válido se crea, lo inválido se explica y nada se interrumpe', async () => {
        const { e, vod } = withVod();
        const plan = {
            clips: [
                { kind: 'vertical', start: 0, end: 3, title: 'V1' },
                { kind: 'horizontal', start: 3, end: 6, title: 'H1' },
                { kind: 'vertical', start: 50, end: 60, title: 'Fuera' },
            ],
            long: { title: 'Largo', segments: [{ start: 0, end: 4 }, { start: 6, end: 10 }] },
        };
        const r = await e.ctx.clips.applyPlan(vod.id, JSON.stringify(plan));
        strict_1.default.equal(r.created.length, 3);
        strict_1.default.deepEqual(r.created.map((o) => o.kind).sort(), ['clip', 'clip', 'long']);
        strict_1.default.deepEqual(r.created.map((o) => Object.keys(o.files).sort().join('+')).sort(), ['horizontal', 'long', 'vertical']);
        strict_1.default.equal(r.errors.length, 1);
        strict_1.default.match(r.errors[0], /clip 3.*después del final/);
        await strict_1.default.rejects(e.ctx.clips.applyPlan(vod.id, 'no es json'), /JSON no válido/);
        await strict_1.default.rejects(e.ctx.clips.applyPlan('nada', '{"clips":[]}'), /El VOD no existe/);
    });
    (0, node_test_1.it)('peticiones simultáneas se renderizan de una en una y terminan todas bien', async () => {
        const { e, vod } = withVod();
        const all = await Promise.all([0, 1, 2, 3].map((i) => e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: i, end: i + 2, title: 'mismo título' })));
        strict_1.default.equal(new Set(all.map((o) => o.files.horizontal)).size, 4, 'mismo título, archivos distintos');
        strict_1.default.ok(all.every((o) => node_fs_1.default.existsSync(o.files.horizontal)));
    });
});
// ───────────────────────────── PublicationService ─────────────────────────────
(0, node_test_1.describe)('PublicationService', () => {
    const setup = (now = Date.now()) => {
        const e = mkEnv();
        (0, helpers_1.addOutput)(e, 'o1');
        const n = new helpers_1.RecordingNotifier();
        const svc = new publications_1.PublicationService(e.ctx.store, n, () => now);
        return { e, svc, n, now };
    };
    const at = (now, ms) => new Date(now + ms).toISOString();
    (0, node_test_1.it)('programa una publicación por red con clave única vídeo:red', () => {
        const { svc, now, n } = setup();
        const r = svc.schedule('o1', ['youtube', 'tiktok'], at(now, 3600_000));
        strict_1.default.deepEqual(r.scheduled.map((p) => p.key), ['o1:youtube', 'o1:tiktok']);
        strict_1.default.deepEqual(r.skipped, []);
        strict_1.default.ok(r.scheduled.every((p) => p.status === 'scheduled'));
        strict_1.default.ok(n.changes >= 1);
    });
    (0, node_test_1.it)('reprogramar no duplica: actualiza la misma publicación', () => {
        const { svc, now, e } = setup();
        svc.schedule('o1', ['youtube'], at(now, 3600_000));
        const r = svc.schedule('o1', ['youtube'], at(now, 7200_000));
        strict_1.default.equal(e.ctx.store.data.publications.length, 1);
        strict_1.default.equal(r.scheduled[0].scheduledAt, at(now, 7200_000));
    });
    (0, node_test_1.it)('lo ya publicado o publicándose se omite y se explica; lo fallido se puede reintentar', () => {
        const { svc, now, e } = setup();
        svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 1000));
        const pubs = e.ctx.store.data.publications;
        pubs[0].status = 'published';
        pubs[1].status = 'publishing';
        pubs[2].status = 'failed';
        pubs[2].note = 'boom';
        const r = svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 5000));
        strict_1.default.deepEqual(r.skipped.map((s) => s.platform), ['youtube', 'tiktok']);
        strict_1.default.match(r.skipped[0].reason, /ya está publicado/);
        strict_1.default.match(r.skipped[1].reason, /se está publicando/);
        strict_1.default.equal(pubs[0].status, 'published'); // intacto
        strict_1.default.equal(pubs[2].status, 'scheduled');
        strict_1.default.equal(pubs[2].note, undefined);
    });
    (0, node_test_1.it)('valida vídeo, fecha, redes y no acepta horas pasadas (con 1 minuto de cortesía)', () => {
        const { svc, now } = setup();
        strict_1.default.throws(() => svc.schedule('nada', ['youtube'], at(now, 1000)), /El vídeo no existe/);
        strict_1.default.throws(() => svc.schedule('o1', ['youtube'], 'ayer'), /no válidas/);
        strict_1.default.throws(() => svc.schedule('o1', ['youtube'], at(now, -3600_000)), /ya ha pasado/);
        strict_1.default.doesNotThrow(() => svc.schedule('o1', ['youtube'], at(now, -30_000)));
        strict_1.default.throws(() => svc.schedule('o1', [], at(now, 1000)), /al menos una red/);
        strict_1.default.throws(() => svc.schedule('o1', ['facebook'], at(now, 1000)), /no reconocida/);
    });
    (0, node_test_1.it)('redes repetidas en la petición se cuentan una sola vez', () => {
        const { svc, now } = setup();
        const r = svc.schedule('o1', ['youtube', 'youtube', 'youtube'], at(now, 1000));
        strict_1.default.equal(r.scheduled.length, 1);
    });
    (0, node_test_1.it)('cancel solo quita lo pendiente o fallido', () => {
        const { svc, now, e } = setup();
        svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 1000));
        const pubs = e.ctx.store.data.publications;
        pubs[1].status = 'published';
        pubs[2].status = 'failed';
        strict_1.default.equal(svc.cancel('o1:youtube'), true);
        strict_1.default.equal(svc.cancel('o1:tiktok'), false);
        strict_1.default.equal(svc.cancel('o1:instagram'), true);
        strict_1.default.equal(svc.cancel('no:existe'), false);
        strict_1.default.deepEqual(e.ctx.store.data.publications.map((p) => p.key), ['o1:tiktok']);
    });
});
// ───────────────────────────── Scheduler ─────────────────────────────
(0, node_test_1.describe)('Scheduler', () => {
    function setup(publishers, now = () => Date.now()) {
        const e = mkEnv();
        (0, helpers_1.addOutput)(e, 'o1');
        const log = new logger_1.Logger(node_path_1.default.join(e.root, 'l'));
        const sched = new scheduler_1.Scheduler(e.ctx.store, notifier_1.silentNotifier, log, { ...publishers_1.defaultPublishers, ...publishers }, 3_600_000, now);
        const add = (platform, ms = -1000, status = 'scheduled') => e.ctx.store.data.publications.push({
            key: `o1:${platform}`, outputId: 'o1', platform, status,
            scheduledAt: new Date(Date.now() + ms).toISOString(),
        });
        const get = (platform) => e.ctx.store.data.publications.find((p) => p.platform === platform);
        return { e, sched, add, get };
    }
    const counting = (impl) => {
        const seen = [];
        const pub = { publish: async (o) => { seen.push(o.id); await impl?.(o); } };
        return { pub, seen };
    };
    (0, node_test_1.it)('publica lo vencido una sola vez, aunque haya muchas pasadas', async () => {
        const yt = counting();
        const { sched, add, get } = setup({ youtube: yt.pub });
        add('youtube');
        await sched.tick();
        await sched.tick();
        await sched.tick();
        strict_1.default.equal(get('youtube').status, 'published');
        strict_1.default.deepEqual(yt.seen, ['o1']);
    });
    (0, node_test_1.it)('no toca lo que aún no ha llegado su hora', async () => {
        const yt = counting();
        const { sched, add, get } = setup({ youtube: yt.pub });
        add('youtube', 3600_000);
        await sched.tick();
        strict_1.default.equal(get('youtube').status, 'scheduled');
        strict_1.default.equal(yt.seen.length, 0);
    });
    (0, node_test_1.it)('usa el reloj inyectado: publica exactamente cuando llega la hora', async () => {
        let now = 1_000_000;
        const yt = counting();
        const { sched, e } = setup({ youtube: yt.pub }, () => now);
        e.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'scheduled', scheduledAt: new Date(now + 60_000).toISOString() });
        await sched.tick();
        strict_1.default.equal(yt.seen.length, 0);
        now += 60_000;
        await sched.tick();
        strict_1.default.equal(yt.seen.length, 1);
    });
    (0, node_test_1.it)('un error real marca fallida con el motivo y NO se reintenta sola', async () => {
        let calls = 0;
        const { sched, add, get } = setup({
            tiktok: { publish: async () => { calls++; throw new Error('TikTok: spam_risk_too_many_posts'); } },
        });
        add('tiktok');
        await sched.tick();
        await sched.tick();
        strict_1.default.equal(get('tiktok').status, 'failed');
        strict_1.default.match(get('tiktok').note, /spam_risk/);
        strict_1.default.equal(calls, 1);
    });
    (0, node_test_1.it)('red no conectada: queda en espera con nota y se publica en cuanto se conecta', async () => {
        let connected = false;
        const seen = [];
        const { sched, add, get } = setup({
            instagram: {
                publish: async (o) => {
                    if (!connected)
                        throw new publishers_1.NotConnectedError('Instagram aún no está conectado');
                    seen.push(o.id);
                },
            },
        });
        add('instagram');
        await sched.tick();
        strict_1.default.equal(get('instagram').status, 'scheduled');
        strict_1.default.match(get('instagram').note, /En espera/);
        connected = true;
        await sched.tick();
        strict_1.default.equal(get('instagram').status, 'published');
        strict_1.default.deepEqual(seen, ['o1']);
    });
    (0, node_test_1.it)('las publicaciones por defecto (sin conectores reales) se quedan en espera, no fallan', async () => {
        const { sched, add, get } = setup({});
        add('youtube');
        await sched.tick();
        strict_1.default.equal(get('youtube').status, 'scheduled');
        strict_1.default.match(get('youtube').note, /aún no está conectado/);
    });
    (0, node_test_1.it)('si el vídeo ya no existe, falla con un motivo claro', async () => {
        const yt = counting();
        const { sched, add, get, e } = setup({ youtube: yt.pub });
        add('youtube');
        e.ctx.store.data.outputs = [];
        await sched.tick();
        strict_1.default.equal(get('youtube').status, 'failed');
        strict_1.default.match(get('youtube').note, /ya no existe/);
        strict_1.default.equal(yt.seen.length, 0);
    });
    (0, node_test_1.it)('dos pasadas simultáneas no publican dos veces', async () => {
        const yt = counting(() => (0, helpers_1.sleep)(60));
        const { sched, add } = setup({ youtube: yt.pub });
        add('youtube');
        await Promise.all([sched.tick(), sched.tick(), sched.tick()]);
        strict_1.default.equal(yt.seen.length, 1);
    });
    (0, node_test_1.it)('el estado "publicando" se guarda en disco ANTES de llamar a la red', async () => {
        let statusOnDiskDuringCall = '';
        const { sched, add, e } = setup({
            youtube: {
                publish: async () => {
                    const disk = new store_1.Store(e.userData, e.outputDir);
                    statusOnDiskDuringCall = disk.data.publications[0].status;
                },
            },
        });
        add('youtube');
        e.ctx.store.save();
        await sched.tick();
        strict_1.default.equal(statusOnDiskDuringCall, 'publishing');
    });
    (0, node_test_1.it)('tras un cierre a mitad de publicación, al arrancar se marca fallida y no se reenvía', async () => {
        const yt = counting();
        const { sched, add, get } = setup({ youtube: yt.pub });
        add('youtube', -1000, 'publishing'); // se quedó así al cerrar la app
        strict_1.default.equal(sched.recoverInterrupted(), 1);
        await sched.tick();
        strict_1.default.equal(get('youtube').status, 'failed');
        strict_1.default.match(get('youtube').note, /Interrumpida/);
        strict_1.default.equal(yt.seen.length, 0, 'jamás se reintenta automáticamente');
    });
    (0, node_test_1.it)('start() publica lo vencido y el temporizador sigue revisando; stop() lo detiene', async () => {
        const yt = counting();
        const e = mkEnv();
        (0, helpers_1.addOutput)(e, 'o1');
        const sched = new scheduler_1.Scheduler(e.ctx.store, notifier_1.silentNotifier, new logger_1.Logger(node_path_1.default.join(e.root, 'l')), { ...publishers_1.defaultPublishers, youtube: yt.pub }, 25);
        e.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'scheduled', scheduledAt: new Date(Date.now() - 5).toISOString() });
        sched.start();
        await (0, helpers_1.sleep)(80);
        strict_1.default.equal(yt.seen.length, 1);
        // algo programado más tarde lo recoge el temporizador
        e.ctx.store.data.publications.push({ key: 'o1:tiktok', outputId: 'o1', platform: 'tiktok', status: 'scheduled', scheduledAt: new Date(Date.now() + 40).toISOString() });
        sched.stop();
        await (0, helpers_1.sleep)(120);
        strict_1.default.equal(e.ctx.store.data.publications[1].status, 'scheduled', 'detenido: ya no publica');
    });
});
(0, node_test_1.describe)('arranque sin tocar disco ajeno', () => {
    (0, node_test_1.it)('AppContext.start recupera descargas y publicaciones interrumpidas', () => {
        const root = (0, helpers_1.tmpDir)();
        try {
            const e1 = (0, helpers_1.makeEnv)({}, root);
            (0, helpers_1.addOutput)(e1, 'o1');
            e1.ctx.store.data.vods.push({ id: 'v', url: 'u', title: '', status: 'downloading', progress: 3, createdAt: 'x' });
            e1.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'publishing', scheduledAt: new Date().toISOString() });
            e1.ctx.store.save();
            const e2 = (0, helpers_1.makeEnv)({}, root); // "reinicio"
            e2.ctx.start();
            e2.ctx.stop();
            strict_1.default.equal(e2.ctx.store.data.vods[0].status, 'error');
            strict_1.default.equal(e2.ctx.store.data.publications[0].status, 'failed');
        }
        finally {
            (0, helpers_1.rmDir)(root);
        }
    });
});

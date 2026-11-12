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
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const types_1 = require("../shared/types");
const plan_1 = require("../shared/plan");
const claudePrompt_1 = require("../shared/claudePrompt");
const register_1 = require("../electron/ipc/register");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const helpers_1 = require("./helpers");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
let root;
let black;
(0, node_test_1.before)(() => {
    root = (0, helpers_1.tmpDir)();
    black = node_path_1.default.join(root, 'black.mp4');
    (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=14', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=14', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', black]);
});
(0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
const TRANSCRIPT = JSON.stringify({
    words: [
        { text: 'Hola', start: 1, end: 1.4 }, { text: 'a', start: 1.4, end: 1.5 }, { text: 'todos', start: 1.5, end: 2 },
        { text: 'esto', start: 8, end: 8.3 }, { text: 'es', start: 8.3, end: 8.5 }, { text: 'increíble', start: 8.5, end: 9.3 },
    ],
});
function env() {
    const e = (0, helpers_1.makeEnv)();
    envs.push(e);
    const vod = (0, helpers_1.addDownloadedVod)(e, black);
    return { e, vod };
}
function importTo(e, vodId, content = TRANSCRIPT, name = 't.json') {
    const f = node_path_1.default.join(e.root, name);
    node_fs_1.default.writeFileSync(f, content);
    return e.ctx.transcripts.importFile(vodId, f);
}
function brightBottom(file, at) {
    const W = 192;
    const H = 108;
    const buf = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
    let n = 0;
    for (let y = Math.floor(H * 0.7); y < H; y++)
        for (let x = 0; x < W; x++)
            if (buf[y * W + x] > 150)
                n++;
    return n / (H * 0.3 * W);
}
(0, node_test_1.describe)('transcripciones: importar', () => {
    (0, node_test_1.it)('importa, guarda las palabras y anota los datos en el VOD', () => {
        const { e, vod } = env();
        const v = importTo(e, vod.id);
        strict_1.default.equal(v.transcript?.words, 6);
        strict_1.default.equal(v.transcript?.source, 'import');
        strict_1.default.equal(e.ctx.transcripts.words(vod.id).length, 6);
        strict_1.default.ok(e.notifier.changes > 0);
    });
    (0, node_test_1.it)('sobrevive a reiniciar: se lee de disco', () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        strict_1.default.equal(e.ctx.transcripts.words(vod.id)[0].text, 'Hola');
    });
    (0, node_test_1.it)('un archivo malo no pisa la transcripción buena', () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        strict_1.default.throws(() => importTo(e, vod.id, 'esto no es una transcripción', 'mala.txt'), /Formato no reconocido/);
        strict_1.default.equal(e.ctx.transcripts.words(vod.id).length, 6);
        strict_1.default.equal(e.ctx.store.data.vods[0].transcript?.words, 6);
    });
    (0, node_test_1.it)('errores claros: VOD inexistente, archivo inexistente', () => {
        const { e, vod } = env();
        strict_1.default.throws(() => e.ctx.transcripts.importFile('nada', '/x.json'), /VOD no existe/);
        strict_1.default.throws(() => e.ctx.transcripts.importFile(vod.id, '/no/existe.json'), /no existe/);
    });
    (0, node_test_1.it)('words() devuelve vacío sin transcripción o con el archivo roto', () => {
        const { e, vod } = env();
        strict_1.default.deepEqual(e.ctx.transcripts.words(vod.id), []);
        importTo(e, vod.id);
        const dir = node_path_1.default.join(e.userData, 'transcripts');
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, node_fs_1.default.readdirSync(dir)[0]), '{roto');
        strict_1.default.deepEqual(e.ctx.transcripts.words(vod.id), []);
    });
});
(0, node_test_1.describe)('transcripciones: Whisper (whisper.cpp)', () => {
    function withWhisper(mode = 'ok') {
        const x = env();
        const log = node_path_1.default.join(x.e.root, 'whisper.log');
        process.env.FAKE_MODE = mode;
        process.env.FAKE_LOG = log;
        x.e.ctx.settings.set({ whisperPath: (0, helpers_1.fakeWhisper)(), whisperModel: 'tiny', whisperLanguage: 'es' });
        (0, helpers_1.installFakeModel)(x.e, 'tiny');
        return { ...x, log };
    }
    (0, node_test_1.afterEach)(() => {
        delete process.env.FAKE_MODE;
        delete process.env.FAKE_LOG;
    });
    (0, node_test_1.it)('trocea el audio, llama a whisper-cli con los argumentos esperados y suma el desfase de cada trozo', async () => {
        const { e, vod, log } = withWhisper();
        // el VOD de prueba dura 14 s: con trozos de 5 s salen 3
        const words = await (await Promise.resolve().then(() => __importStar(require('../electron/services/whisper')))).transcribeVideo(e.ctx.tools(), vod.filePath, { exe: (0, helpers_1.fakeWhisper)(), model: node_path_1.default.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 5, threads: 2, jobs: 1 });
        const lines = node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        strict_1.default.equal(lines.length, 3);
        strict_1.default.match(lines[0][lines[0].indexOf('-f') + 1], /c0\.wav$/);
        strict_1.default.deepEqual([lines[0][lines[0].indexOf('-l') + 1], lines[0][lines[0].indexOf('-t') + 1]], ['es', '2']);
        for (const f of ['-oj', '-ml', '-sow', '-pp'])
            strict_1.default.ok(lines[0].includes(f), `falta ${f}`);
        strict_1.default.deepEqual([lines[0][lines[0].indexOf('-bs') + 1], lines[0][lines[0].indexOf('-bo') + 1]], ['1', '1'], 'decodificación voraz (mucho más rápida que el haz de 5 por defecto)');
        // sin [BLANK_AUDIO] ni (música), con el desfase de cada trozo
        strict_1.default.deepEqual(words.map((w) => w.text), ['Hola', 'a', 'todos.', 'trozo0', 'Hola', 'a', 'todos.', 'trozo1', 'Hola', 'a', 'todos.', 'trozo2']);
        strict_1.default.equal(words[0].start, 1);
        strict_1.default.equal(words[4].start, 6);
        strict_1.default.equal(words[8].start, 11);
    });
    (0, node_test_1.it)('varios trozos a la vez: mismo resultado y mismo orden que de uno en uno', async () => {
        const { e, vod, log } = withWhisper();
        const { transcribeVideo } = await Promise.resolve().then(() => __importStar(require('../electron/services/whisper')));
        const o = { exe: (0, helpers_1.fakeWhisper)(), model: node_path_1.default.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 5 };
        const par = await transcribeVideo(e.ctx.tools(), vod.filePath, { ...o, jobs: 3, threads: 1 });
        strict_1.default.equal(node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').length, 3);
        node_fs_1.default.rmSync(log);
        const seq = await transcribeVideo(e.ctx.tools(), vod.filePath, { ...o, jobs: 1, threads: 1 });
        strict_1.default.deepEqual(par, seq);
        strict_1.default.deepEqual(par.map((w) => w.text).filter((t) => t.startsWith('trozo')), ['trozo0', 'trozo1', 'trozo2']);
    });
    (0, node_test_1.it)('pausar y retomar: los trozos terminados se guardan y al repetir solo se hacen los que faltan', async () => {
        const { e, vod, log } = withWhisper();
        const { transcribeVideo } = await Promise.resolve().then(() => __importStar(require('../electron/services/whisper')));
        const ck = node_path_1.default.join(e.root, 'parcial');
        const o = { exe: (0, helpers_1.fakeWhisper)(), model: node_path_1.default.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 5, jobs: 1, threads: 1, checkpointDir: ck };
        const all = await transcribeVideo(e.ctx.tools(), vod.filePath, o);
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(ck).filter((f) => /^c\d+\.json$/.test(f)).sort(), ['c0.json', 'c1.json', 'c2.json']);
        // se «pierde» el trozo 1 (el equipo se apagó antes de terminarlo)
        node_fs_1.default.rmSync(node_path_1.default.join(ck, 'c1.json'));
        node_fs_1.default.rmSync(log);
        const again = await transcribeVideo(e.ctx.tools(), vod.filePath, o);
        const calls = node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        strict_1.default.equal(calls.length, 1, 'solo se rehace el trozo que faltaba');
        strict_1.default.match(calls[0][calls[0].indexOf('-f') + 1], /c1\.wav$/);
        strict_1.default.deepEqual(again, all, 'el resultado es idéntico al de una sola pasada');
        // otro idioma u otro modelo: lo guardado ya no vale
        node_fs_1.default.rmSync(log);
        await transcribeVideo(e.ctx.tools(), vod.filePath, { ...o, language: 'en' });
        strict_1.default.equal(node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').length, 3);
    });
    (0, node_test_1.it)('mide la velocidad de Whisper en este equipo para estimar tiempos (por modelo)', async () => {
        const { e, vod } = withWhisper();
        strict_1.default.equal(e.ctx.store.data.stats.transcribeRatio.tiny, undefined);
        strict_1.default.ok(e.ctx.transcripts.ratio('tiny') > 0, 'antes de medir hay una estimación gruesa');
        await e.ctx.transcripts.transcribe(vod.id);
        const r = e.ctx.store.data.stats.transcribeRatio.tiny;
        strict_1.default.ok(r > 0 && r < 1000, `ratio ${r}`);
        strict_1.default.equal(e.ctx.transcripts.ratio('tiny'), r);
    });
    (0, node_test_1.it)('al terminar la transcripción completa no queda la carpeta de trozos', async () => {
        const { e, vod } = withWhisper();
        await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(node_fs_1.default.existsSync(e.ctx.transcripts.checkpointDir(vod.id)), false);
        strict_1.default.equal(e.ctx.transcripts.hasCheckpoint(vod.id), false);
    });
    (0, node_test_1.it)('cancelar a media transcripción detiene Whisper y no deja procesos ni trozos', async () => {
        const { e, vod } = withWhisper();
        const { transcribeVideo } = await Promise.resolve().then(() => __importStar(require('../electron/services/whisper')));
        const { withAbort, isCancelled } = await Promise.resolve().then(() => __importStar(require('../electron/services/abort')));
        const ctrl = new AbortController();
        const p = withAbort(ctrl.signal, () => transcribeVideo(e.ctx.tools(), vod.filePath, { exe: (0, helpers_1.fakeWhisper)(), model: node_path_1.default.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 5, jobs: 2, threads: 1 }));
        ctrl.abort();
        await strict_1.default.rejects(p, (err) => isCancelled(err));
    });
    (0, node_test_1.it)('transcribeVideo con tramo: solo ese trozo del audio, con los tiempos del vídeo completo', async () => {
        const { e, vod, log } = withWhisper();
        const words = await (await Promise.resolve().then(() => __importStar(require('../electron/services/whisper')))).transcribeVideo(e.ctx.tools(), vod.filePath, {
            exe: (0, helpers_1.fakeWhisper)(), model: node_path_1.default.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 20, range: { start: 4, end: 9 },
        });
        strict_1.default.equal(node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').length, 1, 'un solo trozo');
        strict_1.default.equal(words[0].text, 'Hola');
        strict_1.default.equal(words[0].start, 5, '4 s del tramo + 1 s dentro del trozo');
    });
    (0, node_test_1.it)('ensure con tramos: transcribe SOLO esos tramos (parcial), no repite lo ya hecho y deja claro que no es el directo entero', async () => {
        const { e, vod, log } = withWhisper();
        const calls = () => node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length;
        await e.ctx.transcripts.ensure(vod.id, [{ start: 2, end: 6 }]);
        strict_1.default.equal(calls(), 1);
        strict_1.default.equal(e.ctx.store.data.vods[0].transcript?.partial, true);
        strict_1.default.equal(e.ctx.transcripts.isFull(vod.id), false);
        const w = e.ctx.transcripts.words(vod.id);
        strict_1.default.ok(w.length > 0 && w.every((x) => x.start >= 0.5 && x.start < 7.5), JSON.stringify(w));
        await e.ctx.transcripts.ensure(vod.id, [{ start: 2.5, end: 5 }]);
        strict_1.default.equal(calls(), 1, 'un tramo ya transcrito no se repite');
        await e.ctx.transcripts.ensure(vod.id, [{ start: 9, end: 12 }]);
        strict_1.default.equal(calls(), 2, 'otro tramo se añade');
        strict_1.default.ok(e.ctx.transcripts.words(vod.id).some((x) => x.start >= 9), 'las palabras nuevas se suman a las anteriores');
        strict_1.default.ok(e.ctx.transcripts.words(vod.id).some((x) => x.start < 7), 'y no se pierden las anteriores');
        // la transcripción completa sustituye a la parcial y desde entonces no hace falta nada más
        await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(e.ctx.transcripts.isFull(vod.id), true);
        strict_1.default.equal(e.ctx.store.data.vods[0].transcript?.partial, undefined);
        const before = calls();
        await e.ctx.transcripts.ensure(vod.id, [{ start: 1, end: 13 }]);
        strict_1.default.equal(calls(), before);
    });
    (0, node_test_1.it)('un clip con subtítulos en un VOD sin transcripción transcribe solo el propio clip', async () => {
        const { e, vod, log } = withWhisper();
        const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 2, end: 8, title: 'Con subs', subtitles: 'clasico' });
        strict_1.default.equal(clip.kind, 'clip');
        const lines = node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
        strict_1.default.equal(lines.length, 1);
        strict_1.default.equal(e.ctx.store.data.vods[0].transcript?.partial, true, 'no se transcribió el directo entero');
    });
    (0, node_test_1.it)('si el whisper-cli principal usa instrucciones que el procesador no tiene, usa el básico y lo recuerda', async () => {
        const { e, vod, log } = withWhisper('sigill');
        const bin = node_path_1.default.join(e.root, 'wbin');
        node_fs_1.default.mkdirSync(bin, { recursive: true });
        for (const n of ['whisper-cli', 'whisper-cli-basic']) {
            node_fs_1.default.copyFileSync((0, helpers_1.fakeWhisper)(), node_path_1.default.join(bin, n));
            node_fs_1.default.chmodSync(node_path_1.default.join(bin, n), 0o755);
        }
        e.ctx.settings.set({ whisperPath: node_path_1.default.join(bin, 'whisper-cli') });
        const v = await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(v.transcript?.source, 'whisper');
        strict_1.default.ok(e.ctx.transcripts.words(vod.id).length > 0);
        const calls = () => node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length;
        const first = calls();
        strict_1.default.equal(first, 2, 'intento con el principal (falla) y después con el básico');
        await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(calls(), first + 1, 'la segunda vez va directo al básico');
    });
    (0, node_test_1.it)('sin versión básica, un fallo de instrucción ilegal llega como error', async () => {
        const { e, vod } = withWhisper('sigill');
        const bin = node_path_1.default.join(e.root, 'wbin2');
        node_fs_1.default.mkdirSync(bin, { recursive: true });
        node_fs_1.default.copyFileSync((0, helpers_1.fakeWhisper)(), node_path_1.default.join(bin, 'whisper-cli'));
        node_fs_1.default.chmodSync(node_path_1.default.join(bin, 'whisper-cli'), 0o755);
        e.ctx.settings.set({ whisperPath: node_path_1.default.join(bin, 'whisper-cli') });
        await strict_1.default.rejects(() => e.ctx.transcripts.transcribe(vod.id), /Illegal instruction|132/i);
    });
    (0, node_test_1.it)('guarda la transcripción en el VOD y avisa del avance', async () => {
        const { e, vod } = withWhisper();
        const v = await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(v.transcript?.source, 'whisper');
        strict_1.default.equal(v.transcript?.words, 4);
        strict_1.default.deepEqual(e.ctx.transcripts.words(vod.id).map((w) => w.text), ['Hola', 'a', 'todos.', 'trozo0']);
        const t = e.notifier.tasks.filter((x) => x.kind === 'transcribe');
        strict_1.default.ok(t.some((x) => x.status === 'running' && x.progress > 0 && x.progress < 100), 'debe haber avance intermedio');
        strict_1.default.equal(t[t.length - 1].status, 'done');
    });
    (0, node_test_1.it)('sin idioma configurado usa detección automática', async () => {
        const { e, vod, log } = withWhisper();
        e.ctx.settings.set({ whisperLanguage: '' });
        await e.ctx.transcripts.transcribe(vod.id);
        const args = JSON.parse(node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n')[0]);
        strict_1.default.equal(args[args.indexOf('-l') + 1], 'auto');
    });
    (0, node_test_1.it)('sin whisper-cli explica qué hacer', async () => {
        const { e, vod } = env();
        await strict_1.default.rejects(() => e.ctx.transcripts.transcribe(vod.id), /No se encuentra Whisper/);
    });
    (0, node_test_1.it)('si whisper-cli falla, el error llega, la tarea queda en error y no se guarda nada', async () => {
        const { e, vod } = withWhisper('fail');
        await strict_1.default.rejects(() => e.ctx.transcripts.transcribe(vod.id), /código 1[\s\S]*failed to load model/);
        strict_1.default.equal(e.ctx.store.data.vods[0].transcript, undefined);
        strict_1.default.equal(e.notifier.tasks.filter((x) => x.kind === 'transcribe').pop()?.status, 'error');
    });
    (0, node_test_1.it)('con el modelo dañado («unknown tensor», código 3) lo borra, lo vuelve a descargar y transcribe', async () => {
        const http = await Promise.resolve().then(() => __importStar(require('node:http')));
        const srv = http.createServer((_q, res) => res.writeHead(200, { 'content-length': 71_000_000 }).end(Buffer.alloc(71_000_000)));
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${srv.address().port}`;
        try {
            const e2 = (0, helpers_1.makeEnv)({ modelBaseUrl: base });
            const vod = (0, helpers_1.addDownloadedVod)(e2, black);
            process.env.FAKE_MODE = 'ok';
            process.env.FAKE_LOG = node_path_1.default.join(e2.root, 'w.log');
            e2.ctx.settings.set({ whisperPath: (0, helpers_1.fakeWhisper)(), whisperModel: 'tiny', whisperLanguage: 'es' });
            const bad = (0, helpers_1.installFakeModel)(e2, 'tiny');
            node_fs_1.default.writeFileSync(bad, Buffer.concat([Buffer.from('BAD!'), Buffer.alloc(71_000_000)]));
            const v = await e2.ctx.transcripts.transcribe(vod.id);
            strict_1.default.equal(v.transcript?.source, 'whisper');
            strict_1.default.notEqual(node_fs_1.default.readFileSync(bad).subarray(0, 4).toString('latin1'), 'BAD!', 'el modelo dañado debe haberse sustituido');
            e2.cleanup();
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('si el modelo sigue dañado tras descargarlo otra vez, lo explica y sugiere otro modelo', async () => {
        const http = await Promise.resolve().then(() => __importStar(require('node:http')));
        const bad = Buffer.concat([Buffer.from('BAD!'), Buffer.alloc(71_000_000)]);
        const srv = http.createServer((_q, res) => res.writeHead(200, { 'content-length': bad.length }).end(bad));
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const base = `http://127.0.0.1:${srv.address().port}`;
        try {
            const e2 = (0, helpers_1.makeEnv)({ modelBaseUrl: base });
            const vod = (0, helpers_1.addDownloadedVod)(e2, black);
            process.env.FAKE_MODE = 'ok';
            e2.ctx.settings.set({ whisperPath: (0, helpers_1.fakeWhisper)(), whisperModel: 'tiny', whisperLanguage: 'es' });
            node_fs_1.default.writeFileSync((0, helpers_1.installFakeModel)(e2, 'tiny'), bad);
            await strict_1.default.rejects(() => e2.ctx.transcripts.transcribe(vod.id), /ni tras descargarlo de nuevo[\s\S]*otro modelo/);
            strict_1.default.equal(e2.notifier.tasks.filter((t) => t.kind === 'transcribe').pop()?.status, 'error');
            e2.cleanup();
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('sin archivo de salida, sin palabras o con JSON roto, lo dice', async () => {
        const a = withWhisper('nofile');
        await strict_1.default.rejects(() => a.e.ctx.transcripts.transcribe(a.vod.id), /no generó/);
        const b = withWhisper('empty');
        await strict_1.default.rejects(() => b.e.ctx.transcripts.transcribe(b.vod.id), /ninguna palabra/);
        const c = withWhisper('garbage');
        await strict_1.default.rejects(() => c.e.ctx.transcripts.transcribe(c.vod.id), /no es JSON válido/);
    });
    (0, node_test_1.it)('no deja archivos temporales', async () => {
        const { e, vod } = withWhisper();
        const count = () => node_fs_1.default.readdirSync(node_os_1.default.tmpdir()).filter((n) => n.startsWith('streamclips-whisper-')).length;
        const before = count();
        await e.ctx.transcripts.transcribe(vod.id);
        strict_1.default.equal(count(), before);
    });
    (0, node_test_1.it)('estado: motor, modelo y tamaño', () => {
        const { e } = env();
        strict_1.default.deepEqual(e.ctx.transcripts.status(), { engine: false, model: 'small', modelInstalled: false, modelApproxMb: 488 });
        e.ctx.settings.set({ whisperPath: (0, helpers_1.fakeWhisper)(), whisperModel: 'tiny' });
        (0, helpers_1.installFakeModel)(e, 'tiny');
        strict_1.default.deepEqual(e.ctx.transcripts.status(), { engine: true, model: 'tiny', modelInstalled: true, modelApproxMb: 78 });
    });
    (0, node_test_1.it)('los ajustes de Whisper se validan', () => {
        const { e } = env();
        strict_1.default.throws(() => e.ctx.settings.set({ whisperPath: 'whisper.exe' }), /absoluta/);
        strict_1.default.throws(() => e.ctx.settings.set({ whisperModel: 'a b;c' }), /modelo/);
        strict_1.default.throws(() => e.ctx.settings.set({ whisperLanguage: 'español' }), /idioma/);
        strict_1.default.equal(e.ctx.settings.set({ whisperLanguage: 'EN' }).whisperLanguage, 'en');
        strict_1.default.equal(e.ctx.settings.get().whisperModel, 'small');
    });
});
(0, node_test_1.describe)('prompt para Claude', () => {
    (0, node_test_1.it)('incluye la transcripción con tiempos y el ejemplo de plan', () => {
        const words = [{ text: 'Hola', start: 61, end: 62 }];
        const p = (0, claudePrompt_1.buildClaudePrompt)('Mi directo', 3600, words);
        strict_1.default.match(p, /"Mi directo"/);
        strict_1.default.match(p, /Dura 3600 segundos/);
        strict_1.default.match(p, /\[01:01\] Hola/);
        strict_1.default.match(p, /"cuts"/);
        strict_1.default.match(p, /"punch"/);
    });
    (0, node_test_1.it)('el plan de ejemplo del prompt es válido para el propio programa', () => {
        const { plan, errors } = (0, plan_1.parsePlan)(JSON.stringify(claudePrompt_1.PROMPT_EXAMPLE), 5000);
        strict_1.default.deepEqual(errors, []);
        strict_1.default.equal(plan.clips.length, 1);
        strict_1.default.ok(plan.long);
    });
    (0, node_test_1.it)('sin transcripción da un error útil', () => {
        const { e, vod } = env();
        strict_1.default.throws(() => e.ctx.transcripts.claudePrompt(vod.id), /no hay transcripción de este tramo|no tiene transcripción/i);
        importTo(e, vod.id);
        strict_1.default.match(e.ctx.transcripts.claudePrompt(vod.id, 14), /Hola a todos/);
    });
});
(0, node_test_1.describe)('clips con cortes, efectos y subtítulos', () => {
    (0, node_test_1.it)('un clip con subtítulos sale con texto grabado en las dos versiones y guarda el estilo', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Con subtítulos', subtitles: 'clasico' });
        strict_1.default.equal(clip.subtitles, 'clasico');
        strict_1.default.ok(clip.files.horizontal && clip.files.vertical);
        strict_1.default.ok(brightBottom(clip.files.horizontal, 1.5) > 0.004, 'horizontal sin texto');
        strict_1.default.ok(brightBottom(clip.files.vertical, 1.5) > 0.004, 'vertical sin texto');
        strict_1.default.ok(brightBottom(clip.files.horizontal, 3.5) < 0.0005, 'texto fuera de su momento');
    });
    (0, node_test_1.it)('sin subtítulos (lo habitual) el vídeo sale limpio y sin campo de estilo', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Limpio' });
        strict_1.default.equal(clip.subtitles, undefined);
        strict_1.default.ok(brightBottom(clip.files.horizontal, 1.5) < 0.0005);
    });
    (0, node_test_1.it)('pedir subtítulos sin transcripción falla sin dejar archivos ni registros', async () => {
        const { e, vod } = env();
        await strict_1.default.rejects(() => e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'x', subtitles: 'karaoke' }), /no hay transcripción de este tramo|no tiene transcripción/i);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        const left = node_fs_1.default.existsSync(node_path_1.default.join(e.outputDir, 'horizontal')) ? node_fs_1.default.readdirSync(node_path_1.default.join(e.outputDir, 'horizontal')) : [];
        strict_1.default.deepEqual(left, []);
    });
    (0, node_test_1.it)('pedir subtítulos en un tramo sin palabras falla con un mensaje claro', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        await strict_1.default.rejects(() => e.ctx.clips.createClip(vod.id, { start: 11, end: 14, title: 'x', subtitles: 'clasico' }), /ninguna palabra en este tramo/);
    });
    (0, node_test_1.it)('cortes: la duración final es la de lo conservado y los cortes se guardan', async () => {
        const { e, vod } = env();
        const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 10, title: 'Cortado', cuts: [{ start: 3, end: 6 }] });
        strict_1.default.ok(Math.abs(clip.durationSec - 7) < 0.6, String(clip.durationSec));
        strict_1.default.deepEqual(clip.cuts, [{ start: 3, end: 6 }]);
    });
    (0, node_test_1.it)('cortes + subtítulos: la frase sigue a su audio tras el corte', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        // "esto es increíble" va de 8.0 a 9.3; quitando 2..5 sale 3 s antes (a 5.0..6.3)
        const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 12, title: 'Sync', cuts: [{ start: 2, end: 5 }], subtitles: 'clasico' });
        strict_1.default.ok(brightBottom(clip.files.horizontal, 5.6) > 0.004);
        strict_1.default.ok(brightBottom(clip.files.horizontal, 8.6) < 0.0005, 'no debe quedar en la posición sin recolocar');
    });
    (0, node_test_1.it)('efectos válidos se renderizan y se guardan; uno mal puesto se rechaza antes de renderizar', async () => {
        const { e, vod } = env();
        const ok = await e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 8, title: 'Fx', effects: [{ type: 'punch', at: 3 }, { type: 'fadeOut' }] });
        strict_1.default.equal(ok.effects?.length, 2);
        await strict_1.default.rejects(() => e.ctx.clips.createClip(vod.id, { start: 0, end: 8, title: 'x', effects: [{ type: 'punch', at: 99 }] }), /fuera del clip/);
    });
    (0, node_test_1.it)('vídeo largo con subtítulos', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 3 }, { start: 7, end: 11 }], subtitles: 'minimal' });
        strict_1.default.equal(long.subtitles, 'minimal');
        strict_1.default.ok(brightBottom(long.files.long, 1.5) > 0.001);
        strict_1.default.ok(brightBottom(long.files.long, 0.5) < 0.0005);
        const info = await (0, ffmpeg_1.probe)({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: '' }, long.files.long);
        strict_1.default.equal(info.width, 1920);
    });
    (0, node_test_1.it)('applyPlan acepta cortes, efectos y subtítulos del JSON de Claude', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const plan = { clips: [{ kind: 'horizontal', start: 0, end: 10, title: 'Plan', cuts: [{ start: 3, end: 6 }], effects: [{ type: 'fadeIn' }], subtitles: 'karaoke' }] };
        const r = await e.ctx.clips.applyPlan(vod.id, JSON.stringify(plan));
        strict_1.default.deepEqual(r.errors, []);
        strict_1.default.equal(r.created[0].subtitles, 'karaoke');
    });
});
(0, node_test_1.describe)('reedición: activar, cambiar y quitar subtítulos', () => {
    (0, node_test_1.it)('se activan, cambian de estilo y se quitan; cada paso sustituye a los archivos anteriores', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Reed' });
        const first = { ...clip.files };
        const on = await e.ctx.library.reeditClip(clip.id, { subtitles: 'pop' });
        strict_1.default.equal(on.subtitles, 'pop');
        for (const f of Object.values(first))
            strict_1.default.ok(!node_fs_1.default.existsSync(f), 'los archivos viejos deben borrarse');
        strict_1.default.ok(Object.values(on.files).every((f) => node_fs_1.default.existsSync(f)));
        const other = await e.ctx.library.reeditClip(clip.id, { subtitles: 'clasico' });
        strict_1.default.equal(other.subtitles, 'clasico');
        strict_1.default.ok(brightBottom(other.files.horizontal, 1.5) > 0.004);
        const off = await e.ctx.library.reeditClip(clip.id, { subtitles: null });
        strict_1.default.equal(off.subtitles, undefined);
        strict_1.default.ok(brightBottom(off.files.horizontal, 1.5) < 0.0005, 'el texto debe desaparecer');
    });
    (0, node_test_1.it)('reeditar sin tocar subtítulos los conserva', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Keep', subtitles: 'clasico' });
        const r = await e.ctx.library.reeditClip(clip.id, { cropX: 0.2 });
        strict_1.default.equal(r.subtitles, 'clasico');
        strict_1.default.ok(brightBottom(r.files.horizontal, 1.5) > 0.004);
    });
    (0, node_test_1.it)('si no hay transcripción falla y el clip queda como estaba', async () => {
        const { e, vod } = env();
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Intacto' });
        const files = { ...clip.files };
        await strict_1.default.rejects(() => e.ctx.library.reeditClip(clip.id, { subtitles: 'clasico' }), /no hay transcripción de este tramo|no tiene transcripción/i);
        strict_1.default.deepEqual(e.ctx.store.data.outputs[0].files, files);
        strict_1.default.ok(Object.values(files).every((f) => node_fs_1.default.existsSync(f)));
        strict_1.default.equal(e.ctx.store.data.outputs[0].subtitles, undefined);
    });
    (0, node_test_1.it)('un estilo inventado se rechaza', async () => {
        const { e, vod } = env();
        const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'x' });
        await strict_1.default.rejects(() => e.ctx.library.reeditClip(clip.id, { subtitles: 'comic' }), /no existe/);
    });
    (0, node_test_1.it)('al acortar el tramo se descartan los cortes y acercamientos que quedan fuera', async () => {
        const { e, vod } = env();
        const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 12, title: 'Trim', cuts: [{ start: 8, end: 10 }], effects: [{ type: 'punch', at: 11 }, { type: 'fadeIn' }] });
        const r = await e.ctx.library.reeditClip(clip.id, { end: 6 });
        strict_1.default.equal(r.cuts, undefined);
        strict_1.default.deepEqual(r.effects?.map((x) => x.type), ['fadeIn']);
        strict_1.default.ok(Math.abs(r.durationSec - 6) < 0.6);
    });
});
(0, node_test_1.describe)('reedición de vídeos largos: subtítulos', () => {
    (0, node_test_1.it)('se activan y se quitan montando de nuevo desde los tramos guardados', async () => {
        const { e, vod } = env();
        importTo(e, vod.id);
        const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 3 }, { start: 7, end: 11 }] });
        strict_1.default.deepEqual(long.segments, [{ start: 0, end: 3 }, { start: 7, end: 11 }]);
        const old = long.files.long;
        const on = await e.ctx.library.reeditClip(long.id, { subtitles: 'clasico' });
        strict_1.default.equal(on.subtitles, 'clasico');
        strict_1.default.ok(!node_fs_1.default.existsSync(old));
        strict_1.default.ok(brightBottom(on.files.long, 1.5) > 0.004);
        const off = await e.ctx.library.reeditClip(long.id, { subtitles: null });
        strict_1.default.equal(off.subtitles, undefined);
        strict_1.default.ok(brightBottom(off.files.long, 1.5) < 0.0005);
        strict_1.default.ok(Math.abs(off.durationSec - 7) < 1);
    });
    (0, node_test_1.it)('rechaza cambiar el tramo, avisa si no hay transcripción y deja todo como estaba', async () => {
        const { e, vod } = env();
        const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 4 }] });
        await strict_1.default.rejects(() => e.ctx.library.reeditClip(long.id, { start: 1 }), /solo se pueden cambiar los subtítulos/);
        const file = long.files.long;
        await strict_1.default.rejects(() => e.ctx.library.reeditClip(long.id, { subtitles: 'pop' }), /no hay transcripción de este tramo|no tiene transcripción/i);
        strict_1.default.equal(e.ctx.store.data.outputs[0].files.long, file);
        strict_1.default.ok(node_fs_1.default.existsSync(file));
    });
    (0, node_test_1.it)('un vídeo antiguo sin tramos guardados da un motivo claro', async () => {
        const { e, vod } = env();
        const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 4 }] });
        delete e.ctx.store.data.outputs[0].segments;
        await strict_1.default.rejects(() => e.ctx.library.reeditClip(long.id, { subtitles: 'pop' }), /no guarda de qué tramos sale/);
    });
});
(0, node_test_1.describe)('IPC de transcripciones', () => {
    function setup() {
        const { e, vod } = env();
        const handlers = new Map();
        const ipc = { handle: (ch, fn) => void handlers.set(ch, fn) };
        const calls = { transcript: null };
        const platform = {
            pickFolder: async () => null,
            pickImage: async () => null,
            pickTranscript: async () => calls.transcript,
            pickSavePath: async () => null,
            showItem: () => undefined,
            openFolder: async () => undefined,
        };
        (0, register_1.registerIpc)(ipc, e.ctx, platform);
        const call = async (ch, ...a) => (await handlers.get(ch)({}, ...a));
        return { e, vod, call, calls };
    }
    (0, node_test_1.it)('importar abre el selector, cancelar devuelve null y un archivo bueno se guarda', async () => {
        const { e, vod, call, calls } = setup();
        const none = await call(types_1.CHANNELS.transcriptImport, vod.id);
        strict_1.default.ok(none.ok && none.value === null);
        const f = node_path_1.default.join(e.root, 'x.srt');
        node_fs_1.default.writeFileSync(f, '1\n00:00:01,000 --> 00:00:02,000\nhola mundo\n');
        calls.transcript = f;
        const r = await call(types_1.CHANNELS.transcriptImport, vod.id);
        strict_1.default.ok(r.ok && r.value?.transcript?.words === 2);
        const words = await call(types_1.CHANNELS.transcriptGet, vod.id);
        strict_1.default.ok(words.ok && words.value.length === 2);
    });
    (0, node_test_1.it)('el prompt para Claude incluye la duración real del VOD', async () => {
        const { e, vod, call } = setup();
        importTo(e, vod.id);
        const r = await call(types_1.CHANNELS.transcriptPrompt, vod.id);
        strict_1.default.ok(r.ok && /Dura 14 segundos/.test(r.value));
    });
    (0, node_test_1.it)('valida parámetros y devuelve errores limpios', async () => {
        const { call } = setup();
        const a = await call(types_1.CHANNELS.transcriptGet, 5);
        strict_1.default.ok(!a.ok && /Parámetro no válido/.test(a.error));
        const b = await call(types_1.CHANNELS.transcriptRun, 'nada');
        strict_1.default.ok(!b.ok);
    });
});

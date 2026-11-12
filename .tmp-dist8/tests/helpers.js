"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = exports.FAKE_YTDLP = exports.FAKE_WHISPER = exports.RecordingNotifier = exports.noCipher = exports.fakeCipher = void 0;
exports.tmpDir = tmpDir;
exports.rmDir = rmDir;
exports.makeVideo = makeVideo;
exports.dominantColor = dominantColor;
exports.fakeWhisper = fakeWhisper;
exports.installFakeModel = installFakeModel;
exports.fakeYtdlp = fakeYtdlp;
exports.makeEnv = makeEnv;
exports.addDownloadedVod = addDownloadedVod;
exports.addOutput = addOutput;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const context_1 = require("../electron/app/context");
function tmpDir(prefix = 'sc-test-') {
    return node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), prefix));
}
function rmDir(d) {
    node_fs_1.default.rmSync(d, { recursive: true, force: true });
}
/** Genera un vídeo sintético real con ffmpeg. */
function makeVideo(file, o = {}) {
    const { w = 1920, h = 1080, dur = 10, audio = true, split = false, fps = 30 } = o;
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const args = ['-y', '-loglevel', 'error'];
    if (split) {
        const half = Math.floor(w / 2);
        // las entradas van siempre antes que las opciones de filtro y de mapeo
        if (audio)
            args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`);
        args.push('-filter_complex', `color=c=red:s=${half}x${h}:r=${fps}:d=${dur}[a];color=c=blue:s=${w - half}x${h}:r=${fps}:d=${dur}[b];[a][b]hstack[v]`, '-map', '[v]');
        if (audio)
            args.push('-map', '0:a');
    }
    else {
        args.push('-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}:duration=${dur}`);
        if (audio)
            args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`);
    }
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
    if (audio)
        args.push('-c:a', 'aac', '-shortest');
    args.push(file);
    (0, node_child_process_1.execFileSync)('ffmpeg', args);
    return file;
}
/** Color dominante de un fotograma (promedia el fotograma a 1x1 píxel). */
function dominantColor(file, atSec = 0.5) {
    const buf = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1024 * 1024 });
    const [r, , b] = [buf[0], buf[1], buf[2]];
    if (r > 200 && b < 80)
        return 'red';
    if (b > 200 && r < 80)
        return 'blue';
    return 'mixed';
}
/** Cifrado de pega que no es identidad (para comprobar que de verdad se codifica). */
exports.fakeCipher = {
    available: () => true,
    encrypt: (s) => Buffer.from(`X${[...s].reverse().join('')}`),
    decrypt: (b) => [...b.toString().slice(1)].reverse().join(''),
};
exports.noCipher = {
    available: () => false,
    encrypt: () => {
        throw new Error('no disponible');
    },
    decrypt: () => {
        throw new Error('no disponible');
    },
};
class RecordingNotifier {
    vodEvents = [];
    changes = 0;
    tasks = [];
    channels = [];
    updates = [];
    vod(job) {
        this.vodEvents.push({ ...job });
    }
    task(t) {
        this.tasks.push({ ...t });
    }
    update(s) {
        this.updates.push({ ...s });
    }
    channel(s) {
        this.channels.push({ ...s });
    }
    changed() {
        this.changes++;
    }
}
exports.RecordingNotifier = RecordingNotifier;
exports.FAKE_WHISPER = node_path_1.default.resolve(__dirname, '../../tests/fixtures/fake-whisper-cli.js');
function fakeWhisper() {
    node_fs_1.default.chmodSync(exports.FAKE_WHISPER, 0o755);
    return exports.FAKE_WHISPER;
}
/** Coloca un "modelo" (archivo grande y vacío) donde la app espera encontrarlo, para no descargarlo. */
function installFakeModel(env, name = 'tiny', bytes = 71_000_000) {
    const dir = node_path_1.default.join(env.userData, 'models');
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const f = node_path_1.default.join(dir, `ggml-${name}.bin`);
    node_fs_1.default.writeFileSync(f, '');
    node_fs_1.default.truncateSync(f, bytes);
    return f;
}
exports.FAKE_YTDLP = node_path_1.default.resolve(__dirname, '../../tests/fixtures/fake-ytdlp.js');
function fakeYtdlp() {
    node_fs_1.default.chmodSync(exports.FAKE_YTDLP, 0o755);
    return exports.FAKE_YTDLP;
}
/** Contexto completo con carpetas temporales. */
function makeEnv(extra = {}, root = tmpDir()) {
    const userData = node_path_1.default.join(root, 'userData');
    const outputDir = node_path_1.default.join(root, 'out');
    node_fs_1.default.mkdirSync(outputDir, { recursive: true });
    const notifier = new RecordingNotifier();
    const ctx = new context_1.AppContext({
        userDataDir: userData,
        defaultOutputDir: outputDir,
        cipher: exports.fakeCipher,
        notifier,
        schedulerIntervalMs: 3_600_000,
        fontsDir: node_path_1.default.resolve(process.cwd(), 'resources/fonts'),
        freeBytes: () => null, // las pruebas no dependen del disco de la máquina
        ...extra,
    });
    return { root, userData, outputDir, notifier, ctx, cleanup: () => { ctx.stop(); rmDir(root); } };
}
/** Registra un vídeo ya "descargado" en el almacén, sin pasar por yt-dlp. */
function addDownloadedVod(env, file, id = 'vod1') {
    const job = {
        id,
        url: `https://www.twitch.tv/videos/${id}`,
        title: 'VOD de prueba',
        status: 'downloaded',
        progress: 100,
        filePath: file,
        createdAt: new Date().toISOString(),
    };
    env.ctx.store.data.vods.unshift(job);
    env.ctx.store.save();
    return job;
}
function addOutput(env, id = 'out1') {
    const item = {
        id,
        kind: 'clip',
        title: 'Clip',
        files: { vertical: node_path_1.default.join(env.outputDir, 'vertical', `${id}.mp4`) },
        durationSec: 5,
        createdAt: new Date().toISOString(),
    };
    env.ctx.store.data.outputs.unshift(item);
    env.ctx.store.save();
    return item;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.sleep = sleep;

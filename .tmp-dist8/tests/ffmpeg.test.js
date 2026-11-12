"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const tools = (0, tools_1.resolveToolPaths)('', '');
(0, node_test_1.describe)('ffmpeg: utilidades', () => {
    (0, node_test_1.it)('concatLine usa barras normales y escapa las comillas simples', () => {
        strict_1.default.equal((0, ffmpeg_1.concatLine)('C:\\Users\\a b\\it\'s.mp4'), "file 'C:/Users/a b/it'\\''s.mp4'");
        strict_1.default.equal((0, ffmpeg_1.concatLine)('/tmp/x.mp4'), "file '/tmp/x.mp4'");
    });
    (0, node_test_1.it)('verticalFilter limita cropX a 0..1', () => {
        strict_1.default.match((0, ffmpeg_1.verticalFilter)(-5), /\*0'/);
        strict_1.default.match((0, ffmpeg_1.verticalFilter)(7), /\*1'/);
        strict_1.default.match((0, ffmpeg_1.verticalFilter)(0.25), /\*0\.25'/);
    });
});
(0, node_test_1.describe)('ffmpeg: render real sobre distintos orígenes', () => {
    let root;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    const sources = [
        { name: '1080p16:9 con audio', opts: { w: 1920, h: 1080, audio: true } },
        { name: '720p sin audio', opts: { w: 1280, h: 720, audio: false } },
        { name: '4:3 (1440x1080)', opts: { w: 1440, h: 1080, audio: true } },
        { name: 'ya vertical (1080x1920)', opts: { w: 1080, h: 1920, audio: true } },
        { name: 'medidas impares (1000x562)', opts: { w: 1000, h: 562, audio: true } },
        { name: '4K (3840x2160)', opts: { w: 3840, h: 2160, dur: 6, audio: true } },
        { name: '60 fps', opts: { w: 1280, h: 720, fps: 60, audio: true } },
    ];
    for (const { name, opts } of sources) {
        (0, node_test_1.it)(`vertical, horizontal y largo válidos desde ${name}`, async () => {
            const dir = node_path_1.default.join(root, name.replace(/\W+/g, '_'));
            const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, 'src.mp4'), { dur: 8, ...opts });
            const hasAudio = opts.audio ?? true;
            const v = node_path_1.default.join(dir, 'v.mp4');
            await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'vertical', start: 1, end: 4, cropX: 0.5 }, v);
            const vi = await (0, ffmpeg_1.validateRender)(tools, v, 'vertical', 3);
            strict_1.default.equal(vi.hasAudio, hasAudio, 'el audio se conserva (o no aparece de la nada)');
            const h = node_path_1.default.join(dir, 'h.mp4');
            await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 2, end: 5 }, h);
            await (0, ffmpeg_1.validateRender)(tools, h, 'horizontal', 3);
            const l = node_path_1.default.join(dir, 'l.mp4');
            await (0, ffmpeg_1.renderLong)(tools, src, { title: 'l', segments: [{ start: 0, end: 2 }, { start: 5, end: 7 }] }, l);
            const li = await (0, ffmpeg_1.validateRender)(tools, l, 'long', 4, 2);
            strict_1.default.equal(li.hasAudio, hasAudio);
        });
    }
    (0, node_test_1.it)('cropX mueve de verdad el recorte vertical (izquierda roja, derecha azul)', async () => {
        const dir = node_path_1.default.join(root, 'crop');
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, 'split.mp4'), { split: true, dur: 4, audio: false });
        const out = async (cropX) => {
            const f = node_path_1.default.join(dir, `c-${cropX}.mp4`);
            await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'vertical', start: 0, end: 2, cropX }, f);
            return (0, helpers_1.dominantColor)(f, 0.5);
        };
        strict_1.default.equal(await out(0), 'red');
        strict_1.default.equal(await out(1), 'blue');
        strict_1.default.equal(await out(0.5), 'mixed');
        strict_1.default.equal(await out(undefined), 'mixed'); // por defecto, centrado
        strict_1.default.equal(await out(-3), 'red'); // fuera de rango se limita
        strict_1.default.equal(await out(9), 'blue');
    });
    (0, node_test_1.it)('el horizontal no deforma: un origen 4:3 lleva bandas negras laterales', async () => {
        const dir = node_path_1.default.join(root, 'bars');
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, 'src.mp4'), { w: 1440, h: 1080, dur: 3, audio: false, split: true });
        const out = node_path_1.default.join(dir, 'h.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 0, end: 2 }, out);
        // columna izquierda de 100 px del fotograma de salida: debería ser negra (banda), no roja
        const px = leftStripLuma(out);
        strict_1.default.ok(px < 30, `la banda izquierda debería ser negra (luma ${px})`);
    });
    (0, node_test_1.it)('largo con tramos desordenados: respeta el orden pedido y suma las duraciones', async () => {
        const dir = node_path_1.default.join(root, 'order');
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, 'src.mp4'), { split: true, dur: 8, audio: true });
        const out = node_path_1.default.join(dir, 'l.mp4');
        // el original es rojo a la izquierda y azul a la derecha en todo momento; el orden se comprueba por duración
        await (0, ffmpeg_1.renderLong)(tools, src, { title: 'l', segments: [{ start: 5, end: 8 }, { start: 0, end: 1 }, { start: 2, end: 4 }] }, out);
        const info = await (0, ffmpeg_1.probe)(tools, out);
        strict_1.default.ok(Math.abs(info.durationSec - 6) < 0.5, `duración ${info.durationSec}`);
        strict_1.default.equal(info.width, 1920);
    });
    (0, node_test_1.it)('largo de un solo tramo y rutas con espacios, comillas y acentos', async () => {
        const dir = node_path_1.default.join(root, "carpeta con espacios y 'comillas' ñ");
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, "mi vídeo 'ñ'.mp4"), { dur: 4, w: 1280, h: 720 });
        const out = node_path_1.default.join(dir, 'salida', "largo 'x'.mp4");
        await (0, ffmpeg_1.renderLong)(tools, src, { title: 'l', segments: [{ start: 0, end: 2 }] }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'long', 2);
        // sin restos temporales
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(node_path_1.default.join(dir, 'salida')), ["largo 'x'.mp4"]);
    });
    (0, node_test_1.it)('un origen corrupto produce un error, no un archivo "bueno"', async () => {
        const bad = node_path_1.default.join(root, 'corrupto.mp4');
        node_fs_1.default.writeFileSync(bad, 'esto no es un vídeo');
        const out = node_path_1.default.join(root, 'out-bad.mp4');
        await strict_1.default.rejects((0, ffmpeg_1.renderClip)(tools, bad, { kind: 'vertical', start: 0, end: 2 }, out), /falló/);
        await strict_1.default.rejects((0, ffmpeg_1.probe)(tools, bad));
    });
    (0, node_test_1.it)('un tramo fuera del vídeo no se da por válido', async () => {
        const dir = node_path_1.default.join(root, 'past-end');
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(dir, 'src.mp4'), { dur: 3, w: 640, h: 360 });
        const out = node_path_1.default.join(dir, 'h.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 10, end: 14 }, out).catch(() => undefined);
        await strict_1.default.rejects((0, ffmpeg_1.validateRender)(tools, out, 'horizontal', 4));
    });
});
(0, node_test_1.describe)('ffmpeg: validateRender rechaza lo incorrecto', () => {
    let root;
    let file;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        file = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'v.mp4'), { w: 1920, h: 1080, dur: 4, audio: true });
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    (0, node_test_1.it)('formato equivocado', async () => {
        await strict_1.default.rejects((0, ffmpeg_1.validateRender)(tools, file, 'vertical', 4), /Resolución incorrecta: 1920x1080 \(esperada 1080x1920\)/);
    });
    (0, node_test_1.it)('duración equivocada', async () => {
        await strict_1.default.rejects((0, ffmpeg_1.validateRender)(tools, file, 'horizontal', 30), /Duración incorrecta/);
        await (0, ffmpeg_1.validateRender)(tools, file, 'horizontal', 4);
        await (0, ffmpeg_1.validateRender)(tools, file, 'horizontal', 5.4); // dentro de la tolerancia
    });
    (0, node_test_1.it)('archivo inexistente o que no es vídeo', async () => {
        await strict_1.default.rejects((0, ffmpeg_1.validateRender)(tools, node_path_1.default.join(root, 'nada.mp4'), 'horizontal', 4), /no existe/);
        const junk = node_path_1.default.join(root, 'junk.mp4');
        node_fs_1.default.writeFileSync(junk, 'basura');
        await strict_1.default.rejects((0, ffmpeg_1.validateRender)(tools, junk, 'horizontal', 4));
    });
});
/** Luminosidad media de una franja de 100 px a la izquierda del primer fotograma. */
function leftStripLuma(file) {
    const buf = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'crop=100:1080:0:0,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1024 * 1024 });
    return buf[0];
}

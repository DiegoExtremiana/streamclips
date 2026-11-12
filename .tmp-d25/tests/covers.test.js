"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const thumbnails_1 = require("../electron/services/thumbnails");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const tools = (0, tools_1.resolveToolPaths)('', '');
const fonts = node_path_1.default.join(__dirname, '..', '..', 'resources', 'fonts');
(0, node_test_1.describe)('portadas con estilo (ffmpeg real)', () => {
    let root;
    let video;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        video = node_path_1.default.join(root, 'v.mp4');
        (0, helpers_1.makeVideo)(video, { dur: 6 });
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    (0, node_test_1.it)('horizontal: JPG de 1280×720 con la frase y el número', async () => {
        const out = await (0, thumbnails_1.autoThumbnail)(tools, root, 'a', 'horizontal', video, 6, { title: 'Minecraft extremo Día 3 - Resumen', fontsDir: fonts });
        const info = await (0, ffmpeg_1.probe)(tools, out);
        strict_1.default.equal(info.width, 1280);
        strict_1.default.equal(info.height, 720);
        strict_1.default.ok(node_fs_1.default.statSync(out).size > 5000);
    });
    (0, node_test_1.it)('sin estilo o en vertical se hace el fotograma sencillo de siempre', async () => {
        const plain = await (0, thumbnails_1.autoThumbnail)(tools, root, 'b', 'horizontal', video, 6, { title: 'X', styled: false });
        strict_1.default.equal((await (0, ffmpeg_1.probe)(tools, plain)).width, 640);
        const vert = await (0, thumbnails_1.autoThumbnail)(tools, root, 'c', 'vertical', video, 6, { title: 'X' });
        strict_1.default.equal((await (0, ffmpeg_1.probe)(tools, vert)).width, 360);
    });
    (0, node_test_1.it)('si la portada con estilo falla (fuente o filtro), cae al fotograma sencillo', async () => {
        const out = await (0, thumbnails_1.autoThumbnail)(tools, root, 'd', 'horizontal', video, 6, { title: 'Hola', fontsDir: node_path_1.default.join(root, 'no-existe') });
        strict_1.default.ok(node_fs_1.default.existsSync(out));
    });
    (0, node_test_1.it)('bestFrameTime devuelve un instante dentro del vídeo', async () => {
        const t = await (0, thumbnails_1.bestFrameTime)(tools, video, 6);
        strict_1.default.ok(t >= 0 && t <= 6);
    });
});

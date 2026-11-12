"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const downloader_1 = require("../electron/services/downloader");
const helpers_1 = require("./helpers");
(0, node_test_1.describe)('parseVodUrl', () => {
    (0, node_test_1.it)('acepta URLs http(s) normales y quita el fragmento', () => {
        strict_1.default.equal((0, downloader_1.parseVodUrl)('https://www.twitch.tv/videos/123456789'), 'https://www.twitch.tv/videos/123456789');
        strict_1.default.equal((0, downloader_1.parseVodUrl)('  http://example.com/v  '), 'http://example.com/v');
        strict_1.default.equal((0, downloader_1.parseVodUrl)('https://www.twitch.tv/videos/1#t=1h'), 'https://www.twitch.tv/videos/1');
        strict_1.default.equal((0, downloader_1.parseVodUrl)('https://www.twitch.tv/videos/1?filter=archive&sort=time'), 'https://www.twitch.tv/videos/1?filter=archive&sort=time');
    });
    (0, node_test_1.it)('rechaza todo lo que no sea una URL web (incluida la inyección de opciones)', () => {
        for (const bad of [
            '', '   ', 'no es una url', '--exec rm -rf /', '-o /tmp/x', '--config-locations /etc/passwd',
            'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/a', 'data:text/plain,hola',
            'https://localhost/x', 'http://intranet/video', 'twitch.tv/videos/1',
        ]) {
            strict_1.default.equal((0, downloader_1.parseVodUrl)(bad), null, `debería rechazar "${bad}"`);
        }
    });
});
(0, node_test_1.describe)('downloadVod (con yt-dlp simulado)', () => {
    let root;
    let source;
    let log;
    let tools;
    const saved = { ...process.env };
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        source = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'src.mp4'), { w: 640, h: 360, dur: 2 });
        log = node_path_1.default.join(root, 'calls.log');
        tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: (0, helpers_1.fakeYtdlp)() };
    });
    (0, node_test_1.after)(() => {
        (0, helpers_1.rmDir)(root);
        process.env = saved;
    });
    const env = (o) => {
        process.env = { ...saved, FAKE_SOURCE: source, FAKE_LOG: log, ...o };
        node_fs_1.default.rmSync(log, { force: true });
    };
    (0, node_test_1.it)('descarga, informa del progreso en orden y devuelve título y archivo', async () => {
        env({});
        const out = node_path_1.default.join(root, 'ok');
        const seen = [];
        const r = await (0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', out, (p) => seen.push(p));
        strict_1.default.equal(r.title, 'Título del VOD');
        strict_1.default.equal(r.filePath, node_path_1.default.join(out, 'abc123.mp4'));
        strict_1.default.ok(node_fs_1.default.statSync(r.filePath).size > 0);
        strict_1.default.equal(seen.at(-1), 100);
        strict_1.default.deepEqual(seen, [...seen].sort((a, b) => a - b), 'el progreso nunca retrocede');
        strict_1.default.ok(seen.length >= 5);
    });
    (0, node_test_1.it)('la URL siempre va tras "--" y como último argumento (sin inyección de opciones)', async () => {
        env({});
        await (0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', node_path_1.default.join(root, 'args'), () => undefined);
        const calls = node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        strict_1.default.equal(calls.length, 2); // metadatos + descarga
        for (const c of calls) {
            strict_1.default.deepEqual(c.slice(-2), ['--', 'https://www.twitch.tv/videos/1']);
        }
        strict_1.default.ok(calls[1].includes('--remux-video'));
    });
    (0, node_test_1.it)('un fallo de yt-dlp da un error con el motivo', async () => {
        env({ FAKE_MODE: 'fail' });
        await strict_1.default.rejects((0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', node_path_1.default.join(root, 'fail'), () => undefined), /código 1[\s\S]*403/);
    });
    (0, node_test_1.it)('si yt-dlp dice que terminó pero no hay archivo, es un error', async () => {
        env({ FAKE_MODE: 'nofile' });
        await strict_1.default.rejects((0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', node_path_1.default.join(root, 'nofile'), () => undefined), /no se encuentra el archivo/);
    });
    (0, node_test_1.it)('si no hay metadatos, el error lo explica', async () => {
        env({ FAKE_MODE: 'nometa' });
        await strict_1.default.rejects((0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', node_path_1.default.join(root, 'nometa'), () => undefined), /no devolvió información/);
    });
    (0, node_test_1.it)('yt-dlp no instalado -> mensaje claro', async () => {
        env({});
        await strict_1.default.rejects((0, downloader_1.downloadVod)({ ...tools, ytdlp: '/no/existe/yt-dlp' }, 'https://www.twitch.tv/videos/1', node_path_1.default.join(root, 'x'), () => undefined), /No se encuentra/);
    });
    (0, node_test_1.it)('un id malicioso nunca saca el archivo de la carpeta de descargas', async () => {
        env({ FAKE_ID: '../../evil' });
        const out = node_path_1.default.join(root, 'safe', 'vods');
        const r = await (0, downloader_1.downloadVod)(tools, 'https://www.twitch.tv/videos/1', out, () => undefined);
        strict_1.default.equal(node_path_1.default.dirname(r.filePath), out);
        strict_1.default.ok(!node_fs_1.default.existsSync(node_path_1.default.join(root, 'evil.mp4')));
    });
});

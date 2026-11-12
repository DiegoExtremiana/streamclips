"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unpackedPath = unpackedPath;
exports.findBundledTools = findBundledTools;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Dentro del asar los ejecutables no se pueden lanzar: viven en la carpeta app.asar.unpacked. */
function unpackedPath(p) {
    return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}
/** Localiza ffmpeg, ffprobe y yt-dlp incluidos con el programa (también whisper-cli). Lo que no exista se omite. */
function findBundledTools(env) {
    const exists = env.exists ?? ((p) => node_fs_1.default.existsSync(p));
    const out = {};
    const take = (key, p) => {
        if (typeof p !== 'string' || !p)
            return;
        const real = unpackedPath(p);
        if (exists(real))
            out[key] = real;
    };
    try {
        take('ffmpeg', env.load('ffmpeg-static'));
    }
    catch {
        /* no instalado */
    }
    try {
        take('ffprobe', env.load('ffprobe-static')?.path);
    }
    catch {
        /* no instalado */
    }
    const yt = node_path_1.default.join(env.resourcesDir, 'bin', env.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
    if (exists(yt))
        out.ytdlp = yt;
    const wh = node_path_1.default.join(env.resourcesDir, 'bin', env.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    if (exists(wh))
        out.whisper = wh;
    return out;
}

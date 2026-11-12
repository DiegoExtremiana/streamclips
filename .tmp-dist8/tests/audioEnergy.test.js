"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const audioEnergy_1 = require("../electron/services/audioEnergy");
const helpers_1 = require("./helpers");
let dir;
(0, node_test_1.before)(() => {
    dir = (0, helpers_1.tmpDir)();
});
(0, node_test_1.after)(() => (0, helpers_1.rmDir)(dir));
const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' };
(0, node_test_1.describe)('energía de audio', () => {
    (0, node_test_1.it)('detecta el tramo fuerte entre dos silenciosos', async () => {
        const f = node_path_1.default.join(dir, 'a.mp4');
        // 6 s flojos, 4 s fuertes, 6 s flojos
        (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=16',
            '-f', 'lavfi', '-i', "aevalsrc='if(between(t,6,10),0.8,0.02)*sin(2*PI*300*t)':d=16:s=16000",
            '-c:v', 'libx264', '-c:a', 'aac', '-shortest', f]);
        const e = await (0, audioEnergy_1.audioEnergy)(tools, f);
        strict_1.default.ok(e.length >= 15 && e.length <= 17, `${e.length}`);
        const quiet = e[2];
        const loud = e[8];
        strict_1.default.ok(loud - quiet > 20, `${loud} vs ${quiet}`);
        strict_1.default.ok(e[13] < loud - 20);
    });
    (0, node_test_1.it)('un vídeo sin audio da error claro y un archivo roto también', async () => {
        const f = node_path_1.default.join(dir, 'mute.mp4');
        (0, helpers_1.makeVideo)(f, { dur: 3, audio: false, w: 160, h: 90 });
        const e = await (0, audioEnergy_1.audioEnergy)(tools, f).catch((x) => x);
        // sin pista de audio no hay datos: o falla con mensaje o devuelve vacío, nunca se cuelga
        strict_1.default.ok(e instanceof Error || (Array.isArray(e) && e.length === 0));
        await strict_1.default.rejects(() => (0, audioEnergy_1.audioEnergy)(tools, node_path_1.default.join(dir, 'no-existe.mp4')), /ffmpeg/);
    });
    (0, node_test_1.it)('un audio de 1 hora se analiza en flujo y da un valor por segundo', async () => {
        const f = node_path_1.default.join(dir, 'long.m4a');
        (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3600:sample_rate=16000', '-c:a', 'aac', '-b:a', '16k', f]);
        const t0 = Date.now();
        const e = await (0, audioEnergy_1.audioEnergy)(tools, f);
        strict_1.default.ok(e.length >= 3598 && e.length <= 3601, `${e.length}`);
        strict_1.default.ok(Date.now() - t0 < 60_000, `${Date.now() - t0} ms`);
        strict_1.default.ok(e.every((x) => Number.isFinite(x)));
    });
});

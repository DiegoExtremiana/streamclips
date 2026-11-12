"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.run = run;
exports.resolveToolPaths = resolveToolPaths;
exports.checkTools = checkTools;
const node_child_process_1 = require("node:child_process");
const abort_1 = require("./abort");
/** Ejecuta un programa SIN shell (los argumentos nunca se interpretan como comandos). */
function run(cmd, args, timeoutMs = 0) {
    return new Promise((resolve, reject) => {
        const signal = (0, abort_1.currentAbort)();
        if (signal?.aborted)
            return reject(new abort_1.CancelledError());
        (0, node_child_process_1.execFile)(cmd, args, { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true, ...(signal ? { signal } : {}) }, (err, stdout, stderr) => {
            if (err) {
                if (signal?.aborted)
                    return reject(new abort_1.CancelledError());
                const tail = String(stderr || '').trim().split('\n').slice(-6).join('\n');
                const base = err.code === 'ENOENT' ? `No se encuentra "${cmd}"` : `${cmd} falló`;
                reject(new Error(tail ? `${base}: ${tail}` : `${base}: ${err.message}`));
            }
            else {
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            }
        });
    });
}
/**
 * Rutas de las herramientas. Prioridad: la ruta que el usuario puso en Ajustes, luego las que
 * vienen incluidas con el programa y por último el PATH del sistema.
 */
function resolveToolPaths(ffmpegPath, ytdlpPath, bundled = {}) {
    const userFfmpeg = ffmpegPath.trim();
    const ffmpeg = userFfmpeg || bundled.ffmpeg || 'ffmpeg';
    let ffprobe = bundled.ffprobe || 'ffprobe';
    if (userFfmpeg) {
        ffprobe = userFfmpeg.replace(/ffmpeg(\.exe)?$/i, (_m, ext) => `ffprobe${ext ?? ''}`);
    }
    return { ffmpeg, ffprobe, ytdlp: ytdlpPath.trim() || bundled.ytdlp || 'yt-dlp' };
}
async function version(cmd, arg) {
    try {
        const { stdout } = await run(cmd, [arg], 15000);
        return { ok: true, version: stdout.split('\n')[0].trim() };
    }
    catch {
        return { ok: false };
    }
}
async function checkTools(paths) {
    const [ffmpeg, ffprobe, ytdlp] = await Promise.all([
        version(paths.ffmpeg, '-version'),
        version(paths.ffprobe, '-version'),
        version(paths.ytdlp, '--version'),
    ]);
    return { ffmpeg, ffprobe, ytdlp };
}

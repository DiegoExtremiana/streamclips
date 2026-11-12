"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.audioEnergy = audioEnergy;
const node_child_process_1 = require("node:child_process");
const node_readline_1 = __importDefault(require("node:readline"));
const abort_1 = require("./abort");
/**
 * Volumen medio de cada segundo del vídeo (dB). Se lee en flujo: un directo de 4 horas son
 * 14.400 valores y la memoria no crece con la duración.
 */
function audioEnergy(tools, input, onProgress) {
    return new Promise((resolve, reject) => {
        const signal = (0, abort_1.currentAbort)();
        if (signal?.aborted)
            return reject(new abort_1.CancelledError());
        const args = [
            '-v', 'error', '-nostdin', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
            '-af', 'asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
            '-f', 'null', '-',
        ];
        const p = (0, node_child_process_1.spawn)(tools.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
        const out = [];
        let err = '';
        p.stderr.on('data', (c) => {
            if (err.length < 4000)
                err += c.toString();
        });
        const rl = node_readline_1.default.createInterface({ input: p.stdout });
        let sec = 0;
        rl.on('line', (line) => {
            const t = /pts_time:([\d.]+)/.exec(line);
            if (t)
                sec = Math.round(Number(t[1]));
            const m = /RMS_level=(-?[\d.]+|-inf|inf|nan)/.exec(line);
            if (m) {
                const v = Number(m[1]);
                out[Math.max(0, sec)] = Number.isFinite(v) ? v : -91;
                if (sec % 60 === 0)
                    onProgress?.(sec);
            }
        });
        p.on('error', (e) => reject(signal?.aborted ? new abort_1.CancelledError() : new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
        p.on('close', (code) => {
            if (signal?.aborted)
                return reject(new abort_1.CancelledError());
            if (code !== 0)
                return reject(new Error(`ffmpeg no pudo analizar el audio (código ${code}). ${err.trim().slice(0, 300)}`));
            // huecos (segundos sin dato) = silencio
            for (let i = 0; i < out.length; i++)
                if (out[i] === undefined)
                    out[i] = -91;
            resolve(out);
        });
    });
}

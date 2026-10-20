import { spawn } from 'node:child_process';
import readline from 'node:readline';
import type { ToolPaths } from './tools';
import { CancelledError, currentAbort } from './abort';

/**
 * Volumen medio de cada segundo del vídeo (dB). Se lee en flujo: un directo de 4 horas son
 * 14.400 valores y la memoria no crece con la duración.
 */
export function audioEnergy(tools: ToolPaths, input: string, onProgress?: (sec: number) => void): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const signal = currentAbort();
    if (signal?.aborted) return reject(new CancelledError());
    const args = [
      '-v', 'error', '-nostdin', '-i', input, '-vn', '-ac', '1', '-ar', '16000',
      '-af', 'asetnsamples=n=16000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
      '-f', 'null', '-',
    ];
    const p = spawn(tools.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    const out: number[] = [];
    let err = '';
    p.stderr.on('data', (c: Buffer) => {
      if (err.length < 4000) err += c.toString();
    });
    const rl = readline.createInterface({ input: p.stdout });
    let sec = 0;
    rl.on('line', (line) => {
      const t = /pts_time:([\d.]+)/.exec(line);
      if (t) sec = Math.round(Number(t[1]));
      const m = /RMS_level=(-?[\d.]+|-inf|inf|nan)/.exec(line);
      if (m) {
        const v = Number(m[1]);
        out[Math.max(0, sec)] = Number.isFinite(v) ? v : -91;
        if (sec % 60 === 0) onProgress?.(sec);
      }
    });
    p.on('error', (e) => reject(signal?.aborted ? new CancelledError() : new Error(`No se pudo ejecutar ffmpeg: ${e.message}`)));
    p.on('close', (code) => {
      if (signal?.aborted) return reject(new CancelledError());
      if (code !== 0) return reject(new Error(`ffmpeg no pudo analizar el audio (código ${code}). ${err.trim().slice(0, 300)}`));
      // huecos (segundos sin dato) = silencio
      for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = -91;
      resolve(out);
    });
  });
}

import { execFile } from 'node:child_process';
import type { ToolStatus } from '../../shared/types';
import { CancelledError, currentAbort } from './abort';

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Ejecuta un programa SIN shell (los argumentos nunca se interpretan como comandos). */
export function run(cmd: string, args: string[], timeoutMs = 0): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const signal = currentAbort();
    if (signal?.aborted) return reject(new CancelledError());
    execFile(
      cmd,
      args,
      { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs, windowsHide: true, ...(signal ? { signal } : {}) },
      (err, stdout, stderr) => {
        if (err) {
          if (signal?.aborted) return reject(new CancelledError());
          const tail = String(stderr || '').trim().split('\n').slice(-6).join('\n');
          const base = (err as NodeJS.ErrnoException).code === 'ENOENT' ? `No se encuentra "${cmd}"` : `${cmd} falló`;
          reject(new Error(tail ? `${base}: ${tail}` : `${base}: ${err.message}`));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}

export interface ToolPaths {
  ffmpeg: string;
  ffprobe: string;
  ytdlp: string;
}

/** Herramientas que vienen dentro del programa (solo las que existen en disco). */
export interface BundledTools {
  ffmpeg?: string;
  ffprobe?: string;
  ytdlp?: string;
  whisper?: string;
}

/**
 * Rutas de las herramientas. Prioridad: la ruta que el usuario puso en Ajustes, luego las que
 * vienen incluidas con el programa y por último el PATH del sistema.
 */
export function resolveToolPaths(ffmpegPath: string, ytdlpPath: string, bundled: BundledTools = {}): ToolPaths {
  const userFfmpeg = ffmpegPath.trim();
  const ffmpeg = userFfmpeg || bundled.ffmpeg || 'ffmpeg';
  let ffprobe = bundled.ffprobe || 'ffprobe';
  if (userFfmpeg) {
    ffprobe = userFfmpeg.replace(/ffmpeg(\.exe)?$/i, (_m, ext?: string) => `ffprobe${ext ?? ''}`);
  }
  return { ffmpeg, ffprobe, ytdlp: ytdlpPath.trim() || bundled.ytdlp || 'yt-dlp' };
}

async function version(cmd: string, arg: string): Promise<{ ok: boolean; version?: string }> {
  try {
    const { stdout } = await run(cmd, [arg], 15000);
    return { ok: true, version: stdout.split('\n')[0].trim() };
  } catch {
    return { ok: false };
  }
}

export async function checkTools(paths: ToolPaths): Promise<ToolStatus> {
  const [ffmpeg, ffprobe, ytdlp] = await Promise.all([
    version(paths.ffmpeg, '-version'),
    version(paths.ffprobe, '-version'),
    version(paths.ytdlp, '--version'),
  ]);
  return { ffmpeg, ffprobe, ytdlp };
}

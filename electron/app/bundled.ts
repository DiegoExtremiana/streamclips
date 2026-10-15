import fs from 'node:fs';
import path from 'node:path';
import type { BundledTools } from '../services/tools';

export interface BundledEnv {
  /** Carpeta de recursos: process.resourcesPath empaquetado, <proyecto>/resources en desarrollo. */
  resourcesDir: string;
  platform: NodeJS.Platform;
  /** Carga un paquete de npm; puede lanzar si no está instalado. */
  load: (name: string) => unknown;
  exists?: (p: string) => boolean;
}

/** Dentro del asar los ejecutables no se pueden lanzar: viven en la carpeta app.asar.unpacked. */
export function unpackedPath(p: string): string {
  return p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

/** Localiza ffmpeg, ffprobe y yt-dlp incluidos con el programa (también whisper-cli). Lo que no exista se omite. */
export function findBundledTools(env: BundledEnv): BundledTools {
  const exists = env.exists ?? ((p: string) => fs.existsSync(p));
  const out: BundledTools = {};
  const take = (key: 'ffmpeg' | 'ffprobe', p: unknown) => {
    if (typeof p !== 'string' || !p) return;
    const real = unpackedPath(p);
    if (exists(real)) out[key] = real;
  };
  try {
    take('ffmpeg', env.load('ffmpeg-static'));
  } catch {
    /* no instalado */
  }
  try {
    take('ffprobe', (env.load('ffprobe-static') as { path?: string } | null)?.path);
  } catch {
    /* no instalado */
  }
  const yt = path.join(env.resourcesDir, 'bin', env.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (exists(yt)) out.ytdlp = yt;
  const wh = path.join(env.resourcesDir, 'bin', env.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  if (exists(wh)) out.whisper = wh;
  return out;
}

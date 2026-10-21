import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { run, type ToolPaths } from './tools';
import { parseChapters, type Chapter } from '../../shared/categories';

export interface DownloadResult {
  title: string;
  filePath: string;
}

/** Solo URLs http(s): evita que un texto con forma de opción llegue a yt-dlp como argumento. */
export function parseVodUrl(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!u.hostname.includes('.')) return null;
  u.hash = '';
  return u.toString();
}

/** El id que usa yt-dlp para nombrar el archivo debe ser seguro como nombre de archivo. */
function safeId(id: string): string {
  const clean = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return clean && clean !== '.' && clean !== '..' ? clean : 'video';
}

// yt-dlp en Windows escribe en la página de códigos del sistema (cp1252) y los acentos llegaban rotos («D�A»). Se le pide UTF-8.
process.env.PYTHONUTF8 = '1';
process.env.PYTHONIOENCODING = 'utf-8';

/** Categorías de Twitch a lo largo de un VOD (capítulos de yt-dlp). Vacío si no hay o no se pueden leer. */
export async function fetchChapters(tools: ToolPaths, url: string): Promise<Chapter[]> {
  const r = await run(tools.ytdlp, ['--no-warnings', '--no-playlist', '--skip-download', '--print', '%(chapters)j', '--', url], 90_000);
  return parseChapters(r.stdout);
}

/** Descarga un VOD (o cualquier URL compatible con yt-dlp) a <outDir>/<id>.mp4. */
export async function downloadVod(
  tools: ToolPaths,
  url: string,
  outDir: string,
  onProgress: (pct: number) => void,
): Promise<DownloadResult> {
  fs.mkdirSync(outDir, { recursive: true });

  // "--" marca el fin de las opciones: lo que sigue es siempre una URL, nunca una opción.
  const meta = await run(
    tools.ytdlp,
    ['--no-warnings', '--no-playlist', '--skip-download', '--print', '%(id)s\t%(title)s', '--', url],
    60_000,
  );
  const first = meta.stdout.trim().split('\n')[0] ?? '';
  const [rawId, ...rest] = first.split('\t');
  if (!rawId) throw new Error('yt-dlp no devolvió información del vídeo (¿la URL es correcta y el VOD sigue disponible?).');
  const id = safeId(rawId);
  const title = rest.join('\t').trim() || id;
  const filePath = path.join(outDir, `${id}.mp4`);

  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      tools.ytdlp,
      [
        '--newline', '--no-warnings', '--no-playlist',
        '--concurrent-fragments', '4',
        '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
        '--merge-output-format', 'mp4',
        '--remux-video', 'mp4',
        '-o', path.join(outDir, `${id}.%(ext)s`),
        '--', url,
      ],
      { windowsHide: true },
    );
    let tail = '';
    p.stdout.on('data', (d: Buffer) => {
      const text = d.toString();
      tail = (tail + text).slice(-2000);
      const m = [...text.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)].pop();
      if (m) onProgress(Math.min(100, Number(m[1])));
    });
    p.stderr.on('data', (d: Buffer) => {
      tail = (tail + d.toString()).slice(-2000);
    });
    p.on('error', (e) => reject(new Error(`No se pudo ejecutar yt-dlp: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp terminó con código ${code}\n${tail.trim().split('\n').slice(-4).join('\n')}`));
    });
  });

  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error('La descarga terminó pero no se encuentra el archivo esperado.');
  }
  onProgress(100);
  return { title, filePath };
}

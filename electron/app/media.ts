import fs from 'node:fs';
import { parseMediaUrl } from '../../shared/media';
import type { AppContext } from './context';

/**
 * Traduce una URL sc-media://o/<id>/video|thumb al archivo real.
 * Solo existen los archivos que la aplicación tiene registrados: no hay forma de pedir una ruta cualquiera.
 */
export function resolveMedia(ctx: AppContext, rawUrl: string): string | null {
  const parsed = parseMediaUrl(rawUrl);
  if (!parsed) return null;
  const o = ctx.store.data.outputs.find((x) => x.id === parsed.outputId);
  if (!o) return null;
  const file = parsed.part === 'thumb' ? o.thumbnail : o.files[parsed.part];
  if (!file || !fs.existsSync(file)) return null;
  return file;
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

export interface MediaPlan {
  status: 200 | 206 | 416;
  headers: Record<string, string>;
  /** Bytes a enviar (ambos incluidos); sin sentido si el estado es 416. */
  start: number;
  end: number;
}

/**
 * Respuesta con soporte de «Range»: sin él el reproductor no puede saltar a otro punto del vídeo.
 * Sin cabecera Range (o con varios rangos) se envía el archivo entero.
 */
export function planMediaResponse(file: string, range: string | null): MediaPlan {
  const size = fs.statSync(file).size;
  const type = MIME[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';
  const base = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const whole: MediaPlan = {
    status: 200,
    headers: { ...base, 'Content-Length': String(size) },
    start: 0,
    end: Math.max(0, size - 1),
  };
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null;
  if (!m || (m[1] === '' && m[2] === '')) return whole;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]); // «los últimos n bytes»
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (size === 0 || start >= size || start > end) {
    return { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` }, start: 0, end: 0 };
  }
  return {
    status: 206,
    headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    start,
    end,
  };
}

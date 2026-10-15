import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Texto -> nombre de archivo seguro (sin tildes, minúsculas, solo [a-z0-9-]). */
export function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'video'
  );
}

/** Ruta única para un vídeo de salida: <dir>/<tipo>/<titulo>-<fecha>-<azar>.mp4 */
export function uniqueOutputPath(outputDir: string, kind: string, title: string): string {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return path.join(outputDir, kind, `${slug(title)}-${stamp}-${rand}.mp4`);
}

/** ¿`child` está dentro de `parent` (o es el propio `parent`)? Resuelve `..` antes de comparar. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Ruta absoluta en Windows o en el sistema actual (para validar ajustes sin depender del SO de pruebas). */
export function isAbsoluteAnyOs(p: string): boolean {
  return path.isAbsolute(p) || path.win32.isAbsolute(p);
}

/** Windows "Copiar como ruta" pega la ruta entre comillas: se las quitamos. */
export function stripQuotes(p: string): string {
  return p.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
}

/** Ruta nueva para la miniatura de un vídeo (el nombre cambia en cada versión para evitar cachés). */
export function thumbnailPath(outputDir: string, outputId: string): string {
  return path.join(outputDir, 'miniaturas', `${outputId}-${crypto.randomBytes(3).toString('hex')}.jpg`);
}

const GB = 1024 ** 3;

/** Bytes libres en el disco donde está (o estará) `dir`; null si no se puede saber. */
export function freeBytes(dir: string): number | null {
  let d = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    try {
      const st = fs.statfsSync(d);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const up = path.dirname(d);
      if (up === d) return null;
      d = up;
    }
  }
  return null;
}

/** Lanza un error claro si no queda espacio para `neededBytes`. Si no se puede medir, no bloquea. */
export function ensureFreeSpace(dir: string, neededBytes: number, what: string, free: (d: string) => number | null = freeBytes): void {
  const have = free(dir);
  if (have === null || have >= neededBytes) return;
  const f = (b: number) => (b / GB).toFixed(1).replace('.', ',');
  throw new Error(`No hay espacio suficiente en el disco para ${what}: quedan ${f(have)} GB y hacen falta unos ${f(neededBytes)} GB. Libera espacio o cambia la carpeta de salida en Ajustes.`);
}

/** Estimación del espacio de un VOD de Twitch a calidad de origen (≈3 GB por hora, con margen). */
export function vodBytesEstimate(durationSec?: number): number {
  if (!durationSec || durationSec <= 0) return 6 * GB;
  return Math.ceil((durationSec / 3600) * 3.2 * GB + 1 * GB);
}
export const RENDER_MIN_BYTES = 2 * GB;

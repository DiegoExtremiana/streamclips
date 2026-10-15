import crypto from 'node:crypto';
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

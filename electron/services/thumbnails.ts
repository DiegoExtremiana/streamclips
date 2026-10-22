import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RenderKind } from '../../shared/types';
import { COVER_GRADE, COVER_H, COVER_W, buildCoverAss, candidateTimes, coverBadge, coverText, frameScore } from '../../shared/thumbStyle';
import { extractFrame, filterPath } from './ffmpeg';
import { thumbnailPath } from './files';
import { run, type ToolPaths } from './tools';

export interface CoverOpts {
  /** Título del vídeo: de él salen la frase y el número de episodio de la portada. */
  title?: string;
  /** Portada con estilo (frase grande, color vivo, número de episodio). Por defecto sí en los horizontales. */
  styled?: boolean;
  fontsDir?: string;
}

/** Lee viveza y contraste de un fotograma con signalstats. Devuelve null si no se pudo medir. */
async function measure(tools: ToolPaths, file: string, at: number): Promise<number | null> {
  try {
    const r = await run(
      tools.ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2,signalstats,metadata=print:file=-', '-f', 'null', '-'],
      30_000,
    );
    const get = (k: string) => Number(new RegExp(`lavfi\\.signalstats\\.${k}=([0-9.]+)`).exec(r.stdout)?.[1] ?? NaN);
    const s = { satAvg: get('SATAVG'), yLow: get('YLOW'), yHigh: get('YHIGH'), yAvg: get('YAVG') };
    return Object.values(s).every(Number.isFinite) ? frameScore(s) : null;
  } catch {
    return null;
  }
}

/** El mejor instante de entre varios candidatos repartidos por el vídeo; sin medidas, el primer tercio como antes. */
export async function bestFrameTime(tools: ToolPaths, file: string, durationSec: number): Promise<number> {
  const fallback = Math.min(durationSec / 3, Math.max(0, durationSec - 0.2));
  const times = candidateTimes(durationSec);
  let best = fallback;
  let top = -1;
  for (const t of times) {
    const s = await measure(tools, file, t);
    if (s !== null && s > top) {
      top = s;
      best = t;
    }
  }
  return top < 0 ? fallback : best;
}

/** Portada 1280×720: el mejor fotograma, con color vivo y la frase del vídeo grande con contorno. */
async function styledCover(tools: ToolPaths, file: string, at: number, out: string, o: CoverOpts): Promise<void> {
  const text = o.title ? coverText(o.title) : '';
  const badge = o.title ? coverBadge(o.title) : null;
  const ass = buildCoverAss(text, badge);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-cover-'));
  try {
    const fit = `scale=${COVER_W}:${COVER_H}:force_original_aspect_ratio=increase,crop=${COVER_W}:${COVER_H},setsar=1`;
    let vf = `${fit},${COVER_GRADE}`;
    if (ass) {
      const f = path.join(dir, 'cover.ass');
      fs.writeFileSync(f, ass);
      vf += `,ass='${filterPath(f)}'${o.fontsDir ? `:fontsdir='${filterPath(o.fontsDir)}'` : ''}`;
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await run(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '2', out]);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('no se generó la imagen');
  } catch (e) {
    fs.rmSync(out, { force: true });
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Miniatura automática. En los vídeos horizontales (la portada de YouTube) elige el mejor fotograma y le da el estilo
 * de los canales grandes (ver shared/thumbStyle.ts); si eso falla, o en los verticales, un fotograma sencillo como siempre.
 */
export async function autoThumbnail(
  tools: ToolPaths,
  outputDir: string,
  outputId: string,
  kind: RenderKind,
  file: string,
  durationSec: number,
  o: CoverOpts = {},
): Promise<string> {
  const out = thumbnailPath(outputDir, outputId);
  if (kind !== 'vertical' && o.styled !== false) {
    try {
      await styledCover(tools, file, await bestFrameTime(tools, file, durationSec), out, o);
      return out;
    } catch {
      // sin portada con estilo (p. ej. falta la fuente): se hace la sencilla
    }
  }
  await extractFrame(tools, file, Math.min(durationSec / 3, Math.max(0, durationSec - 0.2)), out, {
    maxWidth: kind === 'vertical' ? 360 : 640,
  });
  return out;
}

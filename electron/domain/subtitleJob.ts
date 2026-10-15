import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUBTITLE_STYLES, buildAss, wordsForOutput, type SubtitleStyleId, type Word } from '../../shared/subtitles';
import type { Range } from '../../shared/timeline';
import type { RenderKind } from '../../shared/types';
import { EXPECTED_SIZE, type BurnSubs } from '../services/ffmpeg';

export interface SubtitleEnv {
  words: (vodId: string) => Word[];
  fontsDir?: string;
}

/**
 * Prepara el archivo ASS de un render (en el tiempo del vídeo resultante) y lo borra al terminar.
 * Sin estilo no hace nada. Falla con un mensaje claro si no hay transcripción o no hay nada que decir en el tramo.
 */
export async function withSubtitles<T>(
  env: SubtitleEnv,
  vodId: string | undefined,
  style: SubtitleStyleId | undefined,
  ranges: Range[],
  kind: RenderKind,
  fn: (subs?: BurnSubs) => Promise<T>,
): Promise<T> {
  if (!style) return fn(undefined);
  if (!vodId) throw new Error('Este vídeo no guarda de qué VOD sale, así que no se pueden calcular los subtítulos.');
  const all = env.words(vodId);
  if (!all.length) throw new Error('Este VOD no tiene transcripción. Impórtala o transcríbela antes de activar los subtítulos.');
  const words = wordsForOutput(all, ranges);
  if (!words.length) throw new Error('La transcripción no tiene ninguna palabra en este tramo: quita los subtítulos o revisa la transcripción.');
  const { w, h } = EXPECTED_SIZE[kind];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-ass-'));
  try {
    const ass = path.join(dir, 'subs.ass');
    fs.writeFileSync(ass, buildAss(words, SUBTITLE_STYLES[style], w, h));
    return await fn({ ass, fontsDir: env.fontsDir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

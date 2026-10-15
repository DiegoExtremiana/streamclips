import type { RenderKind } from '../../shared/types';
import { extractFrame } from './ffmpeg';
import { thumbnailPath } from './files';
import type { ToolPaths } from './tools';

/** Miniatura automática: un fotograma hacia el primer tercio del vídeo, en su proporción original. */
export async function autoThumbnail(
  tools: ToolPaths,
  outputDir: string,
  outputId: string,
  kind: RenderKind,
  file: string,
  durationSec: number,
): Promise<string> {
  const out = thumbnailPath(outputDir, outputId);
  await extractFrame(tools, file, Math.min(durationSec / 3, Math.max(0, durationSec - 0.2)), out, {
    maxWidth: kind === 'vertical' ? 360 : 640,
  });
  return out;
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import type { ClipSpec, LongSpec, OutputItem, OutputKind, RenderKind } from '../../shared/types';
import { primaryRender } from '../../shared/outputs';
import { defaultPreset, layoutFromPreset } from '../../shared/layout';
import { keptRanges, totalDuration } from '../../shared/timeline';
import { withSubtitles, type SubtitleEnv } from './subtitleJob';
import { normalizeClip, normalizeLong, parsePlan, validateClipSpec, validateLongSpec } from '../../shared/plan';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import { ensureFreeSpace, freeBytes, RENDER_MIN_BYTES, uniqueOutputPath } from '../services/files';
import { autoThumbnail } from '../services/thumbnails';
import { probe, renderClip, renderLong, validateRender } from '../services/ffmpeg';
import type { Notifier } from './notifier';
import type { CategoryService } from './categories';
import { mixedCategories } from '../../shared/categories';

export interface ClipDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  queue: SerialQueue;
  tools: () => ToolPaths;
  subtitles: SubtitleEnv;
  /** Categorías del directo: un clip o vídeo no puede mezclar dos. */
  categories?: CategoryService;
  /** Para las pruebas: espacio libre del disco. */
  freeBytes?: (dir: string) => number | null;
}

export class ClipService {
  constructor(private d: ClipDeps) {}

  private vodFile(vodId: string): string {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!vod) throw new Error('El VOD no existe.');
    if (vod.status !== 'downloaded' || !vod.filePath) throw new Error('El VOD todavía no está descargado.');
    if (!fs.existsSync(vod.filePath)) throw new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).');
    return vod.filePath;
  }

  /**
   * Renderiza todas las versiones pedidas, las valida y solo entonces registra el elemento.
   * Si cualquiera falla se borran todos los archivos: lo que no ha pasado la validación nunca llega a la Biblioteca.
   */
  private async build(
    vodId: string,
    kind: OutputKind,
    title: string,
    expectedSec: number,
    tolerance: number,
    extra: Partial<OutputItem>,
    renders: { render: RenderKind; run: (input: string, out: string) => Promise<void> }[],
  ): Promise<OutputItem> {
    const input = this.vodFile(vodId);
    const outDir = this.d.store.data.settings.outputDir;
    const written: string[] = [];
    try {
      ensureFreeSpace(outDir, RENDER_MIN_BYTES, 'montar el vídeo', this.d.freeBytes ?? freeBytes);
      const files: OutputItem['files'] = {};
      let durationSec = expectedSec;
      for (const [i, r] of renders.entries()) {
        const out = uniqueOutputPath(outDir, r.render, title);
        written.push(out);
        await r.run(input, out);
        const info = await validateRender(this.d.tools(), out, r.render, expectedSec, tolerance);
        files[r.render] = out;
        if (i === 0) durationSec = info.durationSec;
      }
      const item: OutputItem = {
        id: crypto.randomUUID(),
        vodId,
        kind,
        title,
        files,
        durationSec,
        createdAt: new Date().toISOString(),
        ...extra,
      };
      // La miniatura es un extra: si falla, el elemento (ya validado) se conserva sin ella.
      const main = primaryRender(item);
      try {
        if (main) item.thumbnail = await autoThumbnail(this.d.tools(), outDir, item.id, main, files[main]!, durationSec);
      } catch (e) {
        this.d.log.warn(`Sin miniatura para "${title}": ${(e as Error).message}`);
      }
      this.d.store.data.outputs.unshift(item);
      this.d.store.save();
      this.d.notifier.changed();
      this.d.log.info(`Render validado (${renders.map((r) => r.render).join('+')}): "${title}"`);
      return item;
    } catch (e) {
      for (const f of written) fs.rmSync(f, { force: true });
      this.d.log.error(`Render fallido ("${title}")`, e);
      throw e;
    }
  }

  /** Duración real del VOD descargado. */
  vodDuration(vodId: string): Promise<number> {
    return this.d.queue.run(async () => (await probe(this.d.tools(), this.vodFile(vodId))).durationSec);
  }

  async createClip(vodId: string, spec: ClipSpec): Promise<OutputItem> {
    const reason = validateClipSpec(spec);
    if (reason) throw new Error(`Clip no válido: ${reason}.`);
    const clip = normalizeClip(spec, 'Clip');
    return this.d.queue.run(async () => {
      const info = await probe(this.d.tools(), this.vodFile(vodId));
      const vodDur = info.durationSec;
      const bound = validateClipSpec(clip, vodDur);
      if (bound) throw new Error(`Clip no válido: ${bound}.`);
      const mixed = mixedCategories((await this.d.categories?.ensure(vodId)) ?? [], [{ start: clip.start, end: clip.end }]);
      if (mixed) throw new Error(`Clip no válido: ${mixed}.`);
      // Por defecto el clip vertical lleva dos ventanas: la cámara del streamer arriba y la pantalla (el juego) debajo.
      // Solo si quien lo pide fija un encuadre concreto (una columna con cropX o una composición propia) se respeta tal cual.
      if (!clip.layout && clip.cropX === undefined && info.width > 0 && info.height > 0) {
        clip.layout = layoutFromPreset(defaultPreset(2), info.width / info.height);
      }
      const kinds: ('horizontal' | 'vertical')[] = clip.kind === 'both' ? ['horizontal', 'vertical'] : [clip.kind as 'vertical' | 'horizontal'];
      const cropX = clip.cropX ?? 0.5;
      const ranges = keptRanges(clip.start, clip.end, clip.cuts);
      const extra: Partial<OutputItem> = { start: clip.start, end: clip.end, cropX };
      if (clip.cuts) extra.cuts = clip.cuts;
      if (clip.effects) extra.effects = clip.effects;
      if (clip.subtitles) extra.subtitles = clip.subtitles;
      if (clip.layout) extra.layout = clip.layout;
      return this.build(
        vodId,
        'clip',
        clip.title,
        totalDuration(ranges),
        // cada corte seco puede desviar unas décimas
        1.5 + ranges.length * 0.2,
        extra,
        kinds.map((k) => ({
          render: k,
          run: (input, out) =>
            withSubtitles(this.d.subtitles, vodId, clip.subtitles, ranges, k, (subs) =>
              renderClip(this.d.tools(), input, { kind: k, start: clip.start, end: clip.end, cropX, layout: clip.layout, cuts: clip.cuts, effects: clip.effects, subs }, out),
            ),
        })),
      );
    });
  }

  async createLong(vodId: string, spec: LongSpec): Promise<OutputItem> {
    const reason = validateLongSpec(spec);
    if (reason) throw new Error(`Vídeo largo no válido: ${reason}.`);
    const long = normalizeLong(spec);
    return this.d.queue.run(async () => {
      const vodDur = (await probe(this.d.tools(), this.vodFile(vodId))).durationSec;
      const bound = validateLongSpec(long, vodDur);
      if (bound) throw new Error(`Vídeo largo no válido: ${bound}.`);
      const mixed = mixedCategories((await this.d.categories?.ensure(vodId)) ?? [], long.segments);
      if (mixed) throw new Error(`Vídeo largo no válido: ${mixed}.`);
      const expected = long.segments.reduce((a, s) => a + (s.end - s.start), 0);
      // cada tramo puede desviarse unas décimas al cortar: la tolerancia crece con el número de tramos
      const tolerance = 1.5 + long.segments.length * 0.2;
      const extra: Partial<OutputItem> = { segments: long.segments };
      if (long.effects) extra.effects = long.effects;
      if (long.subtitles) extra.subtitles = long.subtitles;
      return this.build(vodId, 'long', long.title, expected, tolerance, extra, [
        {
          render: 'long',
          run: (input, out) =>
            withSubtitles(this.d.subtitles, vodId, long.subtitles, long.segments, 'long', (subs) =>
              renderLong(this.d.tools(), input, long, out, subs),
            ),
        },
      ]);
    });
  }

  /** Aplica un plan completo. Lo que falla no impide que se creen los demás vídeos. */
  async applyPlan(vodId: string, planJson: string): Promise<{ created: OutputItem[]; errors: string[] }> {
    const vodDur = await this.d.queue.run(async () => (await probe(this.d.tools(), this.vodFile(vodId))).durationSec);
    const { plan, errors } = parsePlan(planJson, vodDur);
    const created: OutputItem[] = [];
    for (const clip of plan.clips) {
      try {
        created.push(await this.createClip(vodId, clip));
      } catch (e) {
        errors.push(`"${clip.title}": ${(e as Error).message}`);
      }
    }
    if (plan.long) {
      try {
        created.push(await this.createLong(vodId, plan.long));
      } catch (e) {
        errors.push(`vídeo largo: ${(e as Error).message}`);
      }
    }
    return { created, errors };
  }
}

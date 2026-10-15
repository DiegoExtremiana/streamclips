import fs from 'node:fs';
import path from 'node:path';
import type { ClipEdit, FramingPreview, OutputItem, OutputMeta, RenderKind } from '../../shared/types';
import { MAX_TITLE_LEN, validateClipSpec, validateLongSpec } from '../../shared/plan';
import { YT_DESC_MAX, YT_PLAYLIST_MAX, YT_TITLE_MAX, hasAngle } from '../../shared/youtube';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import { extractFrame, probe, renderClip, renderLong, validateRender } from '../services/ffmpeg';
import { slug, thumbnailPath, uniqueOutputPath } from '../services/files';
import { allFiles, primaryFile, primaryRender } from '../../shared/outputs';
import { keptRanges, totalDuration } from '../../shared/timeline';
import { isSubtitleStyleId } from '../../shared/subtitles';
import { withSubtitles, type SubtitleEnv } from './subtitleJob';
import { autoThumbnail } from '../services/thumbnails';
import type { Notifier } from './notifier';

export interface LibraryDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  queue: SerialQueue;
  tools: () => ToolPaths;
  subtitles: SubtitleEnv;
}

/** Tamaño de las miniaturas elegidas a mano para vídeos largos (formato de YouTube). */
const LONG_THUMB = { width: 1280, height: 720 };

/** Edición de lo ya creado: nombre, miniatura, recorte y encuadre de los clips. */
export class LibraryService {
  constructor(private d: LibraryDeps) {}

  private find(id: string): OutputItem {
    const o = this.d.store.data.outputs.find((x) => x.id === id);
    if (!o) throw new Error('El vídeo no existe.');
    return o;
  }

  private changed(): void {
    this.d.store.save();
    this.d.notifier.changed();
  }

  /** Borra el vídeo: archivos, miniatura y publicaciones que aún no se han enviado. Lo ya publicado queda como registro. */
  remove(id: string): void {
    const o = this.find(id);
    const live = this.d.store.data.publications.find((p) => p.outputId === id && p.status === 'publishing');
    if (live) throw new Error('Se está publicando ahora mismo; espera a que termine.');
    for (const f of [...Object.values(o.files), o.thumbnail]) if (f) fs.rmSync(f, { force: true });
    this.d.store.data.outputs = this.d.store.data.outputs.filter((x) => x.id !== id);
    this.d.store.data.publications = this.d.store.data.publications.filter((p) => !(p.outputId === id && p.status !== 'published'));
    this.changed();
    this.d.log.info(`Vídeo borrado: "${o.title}"`);
  }

  rename(id: string, title: string): OutputItem {
    return this.setMeta(id, { title });
  }

  /**
   * Nombre y datos de YouTube. Todo se valida antes de cambiar nada: si un campo falla, no se guarda ninguno.
   * Descripción, lista y visibilidad son solo de los vídeos largos.
   */
  setMeta(id: string, meta: OutputMeta): OutputItem {
    const o = this.find(id);
    const next: Partial<OutputItem> = {};
    if (meta.title !== undefined) {
      if (typeof meta.title !== 'string') throw new Error('El nombre no es válido.');
      const t = meta.title.trim();
      if (!t) throw new Error('El nombre no puede estar vacío.');
      const max = o.kind === 'long' ? YT_TITLE_MAX : MAX_TITLE_LEN;
      if (t.length > max) throw new Error(`El nombre no puede pasar de ${max} caracteres.`);
      if (o.kind === 'long' && hasAngle(t)) throw new Error('El nombre no puede contener < ni > (YouTube no los admite).');
      next.title = t;
    }
    const youtubeOnly = meta.description !== undefined || meta.playlist !== undefined || meta.visibility !== undefined;
    if (youtubeOnly && o.kind !== 'long') throw new Error('La descripción, la lista y la visibilidad son solo de los vídeos largos.');
    if (meta.description !== undefined) {
      if (typeof meta.description !== 'string') throw new Error('La descripción no es válida.');
      const d = meta.description.replace(/\s+$/, '');
      if (d.length > YT_DESC_MAX) throw new Error(`La descripción no puede pasar de ${YT_DESC_MAX} caracteres.`);
      if (hasAngle(d)) throw new Error('La descripción no puede contener < ni > (YouTube no los admite).');
      next.description = d || undefined;
    }
    if (meta.playlist !== undefined) {
      if (typeof meta.playlist !== 'string') throw new Error('La lista no es válida.');
      const p = meta.playlist.trim();
      if (p.length > YT_PLAYLIST_MAX) throw new Error(`El nombre de la lista no puede pasar de ${YT_PLAYLIST_MAX} caracteres.`);
      if (hasAngle(p)) throw new Error('El nombre de la lista no puede contener < ni >.');
      next.playlist = p || undefined;
    }
    if (meta.visibility !== undefined) {
      if (meta.visibility !== 'public' && meta.visibility !== 'private') throw new Error('La visibilidad debe ser pública o privada.');
      next.visibility = meta.visibility;
    }
    Object.assign(o, next);
    this.changed();
    return o;
  }

  /** Cambia la miniatura guardada y borra la anterior solo después de haber registrado la nueva. */
  private swapThumbnail(o: OutputItem, next: string): void {
    const old = o.thumbnail;
    o.thumbnail = next;
    this.changed();
    if (old && old !== next) fs.rmSync(old, { force: true });
  }

  setThumbnailFromFrame(id: string, atSec: number): Promise<OutputItem> {
    if (typeof atSec !== 'number' || !Number.isFinite(atSec) || atSec < 0) throw new Error('Instante no válido.');
    return this.d.queue.run(async () => {
      const o = this.find(id);
      const src = primaryFile(o);
      if (!src || !fs.existsSync(src)) throw new Error('El archivo del vídeo ya no está en su sitio.');
      const at = Math.min(atSec, Math.max(0, o.durationSec - 0.2));
      const out = thumbnailPath(this.d.store.data.settings.outputDir, o.id);
      await extractFrame(this.d.tools(), src, at, out, o.kind === 'long' ? LONG_THUMB : { maxWidth: primaryRender(o) === 'vertical' ? 360 : 640 });
      this.swapThumbnail(o, out);
      return o;
    });
  }

  /** Imagen elegida por el usuario: se convierte a JPG de 1280×720 (cualquier formato que lea ffmpeg). */
  setThumbnailFromImage(id: string, imagePath: string): Promise<OutputItem> {
    return this.d.queue.run(async () => {
      const o = this.find(id);
      if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) throw new Error('La imagen no existe.');
      const out = thumbnailPath(this.d.store.data.settings.outputDir, o.id);
      try {
        await extractFrame(this.d.tools(), imagePath, 0, out, LONG_THUMB, true);
      } catch {
        throw new Error('No se pudo leer esa imagen. Prueba con un JPG o PNG.');
      }
      this.swapThumbnail(o, out);
      return o;
    });
  }

  /**
   * Recorta o reencuadra un clip volviendo a renderizar sus dos versiones desde el VOD
   * (también sirve para recuperar la versión que faltara). Los archivos nuevos se validan antes de
   * sustituir a los anteriores; si algo falla no cambia nada.
   */
  reeditClip(id: string, edit: ClipEdit): Promise<OutputItem> {
    return this.d.queue.run(async () => {
      const o = this.find(id);
      if (o.kind === 'long') return this.reeditLong(o, edit);
      if (o.vodId === undefined || o.start === undefined || o.end === undefined) {
        throw new Error('Este clip es anterior a la Biblioteca y no guarda de qué parte del VOD sale.');
      }
      if (this.d.store.data.publications.some((p) => p.outputId === id && p.status === 'publishing')) {
        throw new Error('Se está publicando ahora mismo; espera a que termine.');
      }
      const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
      if (!vod?.filePath || !fs.existsSync(vod.filePath)) {
        throw new Error('El VOD de origen ya no está en su sitio (¿lo has movido o borrado?).');
      }
      const start = edit.start ?? o.start;
      const end = edit.end ?? o.end;
      const cropX = edit.cropX ?? o.cropX ?? 0.5;
      if (edit.subtitles !== undefined && edit.subtitles !== null && !isSubtitleStyleId(edit.subtitles)) {
        throw new Error('El estilo de subtítulos no existe.');
      }
      const subtitles = edit.subtitles === undefined ? o.subtitles : (edit.subtitles ?? undefined);
      // al cambiar el tramo, los cortes y acercamientos que ya no caen dentro dejan de tener sentido
      const cuts = o.cuts?.filter((c) => c.start >= start && c.end <= end);
      const effects = o.effects?.filter((e) => e.type !== 'punch' || (e.at >= start && e.at <= end));
      const vodDur = (await probe(this.d.tools(), vod.filePath)).durationSec;
      const reason = validateClipSpec({ kind: 'both', start, end, title: o.title, cropX, cuts, effects, subtitles }, vodDur);
      if (reason) throw new Error(`Clip no válido: ${reason}.`);
      const ranges = keptRanges(start, end, cuts);
      const expected = totalDuration(ranges);

      const outDir = this.d.store.data.settings.outputDir;
      const written: string[] = [];
      let thumb: string | undefined;
      try {
        const files: OutputItem['files'] = {};
        let durationSec = expected;
        for (const kind of ['horizontal', 'vertical'] as const) {
          const out = uniqueOutputPath(outDir, kind, o.title);
          written.push(out);
          await withSubtitles(this.d.subtitles, o.vodId, subtitles, ranges, kind, (subs) =>
            renderClip(this.d.tools(), vod.filePath!, { kind, start, end, cropX, cuts, effects, subs }, out),
          );
          const info = await validateRender(this.d.tools(), out, kind, expected, 1.5 + ranges.length * 0.2);
          files[kind] = out;
          if (kind === 'horizontal') durationSec = info.durationSec;
        }
        try {
          thumb = await autoThumbnail(this.d.tools(), outDir, o.id, 'horizontal', files.horizontal!, durationSec);
        } catch (e) {
          this.d.log.warn(`Sin miniatura para "${o.title}": ${(e as Error).message}`);
        }
        const oldFiles = allFiles(o);
        const oldThumb = o.thumbnail;
        o.files = files;
        o.durationSec = durationSec;
        o.start = start;
        o.end = end;
        o.cropX = cropX;
        o.cuts = cuts?.length ? cuts : undefined;
        o.effects = effects?.length ? effects : undefined;
        o.subtitles = subtitles;
        o.thumbnail = thumb;
        this.changed();
        for (const f of oldFiles) fs.rmSync(f, { force: true });
        if (oldThumb) fs.rmSync(oldThumb, { force: true });
        this.d.log.info(`Clip reeditado: "${o.title}"`);
        return o;
      } catch (e) {
        for (const f of written) fs.rmSync(f, { force: true });
        if (thumb) fs.rmSync(thumb, { force: true });
        this.d.log.error(`Reedición fallida ("${o.title}")`, e);
        throw e;
      }
    });
  }

  /** Vídeo largo: solo cambian los subtítulos; se monta de nuevo desde los tramos guardados. */
  private async reeditLong(o: OutputItem, edit: ClipEdit): Promise<OutputItem> {
    if (edit.start !== undefined || edit.end !== undefined || edit.cropX !== undefined) {
      throw new Error('En un vídeo largo solo se pueden cambiar los subtítulos.');
    }
    if (!o.segments?.length || o.vodId === undefined) throw new Error('Este vídeo es anterior a esta versión y no guarda de qué tramos sale, así que no se puede volver a montar.');
    if (edit.subtitles !== undefined && edit.subtitles !== null && !isSubtitleStyleId(edit.subtitles)) throw new Error('El estilo de subtítulos no existe.');
    if (this.d.store.data.publications.some((p) => p.outputId === o.id && p.status === 'publishing')) {
      throw new Error('Se está publicando ahora mismo; espera a que termine.');
    }
    const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
    if (!vod?.filePath || !fs.existsSync(vod.filePath)) throw new Error('El VOD de origen ya no está en su sitio (¿lo has movido o borrado?).');
    const subtitles = edit.subtitles === undefined ? o.subtitles : (edit.subtitles ?? undefined);
    const spec = { title: o.title, segments: o.segments, effects: o.effects, subtitles };
    const vodDur = (await probe(this.d.tools(), vod.filePath)).durationSec;
    const reason = validateLongSpec(spec, vodDur);
    if (reason) throw new Error(`Vídeo largo no válido: ${reason}.`);
    const expected = totalDuration(o.segments);
    const out = uniqueOutputPath(this.d.store.data.settings.outputDir, 'long', o.title);
    try {
      await withSubtitles(this.d.subtitles, o.vodId, subtitles, o.segments, 'long', (subs) =>
        renderLong(this.d.tools(), vod.filePath!, spec, out, subs),
      );
      const info = await validateRender(this.d.tools(), out, 'long', expected, 1.5 + o.segments.length * 0.2);
      const old = allFiles(o);
      o.files = { long: out };
      o.durationSec = info.durationSec;
      o.subtitles = subtitles;
      this.changed();
      for (const f of old) fs.rmSync(f, { force: true });
      this.d.log.info(`Vídeo largo montado de nuevo: "${o.title}"`);
      return o;
    } catch (e) {
      fs.rmSync(out, { force: true });
      this.d.log.error(`Reedición fallida ("${o.title}")`, e);
      throw e;
    }
  }

  /** Nombre sugerido al guardar una versión. Lanza si esa versión no existe. */
  exportName(id: string, version: RenderKind): string {
    const o = this.find(id);
    const f = o.files[version];
    if (!f || !fs.existsSync(f)) {
      throw new Error(version === 'long' ? 'El archivo del vídeo ya no está en su sitio.' : `Este clip no tiene versión ${version === 'vertical' ? 'vertical' : 'horizontal'} disponible.`);
    }
    return `${slug(o.title)}${o.kind === 'long' ? '' : `-${version}`}.mp4`;
  }

  /** Copia la versión elegida al destino indicado (sobrescribe si el usuario lo confirmó en el cuadro de guardado). */
  async exportFile(id: string, version: RenderKind, dest: string): Promise<string> {
    this.exportName(id, version); // valida
    const o = this.find(id);
    const src = o.files[version]!;
    if (!path.isAbsolute(dest)) throw new Error('La ruta de destino no es válida.');
    const target = /\.mp4$/i.test(dest) ? dest : `${dest}.mp4`;
    if (path.resolve(target) === path.resolve(src)) throw new Error('El destino es el propio archivo.');
    if (!fs.existsSync(path.dirname(target))) throw new Error('La carpeta de destino no existe.');
    const tmp = `${target}.parte`;
    try {
      await fs.promises.copyFile(src, tmp); // se copia a un temporal: un fallo no deja un MP4 a medias ni pisa uno bueno
      await fs.promises.rename(tmp, target);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`No se pudo guardar el archivo: ${(e as Error).message}`);
    }
    return target;
  }

  /** Fotograma completo del VOD en medio del clip, para colocar el recuadro vertical sobre él. */
  framingPreview(id: string): Promise<FramingPreview> {
    return this.d.queue.run(async () => {
      const o = this.find(id);
      if (o.kind !== 'clip') throw new Error('Solo los clips tienen encuadre.');
      const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
      if (o.start === undefined || o.end === undefined || !vod?.filePath || !fs.existsSync(vod.filePath)) {
        throw new Error('No hay VOD de origen para mostrar el encuadre.');
      }
      const tmp = thumbnailPath(this.d.store.data.settings.outputDir, `preview-${o.id}`);
      try {
        await extractFrame(this.d.tools(), vod.filePath, (o.start + o.end) / 2, tmp, { maxWidth: 640 });
        const info = await probe(this.d.tools(), tmp);
        return { dataUrl: `data:image/jpeg;base64,${fs.readFileSync(tmp).toString('base64')}`, width: info.width, height: info.height };
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    });
  }

  /** Genera la miniatura de los vídeos que no la tienen (anteriores a la Biblioteca o con un fallo previo). */
  async backfillThumbnails(): Promise<number> {
    const missing = this.d.store.data.outputs.filter((o) => !o.thumbnail || !fs.existsSync(o.thumbnail));
    let n = 0;
    for (const o of missing) {
      await this.d.queue.run(async () => {
        const k = primaryRender(o);
        const f = primaryFile(o);
        if (!k || !f || !fs.existsSync(f)) return;
        try {
          const t = await autoThumbnail(this.d.tools(), this.d.store.data.settings.outputDir, o.id, k, f, o.durationSec);
          o.thumbnail = t;
          this.changed();
          n++;
        } catch (e) {
          this.d.log.warn(`Sin miniatura para "${o.title}": ${(e as Error).message}`);
        }
      });
    }
    return n;
  }
}

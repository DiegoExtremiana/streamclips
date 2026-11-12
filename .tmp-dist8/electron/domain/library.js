"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LibraryService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const plan_1 = require("../../shared/plan");
const youtube_1 = require("../../shared/youtube");
const ffmpeg_1 = require("../services/ffmpeg");
const files_1 = require("../services/files");
const outputs_1 = require("../../shared/outputs");
const timeline_1 = require("../../shared/timeline");
const layout_1 = require("../../shared/layout");
const subtitles_1 = require("../../shared/subtitles");
const subtitleJob_1 = require("./subtitleJob");
const thumbnails_1 = require("../services/thumbnails");
/** Tamaño de las miniaturas elegidas a mano para vídeos largos (formato de YouTube). */
const LONG_THUMB = { width: 1280, height: 720 };
/** Edición de lo ya creado: nombre, miniatura, recorte y encuadre de los clips. */
class LibraryService {
    d;
    constructor(d) {
        this.d = d;
    }
    find(id) {
        const o = this.d.store.data.outputs.find((x) => x.id === id);
        if (!o)
            throw new Error('El vídeo no existe.');
        return o;
    }
    changed() {
        this.d.store.save();
        this.d.notifier.changed();
    }
    /**
     * Borra el vídeo: archivos, miniatura y publicaciones que aún no se han enviado. Lo ya publicado queda como registro.
     * El VOD de origen no se toca. Primero se quita del programa y después se borran los archivos: si Windows tiene
     * alguno abierto (p. ej. el reproductor) se reintenta y, si no hay manera, se avisa en el registro sin dejar datos a medias.
     */
    remove(id) {
        const o = this.find(id);
        const live = this.d.store.data.publications.find((p) => p.outputId === id && (p.status === 'publishing' || p.cloud?.state === 'publishing'));
        if (live)
            throw new Error('Se está publicando ahora mismo; espera a que termine.');
        this.d.store.data.outputs = this.d.store.data.outputs.filter((x) => x.id !== id);
        this.d.store.data.publications = this.d.store.data.publications.filter((p) => !(p.outputId === id && p.status !== 'published'));
        this.changed();
        const filesLeft = [];
        for (const f of [...Object.values(o.files), o.thumbnail]) {
            if (!f)
                continue;
            try {
                node_fs_1.default.rmSync(f, { force: true, maxRetries: 4, retryDelay: 150 });
            }
            catch (e) {
                filesLeft.push(f);
                this.d.log.warn(`No se pudo borrar ${f}: ${e.message}`);
            }
        }
        this.d.log.info(`Vídeo borrado: "${o.title}"${filesLeft.length ? ` (quedan ${filesLeft.length} archivo(s) sin borrar)` : ''}`);
        return { filesLeft };
    }
    /**
     * Cuando un vídeo o clip ya está publicado en todas las redes en las que se programó, se borra (archivos incluidos):
     * lo publicado queda como registro. Se desactiva en el piloto automático. Devuelve si se borró.
     */
    purgeIfPublished(id) {
        if (this.d.store.data.settings.autopilot.purgePublished === false)
            return false;
        const o = this.d.store.data.outputs.find((x) => x.id === id);
        if (!o)
            return false;
        const pubs = this.d.store.data.publications.filter((p) => p.outputId === id);
        if (!pubs.length || pubs.some((p) => p.status !== 'published'))
            return false;
        try {
            this.remove(id);
            this.d.log.info(`Publicado en todas sus redes: "${o.title}" se borra del disco.`);
            return true;
        }
        catch (e) {
            this.d.log.warn(`No se pudo borrar "${o.title}" tras publicarlo: ${e.message}`);
            return false;
        }
    }
    /** Borra varios. Cada uno es independiente: si uno falla, los demás se borran igualmente. */
    removeMany(ids) {
        const out = { removed: 0, errors: [], filesLeft: [] };
        for (const id of [...new Set(ids)]) {
            const title = this.d.store.data.outputs.find((x) => x.id === id)?.title ?? id;
            try {
                out.filesLeft.push(...this.remove(id).filesLeft);
                out.removed++;
            }
            catch (e) {
                out.errors.push({ id, title, reason: e.message });
            }
        }
        return out;
    }
    /** Nombre puesto por el programa: se puede volver a cambiar solo, a diferencia de uno escrito por el usuario. */
    setAutoTitle(id, title) {
        const o = this.find(id);
        o.title = title;
        o.titleSource = 'auto';
        this.changed();
        return o;
    }
    /** Descripción escrita por el programa: se puede rehacer sola, a diferencia de una escrita por el usuario. */
    setAutoDescription(id, description) {
        const o = this.find(id);
        o.description = description.replace(/\s+$/, '').slice(0, youtube_1.YT_DESC_MAX) || undefined;
        o.descSource = o.description ? 'auto' : undefined;
        this.changed();
        return o;
    }
    rename(id, title) {
        return this.setMeta(id, { title });
    }
    /**
     * Nombre y datos de YouTube. Todo se valida antes de cambiar nada: si un campo falla, no se guarda ninguno.
     * Descripción, lista y visibilidad valen para vídeos y clips (los clips salen como Shorts en YouTube).
     */
    setMeta(id, meta) {
        const o = this.find(id);
        const next = {};
        if (meta.title !== undefined) {
            if (typeof meta.title !== 'string')
                throw new Error('El nombre no es válido.');
            const t = meta.title.trim();
            if (!t)
                throw new Error('El nombre no puede estar vacío.');
            const max = o.kind === 'long' ? youtube_1.YT_TITLE_MAX : plan_1.MAX_TITLE_LEN;
            if (t.length > max)
                throw new Error(`El nombre no puede pasar de ${max} caracteres.`);
            if (o.kind === 'long' && (0, youtube_1.hasAngle)(t))
                throw new Error('El nombre no puede contener < ni > (YouTube no los admite).');
            next.title = t;
            if (t !== o.title)
                next.titleSource = 'manual';
        }
        if (meta.description !== undefined) {
            if (typeof meta.description !== 'string')
                throw new Error('La descripción no es válida.');
            const d = meta.description.replace(/\s+$/, '');
            if (d.length > youtube_1.YT_DESC_MAX)
                throw new Error(`La descripción no puede pasar de ${youtube_1.YT_DESC_MAX} caracteres.`);
            if ((0, youtube_1.hasAngle)(d))
                throw new Error('La descripción no puede contener < ni > (YouTube no los admite).');
            next.description = d || undefined;
            if (d !== (o.description ?? ''))
                next.descSource = d ? 'manual' : undefined;
        }
        if (meta.playlist !== undefined) {
            if (typeof meta.playlist !== 'string')
                throw new Error('La lista no es válida.');
            const p = meta.playlist.trim();
            if (p.length > youtube_1.YT_PLAYLIST_MAX)
                throw new Error(`El nombre de la lista no puede pasar de ${youtube_1.YT_PLAYLIST_MAX} caracteres.`);
            if ((0, youtube_1.hasAngle)(p))
                throw new Error('El nombre de la lista no puede contener < ni >.');
            next.playlist = p || undefined;
        }
        if (meta.visibility !== undefined) {
            if (meta.visibility !== 'public' && meta.visibility !== 'private')
                throw new Error('La visibilidad debe ser pública o privada.');
            next.visibility = meta.visibility;
        }
        Object.assign(o, next);
        this.changed();
        return o;
    }
    /** Opciones de la portada con estilo: frase del título, fuente y el interruptor de Ajustes. */
    coverOpts(title) {
        return { title, styled: this.d.store.data.settings.autopilot.styledCovers !== false, fontsDir: this.d.subtitles.fontsDir };
    }
    /** Cambia la miniatura guardada y borra la anterior solo después de haber registrado la nueva. */
    swapThumbnail(o, next) {
        const old = o.thumbnail;
        o.thumbnail = next;
        this.changed();
        if (old && old !== next)
            node_fs_1.default.rmSync(old, { force: true });
    }
    setThumbnailFromFrame(id, atSec) {
        if (typeof atSec !== 'number' || !Number.isFinite(atSec) || atSec < 0)
            throw new Error('Instante no válido.');
        return this.d.queue.run(async () => {
            const o = this.find(id);
            const src = (0, outputs_1.primaryFile)(o);
            if (!src || !node_fs_1.default.existsSync(src))
                throw new Error('El archivo del vídeo ya no está en su sitio.');
            const at = Math.min(atSec, Math.max(0, o.durationSec - 0.2));
            const out = (0, files_1.thumbnailPath)(this.d.store.data.settings.outputDir, o.id);
            await (0, ffmpeg_1.extractFrame)(this.d.tools(), src, at, out, o.kind === 'long' ? LONG_THUMB : { maxWidth: (0, outputs_1.primaryRender)(o) === 'vertical' ? 360 : 640 });
            this.swapThumbnail(o, out);
            return o;
        });
    }
    /** Imagen elegida por el usuario: se convierte a JPG de 1280×720 (cualquier formato que lea ffmpeg). */
    setThumbnailFromImage(id, imagePath) {
        return this.d.queue.run(async () => {
            const o = this.find(id);
            if (!node_fs_1.default.existsSync(imagePath) || !node_fs_1.default.statSync(imagePath).isFile())
                throw new Error('La imagen no existe.');
            const out = (0, files_1.thumbnailPath)(this.d.store.data.settings.outputDir, o.id);
            try {
                await (0, ffmpeg_1.extractFrame)(this.d.tools(), imagePath, 0, out, LONG_THUMB, true);
            }
            catch {
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
    async reeditClip(id, edit) {
        // si el directo se borró para liberar espacio, se vuelve a descargar ANTES de ocupar la cola de montaje
        const src = this.find(id).vodId;
        if (src)
            await this.d.source?.(src);
        return this.d.queue.run(async () => {
            const o = this.find(id);
            if (o.kind === 'long')
                return this.reeditLong(o, edit);
            if (o.vodId === undefined || o.start === undefined || o.end === undefined) {
                throw new Error('Este clip es anterior a la Biblioteca y no guarda de qué parte del VOD sale.');
            }
            if (this.d.store.data.publications.some((p) => p.outputId === id && p.status === 'publishing')) {
                throw new Error('Se está publicando ahora mismo; espera a que termine.');
            }
            const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
            if (!vod?.filePath || !node_fs_1.default.existsSync(vod.filePath)) {
                throw new Error('El VOD de origen ya no está en su sitio (¿lo has movido o borrado?).');
            }
            const start = edit.start ?? o.start;
            const end = edit.end ?? o.end;
            const cropX = edit.cropX ?? o.cropX ?? 0.5;
            // la composición pedida manda; null vuelve al encuadre simple; sin valor se conserva la que tenga
            let layout = edit.layout === undefined ? o.layout : (edit.layout ?? undefined);
            if (edit.cropX !== undefined && edit.layout === undefined)
                layout = undefined; // un encuadre simple nuevo sustituye a la composición
            if (layout) {
                const lr = (0, layout_1.validateLayout)(layout);
                if (lr)
                    throw new Error(`Composición no válida: ${lr}.`);
                layout = (0, layout_1.normalizeLayout)(layout);
            }
            if (edit.subtitles !== undefined && edit.subtitles !== null && !(0, subtitles_1.isSubtitleStyleId)(edit.subtitles)) {
                throw new Error('El estilo de subtítulos no existe.');
            }
            const subtitles = edit.subtitles === undefined ? o.subtitles : (edit.subtitles ?? undefined);
            // al cambiar el tramo, los cortes y acercamientos que ya no caen dentro dejan de tener sentido
            const cuts = o.cuts?.filter((c) => c.start >= start && c.end <= end);
            const effects = o.effects?.filter((e) => e.type !== 'punch' || (e.at >= start && e.at <= end));
            const vodDur = (await (0, ffmpeg_1.probe)(this.d.tools(), vod.filePath)).durationSec;
            const reason = (0, plan_1.validateClipSpec)({ kind: 'both', start, end, title: o.title, cropX, layout, cuts, effects, subtitles }, vodDur);
            if (reason)
                throw new Error(`Clip no válido: ${reason}.`);
            const ranges = (0, timeline_1.keptRanges)(start, end, cuts);
            const expected = (0, timeline_1.totalDuration)(ranges);
            const outDir = this.d.store.data.settings.outputDir;
            const written = [];
            let thumb;
            try {
                const files = {};
                let durationSec = expected;
                for (const kind of ['horizontal', 'vertical']) {
                    const out = (0, files_1.uniqueOutputPath)(outDir, kind, o.title);
                    written.push(out);
                    await (0, subtitleJob_1.withSubtitles)(this.d.subtitles, o.vodId, subtitles, ranges, kind, (subs) => (0, ffmpeg_1.renderClip)(this.d.tools(), vod.filePath, { kind, start, end, cropX, layout, cuts, effects, subs }, out));
                    const info = await (0, ffmpeg_1.validateRender)(this.d.tools(), out, kind, expected, 1.5 + ranges.length * 0.2);
                    files[kind] = out;
                    if (kind === 'horizontal')
                        durationSec = info.durationSec;
                }
                try {
                    thumb = await (0, thumbnails_1.autoThumbnail)(this.d.tools(), outDir, o.id, 'horizontal', files.horizontal, durationSec, this.coverOpts(o.title));
                }
                catch (e) {
                    this.d.log.warn(`Sin miniatura para "${o.title}": ${e.message}`);
                }
                const oldFiles = (0, outputs_1.allFiles)(o);
                const oldThumb = o.thumbnail;
                o.files = files;
                o.durationSec = durationSec;
                o.start = start;
                o.end = end;
                o.cropX = cropX;
                o.layout = layout;
                o.cuts = cuts?.length ? cuts : undefined;
                o.effects = effects?.length ? effects : undefined;
                o.subtitles = subtitles;
                o.thumbnail = thumb;
                this.changed();
                for (const f of oldFiles)
                    node_fs_1.default.rmSync(f, { force: true });
                if (oldThumb)
                    node_fs_1.default.rmSync(oldThumb, { force: true });
                this.d.log.info(`Clip reeditado: "${o.title}"`);
                return o;
            }
            catch (e) {
                for (const f of written)
                    node_fs_1.default.rmSync(f, { force: true });
                if (thumb)
                    node_fs_1.default.rmSync(thumb, { force: true });
                this.d.log.error(`Reedición fallida ("${o.title}")`, e);
                throw e;
            }
        });
    }
    /** Vídeo largo: solo cambian los subtítulos; se monta de nuevo desde los tramos guardados. */
    async reeditLong(o, edit) {
        if (edit.start !== undefined || edit.end !== undefined || edit.cropX !== undefined || edit.layout !== undefined) {
            throw new Error('En un vídeo largo solo se pueden cambiar los subtítulos.');
        }
        if (!o.segments?.length || o.vodId === undefined)
            throw new Error('Este vídeo es anterior a esta versión y no guarda de qué tramos sale, así que no se puede volver a montar.');
        if (edit.subtitles !== undefined && edit.subtitles !== null && !(0, subtitles_1.isSubtitleStyleId)(edit.subtitles))
            throw new Error('El estilo de subtítulos no existe.');
        if (this.d.store.data.publications.some((p) => p.outputId === o.id && p.status === 'publishing')) {
            throw new Error('Se está publicando ahora mismo; espera a que termine.');
        }
        const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
        if (!vod?.filePath || !node_fs_1.default.existsSync(vod.filePath))
            throw new Error('El VOD de origen ya no está en su sitio (¿lo has movido o borrado?).');
        const subtitles = edit.subtitles === undefined ? o.subtitles : (edit.subtitles ?? undefined);
        const spec = { title: o.title, segments: o.segments, effects: o.effects, subtitles };
        const vodDur = (await (0, ffmpeg_1.probe)(this.d.tools(), vod.filePath)).durationSec;
        const reason = (0, plan_1.validateLongSpec)(spec, vodDur);
        if (reason)
            throw new Error(`Vídeo largo no válido: ${reason}.`);
        const expected = (0, timeline_1.totalDuration)(o.segments);
        const out = (0, files_1.uniqueOutputPath)(this.d.store.data.settings.outputDir, 'long', o.title);
        try {
            await (0, subtitleJob_1.withSubtitles)(this.d.subtitles, o.vodId, subtitles, o.segments, 'long', (subs) => (0, ffmpeg_1.renderLong)(this.d.tools(), vod.filePath, spec, out, subs));
            const info = await (0, ffmpeg_1.validateRender)(this.d.tools(), out, 'long', expected, 1.5 + o.segments.length * 0.2);
            const old = (0, outputs_1.allFiles)(o);
            o.files = { long: out };
            o.durationSec = info.durationSec;
            o.subtitles = subtitles;
            this.changed();
            for (const f of old)
                node_fs_1.default.rmSync(f, { force: true });
            this.d.log.info(`Vídeo largo montado de nuevo: "${o.title}"`);
            return o;
        }
        catch (e) {
            node_fs_1.default.rmSync(out, { force: true });
            this.d.log.error(`Reedición fallida ("${o.title}")`, e);
            throw e;
        }
    }
    /** Nombre sugerido al guardar una versión. Lanza si esa versión no existe. */
    exportName(id, version) {
        const o = this.find(id);
        const f = o.files[version];
        if (!f || !node_fs_1.default.existsSync(f)) {
            throw new Error(version === 'long' ? 'El archivo del vídeo ya no está en su sitio.' : `Este clip no tiene versión ${version === 'vertical' ? 'vertical' : 'horizontal'} disponible.`);
        }
        return `${(0, files_1.slug)(o.title)}${o.kind === 'long' ? '' : `-${version}`}.mp4`;
    }
    /** Copia la versión elegida al destino indicado (sobrescribe si el usuario lo confirmó en el cuadro de guardado). */
    async exportFile(id, version, dest) {
        this.exportName(id, version); // valida
        const o = this.find(id);
        const src = o.files[version];
        if (!node_path_1.default.isAbsolute(dest))
            throw new Error('La ruta de destino no es válida.');
        const target = /\.mp4$/i.test(dest) ? dest : `${dest}.mp4`;
        if (node_path_1.default.resolve(target) === node_path_1.default.resolve(src))
            throw new Error('El destino es el propio archivo.');
        if (!node_fs_1.default.existsSync(node_path_1.default.dirname(target)))
            throw new Error('La carpeta de destino no existe.');
        const tmp = `${target}.parte`;
        try {
            await node_fs_1.default.promises.copyFile(src, tmp); // se copia a un temporal: un fallo no deja un MP4 a medias ni pisa uno bueno
            await node_fs_1.default.promises.rename(tmp, target);
        }
        catch (e) {
            node_fs_1.default.rmSync(tmp, { force: true });
            throw new Error(`No se pudo guardar el archivo: ${e.message}`);
        }
        return target;
    }
    /** Fotograma completo del VOD en medio del clip, para colocar el recuadro vertical sobre él. */
    /** Datos del directo de origen para dibujar la línea de tiempo del recorte (null si ya no está el archivo). */
    async clipContext(id) {
        const o = this.find(id);
        const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
        if (!vod?.filePath || !node_fs_1.default.existsSync(vod.filePath))
            return { vodDurationSec: null };
        if (vod.durationSec)
            return { vodDurationSec: vod.durationSec };
        try {
            return { vodDurationSec: (await (0, ffmpeg_1.probe)(this.d.tools(), vod.filePath)).durationSec };
        }
        catch {
            return { vodDurationSec: null };
        }
    }
    framingPreview(id) {
        return this.d.queue.run(async () => {
            const o = this.find(id);
            if (o.kind !== 'clip')
                throw new Error('Solo los clips tienen encuadre.');
            const vod = this.d.store.data.vods.find((v) => v.id === o.vodId);
            if (o.start === undefined || o.end === undefined || !vod?.filePath || !node_fs_1.default.existsSync(vod.filePath)) {
                throw new Error('No hay VOD de origen para mostrar el encuadre.');
            }
            const tmp = (0, files_1.thumbnailPath)(this.d.store.data.settings.outputDir, `preview-${o.id}`);
            try {
                await (0, ffmpeg_1.extractFrame)(this.d.tools(), vod.filePath, (o.start + o.end) / 2, tmp, { maxWidth: 640 });
                const info = await (0, ffmpeg_1.probe)(this.d.tools(), tmp);
                return { dataUrl: `data:image/jpeg;base64,${node_fs_1.default.readFileSync(tmp).toString('base64')}`, width: info.width, height: info.height };
            }
            finally {
                node_fs_1.default.rmSync(tmp, { force: true });
            }
        });
    }
    /** Genera la miniatura de los vídeos que no la tienen (anteriores a la Biblioteca o con un fallo previo). */
    async backfillThumbnails() {
        const missing = this.d.store.data.outputs.filter((o) => !o.thumbnail || !node_fs_1.default.existsSync(o.thumbnail));
        let n = 0;
        for (const o of missing) {
            await this.d.queue.run(async () => {
                const k = (0, outputs_1.primaryRender)(o);
                const f = (0, outputs_1.primaryFile)(o);
                if (!k || !f || !node_fs_1.default.existsSync(f))
                    return;
                try {
                    const t = await (0, thumbnails_1.autoThumbnail)(this.d.tools(), this.d.store.data.settings.outputDir, o.id, k, f, o.durationSec, this.coverOpts(o.title));
                    o.thumbnail = t;
                    this.changed();
                    n++;
                }
                catch (e) {
                    this.d.log.warn(`Sin miniatura para "${o.title}": ${e.message}`);
                }
            });
        }
        return n;
    }
}
exports.LibraryService = LibraryService;

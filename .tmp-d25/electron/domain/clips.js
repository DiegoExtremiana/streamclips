"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClipService = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const outputs_1 = require("../../shared/outputs");
const layout_1 = require("../../shared/layout");
const timeline_1 = require("../../shared/timeline");
const subtitleJob_1 = require("./subtitleJob");
const plan_1 = require("../../shared/plan");
const files_1 = require("../services/files");
const thumbnails_1 = require("../services/thumbnails");
const ffmpeg_1 = require("../services/ffmpeg");
const categories_1 = require("../../shared/categories");
class ClipService {
    d;
    constructor(d) {
        this.d = d;
    }
    vodFile(vodId) {
        const vod = this.d.store.data.vods.find((v) => v.id === vodId);
        if (!vod)
            throw new Error('El VOD no existe.');
        if (vod.status !== 'downloaded' || !vod.filePath)
            throw new Error('El VOD todavía no está descargado.');
        if (!node_fs_1.default.existsSync(vod.filePath))
            throw new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).');
        return vod.filePath;
    }
    /**
     * Renderiza todas las versiones pedidas, las valida y solo entonces registra el elemento.
     * Si cualquiera falla se borran todos los archivos: lo que no ha pasado la validación nunca llega a la Biblioteca.
     */
    async build(vodId, kind, title, expectedSec, tolerance, extra, renders) {
        const input = this.vodFile(vodId);
        const outDir = this.d.store.data.settings.outputDir;
        const written = [];
        try {
            (0, files_1.ensureFreeSpace)(outDir, files_1.RENDER_MIN_BYTES, 'montar el vídeo', this.d.freeBytes ?? files_1.freeBytes);
            const files = {};
            let durationSec = expectedSec;
            for (const [i, r] of renders.entries()) {
                const out = (0, files_1.uniqueOutputPath)(outDir, r.render, title);
                written.push(out);
                await r.run(input, out);
                const info = await (0, ffmpeg_1.validateRender)(this.d.tools(), out, r.render, expectedSec, tolerance);
                files[r.render] = out;
                if (i === 0)
                    durationSec = info.durationSec;
            }
            const item = {
                id: node_crypto_1.default.randomUUID(),
                vodId,
                kind,
                title,
                files,
                durationSec,
                createdAt: new Date().toISOString(),
                ...extra,
            };
            // La miniatura es un extra: si falla, el elemento (ya validado) se conserva sin ella.
            const main = (0, outputs_1.primaryRender)(item);
            try {
                if (main)
                    item.thumbnail = await (0, thumbnails_1.autoThumbnail)(this.d.tools(), outDir, item.id, main, files[main], durationSec, this.coverOpts(title));
            }
            catch (e) {
                this.d.log.warn(`Sin miniatura para "${title}": ${e.message}`);
            }
            this.d.store.data.outputs.unshift(item);
            this.d.store.save();
            this.d.notifier.changed();
            this.d.log.info(`Render validado (${renders.map((r) => r.render).join('+')}): "${title}"`);
            return item;
        }
        catch (e) {
            for (const f of written)
                node_fs_1.default.rmSync(f, { force: true });
            this.d.log.error(`Render fallido ("${title}")`, e);
            throw e;
        }
    }
    /** Opciones de la portada con estilo: frase del título, fuente y el interruptor de Ajustes. */
    coverOpts(title) {
        return { title, styled: this.d.store.data.settings.autopilot.styledCovers !== false, fontsDir: this.d.subtitles.fontsDir };
    }
    /** Duración real del VOD descargado. */
    async vodDuration(vodId) {
        await this.d.source?.(vodId);
        return this.d.queue.run(async () => (await (0, ffmpeg_1.probe)(this.d.tools(), this.vodFile(vodId))).durationSec);
    }
    async createClip(vodId, spec) {
        const reason = (0, plan_1.validateClipSpec)(spec);
        if (reason)
            throw new Error(`Clip no válido: ${reason}.`);
        const clip = (0, plan_1.normalizeClip)(spec, 'Clip');
        await this.d.source?.(vodId);
        return this.d.queue.run(async () => {
            const info = await (0, ffmpeg_1.probe)(this.d.tools(), this.vodFile(vodId));
            const vodDur = info.durationSec;
            const bound = (0, plan_1.validateClipSpec)(clip, vodDur);
            if (bound)
                throw new Error(`Clip no válido: ${bound}.`);
            const cats = (await this.d.categories?.ensure(vodId)) ?? [];
            const mixed = (0, categories_1.mixedCategories)(cats, [{ start: clip.start, end: clip.end }]);
            if (mixed)
                throw new Error(`Clip no válido: ${mixed}.`);
            // Por defecto el clip vertical lleva dos ventanas: la cámara del streamer arriba y la pantalla (el juego) debajo.
            // Solo si quien lo pide fija un encuadre concreto (una columna con cropX o una composición propia) se respeta tal cual.
            if (!clip.layout && clip.cropX === undefined && info.width > 0 && info.height > 0) {
                clip.layout = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(2), info.width / info.height);
            }
            const kinds = clip.kind === 'both' ? ['horizontal', 'vertical'] : [clip.kind];
            const cropX = clip.cropX ?? 0.5;
            const ranges = (0, timeline_1.keptRanges)(clip.start, clip.end, clip.cuts);
            const extra = { start: clip.start, end: clip.end, cropX };
            const category = (0, categories_1.categoryOf)(cats, [{ start: clip.start, end: clip.end }]);
            if (category)
                extra.category = category;
            if (clip.cuts)
                extra.cuts = clip.cuts;
            if (clip.effects)
                extra.effects = clip.effects;
            if (clip.subtitles)
                extra.subtitles = clip.subtitles;
            if (clip.layout)
                extra.layout = clip.layout;
            return this.build(vodId, 'clip', clip.title, (0, timeline_1.totalDuration)(ranges), 
            // cada corte seco puede desviar unas décimas
            1.5 + ranges.length * 0.2, extra, kinds.map((k) => ({
                render: k,
                run: (input, out) => (0, subtitleJob_1.withSubtitles)(this.d.subtitles, vodId, clip.subtitles, ranges, k, (subs) => (0, ffmpeg_1.renderClip)(this.d.tools(), input, { kind: k, start: clip.start, end: clip.end, cropX, layout: clip.layout, cuts: clip.cuts, effects: clip.effects, subs }, out)),
            })));
        });
    }
    async createLong(vodId, spec) {
        const reason = (0, plan_1.validateLongSpec)(spec);
        if (reason)
            throw new Error(`Vídeo largo no válido: ${reason}.`);
        const long = (0, plan_1.normalizeLong)(spec);
        await this.d.source?.(vodId);
        return this.d.queue.run(async () => {
            const vodDur = (await (0, ffmpeg_1.probe)(this.d.tools(), this.vodFile(vodId))).durationSec;
            const bound = (0, plan_1.validateLongSpec)(long, vodDur);
            if (bound)
                throw new Error(`Vídeo largo no válido: ${bound}.`);
            const cats = (await this.d.categories?.ensure(vodId)) ?? [];
            const mixed = (0, categories_1.mixedCategories)(cats, long.segments);
            if (mixed)
                throw new Error(`Vídeo largo no válido: ${mixed}.`);
            const expected = long.segments.reduce((a, s) => a + (s.end - s.start), 0);
            // cada tramo puede desviarse unas décimas al cortar: la tolerancia crece con el número de tramos
            const tolerance = 1.5 + long.segments.length * 0.2;
            const extra = { segments: long.segments };
            const category = (0, categories_1.categoryOf)(cats, long.segments);
            if (category)
                extra.category = category;
            if (long.effects)
                extra.effects = long.effects;
            if (long.subtitles)
                extra.subtitles = long.subtitles;
            return this.build(vodId, 'long', long.title, expected, tolerance, extra, [
                {
                    render: 'long',
                    run: (input, out) => (0, subtitleJob_1.withSubtitles)(this.d.subtitles, vodId, long.subtitles, long.segments, 'long', (subs) => (0, ffmpeg_1.renderLong)(this.d.tools(), input, long, out, subs)),
                },
            ]);
        });
    }
    /** Aplica un plan completo. Lo que falla no impide que se creen los demás vídeos. */
    async applyPlan(vodId, planJson) {
        await this.d.source?.(vodId);
        const vodDur = await this.d.queue.run(async () => (await (0, ffmpeg_1.probe)(this.d.tools(), this.vodFile(vodId))).durationSec);
        const { plan, errors } = (0, plan_1.parsePlan)(planJson, vodDur);
        const created = [];
        for (const clip of plan.clips) {
            try {
                created.push(await this.createClip(vodId, clip));
            }
            catch (e) {
                errors.push(`"${clip.title}": ${e.message}`);
            }
        }
        if (plan.long) {
            try {
                created.push(await this.createLong(vodId, plan.long));
            }
            catch (e) {
                errors.push(`vídeo largo: ${e.message}`);
            }
        }
        return { created, errors };
    }
}
exports.ClipService = ClipService;

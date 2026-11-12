"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bestFrameTime = bestFrameTime;
exports.autoThumbnail = autoThumbnail;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const thumbStyle_1 = require("../../shared/thumbStyle");
const ffmpeg_1 = require("./ffmpeg");
const files_1 = require("./files");
const tools_1 = require("./tools");
/** Lee viveza y contraste de un fotograma con signalstats. Devuelve null si no se pudo medir. */
async function measure(tools, file, at) {
    try {
        const r = await (0, tools_1.run)(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2,signalstats,metadata=print:file=-', '-f', 'null', '-'], 30_000);
        const get = (k) => Number(new RegExp(`lavfi\\.signalstats\\.${k}=([0-9.]+)`).exec(r.stdout)?.[1] ?? NaN);
        const s = { satAvg: get('SATAVG'), yLow: get('YLOW'), yHigh: get('YHIGH'), yAvg: get('YAVG') };
        return Object.values(s).every(Number.isFinite) ? (0, thumbStyle_1.frameScore)(s) : null;
    }
    catch {
        return null;
    }
}
/** El mejor instante de entre varios candidatos repartidos por el vídeo; sin medidas, el primer tercio como antes. */
async function bestFrameTime(tools, file, durationSec) {
    const fallback = Math.min(durationSec / 3, Math.max(0, durationSec - 0.2));
    const times = (0, thumbStyle_1.candidateTimes)(durationSec);
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
async function styledCover(tools, file, at, out, o) {
    const text = o.title ? (0, thumbStyle_1.coverText)(o.title) : '';
    const badge = o.title ? (0, thumbStyle_1.coverBadge)(o.title) : null;
    const ass = (0, thumbStyle_1.buildCoverAss)(text, badge);
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-cover-'));
    try {
        const fit = `scale=${thumbStyle_1.COVER_W}:${thumbStyle_1.COVER_H}:force_original_aspect_ratio=increase,crop=${thumbStyle_1.COVER_W}:${thumbStyle_1.COVER_H},setsar=1`;
        let vf = `${fit},${thumbStyle_1.COVER_GRADE}`;
        if (ass) {
            const f = node_path_1.default.join(dir, 'cover.ass');
            node_fs_1.default.writeFileSync(f, ass);
            vf += `,ass='${(0, ffmpeg_1.filterPath)(f)}'${o.fontsDir ? `:fontsdir='${(0, ffmpeg_1.filterPath)(o.fontsDir)}'` : ''}`;
        }
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(out), { recursive: true });
        await (0, tools_1.run)(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, at)), '-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '2', out]);
        if (!node_fs_1.default.existsSync(out) || node_fs_1.default.statSync(out).size === 0)
            throw new Error('no se generó la imagen');
    }
    catch (e) {
        node_fs_1.default.rmSync(out, { force: true });
        throw e;
    }
    finally {
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    }
}
/**
 * Miniatura automática. En los vídeos horizontales (la portada de YouTube) elige el mejor fotograma y le da el estilo
 * de los canales grandes (ver shared/thumbStyle.ts); si eso falla, o en los verticales, un fotograma sencillo como siempre.
 */
async function autoThumbnail(tools, outputDir, outputId, kind, file, durationSec, o = {}) {
    const out = (0, files_1.thumbnailPath)(outputDir, outputId);
    if (kind !== 'vertical' && o.styled !== false) {
        try {
            await styledCover(tools, file, await bestFrameTime(tools, file, durationSec), out, o);
            return out;
        }
        catch {
            // sin portada con estilo (p. ej. falta la fuente): se hace la sencilla
        }
    }
    await (0, ffmpeg_1.extractFrame)(tools, file, Math.min(durationSec / 3, Math.max(0, durationSec - 0.2)), out, {
        maxWidth: kind === 'vertical' ? 360 : 640,
    });
    return out;
}

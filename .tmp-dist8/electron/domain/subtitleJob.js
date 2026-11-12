"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.withSubtitles = withSubtitles;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const subtitles_1 = require("../../shared/subtitles");
const ffmpeg_1 = require("../services/ffmpeg");
/**
 * Prepara el archivo ASS de un render (en el tiempo del vídeo resultante) y lo borra al terminar.
 * Sin estilo no hace nada. Falla con un mensaje claro si no hay transcripción o no hay nada que decir en el tramo.
 */
async function withSubtitles(env, vodId, style, ranges, kind, fn) {
    if (!style)
        return fn(undefined);
    if (!vodId)
        throw new Error('Este vídeo no guarda de qué VOD sale, así que no se pueden calcular los subtítulos.');
    // solo se transcribe lo que hace falta: los tramos de este clip o vídeo, no el directo entero
    if (env.ensure)
        await env.ensure(vodId, ranges);
    const all = env.words(vodId);
    if (!all.length)
        throw new Error('Este VOD no tiene transcripción. Impórtala o transcríbela antes de activar los subtítulos.');
    const words = (0, subtitles_1.wordsForOutput)(all, ranges);
    if (!words.length)
        throw new Error('La transcripción no tiene ninguna palabra en este tramo: quita los subtítulos o revisa la transcripción.');
    const { w, h } = ffmpeg_1.EXPECTED_SIZE[kind];
    const dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-ass-'));
    try {
        const ass = node_path_1.default.join(dir, 'subs.ass');
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)(words, subtitles_1.SUBTITLE_STYLES[style], w, h, env.speakerColors?.(words)));
        return await fn({ ass, fontsDir: env.fontsDir });
    }
    finally {
        node_fs_1.default.rmSync(dir, { recursive: true, force: true });
    }
}

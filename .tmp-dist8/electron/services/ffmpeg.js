"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPECTED_SIZE = exports.POLISH_AF = exports.SFX = void 0;
exports.verticalFilter = verticalFilter;
exports.composeGraph = composeGraph;
exports.probe = probe;
exports.filterPath = filterPath;
exports.assFilter = assFilter;
exports.punchFilter = punchFilter;
exports.renderClip = renderClip;
exports.concatLine = concatLine;
exports.renderLong = renderLong;
exports.validateRender = validateRender;
exports.extractFrame = extractFrame;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const tools_1 = require("./tools");
const timeline_1 = require("../../shared/timeline");
const plan_1 = require("../../shared/plan");
const layout_1 = require("../../shared/layout");
const ENCODE_CODEC = [
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart',
];
const ENCODE = ['-map', '0:v:0', '-map', '0:a:0?', ...ENCODE_CODEC];
/** 16:9 de salida; si el origen no es 16:9 se añaden bandas en lugar de deformar. */
const VF_HORIZONTAL = 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1';
/**
 * 9:16 de salida: recorta una columna 9:16 del origen (desplazable con cropX) y escala a 1080x1920.
 * El segundo recorte garantiza el tamaño exacto aunque el origen sea más estrecho que 9:16.
 */
function verticalFilter(cropX) {
    const x = Math.min(1, Math.max(0, cropX));
    return (`crop=w='min(iw,ih*9/16)':h=ih:x='(iw-min(iw,ih*9/16))*${x}':y=0,` +
        'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1');
}
/**
 * Grafo de filtros de la composición vertical: cada ventana recoge su rectángulo del origen, lo llena en su
 * hueco sin deformar (escala hasta cubrir y recorta lo que sobra) y se coloca sobre un lienzo negro de 1080x1920.
 * Termina en la etiqueta [base].
 */
function composeGraph(layout) {
    const n = layout.windows.length;
    const q = (v) => v.toFixed(5);
    const parts = [];
    parts.push(n === 1 ? '[0:v]null[s0]' : `[0:v]split=${n}${layout.windows.map((_, i) => `[s${i}]`).join('')}`);
    layout.windows.forEach((w, i) => {
        const d = (0, layout_1.dstPixels)(w.dst);
        parts.push(`[s${i}]crop=w='iw*${q(w.src.w)}':h='ih*${q(w.src.h)}':x='iw*${q(w.src.x)}':y='ih*${q(w.src.y)}',` +
            `scale=${d.w}:${d.h}:force_original_aspect_ratio=increase,crop=${d.w}:${d.h},setsar=1[w${i}]`);
    });
    parts.push(`color=c=black:s=${layout_1.OUT_W}x${layout_1.OUT_H}:r=30,format=yuv420p[bg0]`);
    layout.windows.forEach((w, i) => {
        const d = (0, layout_1.dstPixels)(w.dst);
        parts.push(`[bg${i}][w${i}]overlay=x=${d.x}:y=${d.y}:shortest=1${i === n - 1 ? ',setsar=1[base]' : `[bg${i + 1}]`}`);
    });
    return parts.join(';');
}
async function probe(tools, file) {
    const { stdout } = await (0, tools_1.run)(tools.ffprobe, [
        '-v', 'error',
        '-show_entries', 'stream=codec_type,width,height:format=duration',
        '-of', 'json',
        file,
    ]);
    const j = JSON.parse(stdout);
    const video = j.streams?.find((s) => s.codec_type === 'video');
    if (!video)
        throw new Error('El archivo no contiene vídeo.');
    return {
        durationSec: Number(j.format?.duration ?? 0),
        width: Number(video.width ?? 0),
        height: Number(video.height ?? 0),
        hasAudio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
    };
}
/** Ruta para usar dentro de un filtro de ffmpeg (barras normales, ":" y comillas escapados). */
function filterPath(p) {
    return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''");
}
/** Filtro que graba el ASS en la imagen. */
function assFilter(subs) {
    const fonts = subs.fontsDir ? `:fontsdir='${filterPath(subs.fontsDir)}'` : '';
    return `ass='${filterPath(subs.ass)}'${fonts}`;
}
/**
 * Acercamiento breve sobre la imagen ya encuadrada (w×h): sube, se mantiene y baja.
 * `a` es el instante, dentro del tramo, en que empieza el efecto.
 */
function punchFilter(w, h, punches) {
    const terms = punches.map((p) => {
        const r = (p.dur * 0.3).toFixed(3);
        return `${(p.zoom - 1).toFixed(3)}*clip(min((t-${p.a.toFixed(3)})/${r},(${(p.a + p.dur).toFixed(3)}-t)/${r}),0,1)`;
    });
    const z = `(1+${terms.join('+')})`;
    return `scale=w='trunc(${w}*${z}/2)*2':h='trunc(${h}*${z}/2)*2':eval=frame,crop=${w}:${h}`;
}
/** Efectos de sonido sintetizados con ffmpeg (sin archivos ni derechos de autor): fuente lavfi, duración y volumen. */
exports.SFX = {
    whoosh: { src: 'anoisesrc=d=0.45:c=pink:r=48000:a=0.8,highpass=f=300,lowpass=f=5500,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25', dur: 0.45, vol: 0.55 },
    pop: { src: 'sine=f=980:d=0.14:r=48000,afade=t=out:d=0.14', dur: 0.14, vol: 0.45 },
    hit: { src: 'sine=f=70:d=0.32:r=48000,afade=t=out:d=0.32', dur: 0.32, vol: 0.9 },
};
/** Volumen parejo de todo el vídeo (objetivo habitual de YouTube: -14 LUFS; aquí -16 para no saturar). */
exports.POLISH_AF = 'loudnorm=I=-16:TP=-1.5:LRA=11';
async function cutSegment(tools, input, start, end, o, out) {
    const dur = end - start;
    const vf = o.vf ? [o.vf] : [];
    const af = [];
    if (o.polish)
        af.push(exports.POLISH_AF);
    if (o.fadeIn) {
        vf.push(`fade=t=in:st=0:d=${o.fadeIn}`);
        af.push(`afade=t=in:st=0:d=${o.fadeIn}`);
    }
    if (o.fadeOut) {
        vf.push(`fade=t=out:st=${Math.max(0, dur - o.fadeOut).toFixed(3)}:d=${o.fadeOut}`);
        af.push(`afade=t=out:st=${Math.max(0, dur - o.fadeOut).toFixed(3)}:d=${o.fadeOut}`);
    }
    const sfx = o.sfx ?? [];
    if (sfx.length) {
        // vídeo y audio en un solo grafo: el audio original más cada efecto retrasado a su instante
        const inputs = sfx.flatMap((x) => ['-f', 'lavfi', '-i', exports.SFX[x.sound].src]);
        const vchain = o.layout ? `${composeGraph(o.layout)};[base]${vf.length ? vf.join(',') : 'null'}[vout]` : `[0:v]${vf.length ? vf.join(',') : 'null'}[vout]`;
        const mix = sfx.map((x, i) => `[${i + 1}:a]adelay=${Math.round(Math.max(0, x.at) * 1000)}:all=1,volume=${exports.SFX[x.sound].vol}[s${i}]`).join(';');
        const graph = `${vchain};[0:a]${af.length ? af.join(',') : 'anull'}[a0];${mix};[a0]${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:dropout_transition=0:normalize=0[aout]`;
        await (0, tools_1.run)(tools.ffmpeg, [
            '-y', '-hide_banner', '-loglevel', 'error',
            // la duración va ANTES de la entrada: después de ella se aplicaría a la siguiente (los efectos) y el montaje seguiría hasta el final del directo
            '-ss', String(start), '-t', String(dur), '-i', input,
            ...inputs,
            '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]',
            ...ENCODE_CODEC,
            out,
        ]);
        return;
    }
    const video = o.layout
        ? ['-filter_complex', `${composeGraph(o.layout)};[base]${vf.length ? vf.join(',') : 'null'}[vout]`, '-map', '[vout]', '-map', '0:a:0?', ...ENCODE_CODEC]
        : ['-vf', vf.join(','), ...ENCODE];
    await (0, tools_1.run)(tools.ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-ss', String(start), '-t', String(dur), '-i', input,
        ...video,
        ...(af.length ? ['-af', af.join(',')] : []),
        out,
    ]);
}
/**
 * Monta el vídeo: cada tramo conservado se codifica igual (con sus acercamientos y fundidos),
 * se concatenan sin recodificar y, si hay subtítulos, se graban en una segunda pasada.
 */
async function renderTimeline(tools, input, t, out) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(out), { recursive: true });
    const fx = t.effects ?? [];
    const fadeIn = fx.find((e) => e.type === 'fadeIn');
    const fadeOut = fx.find((e) => e.type === 'fadeOut');
    const total = (0, timeline_1.totalDuration)(t.ranges);
    const clampFade = (d) => Math.min(d ?? plan_1.FADE.default, total / 2);
    const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-'));
    const polish = fx.some((e) => e.type === 'polish');
    const allSfx = fx.filter((e) => e.type === 'sfx');
    try {
        // los efectos de sonido necesitan una pista de audio a la que sumarse
        const hasAudio = allSfx.length ? (await probe(tools, input)).hasAudio : false;
        const parts = [];
        for (let i = 0; i < t.ranges.length; i++) {
            const r = t.ranges[i];
            const punches = fx
                .filter((e) => e.type === 'punch')
                .filter((e) => e.at >= r.start && e.at <= r.end)
                .map((e) => ({ a: e.at - r.start, dur: e.duration ?? plan_1.PUNCH.defaultDur, zoom: e.zoom ?? plan_1.PUNCH.defaultZoom }));
            const punch = punches.length ? punchFilter(t.size.w, t.size.h, punches) : '';
            const vf = t.layout ? punch : punch ? `${t.baseVf},${punch}` : t.baseVf;
            const part = node_path_1.default.join(tmp, `part${String(i).padStart(3, '0')}.mp4`);
            await cutSegment(tools, input, r.start, r.end, {
                vf,
                layout: t.layout,
                fadeIn: i === 0 && fadeIn ? clampFade(fadeIn.duration) : undefined,
                fadeOut: i === t.ranges.length - 1 && fadeOut ? clampFade(fadeOut.duration) : undefined,
                polish,
                sfx: hasAudio ? allSfx.filter((e) => e.at >= r.start && e.at <= r.end).map((e) => ({ at: e.at - r.start, sound: e.sound ?? 'pop' })) : undefined,
            }, part);
            parts.push(part);
        }
        // un solo tramo y sin subtítulos: el propio tramo es el resultado
        if (parts.length === 1 && !t.subs) {
            node_fs_1.default.copyFileSync(parts[0], out);
            return;
        }
        const list = node_path_1.default.join(tmp, 'list.txt');
        node_fs_1.default.writeFileSync(list, parts.map(concatLine).join('\n'));
        const joined = t.subs ? node_path_1.default.join(tmp, 'joined.mp4') : out;
        await (0, tools_1.run)(tools.ffmpeg, [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'concat', '-safe', '0', '-i', list,
            '-c', 'copy', '-movflags', '+faststart', joined,
        ]);
        if (t.subs) {
            await (0, tools_1.run)(tools.ffmpeg, [
                '-y', '-hide_banner', '-loglevel', 'error',
                '-i', joined,
                '-vf', assFilter(t.subs),
                '-map', '0:v:0', '-map', '0:a:0?',
                '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                '-c:a', 'copy', '-movflags', '+faststart',
                out,
            ]);
        }
    }
    finally {
        node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
    }
}
async function renderClip(tools, input, spec, out) {
    const vertical = spec.kind === 'vertical';
    await renderTimeline(tools, input, {
        ranges: (0, timeline_1.keptRanges)(spec.start, spec.end, spec.cuts),
        baseVf: vertical ? verticalFilter(spec.cropX ?? 0.5) : VF_HORIZONTAL,
        layout: vertical ? spec.layout : undefined,
        size: vertical ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 },
        effects: spec.effects,
        subs: spec.subs,
    }, out);
}
/** Línea del archivo de lista del demuxer concat: barras normales y comillas simples escapadas. */
function concatLine(file) {
    return `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}
/** Vídeo largo 1920x1080: cada tramo se codifica igual y luego se concatenan sin recodificar. */
async function renderLong(tools, input, spec, out, subs) {
    await renderTimeline(tools, input, { ranges: spec.segments, baseVf: VF_HORIZONTAL, size: { w: 1920, h: 1080 }, effects: spec.effects, subs }, out);
}
exports.EXPECTED_SIZE = {
    vertical: { w: 1080, h: 1920 },
    horizontal: { w: 1920, h: 1080 },
    long: { w: 1920, h: 1080 },
};
/**
 * Un contenido no está listo hasta que el render se valida:
 * se puede abrir, tiene la resolución esperada y la duración correcta.
 */
async function validateRender(tools, file, kind, expectedSec, toleranceSec = 1.5) {
    if (!node_fs_1.default.existsSync(file))
        throw new Error('El archivo renderizado no existe');
    const info = await probe(tools, file);
    const exp = exports.EXPECTED_SIZE[kind];
    if (info.width !== exp.w || info.height !== exp.h) {
        throw new Error(`Resolución incorrecta: ${info.width}x${info.height} (esperada ${exp.w}x${exp.h})`);
    }
    if (Math.abs(info.durationSec - expectedSec) > toleranceSec) {
        throw new Error(`Duración incorrecta: ${info.durationSec.toFixed(1)}s (esperada ~${expectedSec.toFixed(1)}s)`);
    }
    return info;
}
/** Guarda un fotograma como JPG. Sirve para miniaturas, vista previa del encuadre e imágenes elegidas. */
async function extractFrame(tools, input, atSec, out, o = {}, isImage = false) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(out), { recursive: true });
    const vf = o.width && o.height
        ? `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height},setsar=1`
        : `scale='min(${o.maxWidth ?? 640},iw)':-2`;
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (!isImage)
        args.push('-ss', String(Math.max(0, atSec)));
    args.push('-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '3', out);
    try {
        await (0, tools_1.run)(tools.ffmpeg, args);
        if (!node_fs_1.default.existsSync(out) || node_fs_1.default.statSync(out).size === 0)
            throw new Error('no se generó la imagen');
    }
    catch (e) {
        node_fs_1.default.rmSync(out, { force: true });
        throw new Error(`No se pudo generar la imagen: ${e.message}`);
    }
}

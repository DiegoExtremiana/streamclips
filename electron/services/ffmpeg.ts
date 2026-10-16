import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, type ToolPaths } from './tools';
import type { Effect, LongSpec, RenderKind } from '../../shared/types';
import { keptRanges, totalDuration, type Range } from '../../shared/timeline';
import { FADE, PUNCH } from '../../shared/plan';
import { dstPixels, OUT_H, OUT_W, type VerticalLayout } from '../../shared/layout';

const ENCODE_CODEC = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
  '-movflags', '+faststart',
];
const ENCODE = ['-map', '0:v:0', '-map', '0:a:0?', ...ENCODE_CODEC];

/** 16:9 de salida; si el origen no es 16:9 se añaden bandas en lugar de deformar. */
const VF_HORIZONTAL =
  'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1';

/**
 * 9:16 de salida: recorta una columna 9:16 del origen (desplazable con cropX) y escala a 1080x1920.
 * El segundo recorte garantiza el tamaño exacto aunque el origen sea más estrecho que 9:16.
 */
export function verticalFilter(cropX: number): string {
  const x = Math.min(1, Math.max(0, cropX));
  return (
    `crop=w='min(iw,ih*9/16)':h=ih:x='(iw-min(iw,ih*9/16))*${x}':y=0,` +
    'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1'
  );
}

/**
 * Grafo de filtros de la composición vertical: cada ventana recoge su rectángulo del origen, lo llena en su
 * hueco sin deformar (escala hasta cubrir y recorta lo que sobra) y se coloca sobre un lienzo negro de 1080x1920.
 * Termina en la etiqueta [base].
 */
export function composeGraph(layout: VerticalLayout): string {
  const n = layout.windows.length;
  const q = (v: number) => v.toFixed(5);
  const parts: string[] = [];
  parts.push(n === 1 ? '[0:v]null[s0]' : `[0:v]split=${n}${layout.windows.map((_, i) => `[s${i}]`).join('')}`);
  layout.windows.forEach((w, i) => {
    const d = dstPixels(w.dst);
    parts.push(
      `[s${i}]crop=w='iw*${q(w.src.w)}':h='ih*${q(w.src.h)}':x='iw*${q(w.src.x)}':y='ih*${q(w.src.y)}',` +
        `scale=${d.w}:${d.h}:force_original_aspect_ratio=increase,crop=${d.w}:${d.h},setsar=1[w${i}]`,
    );
  });
  parts.push(`color=c=black:s=${OUT_W}x${OUT_H}:r=30,format=yuv420p[bg0]`);
  layout.windows.forEach((w, i) => {
    const d = dstPixels(w.dst);
    parts.push(`[bg${i}][w${i}]overlay=x=${d.x}:y=${d.y}:shortest=1${i === n - 1 ? ',setsar=1[base]' : `[bg${i + 1}]`}`);
  });
  return parts.join(';');
}

export interface ProbeInfo {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(tools: ToolPaths, file: string): Promise<ProbeInfo> {
  const { stdout } = await run(tools.ffprobe, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,width,height:format=duration',
    '-of', 'json',
    file,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: { codec_type?: string; width?: number; height?: number }[];
    format?: { duration?: string };
  };
  const video = j.streams?.find((s) => s.codec_type === 'video');
  if (!video) throw new Error('El archivo no contiene vídeo.');
  return {
    durationSec: Number(j.format?.duration ?? 0),
    width: Number(video.width ?? 0),
    height: Number(video.height ?? 0),
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
  };
}

/** Archivo de subtítulos ya generado (ASS) y carpeta con las fuentes que usa. */
export interface BurnSubs {
  ass: string;
  fontsDir?: string;
}

/** Ruta para usar dentro de un filtro de ffmpeg (barras normales, ":" y comillas escapados). */
export function filterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\\\\\''");
}

/** Filtro que graba el ASS en la imagen. */
export function assFilter(subs: BurnSubs): string {
  const fonts = subs.fontsDir ? `:fontsdir='${filterPath(subs.fontsDir)}'` : '';
  return `ass='${filterPath(subs.ass)}'${fonts}`;
}

/**
 * Acercamiento breve sobre la imagen ya encuadrada (w×h): sube, se mantiene y baja.
 * `a` es el instante, dentro del tramo, en que empieza el efecto.
 */
export function punchFilter(w: number, h: number, punches: { a: number; dur: number; zoom: number }[]): string {
  const terms = punches.map((p) => {
    const r = (p.dur * 0.3).toFixed(3);
    return `${(p.zoom - 1).toFixed(3)}*clip(min((t-${p.a.toFixed(3)})/${r},(${(p.a + p.dur).toFixed(3)}-t)/${r}),0,1)`;
  });
  const z = `(1+${terms.join('+')})`;
  return `scale=w='trunc(${w}*${z}/2)*2':h='trunc(${h}*${z}/2)*2':eval=frame,crop=${w}:${h}`;
}

interface SegmentOpts {
  vf: string;
  /** Composición vertical con varias ventanas: usa el grafo en lugar de `vf` como base (`vf` pasa a ser lo que va después). */
  layout?: VerticalLayout;
  /** Fundidos de este tramo (vídeo y audio). */
  fadeIn?: number;
  fadeOut?: number;
}

async function cutSegment(tools: ToolPaths, input: string, start: number, end: number, o: SegmentOpts, out: string): Promise<void> {
  const dur = end - start;
  const vf = o.vf ? [o.vf] : [];
  const af: string[] = [];
  if (o.fadeIn) {
    vf.push(`fade=t=in:st=0:d=${o.fadeIn}`);
    af.push(`afade=t=in:st=0:d=${o.fadeIn}`);
  }
  if (o.fadeOut) {
    vf.push(`fade=t=out:st=${Math.max(0, dur - o.fadeOut).toFixed(3)}:d=${o.fadeOut}`);
    af.push(`afade=t=out:st=${Math.max(0, dur - o.fadeOut).toFixed(3)}:d=${o.fadeOut}`);
  }
  const video = o.layout
    ? ['-filter_complex', `${composeGraph(o.layout)};[base]${vf.length ? vf.join(',') : 'null'}[vout]`, '-map', '[vout]', '-map', '0:a:0?', ...ENCODE_CODEC]
    : ['-vf', vf.join(','), ...ENCODE];
  await run(tools.ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(start), '-i', input, '-t', String(dur),
    ...video,
    ...(af.length ? ['-af', af.join(',')] : []),
    out,
  ]);
}

/** Lo que hace falta para renderizar una versión de un clip. */
export interface RenderClipSpec {
  kind: 'vertical' | 'horizontal';
  start: number;
  end: number;
  cropX?: number;
  /** Composición vertical con ventanas; si falta se usa el encuadre simple (`cropX`). */
  layout?: VerticalLayout;
  cuts?: Range[];
  effects?: Effect[];
  subs?: BurnSubs;
}

interface TimelineSpec {
  ranges: Range[];
  baseVf: string;
  layout?: VerticalLayout;
  size: { w: number; h: number };
  effects?: Effect[];
  subs?: BurnSubs;
}

/**
 * Monta el vídeo: cada tramo conservado se codifica igual (con sus acercamientos y fundidos),
 * se concatenan sin recodificar y, si hay subtítulos, se graban en una segunda pasada.
 */
async function renderTimeline(tools: ToolPaths, input: string, t: TimelineSpec, out: string): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fx = t.effects ?? [];
  const fadeIn = fx.find((e) => e.type === 'fadeIn');
  const fadeOut = fx.find((e) => e.type === 'fadeOut');
  const total = totalDuration(t.ranges);
  const clampFade = (d: number | undefined) => Math.min(d ?? FADE.default, total / 2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-'));
  try {
    const parts: string[] = [];
    for (let i = 0; i < t.ranges.length; i++) {
      const r = t.ranges[i];
      const punches = fx
        .filter((e): e is Extract<Effect, { type: 'punch' }> => e.type === 'punch')
        .filter((e) => e.at >= r.start && e.at <= r.end)
        .map((e) => ({ a: e.at - r.start, dur: e.duration ?? PUNCH.defaultDur, zoom: e.zoom ?? PUNCH.defaultZoom }));
      const punch = punches.length ? punchFilter(t.size.w, t.size.h, punches) : '';
      const vf = t.layout ? punch : punch ? `${t.baseVf},${punch}` : t.baseVf;
      const part = path.join(tmp, `part${String(i).padStart(3, '0')}.mp4`);
      await cutSegment(
        tools,
        input,
        r.start,
        r.end,
        {
          vf,
          layout: t.layout,
          fadeIn: i === 0 && fadeIn ? clampFade(fadeIn.duration) : undefined,
          fadeOut: i === t.ranges.length - 1 && fadeOut ? clampFade(fadeOut.duration) : undefined,
        },
        part,
      );
      parts.push(part);
    }
    // un solo tramo y sin subtítulos: el propio tramo es el resultado
    if (parts.length === 1 && !t.subs) {
      fs.copyFileSync(parts[0], out);
      return;
    }
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, parts.map(concatLine).join('\n'));
    const joined = t.subs ? path.join(tmp, 'joined.mp4') : out;
    await run(tools.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-movflags', '+faststart', joined,
    ]);
    if (t.subs) {
      await run(tools.ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', joined,
        '-vf', assFilter(t.subs),
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart',
        out,
      ]);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function renderClip(tools: ToolPaths, input: string, spec: RenderClipSpec, out: string): Promise<void> {
  const vertical = spec.kind === 'vertical';
  await renderTimeline(
    tools,
    input,
    {
      ranges: keptRanges(spec.start, spec.end, spec.cuts),
      baseVf: vertical ? verticalFilter(spec.cropX ?? 0.5) : VF_HORIZONTAL,
      layout: vertical ? spec.layout : undefined,
      size: vertical ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 },
      effects: spec.effects,
      subs: spec.subs,
    },
    out,
  );
}

/** Línea del archivo de lista del demuxer concat: barras normales y comillas simples escapadas. */
export function concatLine(file: string): string {
  return `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

/** Vídeo largo 1920x1080: cada tramo se codifica igual y luego se concatenan sin recodificar. */
export async function renderLong(tools: ToolPaths, input: string, spec: LongSpec, out: string, subs?: BurnSubs): Promise<void> {
  await renderTimeline(
    tools,
    input,
    { ranges: spec.segments, baseVf: VF_HORIZONTAL, size: { w: 1920, h: 1080 }, effects: spec.effects, subs },
    out,
  );
}

export const EXPECTED_SIZE: Record<RenderKind, { w: number; h: number }> = {
  vertical: { w: 1080, h: 1920 },
  horizontal: { w: 1920, h: 1080 },
  long: { w: 1920, h: 1080 },
};

/**
 * Un contenido no está listo hasta que el render se valida:
 * se puede abrir, tiene la resolución esperada y la duración correcta.
 */
export async function validateRender(
  tools: ToolPaths,
  file: string,
  kind: RenderKind,
  expectedSec: number,
  toleranceSec = 1.5,
): Promise<ProbeInfo> {
  if (!fs.existsSync(file)) throw new Error('El archivo renderizado no existe');
  const info = await probe(tools, file);
  const exp = EXPECTED_SIZE[kind];
  if (info.width !== exp.w || info.height !== exp.h) {
    throw new Error(`Resolución incorrecta: ${info.width}x${info.height} (esperada ${exp.w}x${exp.h})`);
  }
  if (Math.abs(info.durationSec - expectedSec) > toleranceSec) {
    throw new Error(`Duración incorrecta: ${info.durationSec.toFixed(1)}s (esperada ~${expectedSec.toFixed(1)}s)`);
  }
  return info;
}

export interface FrameOpts {
  /** Ancho máximo (mantiene la proporción). Si se indican width y height, se rellena ese tamaño exacto. */
  maxWidth?: number;
  width?: number;
  height?: number;
}

/** Guarda un fotograma como JPG. Sirve para miniaturas, vista previa del encuadre e imágenes elegidas. */
export async function extractFrame(
  tools: ToolPaths,
  input: string,
  atSec: number,
  out: string,
  o: FrameOpts = {},
  isImage = false,
): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const vf =
    o.width && o.height
      ? `scale=${o.width}:${o.height}:force_original_aspect_ratio=increase,crop=${o.width}:${o.height},setsar=1`
      : `scale='min(${o.maxWidth ?? 640},iw)':-2`;
  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  if (!isImage) args.push('-ss', String(Math.max(0, atSec)));
  args.push('-i', input, '-frames:v', '1', '-vf', vf, '-q:v', '3', out);
  try {
    await run(tools.ffmpeg, args);
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('no se generó la imagen');
  } catch (e) {
    fs.rmSync(out, { force: true });
    throw new Error(`No se pudo generar la imagen: ${(e as Error).message}`);
  }
}

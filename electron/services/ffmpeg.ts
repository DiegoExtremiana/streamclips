import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, type ToolPaths } from './tools';
import { TITLE, type Effect, type LongSpec, type RenderKind } from '../../shared/types';
import type { SoundId } from '../../shared/sounds';
import { sfxInput } from './soundBank';
import { mixMusic, musicFile } from './music';
import { keptRanges, toOutputTime, totalDuration, type Range } from '../../shared/timeline';
import { buildOverlayAss, type Overlay } from '../../shared/overlays';
import { FADE, PUNCH } from '../../shared/plan';
import { dstPixels, OUT_H, OUT_W, type VerticalLayout } from '../../shared/layout';

const ENCODE_CODEC = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
  // siempre estéreo: los tramos se unen sin recodificar y, si uno saliera en mono y otro en estéreo, el audio se corrompe y se repite hasta el final
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
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

/** `audioOnly`: acepta archivos sin imagen (un .wav suelto); si no, un archivo sin vídeo es un error. */
export async function probe(tools: ToolPaths, file: string, o: { audioOnly?: boolean } = {}): Promise<ProbeInfo> {
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
  if (!video && !o.audioOnly) throw new Error('El archivo no contiene vídeo.');
  return {
    durationSec: Number(j.format?.duration ?? 0),
    width: Number(video?.width ?? 0),
    height: Number(video?.height ?? 0),
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')),
  };
}

/** Archivo de subtítulos ya generado (ASS) y carpeta con las fuentes que usa. */
export interface BurnSubs {
  ass: string;
  fontsDir?: string;
}

/** Una pasada de grabado de texto (subtítulos o rótulos) tras el montaje. */
type AssPass = { ass: string; fontsDir?: string };

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
 * Acercamiento breve sobre la imagen ya encuadrada (w×h): sube, se mantiene y baja, HACIA SU OBJETIVO.
 * `a` es el instante, dentro del tramo, en que empieza el efecto; `x`,`y` (0 a 1 de la imagen encuadrada) es el punto al
 * que se acerca: el recorte se desplaza para centrarlo tanto como permite el zoom (sin salirse de la imagen). Sin objetivo,
 * al centro. Al empezar y al acabar el zoom vale 1 y el desplazamiento es nulo, así que cambiar de objetivo no da saltos.
 */
export function punchFilter(w: number, h: number, punches: { a: number; dur: number; zoom: number; x?: number; y?: number }[]): string {
  const on = (p: { a: number; dur: number }) => `between(t,${p.a.toFixed(3)},${(p.a + p.dur).toFixed(3)})`;
  const terms = punches.map((p) => {
    const r = (p.dur * 0.3).toFixed(3);
    return `${(p.zoom - 1).toFixed(3)}*clip(min((t-${p.a.toFixed(3)})/${r},(${(p.a + p.dur).toFixed(3)}-t)/${r}),0,1)`;
  });
  const z = `(1+${terms.join('+')})`;
  // objetivo de cada instante: el del acercamiento activo (0,5 si no hay ninguno)
  const target = (k: 'x' | 'y') => `(0.5${punches.map((p) => `+(${((p[k] ?? 0.5) - 0.5).toFixed(3)})*${on(p)}`).join('')})`;
  const x = `max(0,min(iw-ow,${target('x')}*iw-ow/2))`;
  const y = `max(0,min(ih-oh,${target('y')}*ih-oh/2))`;
  return `scale=w='trunc(${w}*${z}/2)*2':h='trunc(${h}*${z}/2)*2':eval=frame,crop=w=${w}:h=${h}:x='${x}':y='${y}'`;
}

/**
 * Pasa un punto del fotograma original (0 a 1) a la imagen ya encuadrada. Horizontal: el mismo punto. Vertical con columna
 * (cropX): dentro de la columna de 9:16 que se recorta. Vertical compuesto: a la ventana que muestra ese punto. Si el punto
 * no se ve en la imagen final, null (no se hace zoom).
 */
export function mapFocus(p: { x: number; y: number }, o: { vertical?: boolean; cropX?: number; layout?: VerticalLayout; srcAspect?: number }): { x: number; y: number } | null {
  if (!o.vertical) return p;
  if (o.layout?.windows.length) {
    for (const win of o.layout.windows) {
      const s = win.src;
      if (p.x >= s.x && p.x <= s.x + s.w && p.y >= s.y && p.y <= s.y + s.h) {
        return { x: win.dst.x + ((p.x - s.x) / s.w) * win.dst.w, y: win.dst.y + ((p.y - s.y) / s.h) * win.dst.h };
      }
    }
    return null;
  }
  const cw = Math.min(1, (9 / 16) / (o.srcAspect ?? 16 / 9));
  const x0 = (1 - cw) * Math.min(1, Math.max(0, o.cropX ?? 0.5));
  const x = (p.x - x0) / cw;
  return x < 0 || x > 1 ? null : { x, y: p.y };
}

export { SFX } from './soundBank';

/** Volumen parejo de todo el vídeo (objetivo habitual de YouTube: -14 LUFS; aquí -16 para no saturar). */
export const POLISH_AF = 'loudnorm=I=-16:TP=-1.5:LRA=11';

interface SegmentOpts {
  vf: string;
  /** Composición vertical con varias ventanas: usa el grafo en lugar de `vf` como base (`vf` pasa a ser lo que va después). */
  layout?: VerticalLayout;
  /** Fundidos de este tramo (vídeo y audio). */
  fadeIn?: number;
  fadeOut?: number;
  /** Efectos de sonido, con su instante dentro del tramo. */
  sfx?: { at: number; sound: SoundId }[];
  polish?: boolean;
}

async function cutSegment(tools: ToolPaths, input: string, start: number, end: number, o: SegmentOpts, out: string): Promise<void> {
  const dur = end - start;
  const vf = o.vf ? [o.vf] : [];
  const af: string[] = [];
  if (o.polish) af.push(POLISH_AF);
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
    const defs = sfx.map((x) => sfxInput(x.sound));
    const inputs = defs.flatMap((d) => d.args);
    const vchain = o.layout ? `${composeGraph(o.layout)};[base]${vf.length ? vf.join(',') : 'null'}[vout]` : `[0:v]${vf.length ? vf.join(',') : 'null'}[vout]`;
    const mix = sfx.map((x, i) => `[${i + 1}:a]aformat=channel_layouts=stereo,adelay=${Math.round(Math.max(0, x.at) * 1000)}:all=1,volume=${defs[i].vol}[s${i}]`).join(';');
    const graph = `${vchain};[0:a]aformat=channel_layouts=stereo${af.length ? `,${af.join(',')}` : ''}[a0];${mix};[a0]${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:dropout_transition=0:normalize=0,aformat=channel_layouts=stereo[aout]`;
    await run(tools.ffmpeg, [
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
  await run(tools.ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-ss', String(start), '-t', String(dur), '-i', input,
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
  fontsDir?: string;
}

interface TimelineSpec {
  ranges: Range[];
  baseVf: string;
  layout?: VerticalLayout;
  /** Pasa el objetivo de un zoom (fotograma original) a la imagen encuadrada; null si no se ve. */
  focusMap?: (p: { x: number; y: number }) => { x: number; y: number } | null;
  size: { w: number; h: number };
  effects?: Effect[];
  subs?: BurnSubs;
  /** Carpeta de fuentes para los rótulos cuando no hay subtítulos. */
  fontsDir?: string;
}

/**
 * Monta el vídeo: cada tramo conservado se codifica igual (con sus acercamientos y fundidos),
 * se concatenan sin recodificar y, si hay subtítulos, se graban en una segunda pasada.
 */
/** Entre dos tramos separados más que esto (s) se considera un salto entre momentos distintos del directo, no un corte de silencio. */
const JOINT_MIN_GAP = 20;

async function renderTimeline(tools: ToolPaths, input: string, t: TimelineSpec, out: string): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fx = t.effects ?? [];
  const fadeIn = fx.find((e) => e.type === 'fadeIn');
  const fadeOut = fx.find((e) => e.type === 'fadeOut');
  const total = totalDuration(t.ranges);
  const clampFade = (d: number | undefined) => Math.min(d ?? FADE.default, total / 2);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-'));
  const polish = fx.some((e) => e.type === 'polish');
  const joints = fx.find((e): e is Extract<Effect, { type: 'joints' }> => e.type === 'joints');
  const jointDur = Math.min(0.6, joints?.duration ?? 0.25);
  const allSfx = fx.filter((e): e is Extract<Effect, { type: 'sfx' }> => e.type === 'sfx');
  try {
    // los efectos de sonido necesitan una pista de audio a la que sumarse
    const hasAudio = allSfx.length ? (await probe(tools, input)).hasAudio : false;
    const parts: string[] = [];
    for (let i = 0; i < t.ranges.length; i++) {
      const r = t.ranges[i];
      const punches = fx
        .filter((e): e is Extract<Effect, { type: 'punch' }> => e.type === 'punch')
        .filter((e) => e.at >= r.start && e.at <= r.end)
        .flatMap((e) => {
          // el objetivo del zoom viene en coordenadas del fotograma original: se pasa a la imagen encuadrada
          const target = e.x !== undefined && e.y !== undefined ? (t.focusMap ? t.focusMap({ x: e.x, y: e.y }) : { x: e.x, y: e.y }) : undefined;
          if (target === null) return [];
          return [{ a: e.at - r.start, dur: e.duration ?? PUNCH.defaultDur, zoom: e.zoom ?? PUNCH.defaultZoom, ...(target ? { x: target.x, y: target.y } : {}) }];
        });
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
          fadeIn: i === 0 ? (fadeIn ? clampFade(fadeIn.duration) : undefined) : joints && Math.abs(r.start - t.ranges[i - 1].end) > JOINT_MIN_GAP ? jointDur : undefined,
          fadeOut: i === t.ranges.length - 1 ? (fadeOut ? clampFade(fadeOut.duration) : undefined) : joints && Math.abs(t.ranges[i + 1].start - r.end) > JOINT_MIN_GAP ? jointDur : undefined,
          polish,
          sfx: hasAudio ? allSfx.filter((e) => e.at >= r.start && e.at <= r.end).map((e) => ({ at: e.at - r.start, sound: e.sound ?? 'pop' })) : undefined,
        },
        part,
      );
      parts.push(part);
    }
    const musicFx = fx.find((e): e is Extract<Effect, { type: 'music' }> => e.type === 'music');
    const music = musicFx ? await musicFile(tools, musicFx.mood) : null;
    // un solo tramo, sin subtítulos ni música: el propio tramo es el resultado
    if (parts.length === 1 && !t.subs && !music && !fx.some((e) => e.type === 'title')) {
      fs.copyFileSync(parts[0], out);
      return;
    }
    let joined = parts[0];
    if (parts.length > 1) {
      const list = path.join(tmp, 'list.txt');
      fs.writeFileSync(list, parts.map(concatLine).join('\n'));
      joined = path.join(tmp, 'joined.mp4');
      await run(tools.ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', list,
        // el vídeo se copia; el audio se vuelve a codificar de una vez: unir trozos de AAC ya codificados deja saltos en cada unión y
        // algunos reproductores (el del programa incluido) repiten un fragmento de sonido en bucle al saltar en la barra de tiempo
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', joined,
      ]);
    }
    if (music && musicFx) {
      // la música va debajo de las voces: baja sola cuando se habla (el audio del vídeo gobierna su volumen)
      const mixed = t.subs || fx.some((e) => e.type === 'title') ? path.join(tmp, 'music.mp4') : out;
      await mixMusic(tools, joined, music, musicFx.volume ?? 0.16, mixed);
      joined = mixed;
    }
    // rótulos en pantalla: cada «title» cae en un tramo conservado; se pasa al tiempo del vídeo resultante y se graba como ASS aparte
    const titles = fx.filter((e): e is Extract<Effect, { type: 'title' }> => e.type === 'title');
    const overlays: Overlay[] = titles.flatMap((e) => {
      const at = toOutputTime(e.at, t.ranges);
      return at === null ? [] : [{ start: at, end: Math.min(total, at + (e.duration ?? TITLE.defaultDur)), text: e.text, kind: e.kind ?? 'frase' }];
    });
    const passes: AssPass[] = [];
    if (t.subs) passes.push(t.subs);
    if (overlays.length) {
      const f = path.join(tmp, 'overlays.ass');
      fs.writeFileSync(f, buildOverlayAss(overlays, t.size.w, t.size.h));
      passes.push({ ass: f, fontsDir: t.subs?.fontsDir ?? t.fontsDir });
    }
    if (passes.length) {
      await run(tools.ffmpeg, [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', joined,
        '-vf', passes.map(assFilter).join(','),
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy', '-movflags', '+faststart',
        out,
      ]);
    } else if (joined !== out) {
      fs.copyFileSync(joined, out);
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
      focusMap: (p) => mapFocus(p, { vertical, cropX: spec.cropX, layout: spec.layout }),
      size: vertical ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 },
      effects: spec.effects,
      subs: spec.subs,
      fontsDir: spec.fontsDir,
    },
    out,
  );
}

/** Línea del archivo de lista del demuxer concat: barras normales y comillas simples escapadas. */
export function concatLine(file: string): string {
  return `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

/** Vídeo largo 1920x1080: cada tramo se codifica igual y luego se concatenan sin recodificar. */
export async function renderLong(tools: ToolPaths, input: string, spec: LongSpec, out: string, subs?: BurnSubs, fontsDir?: string): Promise<void> {
  await renderTimeline(
    tools,
    input,
    { ranges: spec.segments, baseVf: VF_HORIZONTAL, size: { w: 1920, h: 1080 }, effects: spec.effects, subs, fontsDir },
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
  // comprobaciones del vídeo largo ya hecho: que suene, que no esté en negro y que la imagen no esté parada
  if (kind === 'long' && info.durationSec >= 120) {
    const q = await qualityCheck(tools, file, info.hasAudio);
    const pct = (x: number) => Math.round((x / info.durationSec) * 100);
    if (pct(q.silentSec) >= 30) throw new Error(`El vídeo ha salido sin sonido en el ${pct(q.silentSec)} % de su duración (¿tramos del directo silenciados por Twitch?)`);
    if (pct(q.blackSec) >= 20) throw new Error(`El vídeo ha salido en negro en el ${pct(q.blackSec)} % de su duración`);
    if (pct(q.frozenSec) >= 60) throw new Error(`La imagen está parada en el ${pct(q.frozenSec)} % del vídeo (pantalla de espera o directo sin imagen)`);
  }
  return info;
}

/** Una pasada por el vídeo terminado: segundos en silencio (8 s o más seguidos), en negro (2 s o más) y con la imagen parada (10 s o más). */
export async function qualityCheck(tools: ToolPaths, file: string, hasAudio = true): Promise<{ silentSec: number; blackSec: number; frozenSec: number }> {
  try {
    const r = await run(
      tools.ffmpeg,
      ['-hide_banner', '-nostats', '-i', file, '-vf', 'fps=4,scale=320:-2,blackdetect=d=2:pix_th=0.08,freezedetect=n=0.002:d=10', ...(hasAudio ? ['-af', 'silencedetect=n=-45dB:d=8'] : ['-an']), '-f', 'null', '-'],
      600_000,
    );
    const sum = (re: RegExp) => [...String(r.stderr).matchAll(re)].reduce((a, m) => a + Number(m[1]), 0);
    return { silentSec: sum(/silence_duration: ([\d.]+)/g), blackSec: sum(/black_duration:([\d.]+)/g), frozenSec: sum(/freeze_duration: ([\d.]+)/g) };
  } catch (e) {
    if ((e as Error).name === 'CancelledError') throw e;
    return { silentSec: 0, blackSec: 0, frozenSec: 0 };
  }
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

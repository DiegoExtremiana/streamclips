import fs from 'node:fs';
import path from 'node:path';
import { run, type ToolPaths } from './tools';
import { assetFolders, userFile } from './soundBank';
import type { MusicMood } from '../../shared/music';
import type { Range } from '../../shared/timeline';

/**
 * Música lofi sin letra generada con ffmpeg: acordes de séptima con pulsación suave, bombo y caja flojos, hi-hat y crujido de vinilo.
 * No hay archivos ni derechos de autor. Si en la carpeta de música hay un archivo con el nombre del ambiente (`cafe.mp3`), se usa ese.
 */
const NOTE: Record<string, number> = {};
['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'].forEach((n, i) => {
  for (let o = 1; o <= 5; o++) NOTE[`${n}${o}`] = 440 * 2 ** ((i - 9 + (o - 4) * 12) / 12);
});

interface MoodDef {
  bpm: number;
  chords: string[][];
}

export const LOFI: Record<MusicMood, MoodDef> = {
  cafe: { bpm: 72, chords: [['F3', 'A3', 'C4', 'E4'], ['E3', 'G3', 'B3', 'D4'], ['D3', 'F3', 'A3', 'C4'], ['C3', 'E3', 'G3', 'B3']] },
  viaje: { bpm: 88, chords: [['C3', 'E3', 'G3', 'C4'], ['G2', 'B2', 'D3', 'G3'], ['A2', 'C3', 'E3', 'A3'], ['F2', 'A2', 'C3', 'F3']] },
  noche: { bpm: 64, chords: [['A2', 'C3', 'E3', 'G3'], ['D3', 'F3', 'A3', 'C4'], ['G2', 'B2', 'D3', 'F3'], ['C3', 'E3', 'G3', 'B3']] },
  charla: { bpm: 78, chords: [['C3', 'E3', 'G3', 'B3'], ['A2', 'C3', 'E3', 'G3'], ['D3', 'F3', 'A3', 'C4'], ['G2', 'B2', 'D3', 'F3']] },
  juego: { bpm: 92, chords: [['D3', 'F3', 'A3', 'C4'], ['Bb2', 'D3', 'F3', 'A3'], ['F3', 'A3', 'C4', 'E4'], ['C3', 'E3', 'G3', 'B3']] },
};

/** Filtro de ffmpeg (entradas lavfi + grafo) de un bucle de 4 compases. */
export function lofiGraph(mood: MusicMood): { inputs: string[]; graph: string; seconds: number } {
  const { bpm, chords } = LOFI[mood];
  const b = 60 / bpm;
  const bar = 4 * b;
  const total = chords.length * bar;
  const inputs: string[] = [];
  const chain: string[] = [];
  chords.forEach((c, i) => {
    const sum = c.map((n) => `sin(2*PI*${NOTE[n].toFixed(2)}*t)`).join('+');
    const pluck = `mod(t,${(2 * b).toFixed(4)})`;
    inputs.push('-f', 'lavfi', '-i', `aevalsrc='0.11*(${sum})*exp(-1.3*${pluck})*(1-exp(-70*${pluck}))':s=48000:d=${bar.toFixed(4)}`);
    chain.push(`[${i}:a]`);
  });
  const k = chords.length;
  const per2 = (2 * b).toFixed(4);
  inputs.push('-f', 'lavfi', '-i', `aevalsrc='0.55*sin(2*PI*(50*mod(t,${per2})+90*(1-exp(-25*mod(t,${per2})))/25))*exp(-8*mod(t,${per2}))':s=48000:d=${total.toFixed(4)}`);
  inputs.push('-f', 'lavfi', '-i', `anoisesrc=d=${total.toFixed(4)}:c=white:r=48000:a=0.5`);
  inputs.push('-f', 'lavfi', '-i', `anoisesrc=d=${total.toFixed(4)}:c=white:r=48000:a=0.5`);
  inputs.push('-f', 'lavfi', '-i', `anoisesrc=d=${total.toFixed(4)}:c=pink:r=48000:a=0.5`);
  const graph = [
    `${chain.join('')}concat=n=${k}:v=0:a=1,aformat=sample_rates=48000:channel_layouts=mono,lowpass=f=2200,vibrato=f=0.6:d=0.25[pad]`,
    `[${k}:a]lowpass=f=140[kick]`,
    `[${k + 1}:a]highpass=f=1500,lowpass=f=6000,volume='0.22*exp(-14*mod(t+${b.toFixed(4)},${per2}))':eval=frame[snare]`,
    `[${k + 2}:a]highpass=f=7000,volume='0.05*exp(-45*mod(t,${(b / 2).toFixed(4)}))':eval=frame[hat]`,
    `[${k + 3}:a]highpass=f=3000,volume=0.012[vinyl]`,
    `[pad][kick][snare][hat][vinyl]amix=inputs=5:normalize=0,alimiter=limit=0.9,aformat=channel_layouts=stereo[out]`,
  ].join(';');
  return { inputs, graph, seconds: total };
}

/** Archivo de música de un ambiente: el del usuario o el bucle lofi generado (se guarda para no repetirlo). */
export async function musicFile(tools: ToolPaths, mood: MusicMood): Promise<string | null> {
  const dir = assetFolders().music;
  const own = userFile(dir, mood);
  if (own) return own;
  if (!dir) return null;
  const file = path.join(dir, `lofi-${mood}.m4a`);
  if (fs.existsSync(file) && fs.statSync(file).size > 10_000) return file;
  fs.mkdirSync(dir, { recursive: true });
  const { inputs, graph } = lofiGraph(mood);
  const tmp = `${file}.part.m4a`;
  await run(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-map', '[out]', '-c:a', 'aac', '-b:a', '160k', tmp], 120_000);
  fs.renameSync(tmp, file);
  return file;
}

/**
 * Suma la música (en bucle) al audio del vídeo. La música suena a `volume` y se agacha mientras hay voz: el propio audio
 * del vídeo controla su volumen, así que nunca tapa a quien habla.
 */
export async function mixMusic(tools: ToolPaths, video: string, music: string, volume: number, out: string): Promise<void> {
  const graph = [
    '[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key]',
    `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volume.toFixed(3)}[bed]`,
    '[bed][key]sidechaincompress=threshold=0.015:ratio=12:attack=20:release=500:makeup=1[ducked]',
    '[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95,aformat=channel_layouts=stereo[aout]',
  ].join(';');
  await run(tools.ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', video, '-stream_loop', '-1', '-i', music,
    '-filter_complex', graph, '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest', '-movflags', '+faststart', out,
  ], 600_000);
}

/**
 * ¿Ya suena algo de fondo (música o juego) en los huecos entre palabras? Mide el volumen de unas cuantas pausas de la fuente:
 * con una pausa de voz se oye solo el micrófono, que en un directo cuidado queda por debajo de -42 dB.
 */
export async function hasBackgroundSound(tools: ToolPaths, file: string, gaps: Range[], thresholdDb = -42): Promise<boolean> {
  const sample = gaps.filter((g) => g.end - g.start >= 0.7).slice(0, 6);
  if (!sample.length) return false;
  const levels: number[] = [];
  for (const g of sample) {
    try {
      const r = await run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-ss', String(g.start + 0.05), '-t', String(Math.min(1.2, g.end - g.start - 0.1)), '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], 60_000);
      const m = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(`${r.stderr}${r.stdout}`);
      if (m) levels.push(Number(m[1]));
    } catch {
      /* esa pausa no se pudo medir */
    }
  }
  if (!levels.length) return false;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length / 2)] > thresholdDb;
}

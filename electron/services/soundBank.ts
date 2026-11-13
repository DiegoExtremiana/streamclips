import fs from 'node:fs';
import path from 'node:path';
import { isSoundId, type SoundId } from '../../shared/sounds';

/** Efecto de sonido: fuente lavfi sintetizada, duración y volumen con el que se suma al audio. */
export interface SfxDef {
  src: string;
  dur: number;
  vol: number;
}

const ae = (expr: string, d: number) => `aevalsrc='${expr}':s=48000:d=${d}`;

/** Efectos sintetizados con ffmpeg: sin archivos ni derechos de autor. */
export const SFX: Record<SoundId, SfxDef> = {
  whoosh: { src: 'anoisesrc=d=0.45:c=pink:r=48000:a=0.8,highpass=f=300,lowpass=f=5500,afade=t=in:d=0.2,afade=t=out:st=0.2:d=0.25', dur: 0.45, vol: 0.55 },
  pop: { src: 'sine=f=980:d=0.14:r=48000,afade=t=out:d=0.14', dur: 0.14, vol: 0.45 },
  hit: { src: 'sine=f=70:d=0.32:r=48000,afade=t=out:d=0.32', dur: 0.32, vol: 0.9 },
  ding: { src: ae('0.6*sin(2*PI*1568*t)*exp(-4*t)+0.3*sin(2*PI*2349*t)*exp(-6*t)', 0.9), dur: 0.9, vol: 0.5 },
  coin: { src: ae('0.6*sin(2*PI*if(lt(t,0.08),988,1319)*t)*exp(-5*max(t-0.08,0))', 0.6), dur: 0.6, vol: 0.5 },
  tada: { src: ae('0.45*sin(2*PI*if(lt(t,0.12),523,if(lt(t,0.24),659,if(lt(t,0.36),784,1047)))*t)*exp(-2.5*max(t-0.36,0))', 1.1), dur: 1.1, vol: 0.55 },
  fail: { src: ae('0.5*(sin(2*PI*(330/0.9)*(1-exp(-0.9*t)))+0.5*sin(4*PI*(330/0.9)*(1-exp(-0.9*t))))*min(1,(1.1-t)*5)', 1.1), dur: 1.1, vol: 0.5 },
  boom: { src: ae('0.9*sin(2*PI*(45*t+7.5*(1-exp(-12*t))))*exp(-4*t)', 0.9), dur: 0.9, vol: 0.9 },
  alert: { src: ae('0.5*sin(2*PI*880*t)*lt(mod(t,0.3),0.15)', 0.6), dur: 0.6, vol: 0.4 },
  boing: { src: ae('0.6*sin(2*PI*300*t+6*sin(2*PI*8*t))*exp(-3*t)', 0.7), dur: 0.7, vol: 0.5 },
  sparkle: { src: ae('0.4*sin(2*PI*(2000*t+1250*t*t))*exp(-6*t)', 0.6), dur: 0.6, vol: 0.45 },
};

const AUDIO_EXT = /\.(wav|mp3|m4a|ogg|flac|aac)$/i;
let soundsDir = '';
let musicDir = '';

/** Carpetas donde el usuario puede dejar sus propios sonidos (`ding.mp3`…) y música (`cafe.mp3`…). */
export function setAssetFolders(o: { sounds?: string; music?: string }): void {
  soundsDir = o.sounds ?? '';
  musicDir = o.music ?? '';
}
export const assetFolders = () => ({ sounds: soundsDir, music: musicDir });

/** Archivo propio del usuario con ese nombre (`<id>.<extensión>`) en la carpeta, si existe. */
export function userFile(dir: string, id: string): string | null {
  try {
    if (!dir) return null;
    const f = fs.readdirSync(dir).find((n) => AUDIO_EXT.test(n) && path.basename(n, path.extname(n)).toLowerCase() === id.toLowerCase());
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
}

/** Argumentos de entrada de ffmpeg para un efecto: el archivo del usuario si lo hay, si no el sintetizado. */
export function sfxInput(id: SoundId | string): { args: string[]; vol: number } {
  const key: SoundId = isSoundId(id) ? id : 'pop';
  const own = userFile(soundsDir, key);
  if (own) return { args: ['-t', '4', '-i', own], vol: 0.8 };
  return { args: ['-f', 'lavfi', '-i', SFX[key].src], vol: SFX[key].vol };
}

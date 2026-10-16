import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { UpdateStatus, ChannelStatus, OutputItem, TaskInfo, VodJob } from '../shared/types';
import type { Notifier } from '../electron/domain/notifier';
import type { Cipher } from '../electron/services/secrets';
import { AppContext, type ContextOptions } from '../electron/app/context';

export function tmpDir(prefix = 'sc-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmDir(d: string): void {
  fs.rmSync(d, { recursive: true, force: true });
}

export interface VideoOpts {
  w?: number;
  h?: number;
  dur?: number;
  audio?: boolean;
  /** mitad izquierda roja, mitad derecha azul (para comprobar la posición del recorte) */
  split?: boolean;
  fps?: number;
}

/** Genera un vídeo sintético real con ffmpeg. */
export function makeVideo(file: string, o: VideoOpts = {}): string {
  const { w = 1920, h = 1080, dur = 10, audio = true, split = false, fps = 30 } = o;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = ['-y', '-loglevel', 'error'];
  if (split) {
    const half = Math.floor(w / 2);
    // las entradas van siempre antes que las opciones de filtro y de mapeo
    if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`);
    args.push(
      '-filter_complex',
      `color=c=red:s=${half}x${h}:r=${fps}:d=${dur}[a];color=c=blue:s=${w - half}x${h}:r=${fps}:d=${dur}[b];[a][b]hstack[v]`,
      '-map', '[v]',
    );
    if (audio) args.push('-map', '0:a');
  } else {
    args.push('-f', 'lavfi', '-i', `testsrc2=size=${w}x${h}:rate=${fps}:duration=${dur}`);
    if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${dur}`);
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) args.push('-c:a', 'aac', '-shortest');
  args.push(file);
  execFileSync('ffmpeg', args);
  return file;
}

/** Color dominante de un fotograma (promedia el fotograma a 1x1 píxel). */
export function dominantColor(file: string, atSec = 0.5): 'red' | 'blue' | 'mixed' {
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1024 * 1024 },
  );
  const [r, , b] = [buf[0], buf[1], buf[2]];
  if (r > 200 && b < 80) return 'red';
  if (b > 200 && r < 80) return 'blue';
  return 'mixed';
}

/** Cifrado de pega que no es identidad (para comprobar que de verdad se codifica). */
export const fakeCipher: Cipher = {
  available: () => true,
  encrypt: (s) => Buffer.from(`X${[...s].reverse().join('')}`),
  decrypt: (b) => [...b.toString().slice(1)].reverse().join(''),
};

export const noCipher: Cipher = {
  available: () => false,
  encrypt: () => {
    throw new Error('no disponible');
  },
  decrypt: () => {
    throw new Error('no disponible');
  },
};

export class RecordingNotifier implements Notifier {
  vodEvents: VodJob[] = [];
  changes = 0;
  tasks: TaskInfo[] = [];
  channels: ChannelStatus[] = [];
  updates: UpdateStatus[] = [];
  vod(job: VodJob): void {
    this.vodEvents.push({ ...job });
  }
  task(t: TaskInfo): void {
    this.tasks.push({ ...t });
  }
  update(s: UpdateStatus): void {
    this.updates.push({ ...s });
  }
  channel(s: ChannelStatus): void {
    this.channels.push({ ...s });
  }
  changed(): void {
    this.changes++;
  }
}

export const FAKE_WHISPER = path.resolve(__dirname, '../../tests/fixtures/fake-whisper-cli.js');

export function fakeWhisper(): string {
  fs.chmodSync(FAKE_WHISPER, 0o755);
  return FAKE_WHISPER;
}

/** Coloca un "modelo" (archivo grande y vacío) donde la app espera encontrarlo, para no descargarlo. */
export function installFakeModel(env: TestEnv, name = 'tiny', bytes = 71_000_000): string {
  const dir = path.join(env.userData, 'models');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `ggml-${name}.bin`);
  fs.writeFileSync(f, '');
  fs.truncateSync(f, bytes);
  return f;
}

export const FAKE_YTDLP = path.resolve(__dirname, '../../tests/fixtures/fake-ytdlp.js');

export function fakeYtdlp(): string {
  fs.chmodSync(FAKE_YTDLP, 0o755);
  return FAKE_YTDLP;
}

export interface TestEnv {
  root: string;
  userData: string;
  outputDir: string;
  notifier: RecordingNotifier;
  ctx: AppContext;
  cleanup(): void;
}

/** Contexto completo con carpetas temporales. */
export function makeEnv(extra: Partial<ContextOptions> = {}, root = tmpDir()): TestEnv {
  const userData = path.join(root, 'userData');
  const outputDir = path.join(root, 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  const notifier = new RecordingNotifier();
  const ctx = new AppContext({
    userDataDir: userData,
    defaultOutputDir: outputDir,
    cipher: fakeCipher,
    notifier,
    schedulerIntervalMs: 3_600_000,
    fontsDir: path.resolve(process.cwd(), 'resources/fonts'),
    freeBytes: () => null, // las pruebas no dependen del disco de la máquina
    ...extra,
  });
  return { root, userData, outputDir, notifier, ctx, cleanup: () => { ctx.stop(); rmDir(root); } };
}

/** Registra un vídeo ya "descargado" en el almacén, sin pasar por yt-dlp. */
export function addDownloadedVod(env: TestEnv, file: string, id = 'vod1'): VodJob {
  const job: VodJob = {
    id,
    url: `https://www.twitch.tv/videos/${id}`,
    title: 'VOD de prueba',
    status: 'downloaded',
    progress: 100,
    filePath: file,
    createdAt: new Date().toISOString(),
  };
  env.ctx.store.data.vods.unshift(job);
  env.ctx.store.save();
  return job;
}

export function addOutput(env: TestEnv, id = 'out1'): OutputItem {
  const item: OutputItem = {
    id,
    kind: 'clip',
    title: 'Clip',
    files: { vertical: path.join(env.outputDir, 'vertical', `${id}.mp4`) },
    durationSec: 5,
    createdAt: new Date().toISOString(),
  };
  env.ctx.store.data.outputs.unshift(item);
  env.ctx.store.save();
  return item;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

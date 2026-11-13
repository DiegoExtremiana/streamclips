import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StorageReport } from '../../shared/storage';
import type { Store } from '../services/store';
import { allFiles } from '../../shared/outputs';

export interface StorageDeps {
  store: Store;
  userDataDir: string;
  /** Borra el directo completo de un VOD conservando lo que salió de él (misma acción que «Liberar espacio»). */
  discard: (vodId: string) => { freedBytes: number };
  /** ¿Se está analizando este directo ahora? */
  isRunning: (vodId: string) => boolean;
  /** ¿Hay descargas, montajes o análisis en marcha? Mientras sea así no se borra ningún directo. */
  busy?: () => boolean;
  /** Registro de lo que se borra solo. */
  log?: { info: (m: string) => void; warn: (m: string) => void };
  now?: () => number;
  graceMs?: number;
  sweepEveryMs?: number;
  tmpDir?: string;
}

/** Un directo usado se borra solo cuando lleva este rato sin que salga nada más de él (por si sigues sacando clips). */
export const USED_VOD_GRACE_MS = 30 * 60_000;
const SWEEP_EVERY_MS = 10 * 60_000;

function sizeOf(p: string): number {
  try {
    const st = fs.statSync(p);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let n = 0;
    for (const f of fs.readdirSync(p)) n += sizeOf(path.join(p, f));
    return n;
  } catch {
    return 0;
  }
}

/** Cuánto ocupa cada cosa del programa y qué se puede liberar sin perder nada que no se pueda recuperar. */
export class StorageService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly d: StorageDeps) {}

  /** Empieza a borrar solos los directos ya usados (si «Borrar el directo completo al terminar» está activo). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweepUsed(), this.d.sweepEveryMs ?? SWEEP_EVERY_MS);
    this.timer.unref?.();
    setTimeout(() => this.sweepUsed(), 60_000).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Borra los directos completos que ya se usaron: tienen vídeos o clips sacados de ellos, el último salió hace más de
   * media hora y no hay nada trabajando. Si hace falta el directo otra vez, se vuelve a bajar solo.
   */
  sweepUsed(): { vods: number; freedBytes: number } {
    const none = { vods: 0, freedBytes: 0 };
    const { outputs, settings } = this.d.store.data;
    if (settings.autopilot.cleanup === false || this.d.busy?.()) return none;
    const now = (this.d.now ?? Date.now)();
    let freedBytes = 0;
    let n = 0;
    for (const v of this.freeable()) {
      if (v.origin === 'clip') continue;
      const last = Math.max(...outputs.filter((o) => o.vodId === v.id).map((o) => Date.parse(o.createdAt) || 0));
      if (now - last < (this.d.graceMs ?? USED_VOD_GRACE_MS)) continue;
      try {
        freedBytes += this.d.discard(v.id).freedBytes;
        n++;
      } catch (e) {
        this.d.log?.warn(`No se pudo borrar el directo «${v.title}»: ${(e as Error).message}`);
      }
    }
    if (n) this.d.log?.info(`Directos ya usados borrados solos: ${n} (${(freedBytes / 1024 ** 3).toFixed(1)} GB liberados).`);
    return { vods: n, freedBytes };
  }

  /** Directos completos que se pueden borrar: ya tienen clips o vídeos sacados de ellos y no se están analizando. */
  private freeable() {
    const { vods, outputs } = this.d.store.data;
    return vods.filter((v) => v.filePath && fs.existsSync(v.filePath) && !this.d.isRunning(v.id) && outputs.some((o) => o.vodId === v.id));
  }

  private tempFiles(): string[] {
    const dir = this.d.tmpDir ?? os.tmpdir();
    try {
      return fs.readdirSync(dir).filter((f) => f.startsWith('streamclips-')).map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  }

  report(): StorageReport {
    const { vods, outputs, settings } = this.d.store.data;
    const u = this.d.userDataDir;
    const vodBytes = vods.reduce((n, v) => n + (v.filePath ? sizeOf(v.filePath) : 0), 0);
    const outBytes = outputs.reduce((n, o) => n + allFiles(o).reduce((m, f) => m + sizeOf(f), 0), 0);
    const reclaimVods = this.freeable();
    const reclaimVodBytes = reclaimVods.reduce((n, v) => n + sizeOf(v.filePath!), 0);
    const temp = this.tempFiles().reduce((n, f) => n + sizeOf(f), 0);
    const items = [
      { id: 'vods', label: 'Directos descargados', bytes: vodBytes, note: 'Los VODs completos. Se pueden borrar cuando ya salieron sus clips y vídeos.' },
      { id: 'library', label: 'Vídeos y clips de la Biblioteca', bytes: outBytes, note: `Carpeta de salida: ${settings.outputDir}` },
      { id: 'covers', label: 'Portadas', bytes: sizeOf(path.join(u, 'covers')), note: 'Tu biblioteca de imágenes para portadas.' },
      { id: 'models', label: 'Modelos de Whisper', bytes: sizeOf(path.join(u, 'models')), note: 'Lo que usa el programa para escuchar. Se vuelven a descargar si se borran.' },
      { id: 'temp', label: 'Archivos temporales', bytes: temp, note: 'Restos de montajes interrumpidos; se pueden borrar sin riesgo.' },
    ];
    return { items, total: items.reduce((n, i) => n + i.bytes, 0), reclaimableBytes: reclaimVodBytes + temp, reclaimableVods: reclaimVods.length };
  }

  /** Borra los restos temporales y los directos completos ya aprovechados. Los vídeos, clips y transcripciones se conservan. */
  free(): { freedBytes: number; vods: number; temp: number } {
    let freed = 0;
    let temp = 0;
    for (const f of this.tempFiles()) {
      const n = sizeOf(f);
      try {
        fs.rmSync(f, { recursive: true, force: true });
        freed += n;
        temp++;
      } catch {
        /* en uso: se deja */
      }
    }
    let vods = 0;
    for (const v of this.freeable()) {
      try {
        freed += this.d.discard(v.id).freedBytes;
        vods++;
      } catch {
        /* se deja y se cuenta como no liberado */
      }
    }
    return { freedBytes: freed, vods, temp };
  }
}

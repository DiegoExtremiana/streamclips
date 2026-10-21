import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { VodJob, VodOrigin } from '../../shared/types';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import { downloadVod, parseVodUrl } from '../services/downloader';
import { ensureFreeSpace, freeBytes, vodBytesEstimate } from '../services/files';
import type { Notifier } from './notifier';

export interface VodDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  queue: SerialQueue;
  tools: () => ToolPaths;
  download?: typeof downloadVod;
  /** Para las pruebas: espacio libre del disco. */
  freeBytes?: (dir: string) => number | null;
}

export class VodService {
  private download: typeof downloadVod;
  private listeners: ((job: VodJob) => void)[] = [];

  constructor(private d: VodDeps) {
    this.download = d.download ?? downloadVod;
  }

  /** Avisa cuando un VOD acaba de descargarse bien (lo usan la recogida automática y los clips de Twitch). */
  onDownloaded(cb: (job: VodJob) => void): void {
    this.listeners.push(cb);
  }

  private get vodsDir(): string {
    return path.join(this.d.store.data.settings.outputDir, 'vods');
  }

  /** Añade un VOD a la cola de descarga. El mismo VOD (misma URL) no se descarga dos veces. */
  add(rawUrl: string, title?: string, meta: { origin?: VodOrigin; twitchId?: string; streamStartedAt?: string; durationSec?: number } = {}): VodJob {
    const url = parseVodUrl(rawUrl);
    if (!url) throw new Error('La URL no es válida. Debe empezar por https:// (por ejemplo https://www.twitch.tv/videos/123456789).');
    const existing = this.d.store.data.vods.find((v) => v.url === url && v.status !== 'error');
    if (existing) return existing;

    const job: VodJob = {
      id: crypto.randomUUID(),
      url,
      origin: meta.origin ?? 'manual',
      ...(meta.twitchId ? { twitchId: meta.twitchId } : {}),
      ...(meta.streamStartedAt ? { streamStartedAt: meta.streamStartedAt } : {}),
      ...(meta.durationSec ? { durationSec: meta.durationSec } : {}),
      title: title?.trim() ?? '',
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    this.d.store.data.vods.unshift(job);
    this.d.store.save();
    this.d.notifier.changed();
    void this.d.queue.run(() => this.runDownload(job));
    return job;
  }

  private restores = new Map<string, Promise<string>>();

  /**
   * Ruta del archivo del directo. Si se borró para liberar espacio (o ya no está en su sitio) y se conoce su dirección,
   * se vuelve a descargar. Quien lo necesite lo pide antes de ocupar su cola de trabajo.
   */
  ensureFile(vodId: string): Promise<string> {
    const job = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!job) return Promise.reject(new Error('El VOD no existe.'));
    if (job.status === 'downloaded' && job.filePath && fs.existsSync(job.filePath)) return Promise.resolve(job.filePath);
    const running = this.restores.get(vodId);
    if (running) return running;
    if (job.origin === 'clip' || !job.url) return Promise.reject(new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).'));
    if (job.status === 'queued' || job.status === 'downloading') return Promise.reject(new Error('El VOD todavía no está descargado (se está descargando).'));
    if (job.status === 'error' && !job.cleaned && !job.filePath) return Promise.reject(new Error(`El VOD no se pudo descargar: ${job.error ?? 'error desconocido'}`));
    this.d.log.info(`Volviendo a descargar el directo "${job.title}" (${job.url}).`);
    job.status = 'queued';
    job.progress = 0;
    job.error = undefined;
    job.filePath = undefined;
    this.d.store.save();
    this.d.notifier.vod(job);
    const p = this.d.queue
      .run(() => this.runDownload(job, true))
      .then(() => {
        if (job.status !== 'downloaded' || !job.filePath) throw new Error(`No se pudo volver a descargar el directo: ${job.error ?? 'error desconocido'}`);
        return job.filePath;
      })
      .finally(() => this.restores.delete(vodId));
    this.restores.set(vodId, p);
    return p;
  }

  /** Borra del disco el directo completo (y lo que dejó la descarga junto a él). Devuelve los bytes liberados. */
  discardSource(vodId: string): number {
    const job = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!job) throw new Error('El VOD no existe.');
    if (job.origin === 'clip') throw new Error('Los clips de Twitch descargados no se borran: son el origen de su vídeo.');
    if (job.status === 'queued' || job.status === 'downloading') throw new Error('El VOD todavía no está descargado (se está descargando).');
    let freed = 0;
    if (job.filePath) {
      const dir = path.dirname(job.filePath);
      const stem = path.basename(job.filePath, path.extname(job.filePath));
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f === path.basename(job.filePath!) || f.startsWith(`${stem}.`)) : [];
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          freed += fs.statSync(full).size;
          fs.rmSync(full, { force: true });
        } catch (e) {
          this.d.log.warn(`No se pudo borrar ${full}: ${(e as Error).message}`);
        }
      }
    }
    job.filePath = undefined;
    job.status = 'downloaded';
    job.cleaned = { at: new Date().toISOString(), freedBytes: freed };
    this.d.store.save();
    this.d.notifier.vod(job);
    this.d.notifier.changed();
    return freed;
  }

  /** Al arrancar: lo que estaba descargándose cuando se cerró la app no se puede dar por bueno. */
  recoverInterrupted(): number {
    let n = 0;
    for (const v of this.d.store.data.vods) {
      if (v.status === 'queued' || v.status === 'downloading') {
        v.status = 'error';
        v.error = 'La descarga se interrumpió al cerrar la aplicación. Vuelve a añadir el VOD.';
        n++;
      }
    }
    if (n) this.d.store.save();
    return n;
  }

  private async runDownload(job: VodJob, silent = false): Promise<void> {
    try {
      ensureFreeSpace(this.d.store.data.settings.outputDir, vodBytesEstimate(job.durationSec), 'descargar el VOD', this.d.freeBytes ?? freeBytes);
      job.status = 'downloading';
      job.error = undefined;
      this.d.notifier.vod(job);
      this.d.log.info(`Descarga iniciada: ${job.url}`);
      let lastSent = -1;
      const res = await this.download(this.d.tools(), job.url, this.vodsDir, (pct) => {
        job.progress = pct;
        // se avisa como mucho una vez por cada 1 % para no saturar la interfaz
        if (Math.floor(pct) !== lastSent) {
          lastSent = Math.floor(pct);
          this.d.notifier.vod(job);
        }
      });
      // si yt-dlp devolvió un título con caracteres rotos, se conserva el que ya teníamos (el de Twitch)
      job.title = res.title && !(res.title.includes('\uFFFD') && job.title && !job.title.includes('\uFFFD')) ? res.title : job.title;
      job.filePath = res.filePath;
      job.cleaned = undefined;
      job.status = 'downloaded';
      job.progress = 100;
      this.d.log.info(`Descarga completada: ${res.filePath}`);
    } catch (e) {
      job.status = 'error';
      job.error = (e as Error).message;
      this.d.log.error(`Descarga fallida: ${job.url}`, e);
    }
    this.d.store.save();
    this.d.notifier.vod(job);
    this.d.notifier.changed();
    if (job.status === 'downloaded' && !silent) {
      for (const cb of this.listeners) {
        try {
          cb(job);
        } catch (e) {
          this.d.log.error('Fallo al reaccionar a una descarga terminada', e);
        }
      }
    }
  }
}

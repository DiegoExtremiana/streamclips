import crypto from 'node:crypto';
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

  private async runDownload(job: VodJob): Promise<void> {
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
      job.title = res.title || job.title;
      job.filePath = res.filePath;
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
    if (job.status === 'downloaded') {
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

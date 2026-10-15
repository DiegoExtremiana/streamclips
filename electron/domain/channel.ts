import type { ChannelStatus, OutputItem, TwitchClip, TwitchStream, VodJob } from '../../shared/types';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { TwitchClient, TwitchCreds } from '../services/twitch';
import fs from 'node:fs';
import path from 'node:path';
import { ChatBins, ChatLogger } from '../services/chatlog';
import type { Notifier } from './notifier';
import type { VodService } from './vods';
import type { ClipService } from './clips';

export interface ChannelDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  twitch: Pick<TwitchClient, 'streamStatus' | 'listVods' | 'listClips'>;
  creds: () => TwitchCreds;
  vods: VodService;
  clips: ClipService;
  intervalMs: number;
  now?: () => number;
  /** Captura del chat mientras estás en directo. Sin esto no se guarda actividad del chat. */
  chat?: { dir: string; enabled: () => boolean; host?: string; port?: number };
}

/** Margen para reconocer el VOD del directo en curso: Twitch lo crea unos segundos antes que `started_at`. */
const LIVE_VOD_SLACK_MS = 5 * 60_000;
/** Lecturas seguidas «sin directo» antes de recoger el VOD (evita recoger a medias si se corta un momento la conexión). */
const OFFLINE_CONFIRMATIONS = 2;
const MIN_IMPORT_SEC = 60;

/**
 * Vigila el canal de Twitch: sabe si estás en directo, recoge solo el VOD cuando el directo termina
 * y ofrece los clips del canal. No hace nada pesado por su cuenta: encola descargas en el VodService.
 */
export class ChannelMonitor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stream: TwitchStream | null = null;
  private lastCheck: string | null = null;
  private error: string | null = null;
  private offlineStreak = 0;
  private lastImported?: ChannelStatus['lastImported'];
  private liveListeners: ((job: VodJob) => void)[] = [];
  private chatLogger: ChatLogger | null = null;
  private chatBins = new ChatBins();
  private chatStart: string | null = null;
  private chatSaved = 0;
  private clipOutputs = new Map<string, Promise<OutputItem>>();

  constructor(private d: ChannelDeps) {
    d.vods.onDownloaded((job) => this.afterDownload(job));
  }

  private get now(): number {
    return (this.d.now ?? Date.now)();
  }
  private get state() {
    return this.d.store.data.channel;
  }

  /** Se avisa cuando el VOD de un directo recién terminado ya está descargado (aquí engancha el piloto automático). */
  onLiveVodReady(cb: (job: VodJob) => void): void {
    this.liveListeners.push(cb);
  }

  status(): ChannelStatus {
    const c = this.d.creds();
    return {
      configured: !!(c.clientId && c.clientSecret && c.login),
      autoImport: this.state.autoImport,
      stream: this.stream,
      lastCheck: this.lastCheck,
      error: this.error,
      ...(this.lastImported ? { lastImported: this.lastImported } : {}),
    };
  }

  setAutoImport(on: boolean): ChannelStatus {
    this.state.autoImport = on;
    if (on) this.state.autoSince = null; // al volver a activarlo no se recoge lo que pasó mientras estaba apagado
    this.d.store.save();
    this.d.notifier.channel(this.status());
    return this.status();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.d.intervalMs);
    this.timer.unref?.();
    void this.poll();
  }

  stop(): void {
    this.saveChat();
    this.stopChat();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una vuelta de vigilancia. Nunca lanza: los fallos quedan en `error`. */
  async poll(): Promise<ChannelStatus> {
    if (this.busy) return this.status();
    this.busy = true;
    try {
      const creds = this.d.creds();
      if (!creds.clientId || !creds.clientSecret || !creds.login) {
        this.stream = null;
        this.error = null;
        return this.status();
      }
      const stream = await this.d.twitch.streamStatus(creds);
      this.stream = stream;
      this.offlineStreak = stream.live ? 0 : this.offlineStreak + 1;
      this.syncChat(creds, stream);
      if (this.state.autoImport) await this.collect(creds, stream);
      this.error = null;
    } catch (e) {
      this.error = (e as Error).message;
      this.d.log.warn(`Vigilancia del canal: ${this.error}`);
    } finally {
      this.lastCheck = new Date(this.now).toISOString();
      this.busy = false;
      this.d.notifier.channel(this.status());
    }
    return this.status();
  }

  /** Mientras estás en directo guarda cuántos mensajes hay cada segundo; al terminar, deja el archivo definitivo. */
  private syncChat(creds: TwitchCreds, stream: TwitchStream): void {
    const c = this.d.chat;
    if (!c) return;
    if (stream.live && stream.startedAt && c.enabled()) {
      if (!this.chatLogger || this.chatStart !== stream.startedAt) {
        this.stopChat();
        const startSec = Date.parse(stream.startedAt) / 1000;
        this.chatStart = stream.startedAt;
        this.chatBins = new ChatBins();
        this.chatLogger = new ChatLogger({ channel: creds.login, host: c.host, port: c.port, onMessage: (t) => this.chatBins.add(t, startSec) });
        this.chatLogger.start();
      }
      this.saveChat(); // cada vuelta: si la app se cierra a mitad, no se pierde todo
    } else if (this.chatLogger && this.offlineStreak >= OFFLINE_CONFIRMATIONS) {
      this.saveChat();
      this.stopChat();
    }
  }

  private saveChat(): void {
    const c = this.d.chat;
    if (!c || !this.chatStart) return;
    const bins = this.chatBins.toArray();
    if (!bins.length) return;
    try {
      fs.mkdirSync(c.dir, { recursive: true });
      const file = path.join(c.dir, `${this.chatStart.replace(/[^\w-]/g, '_')}.json`);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ startedAt: this.chatStart, bins }));
      fs.renameSync(`${file}.tmp`, file);
      this.chatSaved = bins.length;
    } catch (e) {
      this.d.log.warn(`No se pudo guardar el chat: ${(e as Error).message}`);
    }
  }

  private stopChat(): void {
    this.chatLogger?.stop();
    this.chatLogger = null;
    this.chatStart = null;
  }

  /** Segundos de chat guardados del directo en curso (para el Panel). */
  chatSeconds(): number {
    return this.chatSaved;
  }

  /** Recoge los VODs nuevos de directos ya terminados. */
  private async collect(creds: TwitchCreds, stream: TwitchStream): Promise<void> {
    const vods = await this.d.twitch.listVods(creds);
    const st = this.state;
    if (!st.autoSince) {
      // primera vigilancia: lo que ya existe no se toca
      st.autoSince = new Date(this.now).toISOString();
      for (const v of vods) if (!st.seenVodIds.includes(v.id)) st.seenVodIds.push(v.id);
      this.d.store.save();
      return;
    }
    if (!stream.live && this.offlineStreak < OFFLINE_CONFIRMATIONS) return;
    const since = Date.parse(st.autoSince) - LIVE_VOD_SLACK_MS;
    const liveStart = stream.live && stream.startedAt ? Date.parse(stream.startedAt) - LIVE_VOD_SLACK_MS : Infinity;
    // los más antiguos primero, para que salgan en orden
    for (const v of [...vods].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      if (st.seenVodIds.includes(v.id)) continue;
      const created = Date.parse(v.createdAt);
      if (created < since) {
        st.seenVodIds.push(v.id);
        continue;
      }
      if (stream.live && created >= liveStart) continue; // es el directo en curso
      if (v.durationSec < MIN_IMPORT_SEC) continue; // Twitch aún lo está cerrando
      st.seenVodIds.push(v.id);
      this.d.store.save();
      const job = this.d.vods.add(v.url, v.title, { origin: 'live', twitchId: v.id, streamStartedAt: v.createdAt });
      this.lastImported = { vodId: job.id, title: v.title, at: new Date(this.now).toISOString() };
      this.d.log.info(`Directo terminado: recogiendo el VOD "${v.title}" (${v.url}).`);
    }
    if (st.seenVodIds.length > 500) st.seenVodIds.splice(0, st.seenVodIds.length - 500);
    this.d.store.save();
  }

  /** Clips del canal con la marca de los que ya están importados. */
  async clips(): Promise<TwitchClip[]> {
    const list = await this.d.twitch.listClips(this.d.creds());
    const done = new Set(this.state.importedClipIds);
    return list.map((c) => ({ ...c, imported: done.has(c.id) }));
  }

  /** Descarga un clip de Twitch; al terminar se renderiza en vertical y horizontal. */
  async importClip(clipId: string): Promise<VodJob> {
    const clip = (await this.d.twitch.listClips(this.d.creds())).find((c) => c.id === clipId);
    if (!clip) throw new Error('Ese clip ya no está en la lista de Twitch. Actualiza la lista.');
    if (this.state.importedClipIds.includes(clip.id)) {
      const prev = this.d.store.data.vods.find((v) => v.twitchId === clip.id && v.status !== 'error');
      if (prev) return prev;
    }
    const job = this.d.vods.add(clip.url, clip.title, { origin: 'clip', twitchId: clip.id });
    if (!this.state.importedClipIds.includes(clip.id)) this.state.importedClipIds.push(clip.id);
    this.d.store.save();
    return job;
  }

  private afterDownload(job: VodJob): void {
    if (job.origin === 'clip') {
      void this.renderClip(job).catch((e) => this.d.log.error(`No se pudo preparar el clip "${job.title}"`, e));
    } else if (job.origin === 'live') {
      for (const cb of this.liveListeners) {
        try {
          cb(job);
        } catch (e) {
          this.d.log.error('Fallo en el piloto automático', e);
        }
      }
    }
  }

  /** Un clip de Twitch entero, en las dos versiones. */
  private renderClip(job: VodJob): Promise<OutputItem> {
    const existing = this.clipOutputs.get(job.id);
    if (existing) return existing;
    const p = (async () => {
      const dur = await this.d.clips.vodDuration(job.id);
      const end = Math.floor(dur * 10) / 10;
      return this.d.clips.createClip(job.id, { start: 0, end, title: job.title || 'Clip de Twitch' });
    })();
    this.clipOutputs.set(job.id, p);
    p.catch(() => this.clipOutputs.delete(job.id));
    return p;
  }
}

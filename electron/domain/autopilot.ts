import fs from 'node:fs';
import path from 'node:path';
import type { AutopilotSettings, OutputItem, VodJob, AutoRole } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { bestStretch, buildSummary, fallbackTitle, findMoments, textOf, type Seg, type Signals } from '../../shared/highlights';
import { nextSlot } from '../../shared/slots';
import { ChatBins } from '../services/chatlog';
import { audioEnergy } from '../services/audioEnergy';
import { LLM_PROVIDERS, askJson, type LlmConfig } from '../services/llm';
import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { ToolPaths } from '../services/tools';
import type { SerialQueue } from '../services/queue';
import type { Notifier } from './notifier';
import type { TaskTracker } from './tasks';
import type { TranscriptService } from './transcripts';
import type { ClipService } from './clips';
import type { LibraryService } from './library';
import type { PublicationService } from './publications';

export interface AutopilotDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  tasks: TaskTracker;
  queue: SerialQueue;
  tools: () => ToolPaths;
  transcripts: TranscriptService;
  clips: ClipService;
  library: LibraryService;
  pubs: PublicationService;
  chatDir: string;
  llmKey: () => string;
  /** Solo pruebas. */
  llmBaseUrl?: string;
  llmFetch?: typeof fetch;
  energy?: typeof audioEnergy;
  now?: () => number;
}

interface Titles {
  title: string;
  description: string;
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * Cuando termina un directo y su VOD está descargado: lo transcribe, busca los mejores momentos y
 * monta resumen, vídeo principal y clips. Los deja pendientes de tu visto bueno (o los programa si lo desactivas).
 * Lo que decide los tramos son siempre las señales locales; el modelo de lenguaje solo pone títulos y descripciones.
 */
export class Autopilot {
  constructor(private d: AutopilotDeps) {}

  private get cfg(): AutopilotSettings {
    return this.d.store.data.settings.autopilot;
  }
  private get now(): number {
    return (this.d.now ?? Date.now)();
  }

  private mark(vod: VodJob, status: NonNullable<VodJob['autopilot']>['status'], note?: string): void {
    vod.autopilot = { status, ...(note ? { note } : {}), at: new Date(this.now).toISOString() };
    this.d.store.save();
    this.d.notifier.vod(vod);
    this.d.notifier.changed();
  }

  /** Lo llama el vigilante al terminar de descargar el VOD de un directo. */
  onLiveVod(vod: VodJob): void {
    if (!this.cfg.enabled) return;
    this.mark(vod, 'waiting', 'En cola para analizarse.');
    void this.run(vod.id).catch((e) => this.d.log.error('Piloto automático', e));
  }

  /** Ejecuta todo el proceso sobre un VOD descargado. Una vez por VOD a la vez. */
  run(vodId: string): Promise<VodJob> {
    const vod = this.d.store.data.vods.find((v) => v.id === vodId);
    if (!vod) return Promise.reject(new Error('El VOD no existe.'));
    if (vod.status !== 'downloaded' || !vod.filePath) return Promise.reject(new Error('El VOD todavía no está descargado.'));
    if (vod.autopilot && ['transcribing', 'analyzing', 'rendering'].includes(vod.autopilot.status) && this.running.has(vodId)) {
      return Promise.reject(new Error('El piloto automático ya está trabajando en este VOD.'));
    }
    this.running.add(vodId);
    this.mark(vod, 'waiting', 'En cola para analizarse.');
    return this.d.queue.run(() => this.process(vod)).finally(() => this.running.delete(vodId));
  }
  private running = new Set<string>();

  private chatFor(vod: VodJob): number[] | undefined {
    if (!vod.streamStartedAt || !fs.existsSync(this.d.chatDir)) return undefined;
    const start = Date.parse(vod.streamStartedAt);
    for (const f of fs.readdirSync(this.d.chatDir)) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.d.chatDir, f), 'utf8')) as { startedAt: string; bins: number[] };
        // el VOD de Twitch empieza con el directo: unos segundos de diferencia como mucho
        if (Math.abs(Date.parse(j.startedAt) - start) < 5 * 60_000 && Array.isArray(j.bins)) return ChatBins.fromArray(j.bins).toArray();
      } catch {
        /* archivo de otro directo o dañado: se ignora */
      }
    }
    return undefined;
  }

  private async process(vod: VodJob): Promise<VodJob> {
    const task = this.d.tasks.start('analyze', `Piloto automático: ${vod.title || 'directo'}`);
    const notes: string[] = [];
    try {
      // 1) transcripción (si se puede)
      let words = this.d.transcripts.words(vod.id);
      if (!words.length) {
        const st = this.d.transcripts.status();
        if (st.engine) {
          this.mark(vod, 'transcribing');
          task.update(2, 'Transcribiendo el directo (puede tardar)…');
          try {
            await this.d.transcripts.transcribe(vod.id);
            words = this.d.transcripts.words(vod.id);
          } catch (e) {
            notes.push(`Sin transcripción: ${(e as Error).message}`);
          }
        } else notes.push('Sin transcripción: Whisper no está disponible.');
      }

      // 2) señales
      this.mark(vod, 'analyzing');
      task.update(30, 'Analizando audio y chat…');
      const duration = await this.d.clips.vodDuration(vod.id);
      let energyDb: number[] | undefined;
      try {
        energyDb = await (this.d.energy ?? audioEnergy)(this.d.tools(), vod.filePath!, (s) => task.update(30 + Math.min(20, (s / duration) * 20)));
      } catch (e) {
        notes.push(`Sin análisis de volumen: ${(e as Error).message}`);
      }
      const chat = this.chatFor(vod);
      if (!chat && this.cfg.chatCapture) notes.push('Sin datos de chat de este directo.');
      const sig: Signals = { durationSec: duration, energyDb, chat, words: words.length ? words : undefined };
      if (!energyDb && !chat && !words.length) throw new Error('No hay ninguna señal para analizar (ni audio, ni chat, ni transcripción).');

      // 3) tramos
      const moments = this.cfg.maxClips > 0 ? findMoments(sig, { count: this.cfg.maxClips }) : [];
      const summary = buildSummary(sig, { minSec: this.cfg.summaryMinutes * 60 * 0.85, maxSec: this.cfg.summaryMinutes * 60 * 1.25 });
      const main = bestStretch(sig, this.cfg.mainMinutes * 60);
      if (!moments.length && !summary.length && !main) {
        this.mark(vod, 'skipped', ['No se encontraron momentos que destaquen en este directo.', ...notes].join(' '));
        task.done('Sin momentos destacados');
        return vod;
      }

      // 4) títulos
      task.update(55, 'Poniendo títulos…');
      const titles = await this.titles(vod, words, moments, main, notes);

      // 5) montaje
      this.mark(vod, 'rendering');
      const created: OutputItem[] = [];
      const errors: string[] = [];
      const total = (summary.length ? 1 : 0) + (main ? 1 : 0) + moments.length;
      let doneCount = 0;
      const step = async (role: AutoRole, label: string, fn: () => Promise<OutputItem>, t: Titles) => {
        try {
          const item = await fn();
          item.auto = { role, review: 'pending' };
          if (item.kind === 'long' && t.description) this.d.library.setMeta(item.id, { description: t.description });
          this.d.store.save();
          created.push(item);
        } catch (e) {
          errors.push(`${label}: ${(e as Error).message}`);
        }
        task.update(55 + (++doneCount / total) * 40, `Montando (${doneCount}/${total})…`);
      };
      if (summary.length) await step('summary', 'resumen', () => this.d.clips.createLong(vod.id, { title: titles.summary.title, segments: summary, ...(this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {}) }), titles.summary);
      if (main) await step('main', 'vídeo principal', () => this.d.clips.createLong(vod.id, { title: titles.main.title, segments: [main], ...(this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {}) }), titles.main);
      for (const [i, m] of moments.entries()) {
        const t = titles.clips[i];
        await step('clip', `clip ${i + 1}`, () => this.d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, ...(this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {}) }), t);
      }
      if (!created.length) throw new Error(`No se pudo montar ningún vídeo. ${errors.join(' ')}`);

      // 6) visto bueno o programación
      if (!this.cfg.requireApproval) for (const o of created) this.approve(o.id);
      const msg = `${created.length} vídeo(s) listos${this.cfg.requireApproval ? ' para revisar' : ' y programados'}.`;
      this.mark(vod, 'done', [msg, ...errors, ...notes].join(' '));
      task.done(msg);
      return vod;
    } catch (e) {
      this.mark(vod, 'error', (e as Error).message);
      task.fail((e as Error).message);
      this.d.log.error('Piloto automático fallido', e);
      throw e;
    }
  }

  private async titles(vod: VodJob, words: Word[], moments: Seg[], main: Seg | null, notes: string[]) {
    const base = {
      summary: { title: `Resumen del directo - ${this.dateLabel(vod)}`, description: '' },
      main: { title: clean(main && words.length ? fallbackTitle(words, main, 0) : `Directo del ${this.dateLabel(vod)}`, 100), description: '' },
      clips: moments.map((m, i) => ({ title: clean(words.length ? fallbackTitle(words, m, i) : `Momento ${i + 1}`, 100), description: '' })),
    };
    const llm = this.cfg.llm;
    const key = this.d.llmKey();
    if (llm.provider === 'none' || !key || !words.length) {
      if (llm.provider !== 'none' && !words.length) notes.push('Títulos sin modelo de lenguaje: no hay transcripción.');
      return base;
    }
    const conf: LlmConfig = { provider: llm.provider, model: llm.model || LLM_PROVIDERS[llm.provider].defaultModel, apiKey: key, baseUrl: this.d.llmBaseUrl };
    const items = [
      ...(main ? [{ id: 'principal', texto: textOf(words, main.start, Math.min(main.end, main.start + 240), 900) }] : []),
      ...moments.map((m, i) => ({ id: `clip${i + 1}`, texto: textOf(words, m.start, m.end, 600) })),
    ];
    try {
      const raw = (await askJson(
        conf,
        'Eres editor de contenido de un streamer en español. Escribes títulos cortos y atractivos (máximo 70 caracteres, sin clickbait falso, sin emojis) y descripciones de 1-2 frases. Responde SOLO con JSON.',
        `Estos son fragmentos transcritos de un directo. Devuelve {"resumen":{"titulo":"","descripcion":""},"principal":{"titulo":"","descripcion":""},"clips":[{"id":"clip1","titulo":"","descripcion":""}]}.\n"resumen" es el resumen de todo el directo (no tienes su texto: titúlalo a partir de los demás fragmentos). Fragmentos:\n${JSON.stringify(items)}`,
        { fetchFn: this.d.llmFetch },
      )) as { resumen?: Record<string, unknown>; principal?: Record<string, unknown>; clips?: Record<string, unknown>[] };
      const pick = (o: Record<string, unknown> | undefined, fb: Titles): Titles => ({ title: clean(o?.titulo, 100) || fb.title, description: clean(o?.descripcion, 500) || fb.description });
      base.summary = pick(raw.resumen, base.summary);
      base.main = pick(raw.principal, base.main);
      const byId = new Map((Array.isArray(raw.clips) ? raw.clips : []).map((c) => [String(c.id), c]));
      base.clips = base.clips.map((fb, i) => pick(byId.get(`clip${i + 1}`), fb));
    } catch (e) {
      notes.push(`Títulos sin modelo de lenguaje: ${(e as Error).message}`);
    }
    return base;
  }

  private dateLabel(vod: VodJob): string {
    const d = new Date(vod.streamStartedAt ?? vod.createdAt);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }

  /** Visto bueno: programa el vídeo en su hora en las redes elegidas. */
  approve(outputId: string): OutputItem {
    const o = this.d.store.data.outputs.find((x) => x.id === outputId);
    if (!o) throw new Error('El vídeo no existe.');
    const role = o.auto?.role ?? (o.kind === 'long' ? 'main' : 'clip');
    // TikTok e Instagram solo admiten clips: los vídeos largos van solo a YouTube
    const platforms = role === 'clip' ? this.cfg.platforms : this.cfg.platforms.filter((p) => p === 'youtube');
    if (!platforms.length) {
      throw new Error(role === 'clip' ? 'Elige en Ajustes en qué redes se publica lo automático.' : 'Los vídeos largos solo se publican en YouTube: actívalo en Ajustes > Piloto automático.');
    }
    const taken = new Set(this.d.store.data.publications.filter((p) => p.status !== 'failed').map((p) => Date.parse(p.scheduledAt)));
    const now = new Date(this.now + 5 * 60_000);
    let at: Date;
    if (role === 'summary') at = nextSlot(now, this.cfg.slots.summary, taken);
    else if (role === 'main') {
      const sum = this.d.store.data.outputs.find((x) => x.vodId === o.vodId && x.auto?.role === 'summary');
      const sumAt = sum ? this.d.store.data.publications.find((p) => p.outputId === sum.id)?.scheduledAt : undefined;
      // el principal sale el mismo día que el resumen, por la tarde
      const from = sumAt ? new Date(Math.max(now.getTime(), Date.parse(sumAt))) : now;
      at = nextSlot(from, this.cfg.slots.main, taken);
    } else at = nextSlot(now, this.cfg.slots.clips, taken); // un clip por día
    this.d.pubs.schedule(outputId, platforms, at.toISOString());
    o.auto = { role, review: 'approved' };
    this.d.store.save();
    this.d.notifier.changed();
    return o;
  }
}

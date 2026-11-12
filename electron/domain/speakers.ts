import fs from 'node:fs';
import path from 'node:path';
import type { Range } from '../../shared/timeline';
import type { Word } from '../../shared/subtitles';
import { DEFAULT_SPEAKER_COLORS, colorMap, defaultAlias, resolveVoices, updateProfile, type SpeakerSeg, type VoiceProfile } from '../../shared/speakers';
import { downloadEmbeddingModel, diarizeRange, embeddingInstalled, embeddingPath, loadSherpa, sherpaEngine, type DiarizeEngine } from '../services/diarize';
import type { Logger } from '../services/logger';
import type { Store } from '../services/store';
import type { ToolPaths } from '../services/tools';
import type { Notifier } from './notifier';

export interface SpeakerDeps {
  store: Store;
  log: Logger;
  notifier: Notifier;
  tools: () => ToolPaths;
  /** Archivo del directo (se vuelve a descargar si se borró). */
  source: (vodId: string) => Promise<string>;
  /** Modelo de segmentación incluido con el programa. */
  segmentationModel: string;
  modelsDir: string;
  /** Solo pruebas. */
  engine?: () => DiarizeEngine;
  fetchFn?: typeof fetch;
}

export interface ProfileInfo {
  id: number;
  alias: string;
  self: boolean;
  named: boolean;
}

/** Una voz con menos audio que esto no crea perfil nuevo (probablemente ruido o una frase suelta). */
const MIN_VOICE_SEC = 4;
/** Parecido para reconocer una voz ya conocida entre directos (más exigente que unir grupos dentro de un mismo directo). */
const KNOWN_VOICE = 0.55;
/** Trozos de como máximo esto se analizan de una vez (memoria). */
const CHUNK_SEC = 15 * 60;
const JOIN_GAP_SEC = 20;

interface Stored {
  segs: SpeakerSeg[];
  covered: Range[];
}

/** Hablantes: quién habla en cada tramo y la memoria de voces entre directos (con alias que el usuario puede poner y corregir). */
export class SpeakerService {
  private dir: string;
  private engine: DiarizeEngine | null = null;
  private versions = new Map<string, number>();
  private cache = new Map<string, { mtime: number; data: Stored }>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private d: SpeakerDeps) {
    this.dir = path.join(path.dirname(d.store.file), 'speakers');
  }

  private file(vodId: string): string {
    return path.join(this.dir, `${vodId.replace(/[^\w-]/g, '_')}.json`);
  }

  private read(vodId: string): Stored {
    const f = this.file(vodId);
    try {
      const mtime = fs.statSync(f).mtimeMs;
      const hit = this.cache.get(vodId);
      if (hit && hit.mtime === mtime) return hit.data;
      const j = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<Stored>;
      const data: Stored = { segs: Array.isArray(j.segs) ? j.segs : [], covered: Array.isArray(j.covered) ? j.covered : [] };
      this.cache.set(vodId, { mtime, data });
      return data;
    } catch {
      return { segs: [], covered: [] };
    }
  }

  private write(vodId: string, data: Stored): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const f = this.file(vodId);
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(data));
    fs.renameSync(`${f}.tmp`, f);
    this.cache.delete(vodId);
    this.versions.set(vodId, (this.versions.get(vodId) ?? 0) + 1);
  }

  /** Para el servicio de transcripciones: los tramos de cada voz de un directo. */
  overlay(vodId: string): { segs: SpeakerSeg[]; version: number } | null {
    const s = this.read(vodId);
    return s.segs.length ? { segs: s.segs, version: this.versions.get(vodId) ?? 1 } : null;
  }

  /** ¿Se puede identificar hablantes en este equipo? */
  available(): { ok: boolean; reason?: string } {
    if (this.d.engine) return { ok: true };
    if (!loadSherpa()) return { ok: false, reason: 'El módulo de diarización (sherpa-onnx) no está disponible en este equipo.' };
    if (!fs.existsSync(this.d.segmentationModel)) return { ok: false, reason: 'Falta el modelo de segmentación de voces incluido con el programa.' };
    return { ok: true };
  }

  private async getEngine(): Promise<DiarizeEngine> {
    if (this.engine) return this.engine;
    if (this.d.engine) return (this.engine = this.d.engine());
    const a = this.available();
    if (!a.ok) throw new Error(a.reason);
    if (!embeddingInstalled(this.d.modelsDir)) {
      this.d.log.info('Descargando el modelo de voz (40 MB) para identificar hablantes…');
      await downloadEmbeddingModel(this.d.modelsDir, () => undefined, this.d.fetchFn);
    }
    this.engine = sherpaEngine(this.d.segmentationModel, embeddingPath(this.d.modelsDir));
    return this.engine;
  }

  /** Partes de `ranges` que todavía no se han analizado, unidas si están cerca y partidas en trozos manejables. */
  pending(vodId: string, ranges: Range[]): Range[] {
    const cov = this.read(vodId).covered;
    let todo: Range[] = ranges.map((r) => ({ start: Math.max(0, r.start), end: r.end })).filter((r) => r.end > r.start);
    for (const c of cov) {
      todo = todo.flatMap((p) => {
        if (c.end <= p.start || c.start >= p.end) return [p];
        const parts: Range[] = [];
        if (c.start > p.start) parts.push({ start: p.start, end: c.start });
        if (c.end < p.end) parts.push({ start: c.end, end: p.end });
        return parts;
      });
    }
    todo = todo.filter((r) => r.end - r.start >= 3).sort((a, b) => a.start - b.start);
    const merged: Range[] = [];
    for (const r of todo) {
      const last = merged[merged.length - 1];
      if (last && r.start - last.end <= JOIN_GAP_SEC && r.end - last.start <= CHUNK_SEC) last.end = Math.max(last.end, r.end);
      else merged.push({ ...r });
    }
    return merged.flatMap((r) => {
      const out: Range[] = [];
      for (let s = r.start; s < r.end; s += CHUNK_SEC) out.push({ start: s, end: Math.min(r.end, s + CHUNK_SEC) });
      return out;
    });
  }

  /** Segundos de audio que faltan por analizar (para estimar el tiempo). */
  pendingSeconds(vodId: string, ranges: Range[]): number {
    return this.pending(vodId, ranges).reduce((a, r) => a + (r.end - r.start), 0);
  }

  /**
   * Identifica quién habla en los tramos indicados (solo los que faltan) y lo recuerda: las voces conocidas se reconocen, las
   * nuevas pasan a ser «Hablante N». Las llamadas se hacen de una en una para que la memoria de voces sea coherente.
   */
  diarize(vodId: string, ranges: Range[], onProgress?: (doneSec: number, totalSec: number) => void): Promise<{ voices: number; sec: number }> {
    const job = this.chain.then(() => this.doDiarize(vodId, ranges, onProgress));
    this.chain = job.catch(() => undefined);
    return job;
  }

  private async doDiarize(vodId: string, ranges: Range[], onProgress?: (doneSec: number, totalSec: number) => void): Promise<{ voices: number; sec: number }> {
    const todo = this.pending(vodId, ranges);
    const total = todo.reduce((a, r) => a + (r.end - r.start), 0);
    if (!todo.length) return { voices: 0, sec: 0 };
    const engine = await this.getEngine();
    const file = await this.d.source(vodId);
    let done = 0;
    const ids = new Set<number>();
    for (const r of todo) {
      const res = await diarizeRange(this.d.tools(), engine, file, r);
      const book = this.d.store.data.speakers;
      const known = resolveVoices(res.embeddings, book.profiles, { minSimilarity: KNOWN_VOICE });
      const map = new Map<number, number>();
      for (const [voice, emb] of res.embeddings) {
        const sec = res.seconds.get(voice) ?? 0;
        const p = known.get(voice);
        if (p) {
          const i = book.profiles.findIndex((x) => x.id === p.id);
          book.profiles[i] = updateProfile(p, emb, Math.min(sec, 60) / 60);
          map.set(voice, p.id);
        } else if (sec >= MIN_VOICE_SEC) {
          const np: VoiceProfile = { id: book.nextId++, embedding: emb, n: Math.min(sec, 60) / 60 };
          book.profiles.push(np);
          map.set(voice, np.id);
        }
      }
      const cur = this.read(vodId);
      const segs = res.segs.flatMap((s) => (map.has(s.speaker) ? [{ ...s, speaker: map.get(s.speaker)! }] : []));
      for (const s of segs) ids.add(s.speaker);
      // lo ya analizado de este mismo tramo se sustituye
      const kept = cur.segs.filter((s) => s.end <= r.start || s.start >= r.end);
      this.write(vodId, { segs: [...kept, ...segs].sort((a, b) => a.start - b.start), covered: [...cur.covered, { start: r.start, end: r.end }] });
      this.d.store.save();
      done += r.end - r.start;
      onProgress?.(done, total);
    }
    this.d.notifier.changed();
    return { voices: ids.size, sec: total };
  }

  profiles(): ProfileInfo[] {
    return this.d.store.data.speakers.profiles.map((p) => ({ id: p.id, alias: p.alias || defaultAlias(p.id), self: p.self === true, named: Boolean(p.alias) }));
  }

  private profile(id: number): VoiceProfile {
    const p = this.d.store.data.speakers.profiles.find((x) => x.id === id);
    if (!p) throw new Error('Ese hablante no existe.');
    return p;
  }

  /** Pone o quita el nombre de un hablante (se conserva en los próximos directos). */
  rename(id: number, alias: string): void {
    const p = this.profile(id);
    const a = String(alias ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
    if (a) p.alias = a;
    else delete p.alias;
    this.d.store.save();
    this.d.notifier.changed();
  }

  /** Marca qué voz es la del propio streamer (null = ninguna). */
  setSelf(id: number | null): void {
    for (const p of this.d.store.data.speakers.profiles) delete p.self;
    if (id !== null) this.profile(id).self = true;
    this.d.store.save();
    this.d.notifier.changed();
  }

  /** Une dos hablantes que en realidad son la misma persona: `from` desaparece y sus frases pasan a `into`. */
  merge(from: number, into: number): void {
    if (from === into) throw new Error('Elige dos hablantes distintos.');
    const a = this.profile(from);
    const b = this.profile(into);
    const book = this.d.store.data.speakers;
    const merged = updateProfile(b, a.embedding, a.n);
    merged.self = a.self || b.self ? true : undefined;
    if (!merged.self) delete merged.self;
    if (!b.alias && a.alias) merged.alias = a.alias;
    book.profiles = book.profiles.filter((p) => p.id !== from).map((p) => (p.id === into ? merged : p));
    if (fs.existsSync(this.dir)) {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json')) continue;
        const id = f.slice(0, -5);
        const cur = this.read(id);
        if (cur.segs.some((s) => s.speaker === from)) this.write(id, { ...cur, segs: cur.segs.map((s) => (s.speaker === from ? { ...s, speaker: into } : s)) });
      }
    }
    this.d.store.save();
    this.d.notifier.changed();
  }

  /** Colores de las voces que aparecen en unas palabras; undefined si hay una sola voz (no hace falta colorear). */
  colorsFor(words: Word[]): Record<number, string> | undefined {
    const ids: number[] = [];
    for (const w of words) if (w.spk !== undefined && !ids.includes(w.spk)) ids.push(w.spk);
    if (ids.length < 2) return undefined;
    const self = this.d.store.data.speakers.profiles.find((p) => p.self)?.id;
    const palette = this.d.store.data.settings.autopilot.speakerColors;
    return colorMap(ids, self, palette?.length ? palette : DEFAULT_SPEAKER_COLORS);
  }
}

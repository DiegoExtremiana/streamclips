import fs from 'node:fs';
import path from 'node:path';
import type { TwitchClip } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { heuristicScore, isGold, modelScore, SCORE_VERSION, viewsPercentile, type ClipSignals } from '../../shared/clipScore';

interface Stored {
  /** Nota 0-10 (no se enseña). Ausente si el análisis falló. */
  score?: number;
  v: number;
  at: number;
  /** Cómo se puntuó: con el modelo de lenguaje o con las señales del propio clip. */
  by?: 'model' | 'signals';
  /** Intentos fallidos seguidos. */
  fails?: number;
}

export interface ClipScoreDeps {
  file: string;
  /** Baja el audio del clip y saca sus palabras y su volumen. Lanza si no se puede. */
  analyze: (clip: TwitchClip) => Promise<ClipSignals>;
  /** Valoración del contenido por el modelo de lenguaje (0-10); null si no hay modelo o no respondió. */
  judge?: (clip: TwitchClip, words: Word[]) => Promise<number | null>;
  /** Solo se trabaja cuando el equipo está libre (sin directo en marcha ni análisis del piloto). */
  canRun: () => boolean;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Nota por señales a partir de la cual merece la pena preguntar al modelo de lenguaje. */
const PRE_JUDGE_MIN = 5.5;
const MAX_FAILS = 2;
const RETRY_AFTER_MS = 24 * 3600_000;
const WAIT_MS = 60_000;
/** Más largos que esto no son «clips» normales y no se analizan. */
const MAX_CLIP_SEC = 180;

/**
 * Puntúa en segundo plano los clips del canal (de uno en uno, solo con el equipo libre) y recuerda la nota. La nota es interna:
 * lo único que sale de aquí es si un clip es «dorado» (8/10 o más). Lo ya puntuado no se vuelve a analizar.
 */
export class ClipScoreService {
  private scores = new Map<string, Stored>();
  private queue: TwitchClip[] = [];
  private views: number[] = [];
  private running: Promise<void> | null = null;
  private stopped = false;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly d: ClipScoreDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = d.now ?? Date.now;
    try {
      const j = JSON.parse(fs.readFileSync(d.file, 'utf8')) as Record<string, Stored>;
      for (const [id, v] of Object.entries(j)) if (v && typeof v === 'object' && v.v === SCORE_VERSION) this.scores.set(id, v);
    } catch {
      /* sin puntuaciones guardadas */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.d.file), { recursive: true });
      const tmp = `${this.d.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.scores)));
      fs.renameSync(tmp, this.d.file);
    } catch {
      /* si no se guarda, se vuelve a puntuar la próxima vez */
    }
  }

  /** ¿Pasa de 8/10? (Lo único que se enseña de la puntuación.) */
  gold(id: string): boolean {
    return isGold(this.scores.get(id)?.score);
  }

  /** Clips por puntuar (los que quedan en cola). */
  pending(): number {
    return this.queue.length;
  }

  private needs(c: TwitchClip): boolean {
    if (c.durationSec > MAX_CLIP_SEC || c.durationSec < 3) return false;
    const s = this.scores.get(c.id);
    if (!s) return true;
    if (s.score !== undefined) return false;
    return (s.fails ?? 0) < MAX_FAILS || this.now() - s.at > RETRY_AFTER_MS;
  }

  /** Añade a la cola los clips sin puntuar (los más recientes primero) y arranca el trabajo si no estaba en marcha. */
  enqueue(clips: TwitchClip[]): void {
    this.views = clips.map((c) => c.views);
    const queued = new Set(this.queue.map((c) => c.id));
    const add = clips.filter((c) => this.needs(c) && !queued.has(c.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!add.length) return;
    this.queue.push(...add);
    this.start();
  }

  private start(): void {
    if (this.running || this.stopped) return;
    this.running = this.loop().finally(() => {
      this.running = null;
      if (this.queue.length && !this.stopped) this.start();
    });
  }

  /** Se cumple cuando la cola se vacía (para pruebas y para esperar al cerrar). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  stop(): void {
    this.stopped = true;
    this.queue = [];
  }

  private async loop(): Promise<void> {
    while (this.queue.length && !this.stopped) {
      if (!this.d.canRun()) {
        await this.sleep(WAIT_MS);
        continue;
      }
      const clip = this.queue.shift()!;
      if (!this.needs(clip)) continue;
      try {
        this.scores.set(clip.id, await this.score(clip));
      } catch (e) {
        const prev = this.scores.get(clip.id);
        this.scores.set(clip.id, { v: SCORE_VERSION, at: this.now(), fails: (prev?.fails ?? 0) + 1 });
        this.d.log?.warn(`No se pudo puntuar el clip ${clip.id}: ${(e as Error).message}`);
      }
      this.save();
    }
  }

  private async score(clip: TwitchClip): Promise<Stored> {
    const sig = await this.d.analyze(clip);
    const pct = viewsPercentile(clip.views, this.views);
    const base = heuristicScore(sig, pct);
    // el modelo (límite gratuito diario) solo se gasta en los que pueden llegar a dorado: confirma o rebaja
    if (this.d.judge && sig.words.length >= 4 && base >= PRE_JUDGE_MIN) {
      try {
        const judged = await this.d.judge(clip, sig.words);
        if (judged !== null) return { score: modelScore(judged, pct), v: SCORE_VERSION, at: this.now(), by: 'model' };
      } catch (e) {
        this.d.log?.warn(`El modelo no valoró el clip ${clip.id}; se usan las señales del propio clip: ${(e as Error).message}`);
      }
    }
    return { score: base, v: SCORE_VERSION, at: this.now(), by: 'signals' };
  }
}

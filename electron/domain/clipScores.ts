import fs from 'node:fs';
import path from 'node:path';
import type { TwitchClip } from '../../shared/types';
import type { Word } from '../../shared/subtitles';
import { isGold, SCORE_VERSION, type ClipSignals } from '../../shared/clipScore';
import { criteriaFromSignals, overall, reasonFromCriteria, withMeasuredViral, type ClipCriteria, type ClipJudgement, type Evidence, type RubricItems } from '../../shared/clipCriteria';

interface Stored {
  /** Título y fecha del clip (para el documento de notas legible). */
  title?: string;
  createdAt?: string;
  /** Nota 0-10. Ausente si el análisis falló. */
  score?: number;
  v: number;
  at: number;
  /** Los cuatro criterios (humor, se cuenta algo, viral, interesante). */
  crit?: ClipCriteria;
  /** Frase con lo que explica la nota. */
  reason?: string;
  /** Cómo se puntuó: con el modelo de lenguaje o con las señales del propio clip. */
  by?: 'model' | 'signals';
  /** Intentos fallidos seguidos. */
  fails?: number;
  /** Respuestas de la rúbrica y pruebas (citas) del modelo. */
  items?: RubricItems;
  evidence?: Evidence;
  /** El clip no tiene palabras que valorar: no se puntúa (y no se repite). */
  noText?: boolean;
  /** Se puntuó solo con las señales porque no había modelo (o falló): se repite en cuanto haya uno. */
  noModel?: boolean;
}

/** Fases de valorar un clip, para medir dónde se va el tiempo. */
export type ScorePhase = 'descarga' | 'imagen' | 'volumen' | 'transcripcion' | 'modelo';
const PHASE_LABEL: Record<ScorePhase, string> = { descarga: 'bajando el clip', imagen: 'sacando fotogramas', volumen: 'midiendo el volumen', transcripcion: 'transcribiendo con Whisper', modelo: 'preguntando al modelo' };

export interface ClipScoreDeps {
  /** Documento legible con las notas de todos los clips (se reescribe al valorar). */
  notesFile?: string;
  file: string;
  /** Baja el audio del clip y saca sus palabras y su volumen. Lanza si no se puede. */
  analyze: (clip: TwitchClip, onPhase?: (phase: ScorePhase) => void) => Promise<ClipSignals>;
  /** Valoración del contenido por el modelo de lenguaje (cuatro criterios y motivo); null si no hay modelo o no respondió. */
  judge?: (clip: TwitchClip, words: Word[], frames?: string[]) => Promise<ClipJudgement | null>;
  /** Texto con lo que falta para poder valorar (p. ej. el modelo de Whisper); null si todo está listo. */
  ready?: () => string | null;
  /** ¿Hay un modelo de lenguaje configurado ahora? Si lo hay, los clips puntuados sin él se vuelven a valorar. */
  hasJudge?: () => boolean;
  /** Por qué ahora no se trabaja (directo en marcha, análisis del piloto…); null si se puede. Solo para informar. */
  waitReason?: () => string | null;
  /** Solo se trabaja cuando el equipo está libre (sin directo en marcha ni análisis del piloto). */
  canRun: () => boolean;
  /** ¿Está activado puntuar en segundo plano? (Solo para informar a la interfaz.) */
  enabled?: () => boolean;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Con menos palabras que esto no hay nada que leer para el modelo. */
const MIN_WORDS_TO_JUDGE = 4;
const MAX_FAILS = 2;
/** El modelo de lenguaje no se puede usar (modelo retirado, clave rechazada, cuota agotada): se detiene el trabajo en vez de gastar descargas. */
class ModelBlocked extends Error {
  readonly blocked = true;
}
/** Clips valorados a la vez: mientras uno se transcribe, otro baja su audio y otro espera al modelo. */
const CONCURRENCY = 2;
/** Se conservan las notas de versiones anteriores del método mientras sean comparables: no se repite el trabajo al actualizar. */
const MIN_COMPATIBLE_VERSION = 5;
const RETRY_AFTER_MS = 24 * 3600_000;
/** Un clip valorado sin modelo se repite con modelo, pero no más a menudo que esto (límites gratuitos). */
const MODEL_RETRY_MS = 30 * 60_000;
const WAIT_MS = 60_000;
/** Más largos que esto no son «clips» normales y no se analizan. */
const MAX_CLIP_SEC = 180;

/**
 * Puntúa en segundo plano los clips del canal (de uno en uno, solo con el equipo libre) y recuerda la nota con sus cuatro
 * criterios y el motivo. Un clip es «dorado» con 8/10 o más. Lo ya puntuado no se vuelve a analizar.
 */
export class ClipScoreService {
  private scores = new Map<string, Stored>();
  private queue: TwitchClip[] = [];
  private running: Promise<void> | null = null;
  private stopped = false;
  private blocker: string | null = null;
  private lastError: string | null = null;
  private current = new Map<string, { title: string; phase: ScorePhase }>();
  /** Milisegundos por fase de los últimos clips y tiempo total por clip, para calcular cuánto falta. */
  private recent: { total: number; phases: Partial<Record<ScorePhase, number>> }[] = [];
  private unsavedNotes = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly d: ClipScoreDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = d.now ?? Date.now;
    try {
      const j = JSON.parse(fs.readFileSync(d.file, 'utf8')) as Record<string, Stored>;
      for (const [id, v] of Object.entries(j)) {
        if (!v || typeof v !== 'object' || v.v < MIN_COMPATIBLE_VERSION || v.v > SCORE_VERSION) continue;
        // un intento fallido de una sesión anterior no se arrastra: tras actualizar el programa (o arreglar la causa) se vuelve a intentar
        if (v.score === undefined && !v.noText) continue;
        this.scores.set(id, v);
      }
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

  /** Nota de un clip (0-10, un decimal) si ya está valorado. */
  scoreOf(id: string): number | undefined {
    const s = this.scores.get(id)?.score;
    return typeof s === 'number' ? Math.round(s * 10) / 10 : undefined;
  }

  /** Los criterios, el motivo y cómo se valoró un clip (si ya está valorado). */
  detailOf(id: string): { criteria: ClipCriteria; reason: string; by: 'model' | 'signals'; items?: RubricItems; evidence?: Evidence } | undefined {
    const s = this.scores.get(id);
    return s?.crit && s.score !== undefined ? { criteria: s.crit, reason: s.reason ?? '', by: s.by ?? 'signals', items: s.items, evidence: s.evidence } : undefined;
  }

  /** Por qué un clip no tiene nota (no tiene palabras que valorar). */
  skipReason(id: string): string | undefined {
    const s = this.scores.get(id);
    return s?.noText ? s.reason : undefined;
  }

  /** Cómo está la cola ahora: por qué espera, cuántos clips han fallado y el último error. */
  diagnostics(): { waiting?: string; failed: number; lastError?: string; working?: string; secPerClip?: number; etaMin?: number; phases?: Partial<Record<ScorePhase, number>> } {
    let failed = 0;
    for (const v of this.scores.values()) if (v.score === undefined && !v.noText && (v.fails ?? 0) > 0) failed++;
    const waiting = this.queue.length && !this.d.canRun() ? (this.d.waitReason?.() ?? 'el equipo está ocupado') : undefined;
    const first = [...this.current.values()][0];
    const working = first ? `«${first.title.slice(0, 50)}»: ${PHASE_LABEL[first.phase]}` : undefined;
    const t = this.timing();
    return {
      ...(waiting ? { waiting } : {}),
      failed,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(working ? { working } : {}),
      ...(t ? { secPerClip: t.secPerClip, etaMin: Math.ceil((this.queue.length * t.secPerClip) / 60), phases: t.phases } : {}),
    };
  }

  /** Tiempo medio por clip (ya con los clips en paralelo) y por fase, sobre los últimos clips. */
  private timing(): { secPerClip: number; phases: Partial<Record<ScorePhase, number>> } | undefined {
    if (!this.recent.length) return undefined;
    const n = this.recent.length;
    const phases: Partial<Record<ScorePhase, number>> = {};
    for (const r of this.recent) for (const [k, v] of Object.entries(r.phases)) phases[k as ScorePhase] = (phases[k as ScorePhase] ?? 0) + v! / n / 1000;
    for (const k of Object.keys(phases) as ScorePhase[]) phases[k] = Math.round(phases[k]! * 10) / 10;
    const avg = this.recent.reduce((a, r) => a + r.total, 0) / n / 1000;
    return { secPerClip: Math.round((avg / CONCURRENCY) * 10) / 10, phases };
  }

  /** Lo que impide valorar ahora mismo (p. ej. falta el modelo de Whisper); undefined si nada. */
  problem(): string | undefined {
    return this.blocker ?? undefined;
  }

  /** ¿Pasa de 8/10? */
  gold(id: string): boolean {
    return isGold(this.scores.get(id)?.score);
  }

  /** El análisis en segundo plano está activado (Ajustes). */
  enabled(): boolean {
    return this.d.enabled ? this.d.enabled() : true;
  }

  /** Clips por puntuar (los que quedan en cola). */
  pending(): number {
    return this.queue.length;
  }

  private needs(c: TwitchClip): boolean {
    if (c.durationSec > MAX_CLIP_SEC || c.durationSec < 3) return false;
    const s = this.scores.get(c.id);
    if (!s) return true;
    if (s.noText) return false;
    if (s.score !== undefined) return Boolean(s.noModel && this.d.hasJudge?.() && this.now() - s.at > MODEL_RETRY_MS);
    return (s.fails ?? 0) < MAX_FAILS || this.now() - s.at > RETRY_AFTER_MS;
  }

  /** Añade a la cola los clips sin puntuar (los más recientes primero) y arranca el trabajo si no estaba en marcha. */
  enqueue(clips: TwitchClip[]): void {
    this.blocker = this.d.ready?.() ?? null;
    if (this.blocker) return;
    const queued = new Set(this.queue.map((c) => c.id));
    const add = clips.filter((c) => this.needs(c) && !queued.has(c.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (!add.length) return;
    this.queue.push(...add);
    this.start();
  }

  private start(): void {
    if (this.running || this.stopped) return;
    this.running = Promise.all(Array.from({ length: CONCURRENCY }, () => this.loop())).then(() => undefined).finally(() => {
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
      this.blocker = this.d.ready?.() ?? null;
      if (this.blocker) {
        this.queue = [];
        return;
      }
      const clip = this.queue.shift();
      if (!clip || !this.needs(clip)) continue;
      const meta = { title: clip.title, createdAt: clip.createdAt };
      try {
        this.scores.set(clip.id, { ...meta, ...(await this.score(clip)) });
        this.lastError = null;
      } catch (e) {
        if ((e as ModelBlocked).blocked) {
          // el modelo no está disponible (retirado, clave mala o cuota agotada): no se siguen bajando clips para nada; se avisa y se reintenta al reabrir
          this.blocker = `La IA no está disponible: ${(e as Error).message}`;
          this.lastError = (e as Error).message.slice(0, 240);
          this.queue = [];
          return;
        }
        const prev = this.scores.get(clip.id);
        this.scores.set(clip.id, { ...meta, v: SCORE_VERSION, at: this.now(), fails: (prev?.fails ?? 0) + 1 });
        this.lastError = (e as Error).message.slice(0, 240);
        this.d.log?.warn(`No se pudo puntuar el clip ${clip.id}: ${(e as Error).message}`);
      } finally {
        this.current.delete(clip.id);
      }
      this.save();
      if (++this.unsavedNotes >= 10 || !this.queue.length) this.writeNotes();
    }
  }

  /** Ruta del documento de notas (si está activado). */
  notesPath(): string | undefined {
    return this.d.notesFile;
  }

  /** Reescribe el documento legible con las notas (Markdown: tabla con nota, criterios y motivo de cada clip). */
  writeNotes(): void {
    this.unsavedNotes = 0;
    if (!this.d.notesFile) return;
    try {
      const rows = [...this.scores.entries()].filter(([, v]) => v.score !== undefined).sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));
      const c = (v: number | undefined) => (v === undefined ? '-' : String(Math.round(v * 10) / 10));
      const lines = [
        '# Notas de tus clips de Twitch',
        '',
        'Lo escribe StreamClips solo. Cada clip se valora una vez y la nota queda aquí; al abrir el programa no se vuelve a calcular.',
        'Nota de 0 a 10 (8 o más = dorado). Se mide el contenido, nunca las visualizaciones.',
        '',
        '| Nota | Humor | Se cuenta algo | Viral | Interesante | Clip | Fecha | Motivo |',
        '|---|---|---|---|---|---|---|---|',
        ...rows.map(([id, v]) => `| ${c(v.score)} | ${c(v.crit?.humor)} | ${c(v.crit?.historia)} | ${c(v.crit?.viral)} | ${c(v.crit?.interes)} | ${(v.title ?? id).replace(/\|/g, '/')} | ${(v.createdAt ?? '').slice(0, 10)} | ${(v.reason ?? '').replace(/[|\n]/g, ' ')} |`),
        '',
      ];
      fs.mkdirSync(path.dirname(this.d.notesFile), { recursive: true });
      fs.writeFileSync(this.d.notesFile, lines.join('\n'));
    } catch {
      /* el documento es una comodidad: si no se escribe, las notas siguen guardadas */
    }
  }

  private async score(clip: TwitchClip): Promise<Stored> {
    const started = this.now();
    const phases: Partial<Record<ScorePhase, number>> = {};
    let phase: ScorePhase = 'descarga';
    let since = started;
    const mark = (next: ScorePhase) => {
      const t = this.now();
      phases[phase] = (phases[phase] ?? 0) + (t - since);
      phase = next;
      since = t;
      this.current.set(clip.id, { title: clip.title, phase });
    };
    this.current.set(clip.id, { title: clip.title, phase });
    const result = await this.scoreInner(clip, mark);
    mark(phase);
    this.recent.push({ total: this.now() - started, phases });
    if (this.recent.length > 30) this.recent.shift();
    return result;
  }

  private async scoreInner(clip: TwitchClip, mark: (p: ScorePhase) => void): Promise<Stored> {
    const sig = await this.d.analyze(clip, mark);
    // sin palabras no hay nada que valorar: no se inventa una nota (un clip mudo no es «aburrido», es que no se puede leer)
    if (sig.words.length < MIN_WORDS_TO_JUDGE && !(sig.frames?.length && this.d.judge)) {
      return { v: SCORE_VERSION, at: this.now(), noText: true, reason: 'Sin nota: casi no se oye hablar en este clip, así que no hay nada que valorar.' };
    }
    const crit = criteriaFromSignals(sig);
    const noModel = true; // se repite con modelo en cuanto lo haya
    if (this.d.judge) {
      mark('modelo');
      try {
        const j = await this.d.judge(clip, sig.words, sig.frames);
        if (j) {
          const criteria = withMeasuredViral(j.criteria, sig);
          return { score: overall(criteria), crit: criteria, reason: `${j.reason || reasonFromCriteria(criteria, 'model')}${sig.frames?.length ? ' (visto y oído)' : ''}`, items: j.items, evidence: j.evidence, v: SCORE_VERSION, at: this.now(), by: 'model' };
        }
      } catch (e) {
        // con modelo configurado, una nota sacada solo del audio no es fiable (el humor sale casi siempre bajo): mejor sin nota que una nota engañosa
        const msg = (e as Error).message;
        this.d.log?.warn(`El modelo no valoró el clip ${clip.id}: ${msg}`);
        if (/no existe|rechaz|límite gratuito|Falta la clave/i.test(msg)) throw new ModelBlocked(msg);
        throw new Error(`El modelo no pudo valorar el clip: ${msg}`);
      }
    }
    if (sig.words.length < MIN_WORDS_TO_JUDGE) return { v: SCORE_VERSION, at: this.now(), noText: true, reason: 'Sin nota: casi no se oye hablar en este clip y el modelo no pudo valorarlo por la imagen.' };
    return { score: overall(crit), crit, reason: reasonFromCriteria(crit, 'signals'), v: SCORE_VERSION, at: this.now(), by: 'signals', noModel: noModel };
  }
}

import type { AutopilotSettings, OutputItem, VodJob } from '../../../shared/types';
import type { Word } from '../../../shared/subtitles';
import type { Seg, Signals } from '../../../shared/highlights';
import type { Candidate, Judged } from '../../../shared/judge';
import type { ThemeProposal } from '../../../shared/themes';
import type { Chapter } from '../../../shared/categories';
import type { MusicMood } from '../../../shared/music';
import type { StyleProfile } from '../../../shared/styleProfile';
import type { PhaseClock } from '../../../shared/phaseClock';
import type { LlmConfig } from '../../services/llm';
import type { TaskHandle } from '../tasks';
import type { AutopilotDeps } from '../autopilot';

/** Lo que explica la nota de un momento elegido (va al elemento creado, para revisarlo). */
export interface MomentMeta {
  score: number;
  kind: string;
  reason: string;
}

export interface Titles {
  title: string;
  description: string;
}

/** Un vídeo largo ya decidido: qué tramos, en qué orden y con qué rótulos. Lo monta la fase de montaje. */
export interface LongPlan {
  title: string;
  description: string;
  segs: Seg[];
  /** Capítulos de la descripción y rótulos en pantalla (por el inicio del tramo en el directo). */
  chapterLabels?: Map<number, string>;
  /** Etiqueta de capítulo por índice de tramo ('' = el tramo continúa el capítulo anterior). */
  labelsByIndex?: string[];
  /** Frase para la miniatura (2-4 palabras), si el director la decidió. */
  coverText?: string;
  /** Rótulos en pantalla (en segundos del directo). */
  captions?: { at: number; text: string; kind: 'capitulo' | 'frase' | 'gancho' | 'cierre'; duration?: number }[];
  meta?: MomentMeta;
}

/**
 * Lo que el piloto puede pedir a la clase que lo aloja (nombres, música, cortos, temas…). Las fases solo ven esto,
 * no la clase entera, y así cada una se prueba y se lee por separado.
 */
export interface Host {
  cfg: AutopilotSettings;
  d: AutopilotDeps;
  mark(vod: VodJob, status: NonNullable<VodJob['autopilot']>['status'], note?: string): void;
  markPaused(vod: VodJob, interrupted?: boolean): void;
  llmConf(): LlmConfig | null;
  chatFor(vod: VodJob): number[] | undefined;
  titles(vod: VodJob, words: Word[], moments: Seg[], mains: Seg[], notes: string[]): Promise<{ summary: Titles; mains: Titles[]; clips: Titles[] }>;
  musicFor(vod: VodJob, words: Word[], title: string, segs: Seg[], smart: boolean, llmConf: LlmConfig | null | undefined): Promise<MusicMood | null>;
  makeShort(vodId: string, words: Word[], llmConf: LlmConfig | null | undefined, title: string, seg: Seg, subs: { subtitles?: AutopilotSettings['subtitles'] | undefined }): Promise<OutputItem>;
  findThemes(vod: VodJob, judged: Judged[], words: Word[], conf: LlmConfig, notes: string[], o?: { chars?: number; minLongSec?: number; hardCapSec?: number }): Promise<ThemeProposal[]>;
  approve(outputId: string): OutputItem;
  discard(vodId: string, o?: { fromRun?: boolean }): { freedBytes: number; kept: number };
  recordTimes(vod: VodJob, phases: Record<string, number>, totalSec: number): void;
  style(): StyleProfile;
}

/** Estado que viaja de fase en fase durante el análisis de un directo. Cada fase lee lo que necesita y deja lo suyo. */
export interface RunContext {
  host: Host;
  vod: VodJob;
  task: TaskHandle;
  notes: string[];
  clock: PhaseClock;
  t0: number;
  /** «18 s» o «3 min» desde un instante, para las notas. */
  lap(since: number): string;

  // transcripción y señales
  /** El volumen por segundo se calcula a la vez que la transcripción (ffmpeg y Whisper no se estorban) y se recoge después. */
  energyJob: Promise<{ v: number[] } | { e: unknown }>;
  words: Word[];
  tTranscribe: string;
  /** Análisis rápido: se transcribe solo lo elegido, después de elegirlo. */
  deferTranscribe: boolean;
  duration: number;
  sig: Signals;
  cats: Chapter[];
  multiCat: boolean;
  llmConf: LlmConfig | null;

  // tramos
  moments: Seg[];
  summary: Seg[];
  mains: Seg[];
  pool: Candidate[];
  legacy: { moments: Seg[]; summary: Seg[]; mains: Seg[] };
  judged: Judged[] | null;
  chapterLabels: Map<number, string>;
  summaryMeta?: MomentMeta;
  meta: Map<Seg, MomentMeta>;
  /** Títulos que ya decidió el editor de humor para sus clips (mandan sobre los de la fase de títulos). */
  clipTitles?: Map<Seg, string>;
  /** Vídeo largo decidido por el director de edición (sustituye al resumen por lista de mejores momentos). */
  directed?: LongPlan;
  /** Título fijo del resumen del directo: «Resumen 15 de noviembre de 2026». */
  summaryTitle?: string;
  topicLongs: ThemeProposal[];
  topicShorts: ThemeProposal[];
  askProposals: ThemeProposal[];

  // títulos y montaje
  titles: { summary: Titles; mains: Titles[]; clips: Titles[] };
  created: OutputItem[];
  errors: string[];
  scheduled: number;
  /** Cuándo empezó el montaje (para la nota de tiempos si el reloj por fases no tiene nada). */
  renderStarted?: number;
}

/** Resultado de una fase: seguir, o parar porque el análisis ya terminó (sin momentos, por ejemplo). */
export type PhaseOutcome = 'continue' | 'stop';
export type Phase = (ctx: RunContext) => Promise<PhaseOutcome>;

export function newContext(host: Host, vod: VodJob, task: TaskHandle, clock: PhaseClock, now: () => number, energyJob: RunContext['energyJob']): RunContext {
  const t0 = now();
  return {
    host,
    vod,
    task,
    notes: [],
    clock,
    t0,
    lap: (since) => {
      const s = Math.round((now() - since) / 1000);
      return s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`;
    },
    energyJob,
    words: [],
    tTranscribe: '',
    deferTranscribe: false,
    duration: 0,
    sig: { durationSec: 0 },
    cats: [],
    multiCat: false,
    llmConf: null,
    moments: [],
    summary: [],
    mains: [],
    pool: [],
    legacy: { moments: [], summary: [], mains: [] },
    judged: null,
    chapterLabels: new Map(),
    meta: new Map(),
    topicLongs: [],
    topicShorts: [],
    askProposals: [],
    titles: { summary: { title: '', description: '' }, mains: [], clips: [] },
    created: [],
    errors: [],
    scheduled: 0,
  };
}

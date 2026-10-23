import { cleanVocabulary, emptyVocabulary, type Vocabulary } from '../../shared/vocab';
import fs from 'node:fs';
import path from 'node:path';
import type { Group, OutputItem, Platform, Publication, Settings, VodJob } from '../../shared/types';

export const STORE_VERSION = 2;

/**
 * Versión 1 guardaba cada render como un elemento suelto (kind vertical/horizontal/long con un solo `file`).
 * Desde la versión 2 un clip reúne sus versiones en `files`. Lo que no se pueda interpretar se descarta.
 */
export function normalizeOutput(raw: unknown): OutputItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown> & Partial<OutputItem> & { file?: unknown };
  if (typeof o.id !== 'string' || typeof o.title !== 'string') return null;
  const files: OutputItem['files'] = {};
  if (typeof o.files === 'object' && o.files !== null) {
    for (const k of ['vertical', 'horizontal', 'long'] as const) {
      const f = (o.files as Record<string, unknown>)[k];
      if (typeof f === 'string' && f) files[k] = f;
    }
  } else if (typeof o.file === 'string' && o.file) {
    const legacy = o.kind as string;
    if (legacy === 'vertical' || legacy === 'horizontal' || legacy === 'long') files[legacy] = o.file;
  }
  const kind: OutputItem['kind'] = o.kind === 'long' || files.long ? 'long' : 'clip';
  if (!Object.keys(files).length && o.remote !== true) return null; // sin archivos solo valen los que viven en la nube
  const { file: _legacyFile, ...rest } = o as Record<string, unknown>;
  void _legacyFile;
  return { ...(rest as unknown as OutputItem), kind, files };
}

/** Velocidades medidas (segundos de audio por segundo de reloj), solo números válidos. */
function ratios(x: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000) out[k] = v;
  }
  return out;
}

export interface DataShape {
  schemaVersion: number;
  settings: Settings;
  vods: VodJob[];
  outputs: OutputItem[];
  groups: Group[];
  publications: Publication[];
  channel: ChannelState;
  connections: Partial<Record<Platform, StoredConnection>>;
  cloud: CloudState;
  engine: EngineState;
  /** Medidas de este equipo (p. ej. la velocidad de Whisper por modelo) para estimar cuánto tarda cada cosa. */
  stats: { transcribeRatio: Record<string, number> };
  /** Palabras propias y correcciones aprendidas (ver shared/vocab.ts). */
  vocab: Vocabulary;
}

/** Motor nocturno (repositorio público con GitHub Actions). */
export interface EngineState {
  enabled: boolean;
  repo: string;
  /** Token de GitHub, cifrado. */
  token: string;
  since: string | null;
  lastSync: string | null;
  /** Huella de la última configuración subida (para volver a subirla solo si cambia). */
  payloadHash: string;
}

export interface CloudState {
  enabled: boolean;
  repo: string;
  /** Token de GitHub, cifrado. */
  token: string;
  lastSync: string | null;
  /** Para volver a escribir el flujo cuando cambian las horas de publicación o el huso horario. */
  workflowCrons: string;
  /** Claves de las subidas de la cola que este programa ya conoce (propias o traídas): lo cancelado aquí no se vuelve a traer. */
  known: string[];
}

/** Datos de una red social. Todo lo secreto va cifrado (ver Secrets). */
export interface StoredConnection {
  clientId: string;
  clientSecret: string;
  /** TokenSet en JSON, cifrado. */
  tokens: string;
  account?: string;
}

/** Lo que el vigilante del canal recuerda entre sesiones. */
export interface ChannelState {
  autoImport: boolean;
  /** Desde cuándo vigila: solo se recogen VODs posteriores. null = aún no se ha fijado. */
  autoSince: string | null;
  /** VODs de Twitch ya vistos (recogidos o anteriores a empezar a vigilar). */
  seenVodIds: string[];
  /** Clips de Twitch ya importados. */
  importedClipIds: string[];
}

function defaults(defaultOutputDir: string): DataShape {
  return {
    schemaVersion: STORE_VERSION,
    settings: {
      outputDir: defaultOutputDir,
      ffmpegPath: '',
      ytdlpPath: '',
      twitch: { clientId: '', clientSecret: '', login: '' },
      whisperPath: '',
      whisperModel: 'small',
      whisperLanguage: 'es',
      autopilot: {
        enabled: true,
        requireApproval: false,
        maxClips: 3,
        maxVideos: 4,
        visibility: 'public',
        subtitles: '',
        platforms: ['youtube', 'tiktok', 'instagram'],
        videoTimes: ['08:00', '12:00', '16:00', '21:30'],
        clipTimes: ['10:00', '14:00', '19:00'],
        series: { name: '', nextDay: 1 },
        summaryMinutes: 12,
        mainMinutes: 10,
        chatCapture: true,
        llm: { provider: 'none', model: '', apiKey: '' },
      },
    },
    stats: { transcribeRatio: {} },
    vocab: emptyVocabulary(),
    vods: [],
    outputs: [],
    groups: [],
    publications: [],
    channel: { autoImport: true, autoSince: null, seenVodIds: [], importedClipIds: [] },
    connections: {},
    cloud: { enabled: false, repo: '', token: '', lastSync: null, workflowCrons: '', known: [] },
    engine: { enabled: false, repo: '', token: '', since: null, lastSync: null, payloadHash: '' },
  };
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Lista de horas HH:MM válida (sin repetidas y ordenada); si no hay ninguna válida, la de por defecto. */
function times(v: unknown, fallback: string[]): string[] {
  const ok = Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && HHMM_RE.test(x)))].sort() : [];
  return ok.length ? ok : [...fallback];
}

/** Cuántos identificadores antiguos se recuerdan (evita que el archivo crezca sin límite). */
const MAX_SEEN = 2000;
const BACKUP_EVERY_MS = 10 * 60_000;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Almacén en un único JSON con escritura atómica (archivo temporal + renombrado).
 * Pensado para un solo proceso (la app impide una segunda instancia). La interfaz es
 * pequeña a propósito para poder sustituirlo por SQLite o por una base de datos en la nube.
 */
export class Store {
  readonly file: string;
  data: DataShape;
  /** Si el archivo estaba corrupto, ruta de la copia del archivo dañado. */
  recoveredFrom?: string;
  /** Verdadero si, estando dañado, se recuperó la última copia buena (.bak). */
  restoredFromBackup = false;
  private readonly backupFile: string;
  private lastBackup = 0;

  constructor(dir: string, defaultOutputDir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'data.json');
    const base = defaults(defaultOutputDir);
    this.data = base;
    this.backupFile = `${this.file}.bak`;
    if (!fs.existsSync(this.file)) return;
    try {
      this.data = Store.parse(this.file, base);
    } catch {
      // No se pierde nada: se conserva el archivo dañado y se intenta la última copia buena.
      this.recoveredFrom = `${this.file}.corrupto-${Date.now()}`;
      fs.copyFileSync(this.file, this.recoveredFrom);
      try {
        this.data = Store.parse(this.backupFile, base);
        this.restoredFromBackup = true;
        this.lastBackup = Date.now(); // la copia buena no se pisa con el archivo dañado
      } catch {
        this.data = base;
      }
    }
  }

  /** Lee y normaliza un archivo de datos. Lanza si no se puede interpretar. */
  private static parse(file: string, base: DataShape): DataShape {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<DataShape>;
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) throw new Error('formato inesperado');
    return {
      schemaVersion: STORE_VERSION,
      settings: {
        ...base.settings,
        ...saved.settings,
        // el programa edita en español de España: un ajuste antiguo «detectar» pasa a «es»
        whisperLanguage: saved.settings?.whisperLanguage || base.settings.whisperLanguage,
        twitch: { ...base.settings.twitch, ...saved.settings?.twitch },
        autopilot: {
          ...base.settings.autopilot,
          ...saved.settings?.autopilot,
          llm: { ...base.settings.autopilot.llm, ...saved.settings?.autopilot?.llm },
          series: { ...base.settings.autopilot.series, ...saved.settings?.autopilot?.series },
          videoTimes: times(saved.settings?.autopilot?.videoTimes, base.settings.autopilot.videoTimes),
          clipTimes: times(saved.settings?.autopilot?.clipTimes, base.settings.autopilot.clipTimes),
        },
      },
      stats: { transcribeRatio: ratios(saved.stats?.transcribeRatio) },
      vocab: cleanVocabulary(saved.vocab),
      vods: arr<VodJob>(saved.vods),
      outputs: arr<unknown>(saved.outputs).map(normalizeOutput).filter((x): x is OutputItem => x !== null),
      groups: arr<Group>(saved.groups),
      publications: arr<Publication>(saved.publications),
      cloud: { ...base.cloud, ...(typeof saved.cloud === 'object' && saved.cloud !== null ? saved.cloud : {}), known: arr<string>(saved.cloud?.known).slice(-MAX_SEEN) },
      engine: { ...base.engine, ...(typeof saved.engine === 'object' && saved.engine !== null ? saved.engine : {}) },
      connections: typeof saved.connections === 'object' && saved.connections !== null && !Array.isArray(saved.connections) ? saved.connections : {},
      channel: {
        ...base.channel,
        ...(typeof saved.channel === 'object' && saved.channel !== null ? saved.channel : {}),
        seenVodIds: arr<string>(saved.channel?.seenVodIds).slice(-MAX_SEEN),
        importedClipIds: arr<string>(saved.channel?.importedClipIds).slice(-MAX_SEEN),
      },
    };
  }

  /**
   * Escritura atómica (temporal + renombrado). Como mucho cada 10 minutos, antes de sustituir el archivo
   * se guarda la versión anterior como .bak: si algún día se daña, se recupera casi todo.
   */
  save(now: number = Date.now()): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    if (now - this.lastBackup > BACKUP_EVERY_MS && fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.backupFile);
        this.lastBackup = now;
      } catch {
        // la copia es un extra: nunca debe impedir guardar
      }
    }
    fs.renameSync(tmp, this.file);
  }
}

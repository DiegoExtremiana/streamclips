import type { SubtitleStyleId } from '../subtitles';
import type { SoundId } from '../sounds';
import type { MusicMood } from '../music';
import type { VerticalLayout } from '../layout';
import type { ClipFormat, OutputKind, Platform, RenderKind } from './core';
import type { AutoRole, AutopilotState, TranscriptInfo, VodStatus } from './jobs';
export type VodOrigin = 'manual' | 'live' | 'clip';

export interface VodJob {
  id: string;
  /** De dónde viene: añadido a mano, recogido solo al terminar un directo, o clip de Twitch. */
  origin?: VodOrigin;
  /** Id del VOD o clip en Twitch. */
  twitchId?: string;
  /** Cuándo empezó el directo del que sale (para casar con la actividad del chat). */
  streamStartedAt?: string;
  /** Duración del VOD según Twitch (para calcular el espacio que hace falta). */
  durationSec?: number;
  /** Qué ha hecho el piloto automático con este VOD. */
  autopilot?: AutopilotState;
  transcript?: TranscriptInfo;
  /** Categorías de Twitch (juego o actividad) a lo largo del directo; vacío = solo una o desconocidas. */
  chapters?: { start: number; end: number; title: string }[];
  url: string;
  title: string;
  status: VodStatus;
  progress: number; // 0-100
  filePath?: string;
  /** El directo completo ya se borró del disco (se conservan los vídeos, los clips y sus transcripciones); se vuelve a descargar si hace falta. */
  cleaned?: { at: string; freedBytes: number };
  /** Día de la serie asignado a este directo (se reserva al analizarlo, así que repetir el análisis conserva el mismo). */
  seriesDay?: number;
  error?: string;
  createdAt: string;
}

export interface OutputItem {
  id: string;
  vodId?: string;
  kind: OutputKind;
  title: string;
  /** Clip: vertical y horizontal. Vídeo largo: long. Falta la versión que no se haya podido renderizar. */
  files: Partial<Record<RenderKind, string>>;
  durationSec: number;
  createdAt: string;
  /** Tramo del VOD del que sale un clip (permite recortarlo o reencuadrarlo después). */
  start?: number;
  end?: number;
  /** Posición del recorte vertical usada en el último render (0..1). */
  cropX?: number;
  /** Composición de la versión vertical (1 a 3 ventanas); si falta, un solo recuadro según `cropX`. */
  layout?: VerticalLayout;
  cuts?: { start: number; end: number }[];
  /** Vídeo largo: tramos del VOD que lo forman (permite volver a montarlo). */
  segments?: { start: number; end: number }[];
  effects?: Effect[];
  /** Estilo de subtítulos grabados en los archivos; ausente = vídeo limpio. */
  subtitles?: SubtitleStyleId;
  /** Miniatura (JPG) en la carpeta de salida. */
  thumbnail?: string;
  groupId?: string;
  /** Datos de YouTube (solo vídeos largos). */
  description?: string;
  /** Nombre de la lista de reproducción; vacío o ausente = ninguna. */
  playlist?: string;
  /** Sin valor se trata como privado: nada se publica abierto por accidente. */
  visibility?: Visibility;
  /** Vive solo en la nube (lo creó el motor nocturno): no hay archivos en este PC. */
  remote?: boolean;
  /** Quién puso el nombre: el programa (se puede volver a poner solo) o el usuario (no se toca). */
  titleSource?: 'auto' | 'manual';
  /** Quién escribió la descripción: el programa (se puede rehacer) o el usuario (no se toca). */
  descSource?: 'auto' | 'manual';
  /** Categoría de Twitch (juego o actividad) en el momento de este clip o vídeo. */
  category?: string;
  /** Creado por el piloto automático. */
  auto?: { role: AutoRole; review: 'pending' | 'approved'; /** Nota de entretenimiento (0-10) y motivo de la valoración, si la hizo el modelo. */ score?: number; kind?: string; reason?: string };
}

export type Visibility = 'public' | 'private';

/** Cambios de nombre y datos de YouTube; los campos que no se envían no se tocan. */
export interface OutputMeta {
  title?: string;
  description?: string;
  playlist?: string;
  visibility?: Visibility;
}

export type Section = 'clips' | 'videos';
export const sectionOf = (kind: OutputKind): Section => (kind === 'long' ? 'videos' : 'clips');

export type GroupKind = 'theme' | 'series';
export const MAX_GROUP_DEPTH = 5;
export const MAX_GROUP_NAME_LEN = 60;

/** Carpeta de la Biblioteca: por tema (Pokémon, just chatting…) o por serie (Road to Master…). Pueden anidarse. */
export interface Group {
  id: string;
  name: string;
  kind: GroupKind;
  section: Section;
  parentId?: string;
  createdAt: string;
}

export interface GroupPatch {
  name?: string;
  kind?: GroupKind;
}

export type PublicationStatus = 'scheduled' | 'publishing' | 'published' | 'failed';

export interface Publication {
  key: string; // `${outputId}:${platform}` — único: nunca se publica dos veces lo mismo en la misma red
  outputId: string;
  platform: Platform;
  scheduledAt: string; // ISO (UTC)
  status: PublicationStatus;
  note?: string;
  /** Si está en la cola de la nube, ella se encarga de publicarlo (el programador del PC lo deja en paz). */
  cloud?: { state: 'queued' | 'publishing' | 'published' | 'failed' };
}

export interface ScheduleResult {
  scheduled: Publication[];
  skipped: { platform: Platform; reason: string }[];
  /** Avisos que no impiden programar (p. ej. dos subidas muy juntas o demasiadas en un día). */
  warnings?: string[];
}

export interface DeleteResult {
  removed: number;
  errors: { id: string; title: string; reason: string }[];
  /** Archivos que Windows no dejó borrar (se pueden borrar a mano). */
  filesLeft: string[];
}

/**
 * Animaciones que se añaden al montar el vídeo. Los instantes son del VOD.
 *  - punch: acercamiento breve a un momento clave (sube y baja suave).
 *  - fadeIn / fadeOut: fundido desde / a negro al principio / final.
 */
export type Effect =
  | { type: 'punch'; at: number; duration?: number; zoom?: number }
  | { type: 'fadeIn'; duration?: number }
  | { type: 'fadeOut'; duration?: number }
  | { type: 'sfx'; at: number; sound?: SoundId }
  | { type: 'music'; mood: MusicMood; /** Volumen de la música respecto a su nivel normal (0,04-0,4); baja más aún cuando se habla. */ volume?: number }
  | { type: 'polish' };

export interface ClipSpec {
  kind?: ClipFormat; // por defecto: las dos versiones
  start: number; // segundos
  end: number;
  title: string;
  cropX?: number; // 0..1, posición horizontal del recorte vertical (0 = izquierda, 1 = derecha)
  /** Composición vertical con varias ventanas (sustituye a `cropX`). */
  layout?: VerticalLayout;
  /** Partes que se quitan de dentro de [start, end] (silencios, tiempos muertos). Corte seco entre lo que queda. */
  cuts?: { start: number; end: number }[];
  effects?: Effect[];
  /** Estilo de subtítulos grabados en el vídeo. Sin valor = sin subtítulos. */
  subtitles?: SubtitleStyleId;
}

export interface LongSpec {
  title: string;
  segments: { start: number; end: number }[];
  effects?: Effect[];
  subtitles?: SubtitleStyleId;
}

/** Formato en el que Claude devolverá sus decisiones de edición. */
export interface EditPlan {
  clips: ClipSpec[];
  long?: LongSpec;
}

/** Cambios posibles sobre un clip ya creado; cualquier cambio vuelve a renderizarlo desde el VOD. */
export interface ClipEdit {
  start?: number;
  end?: number;
  cropX?: number;
  /** Composición vertical; null = volver al encuadre simple. */
  layout?: VerticalLayout | null;
  /** Estilo de subtítulos, o null para quitarlos. Sin valor se conserva lo que tenga. */
  subtitles?: SubtitleStyleId | null;
}

export interface FramingPreview {
  dataUrl: string; // fotograma completo del VOD (JPG en base64)
  width: number;
  height: number;
}

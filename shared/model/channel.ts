import type { Platform } from './core';
export interface ScheduleEntry {
  platform: Platform;
  atIso: string;
}

export interface TwitchVod {
  id: string;
  title: string;
  url: string;
  durationSec: number;
  createdAt: string;
  /** Miniatura (ya con tamaño) y visualizaciones, si Twitch las da. */
  thumbnail?: string;
  views?: number;
}

export interface TwitchStream {
  live: boolean;
  title?: string;
  game?: string;
  viewers?: number;
  startedAt?: string;
}

export interface AutoNameResult {
  renamed: number;
  /** Descripciones de YouTube escritas a partir de lo que pasa en el vídeo. */
  described: number;
  /** No tienen transcripción: sin ella no hay de qué sacar el nombre. */
  noTranscript: number;
  /** Ya tenían un nombre corto, o lo escribiste tú. */
  kept: number;
}

/** Clips del canal: `loading` es verdadero mientras sigue leyéndose el historial antiguo; `warning` avisa si no se pudo leer entero. */
export interface ClipsResult {
  clips: TwitchClip[];
  /** Canal al que pertenecen (el tuyo si no se pidió otro). */
  channel: string;
  /** Es el canal propio. */
  own: boolean;
  loading: boolean;
  warning: string;
  /** Cómo va la valoración en segundo plano de los clips de tu canal (ausente en otros canales). */
  scoring?: { scored: number; pending: number; total: number; enabled: boolean; /** Lo que impide valorar ahora (p. ej. falta el modelo de Whisper). */ problem?: string; /** Por qué espera ahora (directo en marcha…). */ waiting?: string; /** Clips que han fallado al valorarse. */ failed?: number; /** Último error al valorar un clip. */ lastError?: string; /** Documento con las notas de todos los clips. */ notesFile?: string; /** Qué clip y fase se está valorando ahora. */ working?: string; /** Segundos por clip medidos y minutos que faltan. */ secPerClip?: number; etaMin?: number };
}

export interface TwitchClip {
  id: string;
  title: string;
  url: string;
  durationSec: number;
  createdAt: string;
  creator: string;
  views: number;
  thumbnail: string;
  /** Ya está en la Biblioteca (o descargándose). */
  imported?: boolean;
  /** El programa lo valora muy bien (nota de 8 o más): sale con el fondo dorado. Solo se puntúan los clips de tu canal. */
  gold?: boolean;
  /** Nota del contenido del clip, de 0 a 10 con un decimal; ausente si aún no se ha valorado. Nunca depende de las visualizaciones. */
  score?: number;
  /** Los cuatro criterios de la nota (0-10): humor, se cuenta algo, puede ser viral, momento interesante. */
  criteria?: { humor: number; historia: number; viral: number; interes: number };
  /** Frase que explica la nota. */
  reason?: string;
  /** Cómo se valoró: con el modelo de lenguaje o solo con lo que se oye y se dice. */
  scoredBy?: 'model' | 'user';
  /** Qué IA y qué modelo la examinaron y cuándo (ms desde 1970). */
  scoredWith?: { provider: string; model: string; vision?: boolean; at?: number };
  /** Respuesta (0 no, 1 algo, 2 sí) a cada pregunta de la rúbrica, por «criterio.pregunta»; solo si lo valoró el modelo. */
  items?: Record<string, number>;
  /** Cita literal con la que el modelo justifica cada criterio. */
  evidence?: Partial<Record<'humor' | 'historia' | 'viral' | 'interes', string>>;
}

/** Estado del vigilante del canal, para el Panel. */
export interface ChannelStatus {
  configured: boolean;
  autoImport: boolean;
  stream: TwitchStream | null;
  lastCheck: string | null;
  error: string | null;
  /** VOD que se va a recoger cuando termine el directo (o que se acaba de recoger). */
  lastImported?: { vodId: string; title: string; at: string };
}

export interface WhisperStatus {
  engine: boolean; // hay whisper-cli utilizable
  model: string;
  modelInstalled: boolean;
  modelApproxMb: number;
}

export interface ToolStatus {
  ffmpeg: { ok: boolean; version?: string };
  ffprobe: { ok: boolean; version?: string };
  ytdlp: { ok: boolean; version?: string };
}

import type { SubtitleStyleId, Word } from './subtitles';
/** Qué se renderiza (cada uno es un archivo con su medida). */
export type RenderKind = 'vertical' | 'horizontal' | 'long';
/** Qué es un elemento de la Biblioteca: un clip (con versión vertical y horizontal) o un vídeo largo. */
export type OutputKind = 'clip' | 'long';
/** Versiones que se piden al crear un clip. */
export type ClipFormat = 'both' | 'vertical' | 'horizontal';
export type Platform = 'youtube' | 'tiktok' | 'instagram';
export const ALL_PLATFORMS: readonly Platform[] = ['youtube', 'tiktok', 'instagram'];
/** Los vídeos largos solo se publican en YouTube; los clips, en todas las redes. */
export const VIDEO_PLATFORMS: readonly Platform[] = ['youtube'];
export const platformsFor = (kind: OutputKind): readonly Platform[] => (kind === 'long' ? VIDEO_PLATFORMS : ALL_PLATFORMS);
export const VIDEO_ONLY_YOUTUBE = 'Los vídeos solo se publican en YouTube; los clips pueden ir a todas las redes.';

/** Resultado que cruza la frontera IPC: así los errores llegan limpios a la interfaz. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface Settings {
  outputDir: string;
  ffmpegPath: string; // vacío = usar el del PATH
  ytdlpPath: string; // vacío = usar el del PATH
  twitch: { clientId: string; clientSecret: string; login: string };
  /** Orden de Whisper (openai-whisper) para transcribir; vacío = solo se pueden importar transcripciones. */
  whisperPath: string;
  whisperModel: string; // tiny, base, small, medium...
  whisperLanguage: string; // código ("es") o vacío para detectarlo
  autopilot: AutopilotSettings;
}

export type LlmChoice = 'none' | 'groq' | 'gemini';

/** Lo que el programa hace solo cuando termina un directo. */
export interface AutopilotSettings {
  enabled: boolean;
  /** Los vídeos creados esperan tu visto bueno antes de programarse (recomendado). */
  requireApproval: boolean;
  /** Clips (vertical + horizontal) por directo. */
  maxClips: number;
  /** Subtítulos grabados en lo automático; '' = sin subtítulos. */
  subtitles: SubtitleStyleId | '';
  platforms: Platform[];
  /** Horas locales HH:MM de publicación. */
  slots: { summary: string; main: string; clips: string };
  /** Duración del resumen (min) y del vídeo principal (min). */
  summaryMinutes: number;
  mainMinutes: number;
  /** Guardar la actividad del chat del directo (anónimo, solo lectura) para detectar momentos. */
  chatCapture: boolean;
  llm: { provider: LlmChoice; model: string; apiKey: string };
}

export interface SettingsPatch {
  outputDir?: string;
  ffmpegPath?: string;
  ytdlpPath?: string;
  twitch?: Partial<Settings['twitch']>;
  whisperPath?: string;
  whisperModel?: string;
  whisperLanguage?: string;
  autopilot?: Partial<Omit<AutopilotSettings, 'llm' | 'slots'>> & {
    llm?: Partial<AutopilotSettings['llm']>;
    slots?: Partial<AutopilotSettings['slots']>;
  };
}

export type VodStatus = 'queued' | 'downloading' | 'downloaded' | 'error';

/** Datos de la transcripción guardada de un VOD (las palabras viven en su propio archivo). */
export interface TranscriptInfo {
  words: number;
  source: 'import' | 'whisper';
  at: string;
}

export type TaskKind = 'model' | 'transcribe' | 'analyze' | 'render' | 'download' | 'cloud' | 'publish';

/** Una tarea en segundo plano, para mostrar su avance. */
export interface TaskInfo {
  id: string;
  kind: TaskKind;
  label: string;
  status: 'running' | 'done' | 'error';
  progress: number; // 0-100
  detail?: string;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface AutopilotState {
  status: 'waiting' | 'transcribing' | 'analyzing' | 'rendering' | 'done' | 'error' | 'skipped';
  note?: string;
  at: string;
}

export type AutoRole = 'summary' | 'main' | 'clip';

/** Estado de la conexión con una red social, para la pantalla de Conexiones. */
export interface ConnectionInfo {
  platform: Platform;
  hasCredentials: boolean;
  connected: boolean;
  /** Nombre de la cuenta conectada. */
  account?: string;
  /** Aviso importante (p. ej. solo publica en privado hasta la auditoría). */
  caveat: string;
}

export interface YoutubePlaylist {
  id: string;
  title: string;
}

export interface UpdateStatus {
  status: 'unsupported' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  /** Versión nueva encontrada. */
  version?: string;
  progress?: number;
  lastCheck?: string;
  error?: string;
}

export interface CloudStatus {
  enabled: boolean;
  repo: string;
  hasToken: boolean;
  lastSync: string | null;
  error: string | null;
  /** Vídeos subidos a la nube esperando su hora. */
  queued: number;
  syncing: boolean;
}

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
  url: string;
  title: string;
  status: VodStatus;
  progress: number; // 0-100
  filePath?: string;
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
  /** Creado por el piloto automático. */
  auto?: { role: AutoRole; review: 'pending' | 'approved' };
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
  | { type: 'fadeOut'; duration?: number };

export interface ClipSpec {
  kind?: ClipFormat; // por defecto: las dos versiones
  start: number; // segundos
  end: number;
  title: string;
  cropX?: number; // 0..1, posición horizontal del recorte vertical (0 = izquierda, 1 = derecha)
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
  /** Estilo de subtítulos, o null para quitarlos. Sin valor se conserva lo que tenga. */
  subtitles?: SubtitleStyleId | null;
}

export interface FramingPreview {
  dataUrl: string; // fotograma completo del VOD (JPG en base64)
  width: number;
  height: number;
}

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
}

export interface TwitchStream {
  live: boolean;
  title?: string;
  game?: string;
  viewers?: number;
  startedAt?: string;
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

export interface Api {
  getSettings(): Promise<Settings>;
  setSettings(patch: SettingsPatch): Promise<Settings>;
  pickFolder(): Promise<string | null>;
  checkTools(): Promise<ToolStatus>;
  twitchTest(): Promise<{ ok: boolean; message: string }>;
  twitchVods(): Promise<TwitchVod[]>;
  channelStatus(): Promise<ChannelStatus>;
  /** Comprueba ya el canal (sin esperar al siguiente turno). */
  channelRefresh(): Promise<ChannelStatus>;
  channelClips(): Promise<TwitchClip[]>;
  /** Descarga el clip de Twitch y lo deja en la Biblioteca (vertical y horizontal). */
  channelImportClip(clipId: string): Promise<VodJob>;
  setAutoImport(on: boolean): Promise<ChannelStatus>;
  /** Da el visto bueno: se programa en su hora. */
  listConnections(): Promise<ConnectionInfo[]>;
  /** Guarda el ID y el secreto de tu app (el secreto vacío o enmascarado no cambia el guardado). */
  setConnectionApp(platform: Platform, clientId: string, clientSecret: string): Promise<ConnectionInfo[]>;
  /** Abre el navegador para que autorices; se completa cuando vuelves. */
  connectPlatform(platform: Platform): Promise<ConnectionInfo[]>;
  cancelConnect(): Promise<void>;
  disconnectPlatform(platform: Platform): Promise<ConnectionInfo[]>;
  youtubePlaylists(): Promise<YoutubePlaylist[]>;
  updateStatus(): Promise<UpdateStatus>;
  updateCheck(): Promise<UpdateStatus>;
  /** Instala la versión descargada y reinicia. */
  updateInstall(): Promise<boolean>;
  onUpdate(cb: (s: UpdateStatus) => void): () => void;
  cloudStatus(): Promise<CloudStatus>;
  /** Conecta el repositorio privado de GitHub, instala el publicador y sube los permisos de tus redes. */
  cloudSetup(repo: string, token: string): Promise<CloudStatus>;
  cloudSync(): Promise<CloudStatus>;
  /** Apaga el modo nube: borra lo subido y vuelve a publicar desde el PC. */
  cloudDisable(): Promise<CloudStatus>;
  approveOutput(outputId: string): Promise<OutputItem>;
  /** Borra el vídeo (archivos, miniatura y publicaciones pendientes). */
  /** Borra un vídeo (sus archivos y lo pendiente de publicar). El VOD de origen se conserva. */
  deleteOutput(outputId: string): Promise<DeleteResult>;
  deleteOutputs(outputIds: string[]): Promise<DeleteResult>;
  /** Vuelve a lanzar el piloto automático sobre un VOD ya descargado. */
  runAutopilot(vodId: string): Promise<VodJob>;
  onChannelUpdate(cb: (s: ChannelStatus) => void): () => void;
  listVods(): Promise<VodJob[]>;
  addVod(url: string, title?: string): Promise<VodJob>;
  listOutputs(): Promise<OutputItem[]>;
  createClip(vodId: string, spec: ClipSpec): Promise<OutputItem>;
  createLong(vodId: string, spec: LongSpec): Promise<OutputItem>;
  applyPlan(vodId: string, planJson: string): Promise<{ created: OutputItem[]; errors: string[] }>;
  listPublications(): Promise<Publication[]>;
  schedule(outputId: string, platforms: Platform[], atIso: string): Promise<ScheduleResult>;
  cancelPublication(key: string): Promise<void>;
  listGroups(): Promise<Group[]>;
  createGroup(name: string, kind: GroupKind, section: Section, parentId?: string): Promise<Group>;
  updateGroup(id: string, patch: GroupPatch): Promise<Group>;
  /** Borra la carpeta; su contenido (vídeos y subcarpetas) pasa a la carpeta superior. */
  deleteGroup(id: string): Promise<void>;
  moveGroup(id: string, parentId: string | null): Promise<Group>;
  moveOutput(outputId: string, groupId: string | null): Promise<OutputItem>;
  setSchedule(outputId: string, entries: ScheduleEntry[]): Promise<ScheduleResult>;
  updateOutputMeta(outputId: string, meta: OutputMeta): Promise<OutputItem>;
  renameOutput(outputId: string, title: string): Promise<OutputItem>;
  setThumbnailFromFrame(outputId: string, atSec: number): Promise<OutputItem>;
  /** Abre el selector de imagen; null si se cancela. */
  setThumbnailFromImage(outputId: string): Promise<OutputItem | null>;
  reeditClip(outputId: string, edit: ClipEdit): Promise<OutputItem>;
  /** Palabras de la transcripción del VOD (vacío si no hay). */
  getTranscript(vodId: string): Promise<Word[]>;
  /** Abre el selector de archivo (JSON, SRT, VTT); null si se cancela. */
  importTranscript(vodId: string): Promise<VodJob | null>;
  /** Transcribe el audio del VOD con la orden de Whisper configurada en Ajustes. */
  transcribeVod(vodId: string): Promise<VodJob>;
  /** Transcripción con marcas de tiempo + instrucciones para pedirle un plan de edición a Claude. */
  claudePrompt(vodId: string): Promise<string>;
  framingPreview(outputId: string): Promise<FramingPreview>;
  /** Guarda una copia de la versión elegida donde indique el usuario; null si cancela. */
  exportOutput(outputId: string, version: RenderKind): Promise<string | null>;
  openPath(p: string): Promise<void>;
  onVodUpdate(cb: (v: VodJob) => void): () => void;
  listTasks(): Promise<TaskInfo[]>;
  onTaskUpdate(cb: (t: TaskInfo) => void): () => void;
  whisperStatus(): Promise<WhisperStatus>;
  downloadWhisperModel(): Promise<WhisperStatus>;
  onDataChanged(cb: () => void): () => void;
}

export const MASKED_SECRET = '********';

/** Nombres de canal IPC (una sola fuente de verdad para main y preload). */
export const CHANNELS = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  pickFolder: 'dialog:folder',
  toolsCheck: 'tools:check',
  twitchTest: 'twitch:test',
  twitchVods: 'twitch:vods',
  channelStatus: 'channel:status',
  channelRefresh: 'channel:refresh',
  channelClips: 'channel:clips',
  channelImportClip: 'channel:import-clip',
  channelAuto: 'channel:auto',
  connList: 'conn:list',
  connSet: 'conn:set',
  connConnect: 'conn:connect',
  connCancel: 'conn:cancel',
  connDisconnect: 'conn:disconnect',
  ytPlaylists: 'conn:yt-playlists',
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  eventUpdate: 'event:update',
  cloudStatus: 'cloud:status',
  cloudSetup: 'cloud:setup',
  cloudSync: 'cloud:sync',
  cloudDisable: 'cloud:disable',
  outputsApprove: 'outputs:approve',
  outputsDelete: 'outputs:delete',
  outputsDeleteMany: 'outputs:delete-many',
  autopilotRun: 'autopilot:run',
  eventChannel: 'event:channel',
  vodsList: 'vods:list',
  vodsAdd: 'vods:add',
  outputsList: 'outputs:list',
  clipsCreate: 'clips:create',
  clipsLong: 'clips:long',
  planApply: 'plan:apply',
  pubsList: 'pubs:list',
  pubsSchedule: 'pubs:schedule',
  pubsCancel: 'pubs:cancel',
  pubsSet: 'pubs:set',
  groupsList: 'groups:list',
  groupsCreate: 'groups:create',
  groupsUpdate: 'groups:update',
  groupsDelete: 'groups:delete',
  groupsMove: 'groups:move',
  outputsMove: 'outputs:move',
  outputsRename: 'outputs:rename',
  outputsMeta: 'outputs:meta',
  outputsExport: 'outputs:export',
  outputsThumbFrame: 'outputs:thumb-frame',
  outputsThumbImage: 'outputs:thumb-image',
  outputsReedit: 'outputs:reedit',
  outputsFraming: 'outputs:framing',
  transcriptGet: 'transcript:get',
  transcriptImport: 'transcript:import',
  transcriptRun: 'transcript:run',
  transcriptPrompt: 'transcript:prompt',
  shellOpen: 'shell:open',
  eventVod: 'event:vod',
  eventTask: 'event:task',
  tasksList: 'tasks:list',
  whisperStatus: 'whisper:status',
  whisperModel: 'whisper:model',
  eventData: 'event:data',
} as const;

import type { AssetKind, ComposeOpts, CoverAsset } from '../covers';
import type { StyleProfile } from '../styleProfile';
import type { Vocabulary } from '../vocab';
import type { Word } from '../subtitles';
import type { AutoNameResult, ChannelStatus, ClipsResult, ScheduleEntry, ToolStatus, TwitchVod, WhisperStatus } from './channel';
import type { Platform, RenderKind } from './core';
import type { CloudStatus, ConnectionInfo, EngineStatus, TaskInfo, UpdateStatus, YoutubePlaylist } from './jobs';
import type { ClipEdit, ClipSpec, DeleteResult, FramingPreview, Group, GroupKind, GroupPatch, LongSpec, OutputItem, OutputMeta, Publication, ScheduleResult, Section, VodJob } from './library';
import type { MomentsView, PrefsView } from './moments';
import type { Settings, SettingsPatch } from './settings';
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
  /** Analiza ya un directo de Twitch (id del VOD): lo descarga si hace falta y lanza el piloto automático, aunque esté desactivado. */
  channelAnalyze(twitchId: string): Promise<VodJob>;
  /** Todos los clips del canal, más recientes primero. `force` vuelve a pedir todo el historial a Twitch. */
  channelClips(force?: boolean, login?: string): Promise<ClipsResult>;
  /** Descarga el clip de Twitch y lo deja en la Biblioteca (vertical y horizontal). */
  channelImportClip(clipId: string): Promise<VodJob>;
  /** Dirección directa para ver un clip de Twitch sin descargarlo. */
  channelClipStream(clipId: string): Promise<string>;
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
  engineStatus(): Promise<EngineStatus>;
  /** Instala el motor nocturno en un repositorio PÚBLICO tuyo (minutos de GitHub Actions gratis e ilimitados). */
  engineSetup(repo: string, token: string): Promise<EngineStatus>;
  engineSync(): Promise<EngineStatus>;
  engineDisable(): Promise<EngineStatus>;
  approveOutput(outputId: string): Promise<OutputItem>;
  /** Borra el vídeo (archivos, miniatura y publicaciones pendientes). */
  /** Borra un vídeo (sus archivos y lo pendiente de publicar). El VOD de origen se conserva. */
  deleteOutput(outputId: string): Promise<DeleteResult>;
  deleteOutputs(outputIds: string[]): Promise<DeleteResult>;
  /** Vuelve a lanzar el piloto automático sobre un VOD ya descargado. */
  /** Analiza (o vuelve a analizar) un VOD; si había un análisis en marcha, lo cancela y empieza de nuevo. */
  runAutopilot(vodId: string): Promise<VodJob>;
  /** Detiene el análisis en marcha de un VOD. Devuelve si había algo que detener. */
  cancelAutopilot(vodId: string): Promise<boolean>;
  /** Pausa el análisis: lo ya transcrito se conserva y se retoma con «Reanudar» (aunque se cierre el programa). */
  pauseAutopilot(vodId: string): Promise<boolean>;
  /** Borra del disco el directo completo (se conservan vídeos, clips y sus transcripciones). */
  discardVod(vodId: string): Promise<{ freedBytes: number; kept: number }>;
  /** Cuánto ocupa cada cosa del programa y cuánto se puede liberar. */
  storageReport(): Promise<import('../storage').StorageReport>;
  /** Borra los directos ya aprovechados y los temporales; se conservan vídeos, clips y transcripciones. */
  freeStorage(): Promise<import('../storage').StorageFreed>;
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
  /** Corrige el texto de unas líneas de subtítulo en la transcripción; el programa aprende de lo que cambias. */
  editTranscript(vodId: string, changes: { start: number; end: number; text: string }[]): Promise<{ changed: number; learned: { from: string; to: string }[] }>;
  /** Palabras propias y correcciones aprendidas. */
  getVocabulary(): Promise<Vocabulary>;
  /** Hablantes conocidos (voces) y si se pueden identificar en este equipo. */
  /** Revisión de los momentos que eligió el piloto en un directo. */
  getMoments(vodId: string): Promise<MomentsView>;
  setMomentState(vodId: string, key: string, state: 'include' | 'exclude' | 'reset'): Promise<MomentsView>;
  trimMoment(vodId: string, key: string, start: number, end: number): Promise<MomentsView>;
  addMoment(vodId: string, start: number, end: number, title?: string): Promise<MomentsView>;
  removeMoment(vodId: string, key: string): Promise<MomentsView>;
  clearMomentEdits(vodId: string): Promise<MomentsView>;
  /** Perfil de estilo de edición (silencios, duración, música, subtítulos, títulos y lore del canal). */
  getStyle(): Promise<StyleProfile>;
  coversList(): Promise<CoverAsset[]>;
  coversAdd(fileName: string, data: Uint8Array): Promise<CoverAsset>;
  coversRename(id: string, name: string): Promise<CoverAsset>;
  coversSetKind(id: string, kind: AssetKind): Promise<CoverAsset>;
  coversRemove(id: string): Promise<void>;
  coversPreview(id: string): Promise<string | null>;
  coversCompose(opts: ComposeOpts): Promise<CoverAsset>;
  coversReveal(id: string): Promise<void>;
  setStyle(patch: Partial<StyleProfile>): Promise<StyleProfile>;
  addLore(name: string, note?: string, triggers?: string[]): Promise<StyleProfile>;
  removeLore(id: string): Promise<StyleProfile>;
  resetStyle(): Promise<StyleProfile>;
  getPrefs(): Promise<PrefsView>;
  setPrefsEnabled(enabled: boolean): Promise<PrefsView>;
  resetPrefs(): Promise<PrefsView>;
  getSpeakers(): Promise<{ available: { ok: boolean; reason?: string }; profiles: { id: number; alias: string; self: boolean; named: boolean }[] }>;
  renameSpeaker(id: number, alias: string): Promise<void>;
  /** Marca qué voz es la tuya (null = ninguna): sale en el primer color (blanco). */
  setSelfSpeaker(id: number | null): Promise<void>;
  /** Une dos hablantes que son la misma persona. */
  mergeSpeakers(from: number, into: number): Promise<void>;
  setVocabulary(v: Vocabulary): Promise<Vocabulary>;
  /** Título provisional de un tramo a partir de lo que se dice en él (null si no hay transcripción de ese tramo). */
  /** Duración del directo de origen de un clip (null si el archivo ya no está), para la línea de tiempo del recorte. */
  clipContext(id: string): Promise<{ vodDurationSec: number | null; /** Sin VOD: se trabaja con el propio vídeo del clip (solo acortar y reencuadrar). */ clipOnly?: boolean }>;
  suggestTitle(vodId: string, start: number, end: number): Promise<{ title: string; source: 'llm' | 'transcript' } | null>;
  /** Pone un nombre corto, según lo que se dice, a los clips y vídeos de la Biblioteca que no tienen uno escrito por ti. */
  autoNameLibrary(): Promise<AutoNameResult>;
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

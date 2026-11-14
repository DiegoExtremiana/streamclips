import type { Platform } from './core';
export type VodStatus = 'queued' | 'downloading' | 'downloaded' | 'error';

/** Datos de la transcripción guardada de un VOD (las palabras viven en su propio archivo). */
export interface TranscriptInfo {
  words: number;
  source: 'import' | 'whisper';
  at: string;
  /** Solo están transcritos algunos tramos (los de los clips y vídeos que lo han pedido), no todo el directo. */
  partial?: boolean;
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
  /** Cuándo se calcula que terminará (ISO); ausente mientras no hay datos para estimarlo. */
  etaAt?: string;
  /** Id del VOD al que pertenece (análisis y transcripciones). */
  ref?: string;
}

export interface AutopilotState {
  status: 'waiting' | 'transcribing' | 'analyzing' | 'rendering' | 'paused' | 'done' | 'error' | 'skipped';
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

/** Una comprobación de la prueba de conexión de una red: qué se miró y cómo salió. */
export interface ConnectionCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/** Resultado de «Probar la conexión» de una red: se habla con la red con la clave guardada, sin publicar nada. */
export interface ConnectionProbe {
  platform: Platform;
  account: string;
  checks: ConnectionCheck[];
  /** Si se sabe: ¿la cuenta puede publicar en público (y no solo en privado)? */
  canPublishPublic?: boolean;
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

/** Motor nocturno: edita tus directos en GitHub Actions aunque tu PC y el programa estén apagados. */
export interface EngineStatus {
  enabled: boolean;
  repo: string;
  hasToken: boolean;
  /** Cuándo se subió por última vez la configuración al motor. */
  lastSync: string | null;
  error: string | null;
  /** Desde cuándo vigila: los directos anteriores no se tocan. */
  since: string | null;
  /** La nube (cola de publicación) debe estar activada primero. */
  cloudReady: boolean;
  /** Estado que dejó la última ejecución del motor, si se ha podido leer. */
  last?: { at: string; processed: number; pending: number; note?: string };
}

/** Resultado de «Probar la nube»: la ejecución real en GitHub Actions habló con cada red con las claves del secreto. */
export interface CloudTestResult {
  /** Cuándo terminó la prueba en la nube. */
  at: string;
  /** Cuánto tardó en responder GitHub Actions, en segundos. */
  tookSec: number;
  networks: Partial<Record<Platform, { ok: true; probe: ConnectionProbe } | { ok: false; error: string }>>;
  /** Redes conectadas en el PC que no han llegado a la nube (p. ej. Google sin clave de renovación). */
  missing: Platform[];
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

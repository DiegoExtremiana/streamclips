import type { AutopilotSettings, LlmChoice } from '../../shared/types';

/** Lo que el motor nocturno necesita saber; el programa lo sube como secreto cifrado del repositorio del motor. */
export interface EnginePayload {
  v: 1;
  twitch: { clientId: string; clientSecret: string; login: string };
  llm: { provider: LlmChoice; model: string; apiKey: string };
  /** Repositorio PRIVADO donde se dejan los vídeos listos para publicar (la cola del modo nube). */
  cloud: { repo: string; token: string };
  autopilot: Pick<AutopilotSettings, 'maxClips' | 'maxVideos' | 'subtitles' | 'platforms' | 'videoTimes' | 'clipTimes' | 'summaryMinutes' | 'mainMinutes' | 'visibility'>;
  whisper: { model: string; language: string };
  /** Los directos anteriores a esta fecha no se tocan. */
  since: string;
}

/** Lo que el motor recuerda entre ejecuciones (archivo del repositorio privado). */
export interface EngineRunState {
  v: 1;
  /** Ids de VODs de Twitch ya terminados. */
  done: string[];
  /** Intentos hechos por VOD (a los 3 se deja de insistir). */
  tries: Record<string, number>;
  last?: { at: string; processed: number; pending: number; note?: string };
}

export const ENGINE_STATE_PATH = 'engine/state.json';
export const MAX_TRIES = 3;

export function parsePayload(text: string): EnginePayload {
  let j: Partial<EnginePayload>;
  try {
    j = JSON.parse(text) as Partial<EnginePayload>;
  } catch {
    throw new Error('El secreto STREAMCLIPS_ENGINE no es válido. Vuelve a sincronizar el motor desde el programa.');
  }
  if (j.v !== 1 || !j.twitch?.clientId || !j.twitch.clientSecret || !j.twitch.login) throw new Error('Falta la conexión con Twitch en el motor. Revisa Ajustes y vuelve a sincronizar.');
  if (!j.cloud?.repo || !j.cloud.token) throw new Error('Falta el repositorio privado de la nube en el motor.');
  if (!j.autopilot || !j.whisper || !j.llm || typeof j.since !== 'string') throw new Error('La configuración del motor está incompleta. Vuelve a sincronizar desde el programa.');
  return j as EnginePayload;
}

export function parseRunState(text: string | null): EngineRunState {
  const empty: EngineRunState = { v: 1, done: [], tries: {} };
  if (!text) return empty;
  try {
    const j = JSON.parse(text) as Partial<EngineRunState>;
    return {
      v: 1,
      done: Array.isArray(j.done) ? j.done.filter((x): x is string => typeof x === 'string').slice(-500) : [],
      tries: typeof j.tries === 'object' && j.tries !== null ? Object.fromEntries(Object.entries(j.tries).filter(([, n]) => typeof n === 'number')) : {},
      ...(j.last ? { last: j.last } : {}),
    };
  } catch {
    return empty;
  }
}

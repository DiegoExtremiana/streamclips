import type { SubtitleStyleId } from '../subtitles';
import type { Platform } from './core';
import type { Visibility } from './library';
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
  /** Vídeos largos por directo (el resumen + el resto de tramos destacados). Solo YouTube. */
  maxVideos: number;
  /** Subtítulos grabados en lo automático; '' = sin subtítulos. */
  subtitles: SubtitleStyleId | '';
  platforms: Platform[];
  /** Horas locales HH:MM de publicación de los vídeos largos (cada una, un vídeo al día; solo YouTube). */
  videoTimes: string[];
  /** Horas locales HH:MM de publicación de los clips (cada una, un clip al día en todas las redes elegidas). */
  clipTimes: string[];
  /** Serie en curso: los vídeos de cada directo se llaman «<nombre> Día <n>». Vacío = sin serie (salvo que el título del directo ya diga «… día 3»). */
  series: { name: string; nextDay: number };
  /** Duración del resumen (min) y del vídeo principal (min). */
  summaryMinutes: number;
  mainMinutes: number;
  /** Visibilidad en YouTube de lo que crea el piloto automático. */
  visibility: Visibility;
  /** Guardar la actividad del chat del directo (anónimo, solo lectura) para detectar momentos. */
  chatCapture: boolean;
  /** Edición profesional automática: cortes de silencios, acercamientos, efectos de sonido, fundidos y volumen parejo. */
  proEdit?: boolean;
  /** Al terminar de sacar vídeos y clips, borrar el directo completo y los datos que ya no sirven. Por defecto sí. */
  cleanup?: boolean;
  /** Borrar un vídeo o clip (archivos incluidos) cuando ya se ha publicado en todas sus redes. Por defecto sí. */
  purgePublished?: boolean;
  /** Análisis rápido: se eligen los momentos por volumen y chat y SOLO se transcribe lo elegido (en vez de todo el directo). Por defecto sí. */
  fastAnalysis?: boolean;
  /** Valorar los candidatos con el modelo de lenguaje (humor, originalidad, contexto…) en vez de fiarse solo del volumen. Por defecto sí, si hay modelo configurado. */
  smartSelect?: boolean;
  /** Nota mínima (0-10) para que un momento entre en un vídeo o clip; el modelo puntúa 5 lo normal y 7 lo bueno. Por defecto 6,5. */
  minQuality?: number;
  /** Puntuar en segundo plano los clips de tu canal (con el equipo libre y sin directo) para marcar los mejores en dorado. Por defecto sí. */
  scoreClips?: boolean;
  /** Identificar quién habla y colorear los subtítulos por voz (necesita el módulo de diarización; descarga un modelo de 40 MB la primera vez). */
  speakers?: boolean;
  /** Colores de las voces (#RRGGBB): el primero es el del propio streamer. */
  speakerColors?: string[];
  /** Portadas con estilo de los canales grandes: fotograma más vivo y expresivo, frase corta grande y número de episodio. Por defecto sí. */
  styledCovers?: boolean;
  /** Cuántos directos se analizan a la vez (1 a 4). Por defecto 2. */
  parallel?: number;
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
  autopilot?: Partial<Omit<AutopilotSettings, 'llm'>> & {
    llm?: Partial<AutopilotSettings['llm']>;
  };
}

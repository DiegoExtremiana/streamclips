import fs from 'node:fs';
import { ALL_PLATFORMS, MASKED_SECRET } from '../../shared/types';
import type { AutopilotSettings, Settings, SettingsPatch } from '../../shared/types';
import { isSubtitleStyleId } from '../../shared/subtitles';
import type { Store } from '../services/store';
import type { Secrets } from '../services/secrets';
import { isAbsoluteAnyOs, stripQuotes } from '../services/files';
import { normalizeLogin, type TwitchCreds } from '../services/twitch';

function validateToolPath(label: string, raw: string): string {
  const p = stripQuotes(raw);
  if (!p) return '';
  if (!isAbsoluteAnyOs(p)) throw new Error(`La ruta de ${label} debe ser absoluta (ej. C:\\herramientas\\${label}.exe), o déjala vacía si está en el PATH.`);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) throw new Error(`No existe ${label} en esa ruta: ${p}`);
  return p;
}

function validateOutputDir(raw: string): string {
  const p = stripQuotes(raw);
  if (!p) throw new Error('La carpeta de salida no puede estar vacía.');
  if (!isAbsoluteAnyOs(p)) throw new Error('La carpeta de salida debe ser una ruta absoluta.');
  try {
    fs.mkdirSync(p, { recursive: true });
    fs.accessSync(p, fs.constants.W_OK);
  } catch {
    throw new Error(`No se puede escribir en la carpeta de salida: ${p}`);
  }
  return p;
}

function validateWhisperModel(raw: string): string {
  const m = raw.trim();
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(m)) throw new Error('El modelo de Whisper no es válido (ej. small, medium, large-v3).');
  return m;
}

function validateWhisperLanguage(raw: string): string {
  const l = raw.trim().toLowerCase();
  if (l && !/^[a-z]{2,3}$/.test(l)) throw new Error('El idioma debe ser un código como "es" o "en" (o vacío para detectarlo).');
  return l;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateAutopilot(cur: AutopilotSettings, p: NonNullable<SettingsPatch['autopilot']>, enc: (s: string) => string): AutopilotSettings {
  const n: AutopilotSettings = { ...cur, series: { ...cur.series }, videoTimes: [...cur.videoTimes], clipTimes: [...cur.clipTimes], llm: { ...cur.llm }, platforms: [...cur.platforms] };
  const bool = (v: unknown, label: string): boolean => {
    if (typeof v !== 'boolean') throw new Error(`${label} no es válido.`);
    return v;
  };
  if (p.enabled !== undefined) n.enabled = bool(p.enabled, 'El interruptor del piloto automático');
  if (p.requireApproval !== undefined) n.requireApproval = bool(p.requireApproval, 'La aprobación previa');
  if (p.proEdit !== undefined) n.proEdit = bool(p.proEdit, 'La edición profesional');
  if (p.parallel !== undefined) {
    const v = Number(p.parallel);
    if (!Number.isInteger(v) || v < 1 || v > 4) throw new Error('Los directos a la vez deben ser un número del 1 al 4.');
    n.parallel = v;
  }
  if (p.purgePublished !== undefined) n.purgePublished = bool(p.purgePublished, 'El borrado tras publicar');
  if (p.fastAnalysis !== undefined) n.fastAnalysis = bool(p.fastAnalysis, 'El análisis rápido');
  if (p.styledCovers !== undefined) n.styledCovers = bool(p.styledCovers, 'El estilo de las portadas');
  if (p.cleanup !== undefined) n.cleanup = bool(p.cleanup, 'La limpieza del directo');
  if (p.chatCapture !== undefined) n.chatCapture = bool(p.chatCapture, 'La captura del chat');
  if (p.maxClips !== undefined) {
    if (!Number.isInteger(p.maxClips) || p.maxClips < 0 || p.maxClips > 20) throw new Error('Los clips por directo deben ser un número entre 0 y 20.');
    n.maxClips = p.maxClips;
  }
  if (p.visibility !== undefined) {
    if (p.visibility !== 'public' && p.visibility !== 'private') throw new Error('La visibilidad debe ser pública o privada.');
    n.visibility = p.visibility;
  }
  if (p.series !== undefined) {
    const name = typeof p.series.name === 'string' ? p.series.name.replace(/\s+/g, ' ').trim() : '';
    if (typeof p.series.name !== 'string' || name.length > 60) throw new Error('El nombre de la serie no puede pasar de 60 caracteres.');
    const day = p.series.nextDay;
    if (!Number.isInteger(day) || day < 1 || day > 9999) throw new Error('El día de la serie debe ser un número entero entre 1 y 9999.');
    n.series = { name, nextDay: day };
  }
  if (p.maxVideos !== undefined) {
    if (!Number.isInteger(p.maxVideos) || p.maxVideos < 0 || p.maxVideos > 12) throw new Error('Los vídeos por directo deben ser un número entre 0 y 12.');
    n.maxVideos = p.maxVideos;
  }
  for (const k of ['summaryMinutes', 'mainMinutes'] as const) {
    const v = p[k];
    if (v !== undefined) {
      if (!Number.isInteger(v) || v < 1 || v > 60) throw new Error('La duración debe estar entre 1 y 60 minutos.');
      n[k] = v;
    }
  }
  if (p.subtitles !== undefined) {
    if (p.subtitles !== '' && !isSubtitleStyleId(p.subtitles)) throw new Error('El estilo de subtítulos no existe.');
    n.subtitles = p.subtitles;
  }
  if (p.platforms !== undefined) {
    if (!Array.isArray(p.platforms) || p.platforms.some((x) => !ALL_PLATFORMS.includes(x))) throw new Error('Red social no reconocida.');
    n.platforms = [...new Set(p.platforms)];
  }
  for (const k of ['videoTimes', 'clipTimes'] as const) {
    const v = p[k];
    if (v !== undefined) {
      if (!Array.isArray(v) || v.length > 12 || v.some((h) => typeof h !== 'string' || !HHMM.test(h))) throw new Error('Las horas deben tener el formato HH:MM (por ejemplo 08:00), como mucho 12.');
      n[k] = [...new Set(v)].sort();
    }
  }
  const l = p.llm;
  if (l) {
    if (l.provider !== undefined) {
      if (!['none', 'groq', 'gemini'].includes(l.provider)) throw new Error('Proveedor de modelo no reconocido.');
      n.llm.provider = l.provider;
    }
    if (l.model !== undefined) {
      if (!/^[A-Za-z0-9._:/-]{0,80}$/.test(l.model.trim())) throw new Error('El nombre del modelo no es válido.');
      n.llm.model = l.model.trim();
    }
    if (l.apiKey !== undefined && l.apiKey !== MASKED_SECRET) n.llm.apiKey = enc(l.apiKey.trim());
  }
  return n;
}

export class SettingsService {
  constructor(
    private store: Store,
    private secrets: Secrets,
  ) {}

  /** Ajustes para la interfaz: el secreto de Twitch nunca sale del proceso principal. */
  get(): Settings {
    const s = this.store.data.settings;
    return {
      ...s,
      twitch: { ...s.twitch, clientSecret: s.twitch.clientSecret ? MASKED_SECRET : '' },
      autopilot: { ...s.autopilot, llm: { ...s.autopilot.llm, apiKey: s.autopilot.llm.apiKey ? MASKED_SECRET : '' } },
    };
  }

  /** Valida todo antes de aplicar nada: o se guarda el parche entero o no se guarda nada. */
  set(patch: SettingsPatch): Settings {
    const s = this.store.data.settings;
    const next = {
      outputDir: patch.outputDir !== undefined ? validateOutputDir(patch.outputDir) : s.outputDir,
      ffmpegPath: patch.ffmpegPath !== undefined ? validateToolPath('ffmpeg', patch.ffmpegPath) : s.ffmpegPath,
      ytdlpPath: patch.ytdlpPath !== undefined ? validateToolPath('yt-dlp', patch.ytdlpPath) : s.ytdlpPath,
      whisperPath: patch.whisperPath !== undefined ? validateToolPath('whisper', patch.whisperPath) : s.whisperPath,
      whisperModel: patch.whisperModel !== undefined ? validateWhisperModel(patch.whisperModel) : s.whisperModel,
      whisperLanguage: patch.whisperLanguage !== undefined ? validateWhisperLanguage(patch.whisperLanguage) : s.whisperLanguage,
      twitch: { ...s.twitch },
      autopilot: patch.autopilot ? validateAutopilot(s.autopilot, patch.autopilot, (x) => this.secrets.encode(x)) : s.autopilot,
    };
    if (patch.twitch) {
      const t = patch.twitch;
      if (t.login !== undefined) {
        const raw = t.login.trim();
        if (raw) {
          const login = normalizeLogin(raw);
          if (!login) throw new Error('El nombre de canal no es válido (solo letras, números y guion bajo).');
          next.twitch.login = login;
        } else {
          next.twitch.login = '';
        }
      }
      if (t.clientId !== undefined) next.twitch.clientId = t.clientId.trim();
      if (t.clientSecret !== undefined && t.clientSecret !== MASKED_SECRET) {
        next.twitch.clientSecret = this.secrets.encode(t.clientSecret.trim());
      }
    }
    Object.assign(s, next);
    this.store.save();
    return this.get();
  }

  /** Clave del modelo de lenguaje en claro (solo para el proceso principal). */
  llmKey(): string {
    const k = this.store.data.settings.autopilot.llm.apiKey;
    return k ? this.secrets.decode(k) : '';
  }

  twitchCreds(): TwitchCreds {
    const t = this.store.data.settings.twitch;
    return { clientId: t.clientId, clientSecret: t.clientSecret ? this.secrets.decode(t.clientSecret) : '', login: t.login };
  }
}

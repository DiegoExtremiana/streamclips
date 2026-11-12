/**
 * Perfil de estilo de edición: lo que el creador ha dicho que quiere en sus vídeos. Es la fuente de verdad de las decisiones
 * creativas (silencios, duración, ritmo, música, subtítulos, títulos) y del lore del canal. Se guarda aparte, se puede
 * consultar y corregir, y los valores por defecto salen de la entrevista, no de suposiciones.
 */

export type TitleStyle = 'estetico' | 'sobrio' | 'llamativo';

export interface LoreEntry {
  id: string;
  /** Cómo lo llamas tú: un chiste recurrente, una muletilla, un personaje, un suceso del canal. */
  name: string;
  /** Qué significa y por qué hace gracia, con tus palabras. */
  note: string;
  /** Palabras o frases que lo delatan en una transcripción (para reconocerlo solo). */
  triggers: string[];
}

export interface StyleProfile {
  version: 1;
  /** Vídeos largos: el silencio de más de estos segundos se corta. */
  silenceMaxSec: number;
  /** Clips frenéticos: duración máxima de cada plano, en segundos. */
  shortShotMaxSec: number;
  /** Cortos verticales: duración mínima y máxima en segundos. */
  shortMinSec: number;
  shortMaxSec: number;
  /** Vídeos largos: duración mínima y máxima en segundos (se puede salir un poco si el vídeo lo merece). */
  longMinSec: number;
  longMaxSec: number;
  /** Prefiere transiciones a saltos secos. */
  preferTransitions: boolean;
  music: { enabled: boolean; genre: string; royaltyFreeOnly: boolean; /** Volumen respecto a la voz, de 0 a 1: bajo para que se entienda. */ level: number };
  /** Los subtítulos siempre se pueden activar; por defecto apagados y se eligen por vídeo. */
  subtitlesDefaultOn: boolean;
  titleStyle: TitleStyle;
  lore: LoreEntry[];
}

export const MAX_LORE = 200;

export const defaultStyle = (): StyleProfile => ({
  version: 1,
  silenceMaxSec: 2,
  shortShotMaxSec: 3,
  shortMinSec: 15,
  shortMaxSec: 120,
  longMinSec: 600,
  longMaxSec: 900,
  preferTransitions: true,
  music: { enabled: true, genre: 'lofi', royaltyFreeOnly: true, level: 0.15 },
  subtitlesDefaultOn: false,
  titleStyle: 'estetico',
  lore: [],
});

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function cleanLore(v: unknown): LoreEntry[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: LoreEntry[] = [];
  for (const raw of v) {
    const r = (raw ?? {}) as Partial<LoreEntry>;
    const name = str(r.name, 80);
    if (!name) continue;
    let id = str(r.id, 40) || `l${out.length + 1}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const triggers = Array.isArray(r.triggers) ? [...new Set(r.triggers.map((t) => str(t, 60).toLowerCase()).filter(Boolean))].slice(0, 20) : [];
    out.push({ id, name, note: str(r.note, 600), triggers });
    if (out.length >= MAX_LORE) break;
  }
  return out;
}

/** Acepta cualquier cosa leída del disco o de la interfaz y devuelve un perfil válido: lo que falta o está mal se queda como estaba. */
export function cleanStyle(raw: unknown, base: StyleProfile = defaultStyle()): StyleProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const m = (r.music ?? {}) as Record<string, unknown>;
  const shortMin = num(r.shortMinSec, 5, 600, base.shortMinSec);
  const longMin = num(r.longMinSec, 60, 7200, base.longMinSec);
  return {
    version: 1,
    silenceMaxSec: num(r.silenceMaxSec, 0.3, 30, base.silenceMaxSec),
    shortShotMaxSec: num(r.shortShotMaxSec, 0.5, 30, base.shortShotMaxSec),
    shortMinSec: shortMin,
    shortMaxSec: Math.max(shortMin, num(r.shortMaxSec, 5, 600, base.shortMaxSec)),
    longMinSec: longMin,
    longMaxSec: Math.max(longMin, num(r.longMaxSec, 60, 7200, base.longMaxSec)),
    preferTransitions: typeof r.preferTransitions === 'boolean' ? r.preferTransitions : base.preferTransitions,
    music: {
      enabled: typeof m.enabled === 'boolean' ? m.enabled : base.music.enabled,
      genre: str(m.genre, 40) || base.music.genre,
      royaltyFreeOnly: typeof m.royaltyFreeOnly === 'boolean' ? m.royaltyFreeOnly : base.music.royaltyFreeOnly,
      level: num(m.level, 0, 0.5, base.music.level),
    },
    subtitlesDefaultOn: typeof r.subtitlesDefaultOn === 'boolean' ? r.subtitlesDefaultOn : base.subtitlesDefaultOn,
    titleStyle: r.titleStyle === 'sobrio' || r.titleStyle === 'llamativo' || r.titleStyle === 'estetico' ? r.titleStyle : base.titleStyle,
    lore: 'lore' in r ? cleanLore(r.lore) : base.lore,
  };
}

/** Cambios sobre el perfil actual: solo se tocan los campos que vienen. */
export function patchStyle(cur: StyleProfile, patch: unknown): StyleProfile {
  const p = (patch ?? {}) as Record<string, unknown>;
  const merged = { ...cur, ...p, music: { ...cur.music, ...((p.music ?? {}) as object) } };
  return cleanStyle(merged, cur);
}

export function addLore(cur: StyleProfile, name: string, note = '', triggers: string[] = []): StyleProfile {
  const n = str(name, 80);
  if (!n) throw new Error('Ponle un nombre al detalle del canal.');
  if (cur.lore.length >= MAX_LORE) throw new Error(`Hay ya ${MAX_LORE} detalles del canal; quita alguno antes de añadir más.`);
  if (cur.lore.some((l) => l.name.toLowerCase() === n.toLowerCase())) throw new Error(`«${n}» ya está en el lore del canal.`);
  const id = `l${Date.now().toString(36)}${cur.lore.length}`;
  return cleanStyle({ ...cur, lore: [...cur.lore, { id, name: n, note, triggers }] }, cur);
}

export function removeLore(cur: StyleProfile, id: string): StyleProfile {
  return { ...cur, lore: cur.lore.filter((l) => l.id !== id) };
}

/** Entradas del lore que se nombran en un texto (por sus palabras clave o por su nombre). */
export function loreIn(lore: LoreEntry[], text: string): LoreEntry[] {
  const t = text.toLowerCase();
  return lore.filter((l) => [l.name.toLowerCase(), ...l.triggers].some((k) => k.length >= 3 && t.includes(k)));
}

import type { Word } from './subtitles';

/** Tramo en el que habla un hablante, tal como lo devuelve el modelo de diarización (puede solaparse con otros). */
export interface SpeakerSeg {
  start: number;
  end: number;
  speaker: number;
}

export interface AssignOpts {
  /** Parte mínima de la palabra que debe caer en el tramo de un hablante (0-1). */
  minShare?: number;
  /** Si el segundo hablante cubre al menos esta fracción de lo que cubre el primero, hay voces simultáneas: no se atribuye. */
  overlapRatio?: number;
}

/**
 * Atribuye cada palabra a un hablante por solape de tiempos. Si la palabra cae en un hueco, en el borde entre dos voces o en
 * una zona con dos voces a la vez, se queda SIN hablante: es mejor no decirlo que atribuir una frase a la persona equivocada.
 */
export function assignSpeakers(words: Word[], segs: SpeakerSeg[], o: AssignOpts = {}): Word[] {
  const minShare = o.minShare ?? 0.5;
  const ratio = o.overlapRatio ?? 0.6;
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  return words.map((w) => {
    const dur = Math.max(0.05, w.end - w.start);
    const cover = new Map<number, number>();
    for (const s of sorted) {
      if (s.start >= w.end) break;
      const ov = Math.min(w.end, s.end) - Math.max(w.start, s.start);
      if (ov > 0) cover.set(s.speaker, (cover.get(s.speaker) ?? 0) + ov);
    }
    const ranked = [...cover.entries()].sort((a, b) => b[1] - a[1]);
    const { spk: _drop, ...rest } = w;
    void _drop;
    if (!ranked.length || ranked[0][1] / dur < minShare) return rest;
    if (ranked[1] && ranked[1][1] >= ranked[0][1] * ratio) return rest;
    return { ...rest, spk: ranked[0][0] };
  });
}

/** Cuánto habla cada uno (segundos y palabras). */
export function speakerStats(words: Word[]): { spk: number; words: number; sec: number }[] {
  const m = new Map<number, { words: number; sec: number }>();
  for (const w of words) {
    if (w.spk === undefined) continue;
    const c = m.get(w.spk) ?? { words: 0, sec: 0 };
    c.words++;
    c.sec += Math.max(0, w.end - w.start);
    m.set(w.spk, c);
  }
  return [...m.entries()].map(([spk, v]) => ({ spk, ...v })).sort((a, b) => b.sec - a.sec);
}

/** Colores por defecto: el streamer en blanco y los demás en colores bien distintos. Configurables en Ajustes. */
export const DEFAULT_SPEAKER_COLORS = ['#FFFFFF', '#FFE600', '#5AB4FF', '#5BE37D', '#FF8A5B', '#D58CFF', '#FF6BA8', '#7DF0E4'];

/** Color de cada identidad: la propia primero (blanco por defecto) y el resto por orden de aparición. */
export function colorMap(ids: number[], selfId: number | undefined, palette: string[] = DEFAULT_SPEAKER_COLORS): Record<number, string> {
  const out: Record<number, string> = {};
  const colors = palette.length ? palette : DEFAULT_SPEAKER_COLORS;
  let next = 1;
  for (const id of ids) {
    if (id in out) continue;
    out[id] = id === selfId ? colors[0] : colors[1 + ((next++ - 1) % Math.max(1, colors.length - 1))];
  }
  return out;
}

/** Lo que se pone si la identidad no tiene alias. */
export const defaultAlias = (id: number): string => `Hablante ${id}`;

/** Parecido coseno entre dos vectores de voz (−1 a 1). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface VoiceProfile {
  id: number;
  /** Nombre o alias puesto por el usuario. */
  alias?: string;
  /** Es la voz del propio streamer. */
  self?: boolean;
  /** Media de los vectores de voz oídos (se actualiza con cada análisis). */
  embedding: number[];
  /** Cuántos vectores entran en la media. */
  n: number;
}

export interface MatchOpts {
  /** Parecido mínimo para reconocer una voz ya conocida. */
  minSimilarity?: number;
  /** Diferencia mínima con la segunda más parecida (si hay duda, es una voz nueva). */
  margin?: number;
}

/**
 * ¿A qué voz conocida se parece este vector? Solo se reconoce si supera el parecido mínimo y deja margen sobre la siguiente;
 * con duda devuelve null (voz nueva) en vez de forzar una identidad.
 */
export function matchProfile(embedding: number[], profiles: VoiceProfile[], o: MatchOpts = {}): VoiceProfile | null {
  const min = o.minSimilarity ?? 0.6;
  const margin = o.margin ?? 0.08;
  const scored = profiles.map((p) => ({ p, s: cosine(embedding, p.embedding) })).sort((a, b) => b.s - a.s);
  if (!scored.length || scored[0].s < min) return null;
  if (scored[1] && scored[0].s - scored[1].s < margin) return null;
  return scored[0].p;
}

/** Suma un vector a la media del perfil (media móvil ponderada por cuántos se han oído). */
export function updateProfile(p: VoiceProfile, embedding: number[], weight = 1): VoiceProfile {
  const n = p.n + weight;
  return { ...p, n, embedding: p.embedding.map((x, i) => (x * p.n + embedding[i] * weight) / n) };
}

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

/**
 * Une los grupos de voz que suenan igual (el agrupamiento del motor parte de más a propósito). Agrupa por parecido medio entre
 * grupos (enlace medio) hasta que ningún par llega al umbral. Devuelve, para cada grupo, el número de voz resultante (0, 1, 2…
 * por orden de aparición del primer grupo). Los grupos sin vector no entran.
 */
export function mergeClusters(embeddings: Map<number, number[]>, threshold: number): Map<number, number> {
  const ids = [...embeddings.keys()].sort((a, b) => a - b);
  let groups: number[][] = ids.map((i) => [i]);
  const sim = (a: number[], b: number[]) => {
    let s = 0;
    for (const x of a) for (const y of b) s += cosine(embeddings.get(x)!, embeddings.get(y)!);
    return s / (a.length * b.length);
  };
  for (;;) {
    let best = -Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const s = sim(groups[i], groups[j]);
        if (s > best) {
          best = s;
          bi = i;
          bj = j;
        }
      }
    }
    if (bi < 0 || best < threshold) break;
    groups = groups.filter((_, k) => k !== bi && k !== bj).concat([[...groups[bi], ...groups[bj]]]);
  }
  groups.sort((a, b) => Math.min(...a) - Math.min(...b));
  const out = new Map<number, number>();
  groups.forEach((g, n) => g.forEach((id) => out.set(id, n)));
  return out;
}

/** Memoria de voces: perfiles conocidos y el siguiente número libre. Se guarda con el resto de los datos. */
export interface SpeakerBook {
  profiles: VoiceProfile[];
  nextId: number;
}

export const emptyBook = (): SpeakerBook => ({ profiles: [], nextId: 1 });

/** Normaliza lo que llega del disco o de la interfaz (nunca se fía de su forma). */
export function cleanBook(x: unknown): SpeakerBook {
  const o = (typeof x === 'object' && x !== null ? x : {}) as { profiles?: unknown; nextId?: unknown };
  const profiles: VoiceProfile[] = [];
  const seen = new Set<number>();
  for (const p of Array.isArray(o.profiles) ? (o.profiles as Partial<VoiceProfile>[]) : []) {
    if (typeof p !== 'object' || p === null) continue;
    if (!Number.isInteger(p.id) || (p.id as number) < 1 || seen.has(p.id as number)) continue;
    if (!Array.isArray(p.embedding) || p.embedding.length < 8 || p.embedding.length > 4096 || !p.embedding.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    seen.add(p.id as number);
    const alias = typeof p.alias === 'string' ? p.alias.replace(/[<>]/g, '').trim().slice(0, 40) : '';
    profiles.push({ id: p.id as number, ...(alias ? { alias } : {}), ...(p.self === true ? { self: true } : {}), embedding: p.embedding, n: Number.isFinite(p.n) && (p.n as number) > 0 ? (p.n as number) : 1 });
  }
  // solo una voz puede ser la del propio streamer
  let selfSeen = false;
  for (const p of profiles) {
    if (p.self && selfSeen) delete p.self;
    if (p.self) selfSeen = true;
  }
  const max = profiles.reduce((a, p) => Math.max(a, p.id), 0);
  const next = Number.isInteger(o.nextId) && (o.nextId as number) > max ? (o.nextId as number) : max + 1;
  return { profiles, nextId: next };
}

/** Reparte las voces de un análisis entre los perfiles conocidos: cada perfil solo puede ser una voz (gana la más parecida). */
export function resolveVoices(
  voices: Map<number, number[]>,
  profiles: VoiceProfile[],
  o: MatchOpts = {},
): Map<number, VoiceProfile | null> {
  const cand = [...voices.entries()].map(([v, e]) => ({ v, p: matchProfile(e, profiles, o), s: 0 }));
  for (const c of cand) c.s = c.p ? cosine(voices.get(c.v)!, c.p.embedding) : 0;
  const out = new Map<number, VoiceProfile | null>();
  for (const c of [...cand].sort((a, b) => b.s - a.s)) {
    const taken = [...out.values()].includes(c.p);
    out.set(c.v, c.p && !taken ? c.p : null);
  }
  return out;
}

import type { Word } from './subtitles';
import type { Seg } from './highlights';
import { mergeSegments } from './highlights';

/**
 * Edición temática (v0.28). El modelo lee el directo por unidades (los mejores momentos y los tramos de charla con contenido) y
 * encuentra temas, historias y bromas recurrentes aunque estén separados horas, entendiendo el significado y no solo palabras repetidas.
 * Aquí se valida lo que devuelve, se construye cada propuesta (vídeo largo con estructura y varios cortos), se evitan repeticiones y se
 * decide si hay que preguntar el formato: solo cuando de verdad hay dos opciones buenas.
 */
export type ThemeRole = 'gancho' | 'inicio' | 'desarrollo' | 'evolucion' | 'desenlace';
export const THEME_ROLES: ThemeRole[] = ['gancho', 'inicio', 'desarrollo', 'evolucion', 'desenlace'];
export const ROLE_LABEL: Record<ThemeRole, string> = { gancho: 'Gancho', inicio: 'Inicio', desarrollo: 'Desarrollo', evolucion: 'Evolución', desenlace: 'Desenlace' };

export interface ThemeUnit extends Seg {
  id: string;
  /** Lo que se dice (recortado) para que el modelo lo lea. */
  text: string;
  title?: string;
  /** Nota de entretenimiento si es un momento ya valorado (0-10). */
  total?: number;
}

export interface ThemePiece extends Seg {
  id: string;
  role: ThemeRole;
  title?: string;
}

export interface ThemeShort {
  title: string;
  segs: Seg[];
  sec: number;
}

export interface ThemeProposal {
  id: string;
  vodId: string;
  title: string;
  /** Resumen de lo sucedido y por qué interesa. */
  context: string;
  pieces: ThemePiece[];
  /** Una línea por pieza: «Inicio · 0:15:02 · 1:10 — título». */
  structure: string[];
  long: { segs: Seg[]; sec: number };
  shorts: ThemeShort[];
  category: string;
  participants: string[];
  confidence: number;
  why: string;
  potential: { clip: number; long: number; several: number };
  resolved: boolean;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
  format?: 'long' | 'shorts';
}

export const THEME_SYSTEM =
  'Eres editor de YouTube de un streamer de Twitch que habla en español de España. Recibes fragmentos de un mismo directo (id, hora, texto). ' +
  'Busca TEMAS e HISTORIAS: situaciones absurdas que se retoman, conversaciones que vuelven horas después, bromas recurrentes, un reto o partida con momentos relacionados, una anécdota que evoluciona. ' +
  'Agrupa por SIGNIFICADO, no por palabras repetidas: dos fragmentos pertenecen al mismo tema solo si hay una relación real (se refieren a lo mismo, uno explica o continúa al otro). ' +
  'Piensa como editor: ¿qué historia se cuenta?, ¿por qué le interesaría a alguien que no vio el directo?, ¿hay material para sostener un vídeo?, ¿qué fragmentos son imprescindibles y cuáles repiten lo mismo? Descarta lo repetitivo. ' +
  'Mantén el ORDEN CRONOLÓGICO (no cambies la secuencia de modo que cambie el significado); como mucho puedes marcar UN fragmento como "gancho" para abrir el vídeo con lo más fuerte si el resto sigue en orden. ' +
  'Roles de cada pieza: gancho, inicio (presenta el tema o situación), desarrollo, evolucion (cómo cambia la historia) o desenlace (remate o conclusión); usa solo los que el material permita, sin forzar estructura. "contexto": true si esa pieza necesita unos segundos de lo anterior para entenderse. ' +
  '"cortos" son vídeos cortos independientes (cada uno una situación concreta, ids en orden). Si no hay material suficiente para un tema, pon "vale": false o no lo incluyas: prefiero ningún vídeo a uno de relleno. ' +
  'Cada id va como mucho en un tema. No inventes conexiones ni finales: si la historia queda abierta, "desenlace": false. "confianza" (0 a 1) = seguridad en que las piezas son de verdad el mismo tema; "potencial" 0 a 10 sobrio (un tema mencionado mucho puede ser aburrido). Responde SOLO con JSON: {"temas":[{"titulo":"2 a 7 palabras, sin emojis","contexto":"2 frases: qué pasa y por qué interesa","categoria":"humor|juego|anécdota|charla|reto|otro","participantes":["nombres si se oyen"],"motivo":"por qué estas piezas son un mismo tema","confianza":0.8,"desenlace":true,"potencial":{"corto":5,"largo":6,"varios":4},"vale":true,"piezas":[{"id":"","rol":"","contexto":false}],"cortos":[{"titulo":"","ids":[""]}]}]}';

export function themePrompt(units: ThemeUnit[]): string {
  const list = units.map((u) => ({ id: u.id, hora: clock(u.start), duracion: Math.round(u.end - u.start), ...(u.title ? { titulo: u.title } : {}), texto: u.text }));
  return JSON.stringify({ fragmentos: list });
}

export function clock(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export interface RawTheme {
  title: string;
  context: string;
  pieces: { id: string; role: ThemeRole; needsContext: boolean }[];
  shorts: { title: string; ids: string[] }[];
  category: string;
  participants: string[];
  /** Seguridad del modelo en que las piezas son de verdad el mismo tema (0 a 1). */
  confidence: number;
  /** Por qué interesa y por qué se agrupan (para depurar). */
  why: string;
  /** Potencial (0-10) como clip, vídeo largo y varios vídeos; el modelo debe ser sobrio. */
  potential: { clip: number; long: number; several: number };
  /** Si la historia termina (desenlace) o queda abierta. */
  resolved: boolean;
}

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Valida la respuesta del modelo: ids conocidos, ninguno en dos temas, al menos 2 piezas y solo lo que el modelo da por bueno. */
export function parseThemes(raw: unknown, valid: Set<string>): RawTheme[] {
  const list = (raw as { temas?: unknown } | null)?.temas;
  if (!Array.isArray(list)) return [];
  const used = new Set<string>();
  const out: RawTheme[] = [];
  for (const t of list as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object' || t.vale === false) continue;
    const title = clean(t.titulo, 70);
    if (title.length < 3 || !Array.isArray(t.piezas)) continue;
    const pieces: RawTheme['pieces'] = [];
    const seen = new Set<string>();
    for (const p of t.piezas as Record<string, unknown>[]) {
      const id = String(p?.id ?? '');
      if (!valid.has(id) || used.has(id) || seen.has(id)) continue;
      seen.add(id);
      pieces.push({ id, role: THEME_ROLES.includes(p.rol as ThemeRole) ? (p.rol as ThemeRole) : 'desarrollo', needsContext: p.contexto === true });
    }
    if (pieces.length < 2) continue;
    pieces.forEach((p) => used.add(p.id));
    const shorts: RawTheme['shorts'] = [];
    if (Array.isArray(t.cortos)) {
      for (const s of t.cortos as Record<string, unknown>[]) {
        const ids = Array.isArray(s?.ids) ? (s.ids as unknown[]).map(String).filter((id) => seen.has(id)) : [];
        if (ids.length) shorts.push({ title: clean(s.titulo, 60), ids });
      }
    }
    const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const pot = (t.potencial ?? {}) as Record<string, unknown>;
    const confidence = num(t.confianza, 0, 1, 0.6);
    if (confidence < 0.4) continue; // agrupación dudosa: no se inventan conexiones
    out.push({
      title,
      context: clean(t.contexto, 320),
      pieces,
      shorts,
      category: clean(t.categoria, 30),
      participants: Array.isArray(t.participantes) ? (t.participantes as unknown[]).map((x) => clean(x, 30)).filter(Boolean).slice(0, 8) : [],
      confidence,
      why: clean(t.motivo, 240),
      potential: { clip: num(pot.corto, 0, 10, 5), long: num(pot.largo, 0, 10, 5), several: num(pot.varios, 0, 10, 5) },
      resolved: t.desenlace === true,
    });
  }
  return out;
}

export interface BuildOpts {
  /** Duración que se busca para el vídeo largo (s); no es una cuota: se queda corto si no hay más material bueno. */
  targetSec?: number;
  /** Por encima de esto se quitan piezas (las de menos nota que no sean inicio ni desenlace). */
  hardCapSec?: number;
  minLongSec?: number;
  minShortSec?: number;
  maxShortSec?: number;
  /** Segundos de lo anterior que se añaden a una pieza que necesita contexto. */
  leadIn?: number;
}

const len = (s: Seg) => s.end - s.start;
const total = (segs: Seg[]) => segs.reduce((a, s) => a + len(s), 0);

/** Parte de `segs` que cae sobre `others` (0 a 1). */
export function overlapRatio(segs: Seg[], others: Seg[]): number {
  const t = total(segs);
  if (!t) return 0;
  let ov = 0;
  for (const s of segs) for (const o of others) ov += Math.max(0, Math.min(s.end, o.end) - Math.max(s.start, o.start));
  return Math.min(1, ov / t);
}

/**
 * Construye la propuesta de un tema: piezas en orden cronológico (con un posible gancho al principio), el contexto necesario,
 * sin pieza repetida, con tope de duración, la estructura legible y los cortos que se pueden sacar del mismo material.
 */
export function buildProposal(theme: RawTheme, units: ThemeUnit[], vodId: string, o: BuildOpts = {}): ThemeProposal | null {
  const target = o.targetSec ?? 600;
  const cap = o.hardCapSec ?? target * 1.4;
  const lead = o.leadIn ?? 6;
  const byId = new Map(units.map((u) => [u.id, u]));
  let pieces = theme.pieces
    .map((p) => ({ p, u: byId.get(p.id) }))
    .filter((x): x is { p: RawTheme['pieces'][number]; u: ThemeUnit } => Boolean(x.u))
    .sort((a, b) => a.u.start - b.u.start);
  if (pieces.length < 2) return null;
  // tope de duración: se van quitando las piezas de menos nota que no son inicio ni desenlace; se admite pasarse un poco del objetivo
  const secOf = (xs: typeof pieces) => xs.reduce((a, x) => a + len(x.u), 0);
  while (secOf(pieces) > cap && pieces.length > 2) {
    const removable = pieces.filter((x, i) => x.p.role !== 'inicio' && x.p.role !== 'desenlace' && i !== 0 && i !== pieces.length - 1);
    const drop = (removable.length ? removable : pieces.slice(1, -1)).sort((a, b) => (a.u.total ?? 5) - (b.u.total ?? 5))[0];
    if (!drop) break;
    pieces = pieces.filter((x) => x !== drop);
  }
  // contexto: unos segundos de lo anterior, sin invadir la pieza previa
  const ranged: ThemePiece[] = pieces.map((x, i) => {
    const prevEnd = i > 0 ? pieces[i - 1].u.end : 0;
    const start = x.p.needsContext ? Math.max(prevEnd, Math.max(0, x.u.start - lead)) : x.u.start;
    return { id: x.u.id, role: x.p.role, title: x.u.title, start, end: x.u.end };
  });
  // un posible gancho abre el vídeo (solo uno, y solo si el resto queda en orden cronológico)
  const hook = ranged.find((p) => p.role === 'gancho');
  const ordered = hook && ranged.length >= 3 && ranged[0] !== hook ? [hook, ...ranged.filter((p) => p !== hook)] : ranged;
  const longSegs = mergeSegments(ordered.map((p) => ({ start: p.start, end: p.end })), 0);
  // si el gancho no es lo primero cronológico, no se une con vecinos: el orden de `ordered` manda
  const segs = hook && ordered[0] === hook && ranged[0] !== hook ? ordered.map((p) => ({ start: p.start, end: p.end })) : longSegs;
  const longSec = total(segs);
  const minLong = o.minLongSec ?? 180;
  const structure = ordered.map((p) => `${ROLE_LABEL[p.role]} · ${clock(p.start)} · ${clock(len(p))}${p.title ? ` — ${p.title}` : ''}`);
  // cortos: los que propone el modelo o, si no, un corto por pieza (los tramos pegados se unen); cada uno entre 25 s y 3 min
  const minShort = o.minShortSec ?? 25;
  const maxShort = o.maxShortSec ?? 180;
  const groups: { title: string; segs: Seg[] }[] = theme.shorts.length
    ? theme.shorts.map((s) => ({ title: s.title, segs: s.ids.map((id) => byId.get(id)).filter((u): u is ThemeUnit => Boolean(u)).sort((a, b) => a.start - b.start).map((u) => ({ start: u.start, end: u.end })) }))
    : ranged.map((p) => ({ title: p.title ?? '', segs: [{ start: p.start, end: p.end }] }));
  // cada corto es un tramo continuo (un clip se corta de un solo trozo del directo): un grupo de tramos separados da un corto por tramo
  const shorts: ThemeShort[] = groups
    .flatMap((g, i) => {
      const parts = mergeSegments(g.segs, 1);
      return parts.map((seg, k) => ({ title: (g.title || `${theme.title} (parte ${i + 1})`) + (parts.length > 1 ? ` (${k + 1})` : ''), segs: [seg], sec: len(seg) }));
    })
    .filter((s) => s.sec >= minShort && s.sec <= maxShort);
  const longOk = longSec >= minLong && ordered.length >= 2;
  const shortsOk = shorts.length >= 2;
  if (!longOk && !shortsOk) return null;
  return {
    id: `${vodId}:${Math.round(ordered[0].start)}:${theme.title.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, '-').slice(0, 24)}`,
    vodId,
    title: theme.title,
    context: theme.context,
    category: theme.category,
    participants: theme.participants,
    confidence: theme.confidence,
    why: theme.why,
    potential: theme.potential,
    resolved: theme.resolved,
    pieces: ordered,
    structure,
    long: { segs: longOk ? segs : [], sec: longOk ? longSec : 0 },
    shorts: shortsOk ? shorts : [],
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
}

export type ThemeDecision = 'ask' | 'long' | 'shorts' | 'none';

/** Cuándo preguntar: solo si hay dos formas buenas de aprovechar el tema; si solo hay una, se hace sola. */
export function decideFormat(p: ThemeProposal): ThemeDecision {
  const long = p.long.sec > 0;
  const shorts = p.shorts.length >= 2;
  if (long && shorts) return 'ask';
  return long ? 'long' : shorts ? 'shorts' : 'none';
}

/** Quita las propuestas casi idénticas a lo ya generado de ese directo y a otras de la misma tanda (se queda la primera). */
export function dedupeProposals(props: ThemeProposal[], existing: Seg[][], limit = 0.6): { kept: ThemeProposal[]; dropped: number } {
  const kept: ThemeProposal[] = [];
  let dropped = 0;
  for (const p of props) {
    const mine = p.long.segs.length ? p.long.segs : p.shorts.flatMap((s) => s.segs);
    const clash = [...existing, ...kept.map((k) => (k.long.segs.length ? k.long.segs : k.shorts.flatMap((s) => s.segs)))].some((o) => overlapRatio(mine, o) >= limit);
    if (clash) dropped++;
    else kept.push(p);
  }
  return { kept, dropped };
}

/**
 * Unidades que lee el modelo: los momentos ya valorados y, donde haya transcripción, los tramos de charla con contenido que no
 * coinciden con ellos (una conversación normal puede dar mejor vídeo que varios clips con nota alta).
 */
export function transcriptBlocks(words: Word[], taken: Seg[], size = 150, minWords = 70): Seg[] {
  if (!words.length) return [];
  const by = new Map<number, number>();
  for (const w of words) by.set(Math.floor(w.start / size), (by.get(Math.floor(w.start / size)) ?? 0) + 1);
  return [...by.entries()]
    .filter(([, n]) => n >= minWords)
    .map(([k]) => ({ start: k * size, end: (k + 1) * size }))
    .filter((b) => overlapRatio([b], taken) < 0.5)
    .sort((a, b) => a.start - b.start);
}

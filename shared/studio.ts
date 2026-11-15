import type { DirectorCandidate, DirectorPlan } from './director';
import type { Seg } from './highlights';

/**
 * Estudio de edición (desde la v0.36.0). Un «CapCut interno» manejado por IA: en vez de un solo director, una sala con
 * varios editores que trabajan A LA VEZ sobre los mismos momentos valorados, cada uno con su especialidad, y un jefe de
 * edición que revisa el resultado antes de montar:
 *
 *  - Editor de historia  → la estructura del vídeo resumen de 10-15 min (es el director de `shared/director.ts`).
 *  - Editor de ritmo     → recorta el aire de cada momento (arranques lentos, silencios, colas) sin tocar los remates.
 *  - Editor de humor     → elige los clips graciosos (verticales) con su punto exacto de inicio, remate y título.
 *  - Jefe de edición     → revisa el montaje completo: quita lo que sobra, corrige el título y deja notas.
 *
 * Los vídeos por tema (momentos del mismo asunto, con sentido) los sigue buscando `shared/themes.ts` en la fase de
 * valoración; el estudio los recoge en el proyecto. Todo lo de este archivo es puro (sin Electron ni red): prompts,
 * validación de lo que devuelve cada agente y aplicación de sus decisiones. La fase que los lanza está en
 * `electron/domain/pipeline/studio.ts`. Nada de lo que diga un agente se monta sin validar: ids reales, tiempos dentro
 * del momento, duraciones mínimas.
 */

export type AgentId = 'historia' | 'ritmo' | 'humor' | 'jefe';
export const AGENT_LABEL: Record<AgentId, string> = { historia: 'Editor de historia', ritmo: 'Editor de ritmo', humor: 'Editor de humor', jefe: 'Jefe de edición' };

const r1 = (x: number) => Math.round(x * 10) / 10;
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);

const brief = (c: DirectorCandidate) => ({ id: c.id, dur: r1(c.end - c.start), nota: c.total, tipo: c.kind, titulo: c.title, ...(c.visual ? { imagen: `${c.visual.score}/10: ${c.visual.note}` } : {}), ...(c.energy !== undefined ? { volumen: c.energy } : {}), ...(c.chatPerMin !== undefined ? { chat: c.chatPerMin } : {}), texto: c.text });

// ───────────────────────── Escenas con contexto ─────────────────────────

/**
 * LO MÁS IMPORTANTE DEL ESTUDIO. Los candidatos del piloto son picos sueltos de 25-75 s; un vídeo de 12 min hecho con
 * ellos son 15 cortes sin relación. Aquí se convierten en ESCENAS: los picos cercanos se unen en un tramo CONTINUO del
 * directo (sin cortes dentro), y cada escena arranca antes del pico (el planteamiento) y acaba después (la reacción).
 * El editor de historia monta el vídeo con pocas escenas largas, no con muchos trozos.
 */
export interface SceneOpts {
  /** Dos picos a menos de esto (s) son la misma escena. */
  joinGap: number;
  /** Contexto antes del primer pico y después del último (s). */
  lead: number;
  tail: number;
  /** Una escena no pasa de esto (s); si los picos seguidos dan para más, se parte. */
  maxSec: number;
  durationSec: number;
}

export const SCENE: Omit<SceneOpts, 'durationSec'> = { joinGap: 100, lead: 25, tail: 10, maxSec: 270 };

export interface SceneSpan extends Seg {
  /** Los candidatos (picos) que contiene, en orden. */
  members: DirectorCandidate[];
}

/** Agrupa los candidatos en escenas continuas con contexto. `bounds` limita cada escena (p. ej. a su categoría de Twitch). */
export function sceneSpans(cands: DirectorCandidate[], o: SceneOpts, bounds?: (c: DirectorCandidate) => Seg | undefined): SceneSpan[] {
  const sorted = [...cands].sort((a, b) => a.start - b.start);
  const groups: DirectorCandidate[][] = [];
  for (const c of sorted) {
    const g = groups[groups.length - 1];
    const sameBounds = g && bounds ? bounds(g[0])?.start === bounds(c)?.start : true;
    if (g && sameBounds && c.start - g[g.length - 1].end <= o.joinGap && c.end - g[0].start + o.lead + o.tail <= o.maxSec) g.push(c);
    else groups.push([c]);
  }
  const out: SceneSpan[] = [];
  for (const g of groups) {
    const b = bounds?.(g[0]);
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    const start = Math.max(0, prevEnd, b?.start ?? 0, g[0].start - o.lead);
    const end = Math.min(o.durationSec || Infinity, b?.end ?? Infinity, g[g.length - 1].end + o.tail);
    if (end - start >= 10) out.push({ start: r1(start), end: r1(end), members: g });
  }
  return out;
}

/** La escena como candidato del editor de historia: nota = la del mejor pico matizada por la media; el texto lo pone quien llama. */
export function sceneCandidate(s: SceneSpan, index: number, text: string): DirectorCandidate {
  const best = [...s.members].sort((a, b) => b.total - a.total)[0];
  const mean = s.members.reduce((a, c) => a + c.total, 0) / s.members.length;
  const seen = s.members.filter((c) => c.visual).sort((a, b) => b.visual!.score - a.visual!.score)[0];
  const energies = s.members.flatMap((c) => (c.energy !== undefined ? [c.energy] : []));
  const chats = s.members.flatMap((c) => (c.chatPerMin !== undefined ? [c.chatPerMin] : []));
  const titles = [...new Set(s.members.map((c) => c.title).filter(Boolean))];
  return {
    id: `e${index + 1}`,
    start: s.start,
    end: s.end,
    total: r1(best.total * 0.65 + mean * 0.35),
    kind: best.kind,
    title: titles.slice(0, 3).join(' / ') || undefined,
    reason: s.members.map((c) => c.reason).filter(Boolean).join(' | ').slice(0, 260),
    ...(seen?.visual ? { visual: seen.visual } : {}),
    ...(energies.length ? { energy: Math.max(...energies) } : {}),
    ...(chats.length ? { chatPerMin: r1(chats.reduce((a, b) => a + b, 0) / chats.length) } : {}),
    text,
  };
}

/** Se añade al sistema del director cuando trabaja con escenas. */
export const HISTORIA_EXTRA =
  ' IMPORTANTE: aquí cada «momento» de la lista es una ESCENA CONTINUA del directo (de medio minuto a varios minutos, sin cortes dentro) que ya incluye su planteamiento y su reacción. ' +
  'El vídeo tiene que ENTENDERSE por alguien que no vio el directo: prefiere pocas escenas largas que cuenten algo completo a muchas cortas; no metas una escena que no se entienda sin otra que dejas fuera; ' +
  'si dos escenas son de la misma partida, conversación o historia, van en el mismo capítulo y en orden; el título de cada capítulo debe decir QUÉ pasa (sirve de puente para el espectador), no ser genérico. ' +
  'Entre las escenas el espectador verá un corte: ordénalas para que cada corte tenga lógica (cambio de tema, salto en el tiempo, consecuencia de lo anterior). Lo que se ve (gestos, muecas, caras, lo que pasa en el juego) cuenta tanto como lo que se dice.';

// ───────────────────────── Editor de ritmo ─────────────────────────

/** Recorte interno de un momento, en segundos relativos a su inicio. */
export interface Trim {
  id: string;
  from: number;
  to: number;
}

/** Un momento recortado conserva al menos esto (o no se toca). */
export const TRIM_MIN_SEC = 12;
/** Y como mucho se le quita esta fracción: el editor de ritmo afina, no reescribe. */
export const TRIM_MAX_CUT = 0.3;

export const RITMO_SYSTEM =
  'Eres editor de ritmo de un canal de YouTube en español de España. Recibes momentos de un directo de Twitch ya elegidos, con su transcripción y marcas [Ns] (segundos desde el inicio del momento). ' +
  'Tu único trabajo es quitar el AIRE de cada momento: arranques lentos antes de que pase algo, silencios, muletillas, y colas después del remate. ' +
  'Nunca cortes el planteamiento que hace falta para entender el remate, ni el remate, ni la reacción inmediata (la risa también es contenido). Si un momento ya está bien, no lo incluyas. Responde SOLO con JSON.';

export function ritmoPrompt(cands: DirectorCandidate[]): string {
  return (
    `Momentos:\n${JSON.stringify(cands.map(brief))}\n` +
    `Devuelve exactamente {"recortes":[{"id":"","desde":0,"hasta":0}]}: para cada momento que mejore recortado, el segundo donde debe empezar y el segundo donde debe acabar (relativos a su inicio, dentro de su duración). ` +
    `Son escenas continuas: recorta solo el principio o el final, nunca el contexto que hace falta para entender lo que pasa. Mínimo ${TRIM_MIN_SEC} s por momento y nunca quites más de un tercio.`
  );
}

export function parseTrims(raw: unknown, cands: DirectorCandidate[]): Trim[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out: Trim[] = [];
  const seen = new Set<string>();
  for (const t of list((raw as Record<string, unknown> | null)?.recortes)) {
    const c = byId.get(String(t.id));
    const from = num(t.desde);
    const to = num(t.hasta);
    if (!c || seen.has(c.id) || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    const dur = c.end - c.start;
    const f = Math.max(0, Math.min(from, dur));
    const e = Math.max(0, Math.min(to, dur));
    const kept = e - f;
    if (kept < TRIM_MIN_SEC || kept < dur * (1 - TRIM_MAX_CUT) || kept > dur - 1) continue;
    seen.add(c.id);
    out.push({ id: c.id, from: r1(f), to: r1(e) });
  }
  return out;
}

/** Candidatos con los recortes aplicados (los tiempos pasan a ser los del directo ya recortado). */
export function applyTrims(cands: DirectorCandidate[], trims: Trim[]): DirectorCandidate[] {
  const by = new Map(trims.map((t) => [t.id, t]));
  return cands.map((c) => {
    const t = by.get(c.id);
    return t ? { ...c, start: r1(c.start + t.from), end: r1(c.start + t.to) } : c;
  });
}

/**
 * El editor de historia trabaja a la vez que el de ritmo, así que su gancho y sus frases van en segundos relativos al
 * momento SIN recortar. Esto los pasa al momento recortado (y tira lo que caiga fuera).
 */
export function rebasePlan(plan: DirectorPlan, trims: Trim[], hookMinSec: number): DirectorPlan {
  const by = new Map(trims.map((t) => [t.id, t]));
  let hook = plan.hook;
  if (hook) {
    const t = by.get(hook.id);
    if (t) {
      const from = Math.max(0, hook.from - t.from);
      const to = Math.min(t.to - t.from, hook.to - t.from);
      hook = to - from >= hookMinSec ? { ...hook, from: r1(from), to: r1(to) } : undefined;
    }
  }
  const phrases = plan.phrases.flatMap((p) => {
    const t = by.get(p.id);
    if (!t) return [p];
    const at = p.at - t.from;
    return at >= 0 && at < t.to - t.from - 1 ? [{ ...p, at: r1(at) }] : [];
  });
  const { hook: _h, ...rest } = plan;
  return { ...rest, ...(hook ? { hook } : {}), phrases };
}

// ───────────────────────── Editor de humor ─────────────────────────

/** Un clip gracioso decidido por el editor de humor (tiempos en segundos del directo). */
export interface FunnyClip extends Seg {
  id: string;
  title: string;
  /** Gracia de 0 a 10 según el editor. */
  fun: number;
  why: string;
}

export const FUNNY = { minSec: 12, maxSec: 60, minFun: 6.5 };

export const HUMOR_SYSTEM =
  'Eres editor de clips virales (TikTok, Shorts, Reels) de un streamer de Twitch en español de España. Recibes momentos de un directo con su transcripción y marcas [Ns]. ' +
  'Elige SOLO los que hacen gracia de verdad a alguien que no vio el directo: un fail, una frase absurda, una reacción exagerada, un chiste que se entiende solo. ' +
  'Para cada uno decide dónde empieza (lo justo para entenderlo, sin introducción) y dónde acaba (justo después del remate o de la risa, nunca antes). Sé exigente: mejor tres clips buenos que diez normales. ' +
  'Lo que se ve cuenta: un fail visual vale aunque se hable poco. Título: corto, en castellano de España, sin emojis ni clickbait falso. Responde SOLO con JSON.';

export function humorPrompt(cands: DirectorCandidate[], maxClips: number): string {
  return (
    `Momentos:\n${JSON.stringify(cands.map(brief))}\n` +
    `Devuelve exactamente {"clips":[{"id":"","desde":0,"hasta":0,"titulo":"","gracia":0,"motivo":""}]} con como mucho ${maxClips} clips, de mejor a peor. ` +
    `"desde" y "hasta" son segundos relativos al inicio del momento (entre ${FUNNY.minSec} y ${FUNNY.maxSec} s de clip); "gracia" de 0 a 10 (7 = hace reír, 9 = para enseñárselo a alguien). Si ninguno hace gracia, devuelve la lista vacía.`
  );
}

export function parseFunny(raw: unknown, cands: DirectorCandidate[], maxClips: number): FunnyClip[] {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out: FunnyClip[] = [];
  const seen = new Set<string>();
  for (const k of list((raw as Record<string, unknown> | null)?.clips)) {
    const c = byId.get(String(k.id));
    const fun = num(k.gracia);
    if (!c || seen.has(c.id) || !Number.isFinite(fun) || fun < FUNNY.minFun) continue;
    const dur = c.end - c.start;
    let from = num(k.desde);
    let to = num(k.hasta);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      from = 0;
      to = dur;
    }
    from = Math.max(0, Math.min(from, dur));
    to = Math.max(from, Math.min(to, dur));
    // demasiado corto: se abre hacia los lados dentro del momento; demasiado largo: se queda con el final (el remate)
    if (to - from < FUNNY.minSec) {
      const need = FUNNY.minSec - (to - from);
      from = Math.max(0, from - need);
      to = Math.min(dur, from + FUNNY.minSec);
    }
    if (to - from > FUNNY.maxSec) from = to - FUNNY.maxSec;
    if (to - from < Math.min(FUNNY.minSec, dur)) continue;
    seen.add(c.id);
    out.push({ id: c.id, start: r1(c.start + from), end: r1(c.start + to), title: clean(k.titulo, 80) || c.title || '', fun: Math.min(10, r1(fun)), why: clean(k.motivo, 160) });
  }
  return out.sort((a, b) => b.fun - a.fun).slice(0, Math.max(0, maxClips));
}

// ───────────────────────── Jefe de edición ─────────────────────────

export interface ChiefReview {
  approved: boolean;
  /** Momentos que sobran en el vídeo resumen. */
  drop: string[];
  title: string;
  coverText: string;
  notes: string;
}

export const JEFE_SYSTEM =
  'Eres el jefe de edición de un canal de YouTube en español de España. Tu equipo (editor de historia, de ritmo y de humor) te presenta el montaje de un vídeo resumen de un directo de Twitch y los clips elegidos. ' +
  'Revísalo como espectador exigente: ¿el gancho engancha?, ¿algún momento es relleno, repite a otro o corta el ritmo?, ¿el final remata?, ¿el título es concreto y honesto? ' +
  'Puedes quitar momentos flojos (sin dejar un capítulo vacío ni tocar el último momento) y mejorar el título y la frase de la miniatura. No añadas nada que no esté en el montaje. Responde SOLO con JSON.';

export function jefePrompt(plan: DirectorPlan, cands: DirectorCandidate[], clips: FunnyClip[], o: { minSec: number; maxSec: number; totalSec: number }): string {
  const byId = new Map(cands.map((c) => [c.id, c]));
  const caps = plan.chapters.map((ch) => ({ capitulo: ch.title, ritmo: ch.pace, momentos: ch.ids.map((id) => byId.get(id)).filter((c): c is DirectorCandidate => !!c).map((c) => ({ id: c.id, dur: r1(c.end - c.start), nota: c.total, tipo: c.kind, titulo: c.title, texto: c.text.slice(0, 220) })) }));
  return (
    `Vídeo resumen: título ${JSON.stringify(plan.title)}, miniatura ${JSON.stringify(plan.coverText)}, ${Math.round(o.totalSec / 60)} min (objetivo ${Math.round(o.minSec / 60)}-${Math.round(o.maxSec / 60)} min).\n` +
    `Gancho: ${plan.hook ? JSON.stringify({ id: plan.hook.id, segundos: r1(plan.hook.to - plan.hook.from), rotulo: plan.hook.caption }) : 'no hay'}.\n` +
    `Capítulos en orden:\n${JSON.stringify(caps)}\n` +
    `Clips graciosos elegidos: ${JSON.stringify(clips.map((c) => ({ id: c.id, titulo: c.title, gracia: c.fun, dur: r1(c.end - c.start) })))}\n` +
    `Devuelve exactamente {"aprobado":true,"quitar":["id"],"titulo":"","miniatura":"","notas":""}: "quitar" son ids de momentos que sobran (vacío si está bien); "titulo" y "miniatura" solo si mejoras los actuales (si no, cadena vacía); "notas" es una frase con tu valoración.`
  );
}

export function parseChief(raw: unknown, plan: DirectorPlan): ChiefReview | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const inPlan = new Set(plan.chapters.flatMap((c) => c.ids));
  const drop = (Array.isArray(r.quitar) ? r.quitar.map(String) : []).filter((id) => inPlan.has(id));
  return { approved: r.aprobado !== false, drop: [...new Set(drop)], title: clean(r.titulo, 100), coverText: clean(r.miniatura, 40), notes: clean(r.notas, 240) };
}

/**
 * Aplica la revisión del jefe al plan. Protecciones: no vacía capítulos, no toca el último momento (el cierre), no quita
 * el momento del gancho y nunca quita más de un tercio del vídeo. Devuelve el plan nuevo y cuántos momentos quitó.
 */
export function applyChief(plan: DirectorPlan, review: ChiefReview): { plan: DirectorPlan; dropped: number } {
  const all = plan.chapters.flatMap((c) => c.ids);
  const last = all[all.length - 1];
  const budget = Math.floor(all.length / 3);
  let dropped = 0;
  const chapters = plan.chapters.map((ch) => {
    const ids = [...ch.ids];
    for (const id of review.drop) {
      if (dropped >= budget || ids.length <= 1 || id === last || id === plan.hook?.id) continue;
      const i = ids.indexOf(id);
      if (i < 0) continue;
      ids.splice(i, 1);
      dropped++;
    }
    return { ...ch, ids };
  });
  const kept = new Set(chapters.flatMap((c) => c.ids));
  return {
    plan: { ...plan, chapters, phrases: plan.phrases.filter((p) => kept.has(p.id)), title: review.title || plan.title, coverText: review.coverText || plan.coverText },
    dropped,
  };
}

// ───────────────────────── Proyecto de edición ─────────────────────────

/** Una pieza en la línea de tiempo de un vídeo (segundos del directo). */
export interface ProjectClip extends Seg {
  label?: string;
}

export interface ProjectOutput {
  kind: 'resumen' | 'tema' | 'clip';
  title: string;
  /** Pista de vídeo: las piezas en el orden en que se montan. */
  video: ProjectClip[];
  /** Pista de rótulos (segundos del directo). */
  captions: { at: number; text: string; kind: string }[];
  totalSec: number;
  note?: string;
}

/**
 * El «archivo de proyecto» del estudio: lo que se va a montar de un directo, pista a pista, y qué dijo cada editor.
 * Se guarda junto a las valoraciones (`<vod>.studio.json`) y es la base para un futuro editor visual de línea de tiempo.
 */
export interface StudioProject {
  version: 1;
  vodId: string;
  createdAt: string;
  outputs: ProjectOutput[];
  agents: { id: AgentId; ok: boolean; note: string }[];
}

export const sumSec = (segs: Seg[]): number => r1(segs.reduce((a, s) => a + (s.end - s.start), 0));

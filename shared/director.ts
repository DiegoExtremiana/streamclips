import type { Judged } from './judge';
import { judgeText } from './judge';
import type { Word } from './subtitles';
import type { Seg } from './highlights';
import type { StyleProfile } from './styleProfile';
import type { TitleKind } from './types';

/**
 * Director de edición para YouTube. Con los momentos ya valorados (texto, nota, tipo, imagen, volumen y chat), un modelo
 * de lenguaje decide la ESTRUCTURA de un vídeo de 10-15 minutos como lo haría un editor: un gancho de los primeros
 * segundos, capítulos con sentido (no «los mejores tramos pegados»), un cierre, rótulos en pantalla, título, descripción
 * y la frase de la miniatura. El programa valida todo lo que devuelve y lo monta; nunca se inventa un tramo que no exista.
 */

export interface DirectorCandidate {
  id: string;
  start: number;
  end: number;
  total: number;
  kind: string;
  title?: string;
  reason: string;
  /** Lo que se ve (nota visual del modelo con visión), si se miró. */
  visual?: { score: number; note: string };
  /** Subida de volumen respecto a la media del directo (dB) y mensajes de chat por minuto en el tramo. */
  energy?: number;
  chatPerMin?: number;
  text: string;
}

export interface DirectorInput {
  vodTitle: string;
  dateLabel: string;
  categories: string[];
  /** Duración objetivo del vídeo (s). */
  minSec: number;
  maxSec: number;
  candidates: DirectorCandidate[];
  style: Pick<StyleProfile, 'titleStyle' | 'lore'>;
}

export interface DirectorChapter {
  title: string;
  ids: string[];
  pace: 'rapido' | 'normal';
}

export interface DirectorPlan {
  title: string;
  description: string;
  coverText: string;
  /** Arranque en frío: unos segundos del momento más fuerte, antes de empezar por el principio. */
  hook?: { id: string; from: number; to: number; caption: string };
  chapters: DirectorChapter[];
  /** Frases clave que salen en pantalla (segundos relativos al inicio del momento). */
  phrases: { id: string; at: number; text: string }[];
  reason: string;
}

/** Lo que recibe el montaje: tramos en orden, rótulos (en segundos del directo) y la etiqueta de capítulo por tramo. */
export interface DirectedCut {
  segs: Seg[];
  /** Etiqueta del capítulo del tramo i ('' si el tramo continúa el capítulo anterior). */
  labels: string[];
  captions: { at: number; text: string; kind: TitleKind; duration?: number }[];
  totalSec: number;
  /** El gancho repite al principio un trozo que vuelve a salir entero después. */
  hookRepeats: boolean;
}

export const HOOK = { minSec: 5, maxSec: 20 };
const MAX_CHAPTERS = 8;
const MAX_IDS_PER_CHAPTER = 6;
const MAX_PHRASES = 8;
const MAX_CANDIDATES = 40;

/** Texto de la pantalla final de los vídeos largos. */
export const CLOSING_TEXT = 'Suscríbete para no perderte el próximo directo';

const r1 = (x: number) => Math.round(x * 10) / 10;
const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Convierte lo valorado en lo que lee el director, con las señales medidas del tramo. */
export function directorCandidates(judged: Judged[], words: Word[], sig: { energyDb?: number[]; chat?: number[] }): DirectorCandidate[] {
  const mean = sig.energyDb?.length ? sig.energyDb.reduce((a, b) => a + b, 0) / sig.energyDb.length : undefined;
  return judged
    .filter((j) => !j.judgement.discard && j.total >= 4)
    .sort((a, b) => b.total - a.total)
    .slice(0, MAX_CANDIDATES)
    .sort((a, b) => a.start - b.start)
    .map((j) => {
      const seg = j.judgement.trim ?? j;
      const lo = Math.floor(seg.start);
      const hi = Math.ceil(seg.end);
      const peak = sig.energyDb && mean !== undefined ? Math.max(...sig.energyDb.slice(lo, hi + 1), -200) - mean : undefined;
      const chat = sig.chat ? sig.chat.slice(lo, hi + 1).reduce((a, b) => a + b, 0) : undefined;
      const dur = Math.max(1, seg.end - seg.start);
      const vm = /Imagen \((\d+)\/10\): ([^.]+)/.exec(j.judgement.reason);
      return {
        id: j.id,
        start: r1(seg.start),
        end: r1(seg.end),
        total: r1(j.total),
        kind: j.judgement.kind,
        title: j.judgement.title,
        reason: j.judgement.reason.replace(/\s*Imagen \(\d+\/10\):.*$/, '').slice(0, 160),
        ...(j.visual ? { visual: j.visual } : vm ? { visual: { score: Number(vm[1]), note: vm[2].trim() } } : {}),
        ...(peak !== undefined && Number.isFinite(peak) ? { energy: r1(peak) } : {}),
        ...(chat !== undefined ? { chatPerMin: r1((chat * 60) / dur) } : {}),
        text: judgeText(words, seg, 420),
      };
    });
}

export const DIRECTOR_SYSTEM =
  'Eres el editor jefe del canal de YouTube de un streamer de Twitch que habla en español de España. Tu trabajo es convertir los mejores momentos de un directo en UN vídeo de YouTube de 10 a 15 minutos que la gente vea entero, con la estructura de los canales grandes (Ibai, Rubius, IlloJuan): ' +
  '1) GANCHO: los primeros 5-20 segundos enseñan lo más fuerte del directo (una reacción, un fail, una frase) sin explicar nada; después el vídeo empieza por el principio y ese momento vuelve a salir entero en su sitio. ' +
  '2) CAPÍTULOS con sentido (3 a 8): cada uno cuenta una cosa (una partida, una historia, un tema, una racha) y tiene planteamiento y remate; dentro de un capítulo el orden es cronológico; entre capítulos puedes reordenar si mejora la historia, pero sin que se note un salto raro. ' +
  '3) RITMO: alterna capítulos rápidos (acción, fails, reacciones) y normales (historias, charla buena); no pongas dos tramos lentos seguidos; corta lo que sobre. ' +
  '4) CIERRE: el último momento remata el vídeo (una victoria, una frase, una risa final), nunca termina en medio de nada. ' +
  'REGLAS: usa SOLO los momentos de la lista, por su id, cada uno como mucho una vez (el gancho puede repetir el principio de uno). Respeta la duración objetivo: si sobra, quita los momentos más flojos. ' +
  'Rótulos: «frases» son 0 a 8 frases literales muy cortas (máximo 40 caracteres) que se dicen en el momento y merecen verse en pantalla. Título de YouTube: en castellano de España, concreto y honesto, 30 a 70 caracteres, sin emojis ni mayúsculas gritando, sin clickbait falso. ' +
  'Descripción: 2 a 4 frases que cuenten qué pasa, sin hashtags ni enlaces. Miniatura: 2 a 4 palabras con gancho (no repitas el título). ' +
  'Ten en cuenta lo que se ve (nota de imagen) tanto como lo que se dice: un fail visual o una cara vale aunque se hable poco; una pantalla muerta no vale aunque se hable. Responde SOLO con JSON.';

export function directorPrompt(input: DirectorInput): string {
  const lore = input.style.lore.slice(0, 12).map((l) => `${l.name}: ${l.note}`.slice(0, 120));
  const shape = '{"titulo":"","descripcion":"","miniatura":"","gancho":{"id":"","desde":0,"hasta":10,"rotulo":""},"capitulos":[{"titulo":"","ids":["c1"],"ritmo":"rapido"}],"frases":[{"id":"","en":0,"texto":""}],"motivo":""}';
  return (
    `Directo: ${JSON.stringify(input.vodTitle)} (${input.dateLabel}). Categorías: ${input.categories.join(', ') || 'desconocida'}. ` +
    `Duración objetivo del vídeo: entre ${Math.round(input.minSec / 60)} y ${Math.round(input.maxSec / 60)} minutos (suma de los momentos que elijas).\n` +
    (lore.length ? `Lore y chistes del canal (para entender, no para explicar en el vídeo): ${lore.join(' | ')}\n` : '') +
    `Momentos valorados (id, segundos del directo, nota de 0 a 10, tipo, lo que se ve, subida de volumen en dB, chat por minuto, y la transcripción con marcas [Ns] relativas al inicio del momento):\n` +
    `${JSON.stringify(input.candidates.map((c) => ({ id: c.id, inicio: c.start, fin: c.end, dur: r1(c.end - c.start), nota: c.total, tipo: c.kind, titulo: c.title, motivo: c.reason, ...(c.visual ? { imagen: `${c.visual.score}/10: ${c.visual.note}` } : {}), ...(c.energy !== undefined ? { volumen: c.energy } : {}), ...(c.chatPerMin !== undefined ? { chat: c.chatPerMin } : {}), texto: c.text })))}\n` +
    `Devuelve exactamente este JSON: ${shape}. En "gancho", "desde" y "hasta" son segundos relativos al inicio de ese momento (${HOOK.minSec} a ${HOOK.maxSec} s en total) y "rotulo" es un aviso muy corto para pantalla (p. ej. «lo que pasó al final»). Si ningún momento sirve de gancho, pon "gancho": null.`
  );
}

/** Valida y limpia lo que devuelve el modelo. Devuelve null si no hay con qué montar un vídeo. */
export function parseDirectorPlan(raw: unknown, candidates: DirectorCandidate[]): DirectorPlan | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const used = new Set<string>();
  const chapters: DirectorChapter[] = [];
  for (const ch of Array.isArray(r.capitulos) ? (r.capitulos as Record<string, unknown>[]).slice(0, MAX_CHAPTERS) : []) {
    if (!ch || typeof ch !== 'object') continue;
    const ids: string[] = [];
    for (const id of Array.isArray(ch.ids) ? ch.ids.map(String) : []) {
      if (byId.has(id) && !used.has(id) && ids.length < MAX_IDS_PER_CHAPTER) {
        ids.push(id);
        used.add(id);
      }
    }
    if (!ids.length) continue;
    // dentro del capítulo el orden es el del directo
    ids.sort((a, b) => byId.get(a)!.start - byId.get(b)!.start);
    chapters.push({ title: clean(ch.titulo, 40) || `Capítulo ${chapters.length + 1}`, ids, pace: ch.ritmo === 'rapido' ? 'rapido' : 'normal' });
  }
  if (chapters.length < 2) return null;
  let hook: DirectorPlan['hook'];
  const g = r.gancho as Record<string, unknown> | null;
  if (g && typeof g === 'object') {
    const c = byId.get(String(g.id));
    const from = Number(g.desde);
    const to = Number(g.hasta);
    if (c && Number.isFinite(from) && Number.isFinite(to)) {
      const dur = c.end - c.start;
      const f = Math.min(Math.max(0, from), Math.max(0, dur - HOOK.minSec));
      const t = Math.min(dur, Math.max(f + HOOK.minSec, Math.min(to, f + HOOK.maxSec)));
      if (t - f >= HOOK.minSec) hook = { id: c.id, from: r1(f), to: r1(t), caption: clean(g.rotulo, 40) };
    }
  }
  const phrases: DirectorPlan['phrases'] = [];
  for (const p of Array.isArray(r.frases) ? (r.frases as Record<string, unknown>[]).slice(0, MAX_PHRASES) : []) {
    const c = p && byId.get(String(p.id));
    const at = Number(p?.en);
    const text = clean(p?.texto, 40);
    if (!c || !used.has(c.id) || !Number.isFinite(at) || !text) continue;
    phrases.push({ id: c.id, at: Math.min(Math.max(0, at), Math.max(0, c.end - c.start - 1)), text });
  }
  return {
    title: clean(r.titulo, 100),
    description: clean(r.descripcion, 600),
    coverText: clean(r.miniatura, 40),
    ...(hook ? { hook } : {}),
    chapters,
    phrases,
    reason: clean(r.motivo, 240),
  };
}

/**
 * Convierte el plan en tramos del directo, recortando lo más flojo si se pasa de la duración y rechazándolo (null) si no
 * llega al mínimo razonable. Los rótulos van en segundos del directo; el montaje los pasa al tiempo del vídeo.
 */
export function directedCut(plan: DirectorPlan, candidates: DirectorCandidate[], o: { minSec: number; maxSec: number; floorSec: number }): DirectedCut | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const chapters = plan.chapters.map((ch) => ({ ...ch, ids: [...ch.ids] }));
  const dur = (id: string) => byId.get(id)!.end - byId.get(id)!.start;
  const hookSec = plan.hook ? plan.hook.to - plan.hook.from : 0;
  const total = () => hookSec + chapters.reduce((a, ch) => a + ch.ids.reduce((b, id) => b + dur(id), 0), 0);
  // si se pasa: fuera el momento más flojo que no sea el único de su capítulo ni el cierre
  while (total() > o.maxSec * 1.1) {
    let worst: { ch: number; id: string; total: number } | null = null;
    chapters.forEach((ch, ci) => {
      if (ch.ids.length <= 1) return;
      for (const id of ch.ids) {
        const last = ci === chapters.length - 1 && id === ch.ids[ch.ids.length - 1];
        if (last) continue;
        const t = byId.get(id)!.total;
        if (!worst || t < worst.total) worst = { ch: ci, id, total: t };
      }
    });
    if (!worst) break;
    const w: { ch: number; id: string } = worst;
    chapters[w.ch].ids = chapters[w.ch].ids.filter((id) => id !== w.id);
  }
  const segs: Seg[] = [];
  const labels: string[] = [];
  const captions: DirectedCut['captions'] = [];
  let hookRepeats = false;
  if (plan.hook) {
    const c = byId.get(plan.hook.id)!;
    const start = r1(c.start + plan.hook.from);
    const end = r1(c.start + plan.hook.to);
    segs.push({ start, end });
    labels.push('');
    if (plan.hook.caption) captions.push({ at: start + 0.3, text: plan.hook.caption, kind: 'gancho', duration: Math.min(4, end - start) });
    hookRepeats = chapters.some((ch) => ch.ids.includes(c.id));
  }
  const phraseBy = new Map<string, DirectorPlan['phrases']>();
  for (const p of plan.phrases) phraseBy.set(p.id, [...(phraseBy.get(p.id) ?? []), p]);
  for (const ch of chapters) {
    ch.ids.forEach((id, i) => {
      const c = byId.get(id)!;
      segs.push({ start: c.start, end: c.end });
      labels.push(i === 0 ? ch.title : '');
      if (i === 0) captions.push({ at: c.start + 0.2, text: ch.title, kind: 'capitulo', duration: 3.5 });
      for (const p of phraseBy.get(id) ?? []) captions.push({ at: c.start + p.at, text: p.text, kind: 'frase', duration: 3 });
    });
  }
  // pantalla final: llamada a suscribirse en los últimos segundos del último tramo
  const lastSeg = segs[segs.length - 1];
  if (lastSeg && lastSeg.end - lastSeg.start >= 8) captions.push({ at: r1(lastSeg.end - 5), text: CLOSING_TEXT, kind: 'cierre', duration: 4.5 });
  const totalSec = total();
  if (totalSec < Math.max(o.floorSec, o.minSec * 0.6)) return null;
  return { segs, labels, captions, totalSec, hookRepeats };
}

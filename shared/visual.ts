import { judgeText, type Judged } from './judge';
import type { Word } from './subtitles';
import type { Seg } from './highlights';

/**
 * El directo también se mira: de los mejores momentos se sacan unos fotogramas y el modelo (con visión) puntúa lo que se ve
 * (gestos, pantalla, acción, gags visuales) y avisa de los momentos «muertos» (pantalla de espera, menú, AFK).
 * Esa nota visual es un factor más en la selección y en la edición, junto a lo que se oye.
 */
export interface VisualJudgement {
  id: string;
  /** 0 a 10: qué aporta la imagen (5 = normal, sin nada que destaque). */
  visual: number;
  note: string;
  /** La imagen está muerta: pantalla de espera, menú, cámara apagada, nada que ver. */
  dead: boolean;
  /** Dónde está lo importante del fragmento (0 a 1 del ancho y del alto): la cara si cuenta la reacción, el punto del juego si cuenta la acción. */
  focus?: Point;
  /** Dónde está la cara del streamer en la imagen (si hay cámara). */
  face?: Point;
}

export interface Point {
  x: number;
  y: number;
}

const point = (v: unknown): Point | undefined => {
  const o = v as { x?: unknown; y?: unknown } | null;
  const x = Number(o?.x);
  const y = Number(o?.y);
  return o && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 } : undefined;
};

export const VISUAL_SYSTEM =
  'Eres editor de vídeo de un streamer de Twitch. Ves unos fotogramas de cada fragmento de un directo (en orden cronológico) y, junto a ellos, un resumen de lo que se dice. ' +
  'Puntúa SOLO lo que se ve, de 0 a 10: 5 es una imagen normal (juego o cámara sin nada especial), 7 es visualmente buena (gesto o cara llamativa, acción clara, algo gracioso o espectacular en pantalla, texto o suceso relevante), 9-10 solo si la imagen por sí sola haría reír o enganchar. ' +
  'Pon "muerta": true si la imagen no tiene nada que ver (pantalla de espera o «vuelvo enseguida», menú, carga, pantalla negra, cámara apagada o vacía, el mismo plano inmóvil sin acción). ' +
  'Fíjate sobre todo en la persona si hay cámara: gestos, muecas, caras de sorpresa, risa, enfado o susto, y si cambian de un fotograma a otro (una reacción vale más que una cara quieta). ' +
  '"nota" es una frase corta en castellano de lo que se ve (di el gesto si lo hay). ' +
  '"foco" es el punto de la imagen hacia el que haría zoom un editor en ese fragmento ({"x","y"} de 0 a 1 respecto al ancho y al alto; 0,0 es arriba a la izquierda): la cara de quien reacciona si lo que cuenta es la reacción, o el sitio de la pantalla donde pasa lo importante si lo que cuenta es el juego. ' +
  '"cara" es dónde está la cara del streamer (su cámara) en la imagen, o null si no se ve. No inventes lo que no se vea. Responde SOLO con JSON.';

export function visualPrompt(words: Word[], items: { c: Judged; frames: number }[]): string {
  const list = items.map(({ c, frames }) => ({ id: c.id, fotogramas: frames, titulo: c.judgement.title ?? '', texto: judgeText(words, c, 260) }));
  return `Fragmentos (los fotogramas llegan en este orden, ${items.map((x) => x.frames).join('+')} por fragmento):\n${JSON.stringify(list)}\nDevuelve {"imagen":[{"id":"","visual":0,"muerta":false,"nota":"","foco":{"x":0.5,"y":0.5},"cara":{"x":0.1,"y":0.2}}]} con un elemento por fragmento.`;
}

export function parseVisual(raw: unknown, valid: Set<string>): VisualJudgement[] {
  const list = (raw as { imagen?: unknown } | null)?.imagen;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: VisualJudgement[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const id = String(r?.id ?? '');
    const v = Number(r?.visual);
    if (!valid.has(id) || seen.has(id) || !Number.isFinite(v)) continue;
    seen.add(id);
    const note = typeof r.nota === 'string' ? r.nota.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
    const focus = point(r.foco);
    const face = point(r.cara);
    out.push({ id, visual: Math.min(10, Math.max(0, v)), note, dead: r.muerta === true, ...(focus ? { focus } : {}), ...(face ? { face } : {}) });
  }
  return out;
}

/** Cuánto sube o baja la nota por la imagen: ±1,5 puntos como máximo (la imagen ayuda a decidir, no sustituye a lo que se dice). */
export const VISUAL_SWING = 0.3;

/** Aplica la nota visual: sube o baja el total, deja constancia en el motivo y descarta lo que está muerto. */
export function applyVisual(judged: Judged[], vis: VisualJudgement[]): Judged[] {
  const by = new Map(vis.map((v) => [v.id, v]));
  return judged.map((j) => {
    const v = by.get(j.id);
    if (!v) return j;
    const total = Math.round(Math.min(10, Math.max(0, j.total + (v.visual - 5) * VISUAL_SWING)) * 100) / 100;
    const reason = `${j.judgement.reason}${v.note ? ` Imagen (${v.visual.toFixed(0)}/10): ${v.note}` : ''}`.trim().slice(0, 320);
    return { ...j, total, visual: { score: v.visual, note: v.note, ...(v.focus ? { focus: v.focus } : {}), ...(v.face ? { face: v.face } : {}) }, judgement: { ...j.judgement, reason, discard: j.judgement.discard || (v.dead && v.visual <= 3) } };
  });
}

/** Instantes (s) de los fotogramas de un tramo: repartidos dentro, sin tocar los bordes. */
export function frameTimes(seg: Seg, n: number): number[] {
  const len = Math.max(0, seg.end - seg.start);
  return Array.from({ length: n }, (_, i) => Math.round((seg.start + (len * (i + 1)) / (n + 1)) * 10) / 10);
}

/** Dónde está la cámara del streamer en este directo: la mediana de las caras que vio el modelo (la cámara no se mueve). */
export function streamFace(judged: { visual?: { face?: Point } }[]): Point | null {
  const faces = judged.flatMap((j) => (j.visual?.face ? [j.visual.face] : []));
  if (faces.length < 2) return null;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return { x: med(faces.map((f) => f.x)), y: med(faces.map((f) => f.y)) };
}

/**
 * Hacia dónde va un zoom en cada instante del directo: al foco que vio el modelo en ese momento (la cara que reacciona o el
 * punto del juego donde pasa algo) o, si ese momento no se miró, a la cámara del streamer. Sin ninguno de los dos no hay
 * objetivo y no se hace zoom (un zoom al centro sin más no tiene sentido).
 */
export function focusFinder(judged: (Seg & { judgement?: { trim?: Seg }; visual?: { focus?: Point; face?: Point } })[]): ((t: number) => Point | null) | undefined {
  const seen = judged.filter((j) => j.visual?.focus);
  const face = streamFace(judged);
  if (!seen.length && !face) return undefined;
  return (t: number) => {
    const hit = seen.find((j) => {
      const s = j.judgement?.trim ?? j;
      return t >= s.start - 2 && t <= s.end + 2;
    });
    return hit?.visual?.focus ?? face;
  };
}

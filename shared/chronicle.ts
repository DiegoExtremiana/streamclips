import type { Seg } from './highlights';
import type { Word } from './subtitles';
import { playbookFor } from './editingPlaybook';

/**
 * El cronista (desde la v0.39.0). Un directo de cuatro horas no cabe entero en una sola pregunta a una IA gratuita, así que
 * se parte en tramos (20 min por defecto) y se reparten entre las IAs disponibles, que los leen A LA VEZ. De cada tramo sale
 * una ficha: qué pasa, de qué se habla y qué momentos merecen la pena. Con todas las fichas se forma el MAPA DEL DIRECTO, que
 * reciben el editor de historia y el de temas para entender el directo entero, y los momentos señalados entran como
 * candidatos (los que se encuentran por lo que se dice, no por el volumen).
 */
export interface ChronicleMoment {
  /** Segundo del directo. */
  at: number;
  what: string;
}

export interface ChronicleChunk extends Seg {
  summary: string;
  topics: string[];
  moments: ChronicleMoment[];
}

export const CHUNK_SEC = 20 * 60;
/** Texto como mucho por tramo (unos 4.000 tokens): cabe en las cuentas gratuitas. */
export const CHUNK_CHARS = 14_000;

export const CHRONICLE_SYSTEM =
  'Eres el cronista de un equipo profesional de edición de vídeo que convierte directos de Twitch de un streamer español en vídeos de YouTube y clips para redes. ' +
  'Lees UN tramo de la transcripción del directo (las marcas [h:mm:ss] son el tiempo desde el inicio) y haces su ficha para tus compañeros editores: qué pasa, de qué se habla y qué momentos merecen la pena. ' +
  'La transcripción es automática y puede tener errores: interpreta con sentido común, sin inventar. Responde SOLO con JSON.' +
  playbookFor('cronista');

const hms = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Parte el directo en tramos de `chunkSec` (el último absorbe el resto si es corto). */
export function chronicleChunks(durationSec: number, chunkSec = CHUNK_SEC): Seg[] {
  const out: Seg[] = [];
  for (let t = 0; t < durationSec; t += chunkSec) out.push({ start: t, end: Math.min(durationSec, t + chunkSec) });
  if (out.length > 1 && out[out.length - 1].end - out[out.length - 1].start < chunkSec / 3) {
    const last = out.pop()!;
    out[out.length - 1].end = last.end;
  }
  return out;
}

/** El texto de un tramo con una marca de tiempo cada ~20 s; si no cabe, se toman trozos repartidos por todo el tramo. */
export function chunkText(words: Word[], seg: Seg, maxChars = CHUNK_CHARS): string {
  const ws = words.filter((w) => w.start >= seg.start && w.start < seg.end).sort((a, b) => a.start - b.start);
  if (!ws.length) return '';
  const lines: string[] = [];
  let cur: string[] = [];
  let mark = ws[0].start;
  for (const w of ws) {
    if (w.start - mark >= 20 && cur.length) {
      lines.push(`[${hms(mark)}] ${cur.join(' ')}`);
      cur = [];
      mark = w.start;
    }
    cur.push(w.text.trim());
  }
  if (cur.length) lines.push(`[${hms(mark)}] ${cur.join(' ')}`);
  const full = lines.join('\n');
  if (full.length <= maxChars) return full;
  // demasiado texto: líneas repartidas por todo el tramo (no solo el principio)
  const keep = Math.max(1, Math.floor(lines.length * (maxChars / full.length)));
  const step = lines.length / keep;
  return Array.from({ length: keep }, (_, i) => lines[Math.floor(i * step)]).join('\n');
}

export function chroniclePrompt(text: string, seg: Seg, vodTitle: string): string {
  return (
    `Directo: ${JSON.stringify(vodTitle)}. Tramo de ${hms(seg.start)} a ${hms(seg.end)}.\n${text}\n` +
    'Devuelve exactamente {"resumen":"","temas":[""],"momentos":[{"t":"h:mm:ss","que":""}]}: "resumen" en 2 a 4 frases con lo que pasa de verdad (nombres, juego, decisiones, conversaciones); ' +
    '"temas" son los asuntos de los que se habla (hasta 6, tal como se dirían); "momentos" son hasta 6 instantes que un editor querría usar, con la marca de tiempo donde empiezan y una frase de qué pasa. Si el tramo no tiene nada, listas vacías.'
  );
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>{}\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** «1:02:03», «62:03» o un número de segundos. */
export function parseClock(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const parts = v.trim().split(':').map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

export function parseChronicle(raw: unknown, seg: Seg): ChronicleChunk | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  const summary = clean(r.resumen, 500);
  const topics = (Array.isArray(r.temas) ? r.temas : []).map((t) => clean(t, 60)).filter(Boolean).slice(0, 6);
  const moments: ChronicleMoment[] = [];
  for (const m of Array.isArray(r.momentos) ? (r.momentos as Record<string, unknown>[]) : []) {
    const at = parseClock(m?.t);
    const what = clean(m?.que, 140);
    // el modelo a veces da el tiempo relativo al tramo: si cae fuera, se prueba sumándole el inicio
    const abs = at === null ? null : at >= seg.start && at <= seg.end ? at : at + seg.start >= seg.start && at + seg.start <= seg.end ? at + seg.start : null;
    if (abs !== null && what) moments.push({ at: abs, what });
  }
  if (!summary && !moments.length) return null;
  return { start: seg.start, end: seg.end, summary, topics, moments: moments.slice(0, 6) };
}

/** El mapa del directo para los demás editores: una línea por tramo, en orden. */
export function chronicleMap(chunks: ChronicleChunk[]): string {
  if (!chunks.length) return '';
  const lines = [...chunks]
    .sort((a, b) => a.start - b.start)
    .map((c) => `- ${hms(c.start)}-${hms(c.end)}: ${c.summary}${c.topics.length ? ` Temas: ${c.topics.join(', ')}.` : ''}${c.moments.length ? ` Momentos: ${c.moments.map((m) => `${hms(m.at)} ${m.what}`).join('; ')}.` : ''}`);
  return `\nMAPA DEL DIRECTO (lo que pasa en cada tramo, según el cronista):\n${lines.join('\n')}`;
}

/** Los momentos que señaló el cronista como candidatos (un poco antes para el contexto), sin pisar los que ya hay. */
export function chronicleCandidates(chunks: ChronicleChunk[], taken: Seg[], durationSec: number): (Seg & { what: string })[] {
  const out: (Seg & { what: string })[] = [];
  for (const m of chunks.flatMap((c) => c.moments).sort((a, b) => a.at - b.at)) {
    const seg = { start: Math.max(0, m.at - 15), end: Math.min(durationSec || Infinity, m.at + 50) };
    if (seg.end - seg.start < 20) continue;
    const overl = (x: Seg) => Math.min(x.end, seg.end) - Math.max(x.start, seg.start) > 20;
    if (taken.some(overl) || out.some(overl)) continue;
    out.push({ ...seg, what: m.what });
  }
  return out;
}

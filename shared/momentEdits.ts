import type { Judged, MomentKind } from './judge';
import type { Seg } from './highlights';

/**
 * Correcciones manuales sobre la selección automática de momentos de un directo. Se guardan aparte de las valoraciones del
 * modelo (que no se tocan): así regenerar el montaje respeta lo que decidió el usuario sin volver a analizar nada.
 */
export interface MomentEdits {
  /** Momentos que no deben salir (clave = inicio redondeado del candidato). */
  exclude: string[];
  /** Momentos que deben salir aunque no lleguen a la nota mínima. */
  pin: string[];
  /** Inicio y fin elegidos a mano (segundos del directo), por clave. */
  trims: Record<string, Seg>;
  /** Momentos añadidos a mano que el modelo no había propuesto. */
  extra: { start: number; end: number; title?: string }[];
}

export const emptyEdits = (): MomentEdits => ({ exclude: [], pin: [], trims: {}, extra: [] });

export const momentKey = (start: number): string => String(Math.round(start));

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);

/** Lee lo guardado en disco sin fiarse de él: lo que no tenga sentido se ignora. */
export function cleanEdits(raw: unknown): MomentEdits {
  const r = (raw ?? {}) as Partial<MomentEdits>;
  const keys = (a: unknown): string[] => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === 'string' && /^\d+$/.test(x)))].slice(0, 500) : []);
  const trims: Record<string, Seg> = {};
  if (r.trims && typeof r.trims === 'object') {
    for (const [k, v] of Object.entries(r.trims)) {
      const s = num((v as Seg)?.start);
      const e = num((v as Seg)?.end);
      if (/^\d+$/.test(k) && s !== null && e !== null && e - s >= MIN_LEN && e - s <= MAX_LEN) trims[k] = { start: s, end: e };
    }
  }
  const extra = (Array.isArray(r.extra) ? r.extra : []).flatMap((x) => {
    const s = num(x?.start);
    const e = num(x?.end);
    if (s === null || e === null || e - s < MIN_LEN || e - s > MAX_LEN) return [];
    const title = typeof x.title === 'string' ? x.title.replace(/[<>]/g, '').trim().slice(0, 60) : '';
    return [{ start: s, end: e, ...(title ? { title } : {}) }];
  });
  return { exclude: keys(r.exclude), pin: keys(r.pin), trims, extra: extra.slice(0, 100) };
}

export const MIN_LEN = 8;
export const MAX_LEN = 180;

/**
 * Aplica las correcciones a los candidatos valorados: lo excluido se descarta, lo fijado pasa siempre (nota 10), el recorte
 * manual manda sobre el del modelo y lo añadido a mano entra como un momento más con nota máxima.
 */
export function applyEdits(items: Judged[], edits: MomentEdits): Judged[] {
  const ex = new Set(edits.exclude);
  const pin = new Set(edits.pin);
  const out = items.map((it) => {
    const k = momentKey(it.start);
    const trim = edits.trims[k];
    const j = { ...it.judgement, ...(trim ? { trim, manual: true } : {}), ...(ex.has(k) ? { discard: true } : pin.has(k) ? { discard: false } : {}) };
    return { ...it, judgement: j, total: pin.has(k) && !ex.has(k) ? Math.max(it.total, 10) : it.total };
  });
  for (const x of edits.extra) {
    if (ex.has(momentKey(x.start))) continue;
    out.push({
      id: `m${momentKey(x.start)}`,
      start: x.start,
      end: x.end,
      signal: 10,
      total: 10,
      judgement: { id: `m${momentKey(x.start)}`, scores: { humor: 10, originalidad: 10, interaccion: 10, reaccion: 10, contexto: 10, autonomia: 10 }, kind: 'otro' as MomentKind, reason: 'Añadido por ti', discard: false, manual: true, ...(x.title ? { title: x.title } : {}) },
    });
  }
  return out;
}

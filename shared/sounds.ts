import type { Word } from './subtitles';
import type { Range } from './timeline';

/** Efectos de sonido disponibles. Todos se sintetizan con ffmpeg (sin derechos de autor); una carpeta del usuario puede sustituir cualquiera. */
export const SOUND_IDS = ['whoosh', 'pop', 'hit', 'ding', 'coin', 'tada', 'fail', 'boom', 'alert', 'boing', 'sparkle'] as const;
export type SoundId = (typeof SOUND_IDS)[number];
export const isSoundId = (x: unknown): x is SoundId => typeof x === 'string' && (SOUND_IDS as readonly string[]).includes(x);

/** Lo que se dice → el sonido que lo acompaña. Se compara con cada palabra suelta, sin tildes ni mayúsculas. */
export const SOUND_RULES: { sound: SoundId; words: string[] }[] = [
  { sound: 'coin', words: ['dinero', 'euros', 'euro', 'pasta', 'pavos', 'monedas', 'millon', 'millones', 'rico', 'cobrar', 'oro'] },
  { sound: 'tada', words: ['gane', 'ganamos', 'ganado', 'victoria', 'campeon', 'conseguimos', 'logrado', 'logre', 'completado', 'conseguido'] },
  { sound: 'fail', words: ['mori', 'muero', 'murio', 'mueres', 'perdi', 'perdimos', 'fallo', 'falle', 'desastre', 'caimos', 'rip', 'noooo', 'nooo', 'fracaso'] },
  { sound: 'boom', words: ['explota', 'explosion', 'explotar', 'bomba', 'boom', 'bum', 'estalla', 'revienta'] },
  { sound: 'ding', words: ['correcto', 'correcta', 'exacto', 'exacta', 'acertaste', 'acertado', 'acierto', 'premio'] },
  { sound: 'alert', words: ['cuidado', 'ojo', 'peligro', 'alerta', 'atencion'] },
  { sound: 'boing', words: ['salta', 'saltar', 'rebota', 'boing', 'bote'] },
  { sound: 'sparkle', words: ['shiny', 'brillante', 'variocolor', 'legendario', 'legendaria', 'magico', 'magica'] },
];

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zñ]/g, '');

export interface CueOpts {
  /** Segundos mínimos entre efectos de este tipo (evita que el vídeo parezca una verbena). */
  spacing?: number;
  /** Máximo de efectos por minuto de vídeo. */
  perMinute?: number;
  /** Cuántas veces como mucho suena el mismo sonido en un vídeo. */
  perSound?: number;
}

/**
 * Efectos de sonido según lo que se dice: «ganamos» → fanfarria, «dinero» → moneda, «he muerto» → fallo… Solo en lo que se conserva,
 * con separación entre ellos y sin pisar los que ya hay (`taken`: instantes con otro golpe de sonido).
 */
export function soundCues(words: Word[], seg: Range, isKept: (t: number) => boolean, taken: number[] = [], o: CueOpts = {}): { at: number; sound: SoundId }[] {
  const spacing = o.spacing ?? 7;
  const dur = seg.end - seg.start;
  const max = Math.max(0, Math.floor((dur / 60) * (o.perMinute ?? 4)));
  const perSound = o.perSound ?? 2;
  const out: { at: number; sound: SoundId }[] = [];
  const count = new Map<SoundId, number>();
  const used = [...taken];
  for (const w of [...words].filter((x) => x.start >= seg.start && x.end <= seg.end + 0.25).sort((a, b) => a.start - b.start)) {
    if (out.length >= max) break;
    const key = norm(w.text);
    if (!key) continue;
    const rule = SOUND_RULES.find((r) => r.words.some((x) => norm(x) === key));
    if (!rule) continue;
    const at = Math.max(seg.start, w.start - 0.05);
    if (!isKept(at) || at - seg.start < 1 || seg.end - at < 1.5) continue;
    if ((count.get(rule.sound) ?? 0) >= perSound) continue;
    if (used.some((t) => Math.abs(t - at) < Math.min(spacing, 2) || (out.length && Math.abs(out[out.length - 1].at - at) < spacing))) continue;
    out.push({ at, sound: rule.sound });
    count.set(rule.sound, (count.get(rule.sound) ?? 0) + 1);
    used.push(at);
  }
  return out;
}

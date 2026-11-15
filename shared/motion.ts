import type { Judged } from './judge';
import type { VisualJudgement } from './visual';

/** Lo que se mide de la imagen de un tramo sin mirarla con el modelo: cambios de plano y tiempo con la imagen congelada. */
export interface Motion {
  durationSec: number;
  /** Cambios de escena detectados. */
  changes: number;
  /** Segundos con la imagen quieta (pantalla de espera, menú, cámara parada). */
  frozenSec: number;
}

/** Lee la salida de ffmpeg (freezedetect + showinfo de los cambios de escena). */
export function parseMotion(stderr: string, durationSec: number): Motion {
  // freezedetect avisa del inicio y, al acabar, de la duración; si la imagen sigue quieta hasta el final solo hay inicio
  let frozenSec = 0;
  let open: number | null = null;
  for (const m of stderr.matchAll(/freezedetect[^\]]*\]\s*(?:lavfi\.freezedetect\.)?freeze_(start|duration|end):\s*([\d.]+)/g)) {
    if (m[1] === 'start') open = Number(m[2]);
    else if (m[1] === 'duration') {
      frozenSec += Number(m[2]);
      open = null;
    }
  }
  if (open !== null) frozenSec += Math.max(0, durationSec - open);
  const changes = (stderr.match(/Parsed_showinfo[^\n]*pts_time:/g) ?? []).length;
  return { durationSec, changes, frozenSec: Math.min(durationSec, frozenSec) };
}

/** Nota de imagen medida (sin modelo): conservadora, entre 2 y 6,5; solo marca «muerta» una imagen casi toda quieta. */
export function motionVerdict(id: string, m: Motion): VisualJudgement {
  const dur = Math.max(1, m.durationSec);
  const frozen = m.frozenSec / dur;
  const perMin = (m.changes / dur) * 60;
  if (frozen >= 0.85 && perMin < 2) return { id, visual: 2, dead: true, note: `imagen casi quieta (${Math.round(frozen * 100)}% del tramo)` };
  const visual = Math.round(Math.min(6.5, Math.max(3, 5 + Math.min(1.5, perMin / 10) - frozen * 2)) * 10) / 10;
  const note = frozen >= 0.5 ? `imagen bastante quieta (${Math.round(frozen * 100)}%)` : perMin >= 8 ? `mucha acción en pantalla (${Math.round(perMin)} cambios/min)` : 'imagen con movimiento normal';
  return { id, visual, dead: false, note };
}

/** Candidatos que aún no tienen nota de imagen (el modelo con visión solo mira los mejores). */
export const unseen = (judged: Judged[]): Judged[] => judged.filter((j) => !j.visual && !j.judgement.discard);

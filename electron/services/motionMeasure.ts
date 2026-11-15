import { execFile } from 'node:child_process';
import type { Judged } from '../../shared/judge';
import { motionVerdict, parseMotion, unseen } from '../../shared/motion';
import { applyVisual } from '../../shared/visual';

/** Mide con ffmpeg (sin modelo) un tramo: cambios de escena y tiempo de imagen congelada. */
export function measureMotion(ffmpeg: string, file: string, start: number, end: number, timeoutMs = 90_000): Promise<string> {
  const dur = Math.max(1, end - start);
  return new Promise((resolve, reject) => {
    execFile(
      ffmpeg,
      ['-hide_banner', '-nostdin', '-ss', String(Math.max(0, start)), '-t', String(dur), '-i', file, '-an', '-vf', "scale=160:-2,fps=2,freezedetect=n=0.003:d=2,select='gt(scene,0.1)',showinfo", '-f', 'null', '-'],
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, _out, stderr) => (err && !stderr ? reject(err) : resolve(String(stderr))),
    );
  });
}

/**
 * Nota de imagen barata para los candidatos que el modelo con visión no miró. Es un extra: si ffmpeg falla en un tramo
 * ese tramo se queda sin nota de imagen. Devuelve los valorados con la nota aplicada y cuántos se midieron.
 */
export async function measureUnseen(ffmpeg: string, file: string, judged: Judged[], o: { max?: number; signal?: () => void } = {}): Promise<{ judged: Judged[]; measured: number; dead: number }> {
  const todo = unseen(judged).slice(0, o.max ?? 60);
  const found = [];
  for (const c of todo) {
    o.signal?.();
    const seg = c.judgement.trim ?? c;
    try {
      const raw = await measureMotion(ffmpeg, file, seg.start, seg.end);
      found.push(motionVerdict(c.id, parseMotion(raw, seg.end - seg.start)));
    } catch {
      /* sin medida de este tramo */
    }
  }
  return { judged: applyVisual(judged, found), measured: found.length, dead: found.filter((v) => v.dead).length };
}

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { motionVerdict, parseMotion } from '../shared/motion';
import { measureMotion } from '../electron/services/motionMeasure';

describe('imagen medida sin modelo', () => {
  it('lee los cambios de escena y el tiempo congelado de la salida de ffmpeg', () => {
    const err = '[Parsed_showinfo_3 @ x] n: 0 pts_time:1.5\n[Parsed_showinfo_3 @ x] n: 1 pts_time:4\n[freezedetect @ x] lavfi.freezedetect.freeze_start: 2\n[freezedetect @ x] lavfi.freezedetect.freeze_duration: 6\n[freezedetect @ x] lavfi.freezedetect.freeze_end: 8\n[freezedetect @ x] lavfi.freezedetect.freeze_start: 18';
    const m = parseMotion(err, 20);
    assert.equal(m.changes, 2);
    assert.equal(m.frozenSec, 8, 'un tramo cerrado de 6 s y otro abierto desde el 18 hasta los 20 s');
  });
  it('una imagen casi quieta es muerta; con acción sube un poco; la nota nunca pasa de 6,5', () => {
    assert.equal(motionVerdict('a', { durationSec: 30, changes: 0, frozenSec: 28 }).dead, true);
    const act = motionVerdict('b', { durationSec: 30, changes: 20, frozenSec: 0 });
    assert.equal(act.dead, false);
    assert.ok(act.visual > 5 && act.visual <= 6.5);
    assert.ok(motionVerdict('c', { durationSec: 30, changes: 0, frozenSec: 20 }).visual < 5);
  });
  it('con ffmpeg real: un vídeo parado sale congelado y uno con cambios no', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-motion-'));
    try {
      const still = path.join(dir, 'still.mp4');
      const busy = path.join(dir, 'busy.mp4');
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=10:d=12', '-pix_fmt', 'yuv420p', still]);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=10:d=12', '-pix_fmt', 'yuv420p', busy]);
      const a = parseMotion(await measureMotion('ffmpeg', still, 0, 12), 12);
      const b = parseMotion(await measureMotion('ffmpeg', busy, 0, 12), 12);
      assert.ok(a.frozenSec >= 8, JSON.stringify(a));
      assert.ok(b.frozenSec < 2, JSON.stringify(b));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { probe } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');

describe('probe: archivos de solo audio (los clips del canal se valoran con un .wav)', () => {
  let root: string;
  let wav: string;
  before(() => {
    root = tmpDir();
    wav = path.join(root, 'a.wav');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-ar', '16000', '-ac', '1', wav]);
  });
  after(() => rmDir(root));

  it('con audioOnly mide la duración sin exigir imagen', async () => {
    const info = await probe(tools, wav, { audioOnly: true });
    assert.ok(Math.abs(info.durationSec - 3) < 0.2);
    assert.equal(info.hasAudio, true);
  });

  it('sin audioOnly sigue rechazando un archivo sin vídeo', async () => {
    await assert.rejects(() => probe(tools, wav), /no contiene vídeo/);
  });
});

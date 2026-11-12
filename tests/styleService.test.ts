import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StyleService } from '../electron/domain/style';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const file = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-style-'));
  dirs.push(d);
  return path.join(d, 'sub', 'style-profile.json');
};

describe('servicio del perfil de estilo', () => {
  it('sin archivo devuelve los valores de la entrevista y lo cambiado persiste', () => {
    const f = file();
    const a = new StyleService(f);
    assert.equal(a.get().silenceMaxSec, 2);
    a.set({ silenceMaxSec: 1.5, titleStyle: 'sobrio' });
    a.addLore('El pollo', 'chiste', ['pollo']);
    const b = new StyleService(f);
    assert.equal(b.get().silenceMaxSec, 1.5);
    assert.equal(b.get().titleStyle, 'sobrio');
    assert.equal(b.get().lore[0].name, 'El pollo');
    b.removeLore(b.get().lore[0].id);
    assert.equal(new StyleService(f).get().lore.length, 0);
    assert.equal(b.reset().silenceMaxSec, 2);
  });

  it('un archivo estropeado no rompe nada', () => {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '{no es json');
    assert.equal(new StyleService(f).get().shortShotMaxSec, 3);
  });
});

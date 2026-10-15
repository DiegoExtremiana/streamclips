import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../../src');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(e.name) ? [p] : [];
  });
}

describe('reglas de la interfaz', () => {
  it('no hay emoticonos ni pictogramas en el código de la interfaz (solo iconos SVG)', () => {
    // emoticonos, flechas, símbolos varios, dingbats y signos de ancho completo usados como adorno
    const forbidden = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FF0B}\u{22EF}]/u;
    const offenders: string[] = [];
    for (const f of files(SRC)) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (forbidden.test(line)) offenders.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim().slice(0, 80)}`);
      });
    }
    assert.deepEqual(offenders, []);
  });
});

// Empaqueta el motor nocturno en un único archivo (resources/cloud/engine.js) que el programa instala en tu repositorio público de GitHub.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(root, 'resources/cloud/engine.js');
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [path.join(root, 'electron/engine/main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: false,
  legalComments: 'none',
  banner: { js: '// Generado por StreamClips. No lo edites: se vuelve a escribir.' },
});
console.log(`Motor nocturno: ${outfile} (${Math.round(fs.statSync(outfile).size / 1024)} KB)`);

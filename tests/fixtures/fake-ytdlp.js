#!/usr/bin/env node
// yt-dlp simulado para las pruebas. Se controla con variables de entorno:
//   FAKE_SOURCE  mp4 que se "descarga" (se copia)
//   FAKE_MODE    ok | fail | nofile | nometa
//   FAKE_ID      id que devuelve en los metadatos (por defecto abc123)
//   FAKE_LOG     archivo donde se anota, en JSON, cada ejecución (argv)
//   FAKE_DELAY   milisegundos entre líneas de progreso (por defecto 5)
const fs = require('node:fs');

const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE || 'ok';
const id = process.env.FAKE_ID || 'abc123';
const delay = Number(process.env.FAKE_DELAY || 5);

if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args) + '\n');

if (args[0] === '--version') {
  console.log('2026.01.01-fake');
  process.exit(0);
}

// Contrato: la URL siempre va detrás de "--", como último argumento.
const dd = args.lastIndexOf('--');
if (dd === -1 || dd !== args.length - 2) {
  console.error('ERROR: la URL debe ir tras "--" y ser el último argumento');
  process.exit(2);
}

if (args.includes('-g')) {
  if (mode === 'nometa') process.exit(0);
  console.log(process.env.FAKE_STREAM || 'https://clips.example.test/clip.mp4');
  process.exit(0);
}

if (args.includes('--print')) {
  if (mode === 'nometa') process.exit(0);
  console.log(`${id}\tTítulo del VOD`);
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const o = args[args.indexOf('-o') + 1];
  for (const pct of [3.2, 25.0, 50.5, 75.0, 99.9, 100]) {
    console.log(`[download]  ${pct.toFixed(1)}% of ~ 1.00GiB at 10.00MiB/s ETA 00:10`);
    await sleep(delay);
  }
  if (mode === 'fail') {
    console.error('ERROR: Unable to download webpage: HTTP Error 403: Forbidden');
    process.exit(1);
  }
  if (mode !== 'nofile') {
    fs.copyFileSync(process.env.FAKE_SOURCE, o.replace('%(ext)s', 'mp4'));
  }
  process.exit(0);
})();

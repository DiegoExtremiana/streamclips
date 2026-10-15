// Prueba de la aplicación REAL: abre Electron (en Linux, bajo Xvfb), maneja la interfaz como un usuario
// y comprueba el resultado en pantalla y en disco. Ejecutar con:  xvfb-run -a node tests/e2e/gui-smoke.mjs
// Requiere: npm run build, ffmpeg en el PATH y playwright-core.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// E2E_PACKAGED=<ruta al ejecutable empaquetado> prueba el paquete final en lugar del código fuente.
const packaged = process.env.E2E_PACKAGED;
const electronBin = packaged ?? path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const fakeYtdlp = path.join(root, 'tests', 'fixtures', 'fake-ytdlp.js');
fs.chmodSync(fakeYtdlp, 0o755);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'));
const userData = path.join(work, 'userData');
const outDir = path.join(work, 'salida');
const shots = path.join(root, 'tests', 'e2e', 'out');
fs.mkdirSync(shots, { recursive: true });

// vídeo de origen que "descargará" el yt-dlp simulado
const source = path.join(work, 'directo.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=14',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=14', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);

const launchArgs = ['--no-sandbox', `--user-data-dir=${userData}`, ...(packaged ? [] : ['.'])];
const launchEnv = { ...process.env, FAKE_SOURCE: source, FAKE_DELAY: '5', FAKE_ID: 'e2e1', ELECTRON_ENABLE_LOGGING: '0' };

let step = 0;
const log = (m) => console.log(`  ✔ ${String(++step).padStart(2, '0')} ${m}`);

async function launch() {
  const app = await electron.launch({ executablePath: electronBin, args: launchArgs, cwd: root, env: launchEnv });
  const page = await app.firstWindow();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(`CSP: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, problems };
}

/** Espera a que se cumpla una condición sobre el disco (la interfaz guarda de forma asíncrona). */
async function poll(fn, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (fn()) return;
    } catch {
      /* aún no */
    }
    if (Date.now() > end) throw new Error(`condición no cumplida: ${fn}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const tab = (page, name) => page.getByRole('tab', { name }).click();
const alertText = async (page) => (await page.getByRole('alert').first().innerText()).trim();
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

let app;
try {
  console.log('Prueba de la aplicación real (Electron + interfaz)');
  let page, problems;
  ({ app, page, problems } = await launch());

  // ── ventana y aislamiento ──
  await page.getByRole('tab', { name: 'Programación' }).waitFor({ timeout: 20000 });
  assert.equal(await page.title(), 'StreamClips');
  log('la ventana abre y carga la interfaz (con la política de seguridad de producción)');
  assert.equal(await page.evaluate(() => typeof window.api), 'object');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
  log('el puente seguro (window.api) funciona y la página no tiene acceso a Node');

  // ── las cuatro pestañas ──
  for (const [name, heading] of [['Programación', 'Tu canal'], ['Clips y publicación', 'Crear clips'], ['Conexiones', 'Twitch'], ['Ajustes', 'Carpeta de salida']]) {
    await tab(page, name);
    await page.getByRole('heading', { name: heading, exact: true }).waitFor();
  }
  await tab(page, 'Biblioteca');
  await page.getByRole('tab', { name: 'Vídeos', exact: true }).waitFor();
  log('las cinco pestañas se muestran');

  // ── Programación: guía de inicio y teclado ──
  await tab(page, 'Programación');
  const guide = page.getByRole('region', { name: 'Primeros pasos' });
  await guide.waitFor();
  await guide.getByText('Descarga el modelo de Whisper').waitFor();
  await guide.getByRole('button', { name: 'Ir a Ajustes' }).click();
  await page.getByRole('heading', { name: 'Carpeta de salida', exact: true }).waitFor();
  await page.keyboard.press('Control+1');
  await page.getByRole('heading', { name: 'Próximas subidas', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Programación' }).getAttribute('aria-selected'), 'true');
  log('Programación: la guía de primeros pasos muestra lo que falta y lleva a Ajustes; Ctrl+1 vuelve a la primera pestaña');

  // ── Ajustes ──
  await tab(page, 'Ajustes');
  const outInput = page.getByLabel('Carpeta de salida');
  await outInput.fill('relativa/ruta');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  let msg = await alertText(page);
  assert.match(msg, /ruta absoluta/);
  assert.doesNotMatch(msg, /Error invoking/);
  log('una carpeta no válida muestra un error limpio, sin prefijos técnicos');

  await outInput.fill(outDir);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Guardado.').waitFor();
  assert.ok(fs.statSync(outDir).isDirectory());
  log('la carpeta de salida válida se guarda y se crea en disco');

  await page.locator('#ytdlp-path').fill(`"${fakeYtdlp}"`); // con comillas, como "Copiar como ruta"
  await page.getByRole('button', { name: 'Guardar y comprobar' }).click();
  await page.getByText('2026.01.01-fake').waitFor();
  assert.ok((await page.getByText('OK', { exact: true }).count()) >= 3);
  await shot(page, '1-ajustes');
  log('comprobación de herramientas: ffmpeg, ffprobe y yt-dlp detectados');

  await page.locator('#whisper-path').fill('whisper.exe');
  await page.getByRole('button', { name: 'Guardar transcripción' }).click();
  assert.match(await alertText(page), /ruta de whisper debe ser absoluta/);
  await page.locator('#whisper-path').fill('');
  await page.locator('#whisper-model').selectOption('tiny');
  await page.locator('#whisper-lang').fill('es');
  await page.getByRole('button', { name: 'Guardar transcripción' }).click();
  await poll(() => JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).settings.whisperModel === 'tiny');
  const wset = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).settings;
  assert.deepEqual([wset.whisperModel, wset.whisperLanguage, wset.whisperPath], ['tiny', 'es', '']);
  log('Ajustes: Whisper se valida (ruta absoluta) y el modelo y el idioma se guardan');

  // ── Conexiones ──
  await tab(page, 'Conexiones');
  await page.locator('#tw-login').fill('no válido!');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.match(await alertText(page), /nombre de canal no es válido/);
  await page.locator('#tw-login').fill('@Don_Diegons');
  await page.locator('#tw-id').fill('mi-client-id');
  await page.locator('#tw-secret').fill('mi-secreto-x');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Guardado.').waitFor();
  assert.equal(await page.locator('#tw-login').inputValue(), 'don_diegons');
  assert.equal(await page.locator('#tw-secret').inputValue(), '********');
  const dataJson = fs.readFileSync(path.join(userData, 'data.json'), 'utf8');
  assert.ok(!dataJson.includes('mi-secreto-x'), 'el secreto no debe estar en claro en el disco');
  await shot(page, '2-conexiones');
  log('Twitch: el canal se normaliza, el secreto se enmascara y no queda en claro en disco');

  // ── Programación: URL inválida y descarga (en «Directos recogidos y actividad») ──
  await tab(page, 'Programación');
  await page.getByText('Directos recogidos y actividad').click();
  await page.getByText('Añadir un VOD a mano').click();
  await page.getByLabel('URL del VOD').fill('--exec rm -rf /');
  await page.getByRole('button', { name: 'Descargar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /URL no es válida/ }).waitFor();
  log('una URL peligrosa se rechaza con un mensaje claro');

  await page.getByLabel('URL del VOD').fill('https://www.twitch.tv/videos/123456789');
  await page.getByRole('button', { name: 'Descargar', exact: true }).click();
  await page.getByText('Descargado', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText('Título del VOD').waitFor();
  assert.ok(fs.existsSync(path.join(outDir, 'vods', 'e2e1.mp4')));
  await shot(page, '3-panel');
  log('el VOD se descarga por URL (yt-dlp simulado) y aparece como descargado');

  // ── Clips ──
  await tab(page, 'Clips y publicación');
  await page.getByLabel('Inicio', { exact: true }).fill('abc');
  await page.getByLabel('Fin', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Crear clip' }).click();
  await page.getByRole('alert').filter({ hasText: /Escribe inicio y fin/ }).waitFor();
  await page.getByLabel('Inicio', { exact: true }).fill('5');
  await page.getByRole('button', { name: 'Crear clip' }).click();
  await page.getByText(/Clip no válido: el fin debe ser posterior/).waitFor();
  log('tiempos mal escritos o incoherentes se explican sin romper nada');

  await page.getByLabel('Inicio', { exact: true }).fill('1');
  await page.getByLabel('Fin', { exact: true }).fill('4');
  await page.locator('#clip-title').fill('Mi clip vertical');
  await page.getByRole('button', { name: 'Crear clip' }).click();
  await page.getByText('Clip creado y validado.').first().waitFor({ timeout: 60000 });
  await page.getByText('Mi clip vertical', { exact: true }).waitFor();
  const verticalDir = path.join(outDir, 'vertical');
  const made = fs.readdirSync(verticalDir);
  assert.equal(made.length, 1);
  const dims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(verticalDir, made[0])]).toString().trim();
  assert.equal(dims, '1080,1920');
  const horizontalDir = path.join(outDir, 'horizontal');
  assert.equal(fs.readdirSync(horizontalDir).length, 1, 'un clip genera también su versión horizontal');
  const hdims = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path.join(horizontalDir, fs.readdirSync(horizontalDir)[0])]).toString().trim();
  assert.equal(hdims, '1920,1080');
  log('un clip creado desde la interfaz genera sus dos versiones: 1080×1920 y 1920×1080 verificadas con ffprobe');

  await page.getByText('Avanzado: transcripción y plan de edición de Claude').click();
  const plan = JSON.stringify({
    clips: [{ kind: 'horizontal', start: 2, end: 6, title: 'Clip horizontal', cuts: [{ start: 3, end: 3.5 }], effects: [{ type: 'punch', at: 2.5 }, { type: 'fadeOut' }] }, { kind: 'vertical', start: 50, end: 60, title: 'Fuera' }],
    long: { title: 'Resumen largo', segments: [{ start: 0, end: 3 }, { start: 6, end: 9 }] },
  });
  await page.getByLabel('Plan de edición').fill(plan);
  await page.getByRole('button', { name: 'Aplicar plan' }).click();
  await page.getByText(/2 vídeo\(s\) creados y validados/).first().waitFor({ timeout: 90000 });
  await page.getByText(/clip 2: acaba después del final del VOD/).waitFor();
  await page.getByText('Resumen largo', { exact: true }).waitFor();
  const dimsOf = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim();
  assert.equal(dimsOf(path.join(outDir, 'horizontal', fs.readdirSync(path.join(outDir, 'horizontal'))[0])), '1920,1080');
  assert.equal(dimsOf(path.join(outDir, 'long', fs.readdirSync(path.join(outDir, 'long'))[0])), '1920,1080');
  await shot(page, '4-clips');
  const fromPlan = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).outputs.find((o) => o.title === 'Clip horizontal');
  assert.deepEqual(fromPlan.cuts, [{ start: 3, end: 3.5 }]);
  assert.deepEqual(fromPlan.effects.map((e) => e.type), ['punch', 'fadeOut']);
  assert.ok(Math.abs(fromPlan.durationSec - 3.5) < 0.6, `duración tras el corte: ${fromPlan.durationSec}`);
  log('plan JSON con cortes y animaciones: el clip dura lo que queda tras el corte y guarda cortes y efectos');
  log('plan JSON: horizontal y largo creados (1920×1080), el clip fuera del VOD se descarta con aviso');

  // ── transcripción (Clips) ──
  const transcriptFile = path.join(work, 'transcripcion.json');
  fs.writeFileSync(transcriptFile, JSON.stringify({ words: [
    { text: 'Hola', start: 1.2, end: 1.6 }, { text: 'a', start: 1.6, end: 1.7 }, { text: 'todos.', start: 1.7, end: 2.2 },
    { text: 'esto', start: 3.0, end: 3.3 }, { text: 'es', start: 3.3, end: 3.5 }, { text: 'increíble', start: 3.5, end: 4.0 },
  ] }));
  assert.match(await page.getByTestId('transcript-status').innerText(), /aún no tiene transcripción/);
  assert.equal(await page.getByRole('button', { name: 'Copiar petición para Claude' }).isDisabled(), true);
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, transcriptFile);
  await page.getByRole('button', { name: 'Importar transcripción…' }).click();
  await page.getByText('Transcripción importada (6 palabras).').waitFor();
  assert.match(await page.getByTestId('transcript-status').innerText(), /6 palabras \(importada\)/);
  const savedVod = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).vods[0];
  assert.equal(savedVod.transcript.words, 6);
  assert.ok(fs.readdirSync(path.join(userData, 'transcripts')).length === 1);
  await page.getByRole('button', { name: 'Copiar petición para Claude' }).click();
  await page.getByText(/Petición copiada/).waitFor();
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  assert.match(copied, /editor de vídeo profesional/);
  assert.match(copied, /\[00:01\] Hola a todos\./);
  assert.match(copied, /"cuts"/);
  log('transcripción: se importa desde un archivo, se guarda en disco y «Copiar petición para Claude» deja en el portapapeles instrucciones + transcripción con tiempos');

  await page.getByLabel('Plan de edición').fill('{"clips":[{"start":1,"end":4,"title":"x","subtitles":"inventado"}]}');
  await page.getByRole('button', { name: 'Aplicar plan' }).click();
  await page.getByText(/el estilo de subtítulos no existe/).waitFor();
  await page.getByLabel('Plan de edición').fill('');
  log('un plan con un estilo de subtítulos inventado se rechaza con un aviso');

  // ── Programación (ventana «Añadir subida») ──
  const localDayKeyOf = (iso) => toLocal(new Date(iso)).slice(0, 10);
  const dataNow = () => JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8'));
  const toLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const inDays = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return toLocal(d); };
  const sched = page.getByRole('dialog', { name: 'Añadir subida' });

  await page.getByRole('button', { name: 'Programar subida de Mi clip vertical' }).click();
  await sched.waitFor();
  await sched.getByLabel('YouTube').check();
  await sched.getByLabel('TikTok').check();
  await sched.getByLabel('Fecha y hora').fill(inDays(2, 16));
  await sched.getByRole('button', { name: 'Programar', exact: true }).click();
  await page.getByText(/Subida programada: «Mi clip vertical» \(2 redes\)/).waitFor();
  await poll(() => dataNow().publications.filter((p) => p.status === 'scheduled').length === 2);
  log('«Añadir subida»: programar un clip en dos redes crea dos publicaciones pendientes y avisa con un mensaje');

  await page.getByRole('button', { name: 'Programar subida de Mi clip vertical' }).click();
  await sched.waitFor();
  await sched.getByLabel('YouTube').check();
  await sched.getByLabel('Fecha y hora').fill(inDays(2, 18));
  await sched.getByRole('button', { name: 'Programar', exact: true }).click();
  await poll(() => dataNow().publications.find((p) => p.platform === 'youtube' && p.outputId === dataNow().outputs.find((o) => o.title === 'Mi clip vertical').id).scheduledAt.includes(new Date(inDays(2, 18)).toISOString().slice(11, 16)));
  assert.equal(dataNow().publications.length, 2, 'reprogramar no duplica');
  log('reprogramar una subida no la duplica');

  await page.getByRole('button', { name: 'Programar subida de Mi clip vertical' }).click();
  await sched.waitFor();
  await sched.getByLabel('Instagram').check();
  await sched.getByLabel('Fecha y hora').fill('2020-01-01T10:00');
  await sched.getByRole('button', { name: 'Programar', exact: true }).click();
  await sched.getByText(/ya ha pasado/).waitFor();
  await sched.getByRole('button', { name: 'Cancelar' }).click();
  log('una hora pasada se rechaza dentro de la ventana, sin cerrarla');

  // varias subidas el mismo día: otro clip, mismo día y casi a la misma hora que TikTok (16:00) → se permite y avisa
  await page.getByRole('button', { name: 'Programar subida de Clip horizontal' }).click();
  await sched.waitFor();
  await sched.getByLabel('TikTok').check();
  await sched.getByLabel('Fecha y hora').fill(inDays(2, 16, 10));
  await sched.getByText(/Ese día|ya hay 2 subida/).first().waitFor();
  await shot(page, '13-anadir-subida');
  await sched.getByRole('button', { name: 'Programar', exact: true }).click();
  await page.getByText(/Ya hay otra subida a TikTok a las 16:00/).waitFor();
  await poll(() => dataNow().publications.length === 3);
  log('varias subidas el mismo día: se permiten todas las que quieras y se avisa si dos van muy juntas en la misma red');
  await shot(page, '5-programado');


  // ── Biblioteca ──
  await tab(page, 'Biblioteca');
  await page.getByTestId('item-Mi clip vertical').waitFor();
  assert.equal(await page.getByTestId('library-grid').locator('.tile.item').count(), 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.tile.item img')].every((i) => i.complete && i.naturalWidth > 0));
  await shot(page, '6-biblioteca');
  log('Biblioteca: la sección Clips muestra una cuadrícula con las miniaturas cargadas desde el disco');

  await page.getByRole('tab', { name: 'Vídeos' }).click();
  await page.getByTestId('item-Resumen largo').waitFor();
  assert.equal(await page.getByTestId('library-grid').locator('.tile.item').count(), 1);
  log('Biblioteca: la sección Vídeos muestra solo el vídeo largo');

  // vídeo largo: reproductor y miniatura desde el fotograma actual
  await page.getByTestId('item-Resumen largo').click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  const player = dlg.getByTestId('player-Reproductor');
  await page.waitForFunction(() => document.querySelector('[data-testid="player-Reproductor"]').readyState >= 1);
  const dur = await player.evaluate((v) => v.duration);
  assert.ok(Math.abs(dur - 6) < 1, `duración del reproductor ${dur}`);
  await player.evaluate((v) => new Promise((res) => { v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = 4; }));
  const dbg = await player.evaluate((v) => ({ t: v.currentTime, seekable: v.seekable.length ? [v.seekable.start(0), v.seekable.end(0)] : null, err: v.error && v.error.message, rs: v.readyState }));
  assert.ok(Math.abs(dbg.t - 4) < 0.3, JSON.stringify(dbg));
  log('el reproductor carga el vídeo local, conoce su duración y permite saltar a otro punto');

  await dlg.getByRole('button', { name: 'Reproducir' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="player-Reproductor"]').paused);
  await dlg.getByRole('button', { name: 'Pausa' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="player-Reproductor"]').paused);
  await dlg.getByRole('button', { name: 'Volver al inicio' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="player-Reproductor"]').currentTime < 1);
  await dlg.getByRole('button', { name: 'Pausa' }).click();
  await dlg.getByRole('button', { name: 'Silenciar' }).click();
  await dlg.getByRole('button', { name: 'Activar sonido' }).waitFor();
  log('controles propios con iconos: reproducir, pausa, volver al inicio y silenciar actúan sobre el vídeo');
  await player.evaluate((v) => new Promise((res) => { v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = 4; }));

  const thumbBefore = await dlg.getByAltText('Miniatura actual').getAttribute('src');
  await dlg.getByRole('button', { name: 'Usar el fotograma actual del vídeo' }).click();
  await dlg.getByText(/Miniatura actualizada/).waitFor();
  await page.waitForFunction((b) => document.querySelector('img[alt="Miniatura actual"]').getAttribute('src') !== b, thumbBefore);
  const thumbs = fs.readdirSync(path.join(outDir, 'miniaturas'));
  assert.equal(thumbs.length, 3, 'una miniatura por vídeo: la sustituida se borra');
  const sizes = thumbs.map((f) => dimsOf(path.join(outDir, 'miniaturas', f)));
  assert.ok(sizes.includes('1280,720'), `miniaturas: ${sizes}`);
  await shot(page, '7-modal-largo');
  log('vídeo largo: «usar el fotograma actual» crea una miniatura 1280×720 y borra la anterior');

  assert.equal(await dlg.getByRole('radio', { name: /Privado/ }).isChecked(), true, 'por defecto privado');
  await dlg.locator('#yt-title').fill('Resumen <malo>');
  await dlg.getByRole('button', { name: 'Guardar datos' }).click();
  await dlg.getByText(/no puede contener < ni >/).first().waitFor();
  await dlg.locator('#yt-title').fill('Resumen renombrado');
  await dlg.locator('#yt-desc').fill('Lo mejor del directo.\nSuscríbete.');
  await dlg.locator('#yt-playlist').fill('Road to Master');
  await dlg.getByRole('radio', { name: /Público/ }).check();
  await dlg.getByRole('button', { name: 'Guardar datos' }).click();
  await dlg.getByText('Datos guardados.').waitFor();
  const saved = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).outputs.find((o) => o.kind === 'long');
  assert.deepEqual([saved.title, saved.description, saved.playlist, saved.visibility], ['Resumen renombrado', 'Lo mejor del directo.\nSuscríbete.', 'Road to Master', 'public']);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByTestId('item-Resumen renombrado').waitFor();
  log('vídeo largo: nombre, descripción, lista y visibilidad se validan, se guardan y se ven en la cuadrícula');

  // clip: dos versiones, descarga, encuadre y programación
  await page.getByRole('tab', { name: 'Clips', exact: true }).click();
  await page.getByTestId('item-Mi clip vertical').click();
  await dlg.waitFor();
  await dlg.getByTestId('version-vertical').waitFor();
  await dlg.getByTestId('version-horizontal').waitFor();
  for (const v of ['vertical', 'horizontal']) {
    await page.waitForFunction((n) => document.querySelector(`[data-testid="player-Reproductor ${n}"]`).readyState >= 1, v);
    const d = await dlg.getByTestId(`player-Reproductor ${v}`).evaluate((e) => [e.videoWidth, e.videoHeight, Math.round(e.duration)]);
    assert.deepEqual(d, v === 'vertical' ? [1080, 1920, 3] : [1920, 1080, 3]);
  }
  await shot(page, '8a-modal-clip-dos-versiones');
  log('la ventana de un clip muestra las dos versiones a la vez y cada reproductor carga su vídeo (1080×1920 y 1920×1080)');

  // descargar con el botón de cada versión (el cuadro de guardado del sistema se sustituye por una ruta fija)
  const saveVertical = path.join(work, 'descarga-vertical.mp4');
  await app.evaluate(({ dialog }, dest) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest }); }, saveVertical);
  await dlg.getByRole('button', { name: 'Descargar versión vertical' }).click();
  await dlg.getByText(/Guardado en/).waitFor();
  assert.equal(dimsOf(saveVertical), '1080,1920');
  log('«Descargar» en la versión vertical guarda una copia 1080×1920 donde elige el usuario');

  await dlg.getByRole('button', { name: 'Ver sobre el fotograma' }).click();
  const framing = dlg.getByTestId('framing');
  await framing.locator('img').waitFor();
  const crop = dlg.getByTestId('crop-window');
  const leftBefore = await crop.evaluate((e) => parseFloat(e.style.left));
  const box = await framing.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const leftAfter = await crop.evaluate((e) => parseFloat(e.style.left));
  assert.ok(leftAfter > leftBefore + 10, `el recuadro debe moverse a la derecha (${leftBefore} → ${leftAfter})`);
  await shot(page, '8-modal-encuadre');
  const oldVertical = fs.readdirSync(verticalDir);
  await dlg.getByRole('button', { name: 'Aplicar y renderizar de nuevo' }).click();
  await dlg.getByText('Clip renderizado de nuevo y validado.').waitFor({ timeout: 60000 });
  const newVertical = fs.readdirSync(verticalDir);
  assert.equal(newVertical.length, 1, 'el archivo anterior se borra');
  assert.notDeepEqual(newVertical, oldVertical);
  assert.equal(dimsOf(path.join(verticalDir, newVertical[0])), '1080,1920');
  assert.equal(fs.readdirSync(path.join(outDir, 'horizontal')).length, 2, 'la versión horizontal también se renderiza de nuevo, sin dejar archivos viejos');
  log('encuadre: arrastrar el recuadro y aplicar vuelve a renderizar (1080×1920) y sustituye el archivo');

  await dlg.getByTestId('pub-instagram').getByRole('checkbox').check();
  await dlg.getByLabel('Fecha y hora en Instagram').fill('2031-01-01T10:00');
  await dlg.getByRole('button', { name: 'Guardar programación' }).click();
  await dlg.getByText('Programación guardada.').waitFor();
  await dlg.getByTestId('pub-instagram').getByText('Programado').waitFor();
  await dlg.getByTestId('pub-instagram').getByRole('checkbox').uncheck();
  await dlg.getByRole('button', { name: 'Guardar programación' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid=pub-instagram] .badge'));
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  log('programación por red desde la ventana: programar Instagram a una hora y volver a quitarlo');

  // clip creado solo en horizontal: falta la vertical y se puede generar
  await page.getByTestId('item-Clip horizontal').click();
  await dlg.getByTestId('version-vertical').getByText('Esta versión no está disponible.').waitFor();
  await dlg.getByRole('button', { name: 'Generar versión vertical' }).click();
  await dlg.getByRole('button', { name: 'Descargar versión vertical' }).waitFor({ timeout: 60000 });
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 2);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  log('un clip con una sola versión ofrece «Generar versión vertical» y la crea validada');

  // subtítulos: desactivados por defecto, vista previa en vivo, estilos y render
  await page.getByTestId('item-Mi clip vertical').click();
  await dlg.waitFor();
  const sw = dlg.getByRole('switch', { name: 'Poner subtítulos' });
  assert.equal(await sw.isChecked(), false, 'los subtítulos deben estar desactivados por defecto');
  assert.equal(await dlg.getByTestId('caption-layer').count(), 0);
  assert.equal(await dlg.getByRole('radiogroup', { name: 'Estilo de subtítulos' }).count(), 0);
  await sw.check();
  await dlg.getByRole('radiogroup', { name: 'Estilo de subtítulos' }).waitFor();
  assert.equal(await dlg.getByTestId('style-clasico').getAttribute('aria-checked'), 'true');
  await dlg.getByTestId('caption-sample').waitFor();
  await dlg.getByTestId('caption-layer').first().waitFor();
  assert.equal(await dlg.getByTestId('caption-layer').count(), 2, 'la vista previa aparece sobre las dos versiones');
  const hp = dlg.getByTestId('player-Reproductor horizontal');
  const seekTo = (loc, t) => loc.evaluate((v, t2) => new Promise((res) => { v.addEventListener('seeked', () => res(), { once: true }); v.currentTime = t2; }), t);
  await seekTo(hp, 0.5);
  const capText = () => dlg.getByTestId('player-Reproductor horizontal').locator('xpath=..').getByTestId('caption-text').innerText();
  await page.waitForFunction(() => /Hola a todos/.test(document.querySelector('[data-testid=caption-layer] [data-testid=caption-text]')?.textContent ?? ''));
  assert.equal((await capText()).replace(/\s+/g, ' ').trim(), 'Hola a todos.');
  await seekTo(hp, 2.6);
  await page.waitForFunction(() => /esto es increíble/.test(document.querySelector('[data-testid=caption-layer] [data-testid=caption-text]')?.textContent ?? ''));
  await seekTo(hp, 1.8);
  await page.waitForFunction(() => !document.querySelector('[data-testid=caption-layer] [data-testid=caption-text]'));
  log('subtítulos: desactivados por defecto; al activarlos aparecen sobre las dos versiones y siguen al audio (la frase cambia y desaparece en los silencios)');

  await seekTo(hp, 0.5);
  const fontBefore = await dlg.getByTestId('caption-text').first().evaluate((e) => getComputedStyle(e).fontSize);
  await dlg.getByTestId('style-pop').click();
  assert.equal(await dlg.getByTestId('style-pop').getAttribute('aria-checked'), 'true');
  await page.waitForFunction(() => /^HOLA A\s*$/.test(document.querySelector('[data-testid=caption-layer] [data-testid=caption-text]')?.textContent?.trim() ?? ''));
  const fontAfter = await dlg.getByTestId('caption-text').first().evaluate((e) => getComputedStyle(e).fontSize);
  assert.ok(parseFloat(fontAfter) > parseFloat(fontBefore) * 1.4, `Impacto debe ser más grande (${fontBefore} → ${fontAfter})`);
  await dlg.getByTestId('style-karaoke').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=caption-layer] [data-active=true]'));
  await shot(page, '8b-subtitulos-vista-previa');
  log('cambiar de estilo cambia la vista previa al instante: Impacto (mayúsculas, grande), Karaoke (palabra activa resaltada)');

  const before = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).outputs.find((o) => o.title === 'Mi clip vertical');
  assert.equal(before.subtitles, undefined, 'previsualizar no cambia el clip');
  const filesBefore = JSON.stringify(before.files);
  await dlg.getByRole('button', { name: 'Aplicar subtítulos' }).click();
  await dlg.getByText('Subtítulos grabados en el vídeo.').waitFor({ timeout: 90000 });
  const burnedItem = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).outputs.find((o) => o.title === 'Mi clip vertical');
  assert.equal(burnedItem.subtitles, 'karaoke');
  assert.notEqual(JSON.stringify(burnedItem.files), filesBefore);
  assert.equal(dimsOf(burnedItem.files.vertical), '1080,1920');
  assert.equal(dimsOf(burnedItem.files.horizontal), '1920,1080');
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 2, 'sin archivos viejos');
  await dlg.getByText(/ya lleva los subtítulos «Karaoke» grabados/).waitFor();
  assert.equal(await dlg.getByTestId('caption-layer').count(), 0, 'ya grabados: no se superpone otra capa');
  await page.waitForFunction(() => document.querySelector('[data-testid="player-Reproductor horizontal"]').readyState >= 1);
  await shot(page, '8c-subtitulos-grabados');
  log('«Aplicar subtítulos» vuelve a renderizar las dos versiones con el texto grabado y deja de superponer la vista previa');

  await dlg.getByRole('switch', { name: 'Poner subtítulos' }).uncheck();
  await dlg.getByRole('button', { name: 'Quitar subtítulos' }).click();
  await dlg.getByText('Subtítulos quitados.').waitFor({ timeout: 90000 });
  const cleanItem = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).outputs.find((o) => o.title === 'Mi clip vertical');
  assert.equal(cleanItem.subtitles, undefined);
  assert.equal(await dlg.getByRole('switch', { name: 'Poner subtítulos' }).isChecked(), false);
  await dlg.getByRole('button', { name: 'Cerrar' }).click();
  log('desactivar y quitar los subtítulos deja el clip limpio otra vez');

  // clic derecho en la cuadrícula: descargar en horizontal o en vertical
  const saveH = path.join(work, 'descarga-horizontal.mp4');
  await app.evaluate(({ dialog }, dest) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest }); }, saveH);
  await page.getByTestId('item-Mi clip vertical').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Descargar en horizontal' }).click();
  await page.getByText(/Guardado en/).waitFor();
  assert.equal(dimsOf(saveH), '1920,1080');
  const saveV2 = path.join(work, 'descarga-vertical-2.mp4');
  await app.evaluate(({ dialog }, dest) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: dest }); }, saveV2);
  await page.getByTestId('item-Mi clip vertical').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Descargar en vertical' }).click();
  await page.waitForTimeout(800);
  assert.equal(dimsOf(saveV2), '1080,1920');
  log('clic derecho sobre un clip: «Descargar en horizontal» y «Descargar en vertical» guardan cada versión');

  // todas las fichas de la cuadrícula miden lo mismo
  const tileSizes = await page.locator('.tile.item').evaluateAll((els) => els.map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  assert.equal(new Set(tileSizes).size, 1, `fichas con medidas distintas: ${tileSizes}`);
  log('todas las fichas de clips tienen exactamente la misma medida');

  // carpetas: crear, mover con menú, con arrastre, anidar, borrar
  await page.getByRole('button', { name: 'Nueva carpeta', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Pokémon');
  await page.getByRole('button', { name: 'Crear' }).click();
  await page.getByTestId('group-Pokémon').waitFor();
  await page.getByRole('button', { name: 'Nueva carpeta', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('pokémon');
  await page.getByRole('button', { name: 'Crear' }).click();
  await page.getByText(/Ya hay una carpeta llamada/).waitFor();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  log('carpetas: se crea una por tema y un nombre repetido se rechaza');

  await page.getByTestId('item-Mi clip vertical').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover a carpeta…' }).click();
  await page.getByRole('option', { name: /Pokémon/ }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Mi clip vertical"]'));
  assert.equal(await page.getByTestId('library-grid').locator('.tile.item').count(), 1);
  log('clic derecho → «Mover a carpeta…» saca el clip de la raíz');

  await page.getByTestId('group-Pokémon').click();
  await page.getByTestId('item-Mi clip vertical').waitFor();
  await page.getByRole('button', { name: 'Nueva carpeta', exact: true }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Road to Master');
  await page.getByRole('radio', { name: /Serie/ }).check();
  await page.getByRole('button', { name: 'Crear' }).click();
  await page.getByTestId('group-Road to Master').waitFor();
  await page.getByTestId('item-Mi clip vertical').dragTo(page.getByTestId('group-Road to Master'));
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Mi clip vertical"]'));
  await page.getByTestId('group-Road to Master').click();
  await page.getByTestId('item-Mi clip vertical').waitFor();
  await shot(page, '9-carpetas');
  log('carpeta dentro de carpeta (Tema → Serie) y arrastrar un clip a ella funciona');

  await page.getByRole('navigation', { name: 'Ruta de carpetas' }).getByRole('button', { name: /Clips/ }).first().waitFor();
  await page.getByTestId('item-Mi clip vertical').dragTo(page.getByRole('navigation', { name: 'Ruta de carpetas' }).getByRole('button', { name: /Clips/ }).first());
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Mi clip vertical"]'));
  await page.getByRole('navigation', { name: 'Ruta de carpetas' }).getByRole('button', { name: /Clips/ }).first().click();
  await page.getByTestId('item-Mi clip vertical').waitFor();
  log('arrastrar un clip a la ruta de carpetas lo devuelve a la raíz');

  await page.getByTestId('item-Clip horizontal').dragTo(page.getByTestId('item-Mi clip vertical'));
  await page.getByRole('heading', { name: 'Nueva carpeta con 2 vídeo(s)' }).waitFor();
  await page.getByLabel('Nombre', { exact: true }).fill('Directos');
  await page.getByRole('button', { name: 'Crear' }).click();
  await page.waitForFunction(() => !document.querySelector('.tile.item'));
  await page.getByTestId('group-Directos').click();
  assert.equal(await page.getByTestId('library-grid').locator('.tile.item').count(), 2);
  log('arrastrar un clip sobre otro crea una carpeta con los dos');

  await page.getByRole('navigation', { name: 'Ruta de carpetas' }).getByRole('button', { name: /Clips/ }).first().click();
  await page.getByTestId('group-Directos').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Eliminar carpeta/ }).click();
  await page.getByRole('button', { name: 'Eliminar carpeta', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="group-Directos"]'));
  assert.equal(await page.getByTestId('library-grid').locator('.tile.item').count(), 2);
  log('eliminar una carpeta no borra nada: sus clips vuelven a la raíz');

  assert.equal(fs.readdirSync(path.join(outDir, 'horizontal')).length, 2);
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 2);
  assert.equal(fs.readdirSync(path.join(outDir, 'long')).length, 1);
  const groupsOnDisk = JSON.parse(fs.readFileSync(path.join(userData, 'data.json'), 'utf8')).groups.map((g) => g.name).sort();
  assert.deepEqual(groupsOnDisk, ['Pokémon', 'Road to Master']);
  log('en disco siguen todos los vídeos y las carpetas restantes están guardadas');

  // ── Eliminar clips y vídeos desde la Biblioteca ──
  await tab(page, 'Clips y publicación');
  for (const t of ['Borrar A', 'Borrar B', 'Borrar C', 'Borrar D', 'Borrar E']) {
    await page.getByLabel('Inicio', { exact: true }).fill('1');
    await page.getByLabel('Fin', { exact: true }).fill('3');
    await page.locator('#clip-title').fill(t);
    await page.getByRole('button', { name: 'Crear clip' }).click();
    await page.getByLabel(`Programar subida de ${t}`).waitFor({ timeout: 60000 });
  }
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 7);
  const vodFile = path.join(outDir, 'vods', 'e2e1.mp4');

  await tab(page, 'Biblioteca');
  const grid = page.getByTestId('library-grid');
  const titlesOnDisk = () => dataNow().outputs.map((o) => o.title);
  // A: botón de la papelera de la ficha (con una subida programada que debe cancelarse)
  await page.getByTestId('item-Borrar A').hover();
  await page.getByRole('button', { name: 'Programar subida de Borrar A' }).click();
  await sched.waitFor();
  await sched.getByLabel('YouTube').check();
  await sched.getByLabel('Fecha y hora').fill(inDays(3, 9));
  await sched.getByRole('button', { name: 'Programar', exact: true }).click();
  await poll(() => dataNow().publications.some((p) => p.outputId === dataNow().outputs.find((o) => o.title === 'Borrar A').id));
  const idA = dataNow().outputs.find((o) => o.title === 'Borrar A').id;
  await page.getByTestId('item-Borrar A').hover();
  await page.getByRole('button', { name: 'Eliminar Borrar A' }).click();
  await shot(page, '12-confirmar-borrado');
  const del = page.getByRole('dialog', { name: 'Eliminar vídeo' });
  await del.getByText(/1 subida\(s\) programada\(s\) se cancelarán/).waitFor();
  await del.getByText(/El VOD de origen no se toca/).waitFor();
  await del.getByRole('button', { name: 'Cancelar' }).click();
  assert.ok(titlesOnDisk().includes('Borrar A'), 'cancelar no borra nada');
  await page.getByTestId('item-Borrar A').hover();
  await page.getByRole('button', { name: 'Eliminar Borrar A' }).click();
  await del.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Borrar A"]'));
  await page.getByText('Vídeo eliminado.').first().waitFor();
  assert.ok(!titlesOnDisk().includes('Borrar A'));
  assert.ok(!dataNow().publications.some((p) => p.outputId === idA), 'la subida programada se cancela');
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 6);
  log('eliminar desde la ficha: pide confirmación, explica lo que pasa, «Cancelar» no borra y «Eliminar» borra archivos y cancela su subida programada');

  // B: clic derecho → Eliminar…
  await page.getByTestId('item-Borrar B').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Eliminar…' }).click();
  await del.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Borrar B"]'));
  log('clic derecho → «Eliminar…» borra el clip');

  // C: desde la ventana del vídeo
  await page.getByTestId('item-Borrar C').click();
  const dlgDel = page.getByRole('dialog', { name: 'Borrar C' });
  await dlgDel.getByRole('button', { name: /Eliminar este vídeo/ }).click();
  await del.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="item-Borrar C"]'));
  log('desde la ventana del vídeo: «Eliminar este vídeo…» lo borra tras confirmar');

  // D y E: selección múltiple
  await page.getByRole('button', { name: 'Seleccionar', exact: true }).click();
  await page.getByTestId('item-Borrar D').click();
  await page.getByTestId('item-Borrar E').click();
  await page.getByText(/2.*seleccionado/).first().waitFor();
  assert.equal(await page.getByTestId('item-Borrar D').getAttribute('aria-pressed'), 'true');
  await shot(page, '11-biblioteca-seleccion');
  assert.equal(await page.getByRole('dialog').count(), 0, 'en modo selección un clic no abre el vídeo');
  await page.getByRole('region', { name: 'Selección' }).getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('dialog', { name: 'Eliminar 2 vídeos' }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByText('2 vídeos eliminados.').first().waitFor();
  assert.equal(await page.getByRole('region', { name: 'Selección' }).count(), 0, 'sale del modo selección');
  assert.equal(await grid.locator('.tile.item').count(), 2);
  log('selección múltiple: dos clips seleccionados se eliminan a la vez y la barra de selección se cierra');

  // tecla Supr sobre una ficha pide confirmación
  await page.getByTestId('item-Clip horizontal').focus();
  await page.keyboard.press('Delete');
  await page.getByRole('dialog', { name: 'Eliminar vídeo' }).getByRole('button', { name: 'Cancelar' }).click();
  assert.ok(titlesOnDisk().includes('Clip horizontal'));
  assert.deepEqual(titlesOnDisk().filter((t) => t.startsWith('Borrar')), []);
  assert.ok(fs.existsSync(vodFile), 'el VOD de origen se conserva');
  assert.equal(fs.readdirSync(path.join(outDir, 'vertical')).length, 2, 'solo quedan los dos clips anteriores');
  assert.equal(fs.readdirSync(path.join(outDir, 'horizontal')).length, 2);
  assert.equal(fs.readdirSync(path.join(outDir, 'miniaturas')).length, 3, 'las miniaturas de lo borrado también se van');
  log('la tecla Supr pide confirmación; en disco no queda rastro de lo borrado y el VOD de origen sigue intacto');

  // ── persistencia tras recargar y tras reiniciar ──
  await page.reload();
  await page.getByRole('tab', { name: 'Programación' }).waitFor();
  await page.getByText('Directos recogidos y actividad').click();
  await page.getByText('Título del VOD').waitFor();
  log('al recargar la ventana los datos siguen ahí');

  // ── una sola instancia ──
  const second = spawnSync(electronBin, launchArgs, { cwd: root, env: launchEnv, timeout: 20000 });
  assert.equal(second.error, undefined, 'la segunda instancia debería cerrarse sola (no quedarse abierta)');
  log('una segunda instancia se cierra sola (evita dobles publicaciones)');

  assert.deepEqual(problems, [], `errores en la consola:\n${problems.join('\n')}`);
  log('sin errores en la consola ni avisos de la política de seguridad');

  await app.close();
  ({ app, page, problems } = await launch());
  await page.getByText('Directos recogidos y actividad').click();
  await page.getByText('Título del VOD').waitFor();
  await tab(page, 'Biblioteca');
  await page.getByTestId('group-Pokémon').waitFor();
  await page.getByTestId('item-Mi clip vertical').waitFor();
  await tab(page, 'Clips y publicación');
  await page.getByText('Mi clip vertical', { exact: true }).waitFor();
  await page.getByText('Resumen renombrado', { exact: true }).waitFor();
  await tab(page, 'Programación');
  const progr = page.getByRole('region', { name: 'Próximas subidas' });
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toLocal(d).slice(0, 10); };
  await progr.getByTestId(`tl-row-${day(2)}`).waitFor();
  assert.ok((await progr.locator('.tl-chip').count()) >= 3, 'la línea de tiempo muestra las subidas programadas');
  await shot(page, '10-linea-de-tiempo');
  log('Programación: la línea de tiempo muestra una franja por día con las subidas en su hora');

  // ── arrastrar en la línea de tiempo ──
  const trackBox = async (n) => { const l = progr.locator(`[data-track-day="${day(n)}"]`); await l.scrollIntoViewIfNeeded(); return await l.boundingBox(); };
  const chip = (re) => progr.getByRole('button', { name: re });
  const dragChip = async (loc, toX, toY) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    const grab = 12;
    await page.mouse.move(b.x + grab, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + grab + 30, b.y + b.height / 2 + 4, { steps: 3 });
    await page.mouse.move(toX + grab, toY, { steps: 8 });
    return { release: () => page.mouse.up() };
  };
  const ytPub = () => dataNow().publications.find((p) => p.platform === 'youtube' && p.outputId === dataNow().outputs.find((o) => o.title === 'Mi clip vertical').id);
  const hhmmOf = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  // 1) cambiar la hora: del 18:00 al 20:00 del mismo día (arrastre horizontal)
  let tb = await trackBox(2);
  await page.locator(`[data-track-day="${day(2)}"]`).scrollIntoViewIfNeeded();
  tb = await trackBox(2);
  let h = await dragChip(chip(/Mi clip vertical, 18:00/), tb.x + tb.width * (20 / 24), tb.y + tb.height / 2);
  await page.locator('.tl-marker').getByText('20:00').waitFor();
  await h.release();
  await page.getByText(/«Mi clip vertical» movida a .* a las 20:00/).first().waitFor();
  await poll(() => hhmmOf(ytPub().scheduledAt) === '20:00');
  assert.equal(localDayKeyOf(ytPub().scheduledAt), day(2));
  log('línea de tiempo: arrastrar un bloque a la derecha cambia su hora (18:00 → 20:00) y se guarda; mientras arrastras se ve la hora destino');

  // 2) cambiar el día: arrastre vertical a otra franja, misma hora
  tb = await trackBox(3);
  h = await dragChip(chip(/Mi clip vertical, 20:00/), tb.x + tb.width * (20 / 24), tb.y + tb.height / 2);
  await h.release();
  await poll(() => localDayKeyOf(ytPub().scheduledAt) === day(3));
  assert.equal(hhmmOf(ytPub().scheduledAt), '20:00');
  log('línea de tiempo: arrastrar un bloque a otra franja lo cambia de día y mantiene la hora');

  // 3) no se puede llevar al pasado: se avisa y no cambia nada
  const pubBefore = ytPub().scheduledAt;
  tb = await trackBox(0);
  h = await dragChip(chip(/Mi clip vertical, 20:00/), tb.x + 4, tb.y + tb.height / 2);
  await h.release();
  await page.getByText(/Esa hora ya ha pasado/).first().waitFor();
  assert.equal(ytPub().scheduledAt, pubBefore);
  log('línea de tiempo: soltar en una hora ya pasada se rechaza con un aviso y no cambia nada');

  // 4) Escape cancela un arrastre
  tb = await trackBox(5);
  h = await dragChip(chip(/Mi clip vertical, 20:00/), tb.x + tb.width * 0.5, tb.y + tb.height / 2);
  await page.keyboard.press('Escape');
  await h.release();
  assert.equal(ytPub().scheduledAt, pubBefore);
  log('Escape cancela un arrastre sin cambiar nada');

  // 5) bandeja «Sin programar» → línea de tiempo
  const tray = page.getByRole('complementary', { name: 'Sin programar' });
  await tray.getByTestId('tray-Resumen renombrado').waitFor();
  const tb1 = await trackBox(1);
  const trayBox = await tray.getByTestId('tray-Resumen renombrado').boundingBox();
  await page.mouse.move(trayBox.x + 20, trayBox.y + trayBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trayBox.x - 60, trayBox.y + 10, { steps: 4 });
  await page.mouse.move(tb1.x + tb1.width * (12 / 24), tb1.y + tb1.height / 2, { steps: 8 });
  await page.mouse.up();
  const dlgAdd = page.getByRole('dialog', { name: 'Añadir subida' });
  await dlgAdd.waitFor();
  assert.equal(await dlgAdd.getByLabel('Fecha y hora').inputValue(), `${day(1)}T12:00`);
  await dlgAdd.getByLabel('YouTube').check();
  await dlgAdd.getByRole('button', { name: 'Programar', exact: true }).click();
  await poll(() => dataNow().publications.some((p) => p.outputId === dataNow().outputs.find((o) => o.title === 'Resumen renombrado').id && hhmmOf(p.scheduledAt) === '12:00'));
  await tray.getByTestId('tray-Resumen renombrado').waitFor({ state: 'detached' });
  log('bandeja «Sin programar»: arrastrar un vídeo a un día y una hora abre «Añadir subida» con esa hora; al programarlo sale de la bandeja');

  // 6) clic en un bloque: cambiar la hora con el teclado y quitar
  await chip(/Resumen renombrado, 12:00/).click();
  const bd = page.getByRole('dialog', { name: 'Resumen renombrado' });
  await bd.getByLabel('Fecha y hora').fill(`${day(1)}T13:30`);
  await bd.getByRole('button', { name: 'Guardar hora' }).click();
  await chip(/Resumen renombrado, 13:30/).waitFor();
  await chip(/Resumen renombrado, 13:30/).click();
  await bd.getByRole('button', { name: /Quitar subida/ }).click();
  await chip(/Resumen renombrado, 13:30/).waitFor({ state: 'detached' });
  await tray.getByTestId('tray-Resumen renombrado').waitFor();
  log('clic en un bloque: se cambia la hora escribiéndola y «Quitar subida» la elimina (el vídeo vuelve a la bandeja)');

  // ── calendario ──
  await progr.getByRole('tab', { name: 'Calendario' }).click();
  const cal = progr.getByRole('group', { name: 'Calendario' });
  await cal.getByTestId(`cal-${day(3)}`).waitFor();
  await cal.getByTestId(`cal-${day(3)}`).getByText(/Mi clip vertical/).first().waitFor();
  await shot(page, '10b-calendario');
  const src = await cal.getByTestId(`calblock-Mi clip vertical`).first().boundingBox();
  const dst = await cal.getByTestId(`cal-${day(6)}`).boundingBox();
  await page.mouse.move(src.x + 10, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + 40, src.y + 20, { steps: 3 });
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 8 });
  await page.mouse.up();
  await poll(() => dataNow().publications.some((p) => localDayKeyOf(p.scheduledAt) === day(6)));
  const moved = dataNow().publications.filter((p) => localDayKeyOf(p.scheduledAt) === day(6));
  assert.ok(moved.length >= 1);
  assert.ok(moved.every((p) => ['20:00', '16:00', '16:10', '18:00'].includes(hhmmOf(p.scheduledAt))), 'conserva la hora');
  log('calendario: arrastrar una subida a otro día la cambia de día y conserva su hora');
  await progr.getByRole('tab', { name: 'Línea de tiempo' }).click();

  // «Añadir subida» desde la programación: varias seguidas el mismo día, eligiendo el vídeo en la lista
  await progr.getByRole('button', { name: 'Añadir subida' }).click();
  const sd = page.getByRole('dialog', { name: 'Añadir subida' });
  await sd.getByLabel('Vídeo').selectOption({ label: 'Clip · Clip horizontal' });
  await sd.getByLabel('Instagram').check();
  await sd.getByLabel('Fecha y hora').fill(inDays(4, 12));
  await sd.getByRole('button', { name: 'Guardar y añadir otra' }).click();
  await sd.getByText(/1 subida\(s\) añadida\(s\) en esta sesión/).waitFor();
  await sd.getByLabel('Vídeo').selectOption({ label: 'Clip · Mi clip vertical' });
  await sd.getByLabel('Instagram').check();
  await sd.getByLabel('Fecha y hora').fill(inDays(4, 12, 20));
  await sd.getByRole('button', { name: 'Guardar y añadir otra' }).click();
  await sd.getByText(/2 subida\(s\) añadida\(s\) en esta sesión/).waitFor();
  await sd.getByText(/Ya hay otra subida a Instagram a las 12:00/).waitFor();
  await sd.getByRole('button', { name: 'Hecho' }).click();
  await poll(() => dataNow().publications.filter((p) => p.platform === 'instagram').length === 2);
  log('«Añadir subida»: se eligen vídeos de la lista y se añaden varias el mismo día seguidas; la ventana avisa de las que van muy juntas');
  assert.deepEqual(problems, []);
  log('tras cerrar y reabrir la aplicación se conservan VODs, vídeos y publicaciones programadas');

  console.log(`\nPRUEBA DE INTERFAZ REAL: OK (${step} comprobaciones). Capturas en tests/e2e/out/`);
} catch (e) {
  console.error('\nFALLO en la prueba de interfaz:', e);
  try {
    const p = app && (await app.windows())[0];
    if (p) await p.screenshot({ path: path.join(shots, 'fallo.png') });
  } catch {
    /* sin captura */
  }
  process.exitCode = 1;
} finally {
  try {
    await app?.close();
  } catch {
    /* ya cerrada */
  }
  fs.rmSync(work, { recursive: true, force: true });
}

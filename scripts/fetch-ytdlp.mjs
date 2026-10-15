// Descarga yt-dlp (programa libre y gratuito) a resources/bin para que el instalador lo incluya.
// Uso: node scripts/fetch-ytdlp.mjs   (descarga la versión de tu sistema; en Windows, yt-dlp.exe)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = { win32: ['yt-dlp.exe', 'yt-dlp.exe'], linux: ['yt-dlp_linux', 'yt-dlp'], darwin: ['yt-dlp_macos', 'yt-dlp'] };
const target = process.env.YTDLP_PLATFORM ?? process.platform;
const pick = assets[target];
if (!pick) throw new Error(`Sistema no soportado: ${target}`);
const [asset, name] = pick;
const dest = path.join(root, 'resources', 'bin', name);

if (fs.existsSync(dest) && !process.argv.includes('--force')) {
  console.log(`yt-dlp ya está en ${dest} (usa --force para volver a descargarlo)`);
  process.exit(0);
}
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
console.log(`Descargando ${url}`);
const res = await fetch(url, { redirect: 'follow' });
if (!res.ok) throw new Error(`No se pudo descargar yt-dlp: HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
if (buf.length < 1_000_000) throw new Error(`Descarga sospechosamente pequeña (${buf.length} bytes); no se guarda.`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buf, { mode: 0o755 });
console.log(`Guardado en ${dest} (${(buf.length / 1e6).toFixed(1)} MB)`);

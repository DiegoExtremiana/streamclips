import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { downloadVod, parseVodUrl } from '../electron/services/downloader';
import type { ToolPaths } from '../electron/services/tools';
import { fakeYtdlp, makeVideo, rmDir, tmpDir } from './helpers';

describe('parseVodUrl', () => {
  it('acepta URLs http(s) normales y quita el fragmento', () => {
    assert.equal(parseVodUrl('https://www.twitch.tv/videos/123456789'), 'https://www.twitch.tv/videos/123456789');
    assert.equal(parseVodUrl('  http://example.com/v  '), 'http://example.com/v');
    assert.equal(parseVodUrl('https://www.twitch.tv/videos/1#t=1h'), 'https://www.twitch.tv/videos/1');
    assert.equal(parseVodUrl('https://www.twitch.tv/videos/1?filter=archive&sort=time'), 'https://www.twitch.tv/videos/1?filter=archive&sort=time');
  });

  it('rechaza todo lo que no sea una URL web (incluida la inyección de opciones)', () => {
    for (const bad of [
      '', '   ', 'no es una url', '--exec rm -rf /', '-o /tmp/x', '--config-locations /etc/passwd',
      'file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.com/a', 'data:text/plain,hola',
      'https://localhost/x', 'http://intranet/video', 'twitch.tv/videos/1',
    ]) {
      assert.equal(parseVodUrl(bad), null, `debería rechazar "${bad}"`);
    }
  });
});

describe('downloadVod (con yt-dlp simulado)', () => {
  let root: string;
  let source: string;
  let log: string;
  let tools: ToolPaths;
  const saved = { ...process.env };

  before(() => {
    root = tmpDir();
    source = makeVideo(path.join(root, 'src.mp4'), { w: 640, h: 360, dur: 2 });
    log = path.join(root, 'calls.log');
    tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: fakeYtdlp() };
  });
  after(() => {
    rmDir(root);
    process.env = saved;
  });

  const env = (o: Record<string, string>) => {
    process.env = { ...saved, FAKE_SOURCE: source, FAKE_LOG: log, ...o };
    fs.rmSync(log, { force: true });
  };

  it('descarga, informa del progreso en orden y devuelve título y archivo', async () => {
    env({});
    const out = path.join(root, 'ok');
    const seen: number[] = [];
    const r = await downloadVod(tools, 'https://www.twitch.tv/videos/1', out, (p) => seen.push(p));
    assert.equal(r.title, 'Título del VOD');
    assert.equal(r.filePath, path.join(out, 'abc123.mp4'));
    assert.ok(fs.statSync(r.filePath).size > 0);
    assert.equal(seen.at(-1), 100);
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'el progreso nunca retrocede');
    assert.ok(seen.length >= 5);
  });

  it('la URL siempre va tras "--" y como último argumento (sin inyección de opciones)', async () => {
    env({});
    await downloadVod(tools, 'https://www.twitch.tv/videos/1', path.join(root, 'args'), () => undefined);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    assert.equal(calls.length, 2); // metadatos + descarga
    for (const c of calls) {
      assert.deepEqual(c.slice(-2), ['--', 'https://www.twitch.tv/videos/1']);
    }
    assert.ok(calls[1].includes('--remux-video'));
  });

  it('un fallo de yt-dlp da un error con el motivo', async () => {
    env({ FAKE_MODE: 'fail' });
    await assert.rejects(
      downloadVod(tools, 'https://www.twitch.tv/videos/1', path.join(root, 'fail'), () => undefined),
      /código 1[\s\S]*403/,
    );
  });

  it('si yt-dlp dice que terminó pero no hay archivo, es un error', async () => {
    env({ FAKE_MODE: 'nofile' });
    await assert.rejects(
      downloadVod(tools, 'https://www.twitch.tv/videos/1', path.join(root, 'nofile'), () => undefined),
      /no se encuentra el archivo/,
    );
  });

  it('si no hay metadatos, el error lo explica', async () => {
    env({ FAKE_MODE: 'nometa' });
    await assert.rejects(
      downloadVod(tools, 'https://www.twitch.tv/videos/1', path.join(root, 'nometa'), () => undefined),
      /no devolvió información/,
    );
  });

  it('yt-dlp no instalado -> mensaje claro', async () => {
    env({});
    await assert.rejects(
      downloadVod({ ...tools, ytdlp: '/no/existe/yt-dlp' }, 'https://www.twitch.tv/videos/1', path.join(root, 'x'), () => undefined),
      /No se encuentra/,
    );
  });

  it('un id malicioso nunca saca el archivo de la carpeta de descargas', async () => {
    env({ FAKE_ID: '../../evil' });
    const out = path.join(root, 'safe', 'vods');
    const r = await downloadVod(tools, 'https://www.twitch.tv/videos/1', out, () => undefined);
    assert.equal(path.dirname(r.filePath), out);
    assert.ok(!fs.existsSync(path.join(root, 'evil.mp4')));
  });
});

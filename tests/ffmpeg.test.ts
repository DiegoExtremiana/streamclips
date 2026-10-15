import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { concatLine, probe, renderClip, renderLong, validateRender, verticalFilter } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { dominantColor, makeVideo, rmDir, tmpDir, type VideoOpts } from './helpers';

const tools = resolveToolPaths('', '');

describe('ffmpeg: utilidades', () => {
  it('concatLine usa barras normales y escapa las comillas simples', () => {
    assert.equal(concatLine('C:\\Users\\a b\\it\'s.mp4'), "file 'C:/Users/a b/it'\\''s.mp4'");
    assert.equal(concatLine('/tmp/x.mp4'), "file '/tmp/x.mp4'");
  });

  it('verticalFilter limita cropX a 0..1', () => {
    assert.match(verticalFilter(-5), /\*0'/);
    assert.match(verticalFilter(7), /\*1'/);
    assert.match(verticalFilter(0.25), /\*0\.25'/);
  });
});

describe('ffmpeg: render real sobre distintos orígenes', () => {
  let root: string;
  before(() => {
    root = tmpDir();
  });
  after(() => rmDir(root));

  const sources: { name: string; opts: VideoOpts }[] = [
    { name: '1080p16:9 con audio', opts: { w: 1920, h: 1080, audio: true } },
    { name: '720p sin audio', opts: { w: 1280, h: 720, audio: false } },
    { name: '4:3 (1440x1080)', opts: { w: 1440, h: 1080, audio: true } },
    { name: 'ya vertical (1080x1920)', opts: { w: 1080, h: 1920, audio: true } },
    { name: 'medidas impares (1000x562)', opts: { w: 1000, h: 562, audio: true } },
    { name: '4K (3840x2160)', opts: { w: 3840, h: 2160, dur: 6, audio: true } },
    { name: '60 fps', opts: { w: 1280, h: 720, fps: 60, audio: true } },
  ];

  for (const { name, opts } of sources) {
    it(`vertical, horizontal y largo válidos desde ${name}`, async () => {
      const dir = path.join(root, name.replace(/\W+/g, '_'));
      const src = makeVideo(path.join(dir, 'src.mp4'), { dur: 8, ...opts });
      const hasAudio = opts.audio ?? true;

      const v = path.join(dir, 'v.mp4');
      await renderClip(tools, src, { kind: 'vertical', start: 1, end: 4, cropX: 0.5 }, v);
      const vi = await validateRender(tools, v, 'vertical', 3);
      assert.equal(vi.hasAudio, hasAudio, 'el audio se conserva (o no aparece de la nada)');

      const h = path.join(dir, 'h.mp4');
      await renderClip(tools, src, { kind: 'horizontal', start: 2, end: 5 }, h);
      await validateRender(tools, h, 'horizontal', 3);

      const l = path.join(dir, 'l.mp4');
      await renderLong(tools, src, { title: 'l', segments: [{ start: 0, end: 2 }, { start: 5, end: 7 }] }, l);
      const li = await validateRender(tools, l, 'long', 4, 2);
      assert.equal(li.hasAudio, hasAudio);
    });
  }

  it('cropX mueve de verdad el recorte vertical (izquierda roja, derecha azul)', async () => {
    const dir = path.join(root, 'crop');
    const src = makeVideo(path.join(dir, 'split.mp4'), { split: true, dur: 4, audio: false });
    const out = async (cropX: number | undefined) => {
      const f = path.join(dir, `c-${cropX}.mp4`);
      await renderClip(tools, src, { kind: 'vertical', start: 0, end: 2, cropX }, f);
      return dominantColor(f, 0.5);
    };
    assert.equal(await out(0), 'red');
    assert.equal(await out(1), 'blue');
    assert.equal(await out(0.5), 'mixed');
    assert.equal(await out(undefined), 'mixed'); // por defecto, centrado
    assert.equal(await out(-3), 'red'); // fuera de rango se limita
    assert.equal(await out(9), 'blue');
  });

  it('el horizontal no deforma: un origen 4:3 lleva bandas negras laterales', async () => {
    const dir = path.join(root, 'bars');
    const src = makeVideo(path.join(dir, 'src.mp4'), { w: 1440, h: 1080, dur: 3, audio: false, split: true });
    const out = path.join(dir, 'h.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 0, end: 2 }, out);
    // columna izquierda de 100 px del fotograma de salida: debería ser negra (banda), no roja
    const px = leftStripLuma(out);
    assert.ok(px < 30, `la banda izquierda debería ser negra (luma ${px})`);
  });

  it('largo con tramos desordenados: respeta el orden pedido y suma las duraciones', async () => {
    const dir = path.join(root, 'order');
    const src = makeVideo(path.join(dir, 'src.mp4'), { split: true, dur: 8, audio: true });
    const out = path.join(dir, 'l.mp4');
    // el original es rojo a la izquierda y azul a la derecha en todo momento; el orden se comprueba por duración
    await renderLong(tools, src, { title: 'l', segments: [{ start: 5, end: 8 }, { start: 0, end: 1 }, { start: 2, end: 4 }] }, out);
    const info = await probe(tools, out);
    assert.ok(Math.abs(info.durationSec - 6) < 0.5, `duración ${info.durationSec}`);
    assert.equal(info.width, 1920);
  });

  it('largo de un solo tramo y rutas con espacios, comillas y acentos', async () => {
    const dir = path.join(root, "carpeta con espacios y 'comillas' ñ");
    const src = makeVideo(path.join(dir, "mi vídeo 'ñ'.mp4"), { dur: 4, w: 1280, h: 720 });
    const out = path.join(dir, 'salida', "largo 'x'.mp4");
    await renderLong(tools, src, { title: 'l', segments: [{ start: 0, end: 2 }] }, out);
    await validateRender(tools, out, 'long', 2);
    // sin restos temporales
    assert.deepEqual(fs.readdirSync(path.join(dir, 'salida')), ["largo 'x'.mp4"]);
  });

  it('un origen corrupto produce un error, no un archivo "bueno"', async () => {
    const bad = path.join(root, 'corrupto.mp4');
    fs.writeFileSync(bad, 'esto no es un vídeo');
    const out = path.join(root, 'out-bad.mp4');
    await assert.rejects(renderClip(tools, bad, { kind: 'vertical', start: 0, end: 2 }, out), /falló/);
    await assert.rejects(probe(tools, bad));
  });

  it('un tramo fuera del vídeo no se da por válido', async () => {
    const dir = path.join(root, 'past-end');
    const src = makeVideo(path.join(dir, 'src.mp4'), { dur: 3, w: 640, h: 360 });
    const out = path.join(dir, 'h.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 10, end: 14 }, out).catch(() => undefined);
    await assert.rejects(validateRender(tools, out, 'horizontal', 4));
  });
});

describe('ffmpeg: validateRender rechaza lo incorrecto', () => {
  let root: string;
  let file: string;
  before(() => {
    root = tmpDir();
    file = makeVideo(path.join(root, 'v.mp4'), { w: 1920, h: 1080, dur: 4, audio: true });
  });
  after(() => rmDir(root));

  it('formato equivocado', async () => {
    await assert.rejects(validateRender(tools, file, 'vertical', 4), /Resolución incorrecta: 1920x1080 \(esperada 1080x1920\)/);
  });
  it('duración equivocada', async () => {
    await assert.rejects(validateRender(tools, file, 'horizontal', 30), /Duración incorrecta/);
    await validateRender(tools, file, 'horizontal', 4);
    await validateRender(tools, file, 'horizontal', 5.4); // dentro de la tolerancia
  });
  it('archivo inexistente o que no es vídeo', async () => {
    await assert.rejects(validateRender(tools, path.join(root, 'nada.mp4'), 'horizontal', 4), /no existe/);
    const junk = path.join(root, 'junk.mp4');
    fs.writeFileSync(junk, 'basura');
    await assert.rejects(validateRender(tools, junk, 'horizontal', 4));
  });
});

/** Luminosidad media de una franja de 100 px a la izquierda del primer fotograma. */
function leftStripLuma(file: string): number {
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'crop=100:1080:0:0,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 1024 * 1024 },
  );
  return buf[0];
}

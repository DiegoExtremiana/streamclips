import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { composeGraph, renderClip, validateRender } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import {
  applyPresetKeeping, defaultPreset, dstPixels, fitSrc, layoutFromCropX, layoutFromPreset, moveSrc, normalizeLayout,
  presetsFor, PRESETS, resizeSrc, srcWidthFor, validateLayout, type VerticalLayout,
} from '../shared/layout';
import { normalizeClip, validateClipSpec } from '../shared/plan';
import { rmDir, tmpDir } from './helpers';

const ASPECT = 16 / 9;

describe('composición vertical: modelo', () => {
  it('hay disposiciones por defecto para 1, 2 y 3 ventanas, y cubren el lienzo sin solaparse', () => {
    for (const n of [1, 2, 3]) assert.ok(presetsFor(n).length >= 1, `${n} ventanas`);
    for (const p of PRESETS) {
      assert.equal(p.dst.length, p.count);
      assert.equal(p.focus.length, p.count);
      const area = p.dst.reduce((a, d) => a + d.w * d.h, 0);
      assert.ok(Math.abs(area - 1) < 1e-9, `${p.id} cubre todo el lienzo`);
      const l = layoutFromPreset(p, ASPECT);
      assert.equal(validateLayout(l), null, p.id);
    }
  });

  it('el recuadro de origen tiene la proporción del hueco (sin deformar) y cabe en el fotograma', () => {
    for (const p of PRESETS) {
      for (const w of layoutFromPreset(p, ASPECT).windows) {
        const srcPx = (w.src.w * 1920) / (w.src.h * 1080);
        const dstPx = (w.dst.w * 1080) / (w.dst.h * 1920);
        assert.ok(Math.abs(srcPx - dstPx) < 0.01 || w.src.w > 0.999 || w.src.h > 0.999, `${p.id}: ${srcPx} vs ${dstPx}`);
        assert.ok(w.src.x >= 0 && w.src.y >= 0 && w.src.x + w.src.w <= 1 + 1e-9 && w.src.y + w.src.h <= 1 + 1e-9);
      }
    }
  });

  it('mover no se sale del fotograma y cambiar de tamaño conserva la proporción', () => {
    const l = layoutFromPreset(defaultPreset(2), ASPECT);
    const m = moveSrc(l.windows[0].src, -5, -5);
    assert.deepEqual([m.x, m.y], [0, 0]);
    const m2 = moveSrc(l.windows[1].src, 9, 9);
    assert.ok(m2.x + m2.w <= 1 + 1e-9 && m2.y + m2.h <= 1 + 1e-9);
    const big = resizeSrc(l.windows[0].src, l.windows[0].dst, 0.9, ASPECT);
    assert.ok(big.x + big.w <= 1 + 1e-9 && big.y + big.h <= 1 + 1e-9);
    assert.ok(Math.abs(big.w - srcWidthFor(l.windows[0].dst, big.h, ASPECT)) < 1e-9);
    const tiny = resizeSrc(l.windows[0].src, l.windows[0].dst, 0, ASPECT);
    assert.ok(tiny.h >= 0.06 - 1e-9, 'no se puede hacer más pequeño que el mínimo');
  });

  it('cambiar de disposición conserva lo que cada ventana recogía (centro y alto)', () => {
    const a = layoutFromPreset(presetsFor(2)[0], ASPECT);
    const b = applyPresetKeeping(a, presetsFor(2)[1], ASPECT);
    assert.equal(b.preset, presetsFor(2)[1].id);
    const ca = a.windows[0].src, cb = b.windows[0].src;
    assert.ok(Math.abs(ca.x + ca.w / 2 - (cb.x + cb.w / 2)) < 0.05);
    const c = applyPresetKeeping(a, presetsFor(3)[0], ASPECT); // distinto número de ventanas: empieza de cero
    assert.equal(c.windows.length, 3);
  });

  it('el encuadre antiguo (cropX) equivale a una ventana a pantalla completa', () => {
    const l = layoutFromCropX(0.5, ASPECT);
    assert.equal(l.windows.length, 1);
    assert.ok(Math.abs(l.windows[0].src.x + l.windows[0].src.w / 2 - 0.5) < 1e-9);
    assert.equal(l.windows[0].src.h, 1);
    assert.equal(layoutFromCropX(0, ASPECT).windows[0].src.x, 0);
  });

  it('validateLayout rechaza lo que no vale', () => {
    const ok = layoutFromPreset(defaultPreset(2), ASPECT);
    assert.equal(validateLayout(ok), null);
    assert.match(validateLayout({ windows: [] })!, /de 1 a 3 ventanas/);
    assert.match(validateLayout({ windows: [ok.windows[0], ok.windows[0], ok.windows[0], ok.windows[0]] })!, /de 1 a 3 ventanas/);
    assert.match(validateLayout(null)!, /no es válida/);
    const out = structuredClone(ok);
    out.windows[0].src.x = 0.9;
    assert.match(validateLayout(out)!, /se sale del fotograma/);
    const small = structuredClone(ok);
    small.windows[1].src.w = 0.01;
    assert.match(validateLayout(small)!, /demasiado pequeño/);
    const nan = structuredClone(ok);
    nan.windows[0].dst.h = NaN;
    assert.match(validateLayout(nan)!, /no son números/);
  });

  it('dstPixels da bordes pares y las ventanas contiguas no dejan huecos', () => {
    const l = layoutFromPreset(presetsFor(3).find((p) => p.id === 'tres-dos-arriba')!, ASPECT);
    const px = l.windows.map((w) => dstPixels(w.dst));
    for (const p of px) assert.ok(p.x % 2 === 0 && p.y % 2 === 0 && p.w % 2 === 0 && p.h % 2 === 0);
    assert.equal(px[0].x + px[0].w, px[1].x);
    assert.equal(px[0].y + px[0].h, px[2].y);
    assert.equal(px[2].y + px[2].h, 1920);
  });

  it('un plan con composición se valida y se normaliza; con una mala se rechaza', () => {
    const layout = layoutFromPreset(defaultPreset(2), ASPECT);
    assert.equal(validateClipSpec({ start: 0, end: 5, title: 'x', layout }), null);
    assert.match(validateClipSpec({ start: 0, end: 5, title: 'x', layout: { windows: [] } })!, /ventanas/);
    const n = normalizeClip({ start: 0, end: 5, title: 'x', layout }, 'Clip');
    assert.deepEqual(n.layout, normalizeLayout(layout));
  });

  it('el grafo de ffmpeg lleva una rama por ventana y termina en [base]', () => {
    const g = composeGraph(layoutFromPreset(defaultPreset(3), ASPECT));
    assert.match(g, /split=3/);
    assert.equal((g.match(/overlay=/g) ?? []).length, 3);
    assert.match(g, /\[base\]$/);
    assert.match(composeGraph(layoutFromPreset(defaultPreset(1), ASPECT)), /null\[s0\]/);
  });
});

describe('composición vertical: render real con ffmpeg', () => {
  const tools = resolveToolPaths('', '');
  let root: string;
  let src: string;
  before(() => {
    root = tmpDir();
    src = path.join(root, 'cuadrantes.mp4');
    // cuatro cuadrantes de colores puros: rojo, verde / azul, amarillo
    execFileSync(tools.ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=0xff0000:s=960x540:r=25:d=6', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=960x540:r=25:d=6',
      '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=960x540:r=25:d=6', '-f', 'lavfi', '-i', 'color=c=0xffff00:s=960x540:r=25:d=6',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
      '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack[v]',
      '-map', '[v]', '-map', '4:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
    ]);
  });
  after(() => rmDir(root));

  const pixel = (file: string, x: number, y: number): [number, number, number] => {
    const buf = execFileSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    return [buf[0], buf[1], buf[2]];
  };
  const near = (p: number[], t: number[]) => p.every((v, i) => Math.abs(v - t[i]) < 40);
  const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0];

  const layoutOf = (presetId: string, srcs: [number, number][]): VerticalLayout => {
    const base = layoutFromPreset(PRESETS.find((p) => p.id === presetId)!, ASPECT);
    // recuadros pequeños centrados en el punto indicado de cada ventana (dentro de un solo cuadrante)
    base.windows.forEach((w, i) => {
      w.src = fitSrc(w.dst, srcs[i][0], srcs[i][1], 0.2, ASPECT);
    });
    return base;
  };

  it('2 ventanas apiladas: arriba lo del cuadrante rojo, abajo lo del amarillo', async () => {
    const out = path.join(root, 'dos.mp4');
    await renderClip(tools, src, { kind: 'vertical', start: 0, end: 3, layout: layoutOf('dos-mitad', [[0.25, 0.25], [0.75, 0.75]]) }, out);
    const info = await validateRender(tools, out, 'vertical', 3);
    assert.equal(info.hasAudio, true, 'el audio se conserva');
    assert.ok(near(pixel(out, 540, 480), RED), 'arriba, rojo');
    assert.ok(near(pixel(out, 540, 1440), YELLOW), 'abajo, amarillo');
  });

  it('3 ventanas (dos arriba y una grande): cada hueco enseña su cuadrante', async () => {
    const out = path.join(root, 'tres.mp4');
    await renderClip(tools, src, { kind: 'vertical', start: 0, end: 3, layout: layoutOf('tres-dos-arriba', [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75]]) }, out);
    await validateRender(tools, out, 'vertical', 3);
    assert.ok(near(pixel(out, 270, 280), RED), 'arriba izquierda');
    assert.ok(near(pixel(out, 810, 280), GREEN), 'arriba derecha');
    assert.ok(near(pixel(out, 540, 1200), BLUE), 'abajo, grande');
  });

  it('1 ventana con un recuadro propio y con cortes, acercamiento y fundido a la vez', async () => {
    const out = path.join(root, 'una.mp4');
    await renderClip(tools, src, {
      kind: 'vertical', start: 0, end: 5, cuts: [{ start: 2, end: 3 }],
      effects: [{ type: 'punch', at: 0.5, duration: 1 }, { type: 'fadeIn' }, { type: 'fadeOut' }],
      layout: layoutOf('una', [[0.75, 0.25]]),
    }, out);
    await validateRender(tools, out, 'vertical', 4, 2);
    assert.ok(near(pixel(out, 540, 960), GREEN));
  });

  it('un origen que no es 16:9 no se deforma ni falla', async () => {
    const odd = path.join(root, 'odd.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1000x562:rate=25:duration=4', '-pix_fmt', 'yuv420p', odd]);
    const out = path.join(root, 'odd-v.mp4');
    await renderClip(tools, odd, { kind: 'vertical', start: 0, end: 2, layout: layoutFromPreset(defaultPreset(3), 1000 / 562) }, out);
    await validateRender(tools, out, 'vertical', 2);
  });
});

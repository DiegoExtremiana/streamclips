"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const layout_1 = require("../shared/layout");
const plan_1 = require("../shared/plan");
const helpers_1 = require("./helpers");
const ASPECT = 16 / 9;
(0, node_test_1.describe)('composición vertical: modelo', () => {
    (0, node_test_1.it)('hay disposiciones por defecto para 1, 2 y 3 ventanas, y cubren el lienzo sin solaparse', () => {
        for (const n of [1, 2, 3])
            strict_1.default.ok((0, layout_1.presetsFor)(n).length >= 1, `${n} ventanas`);
        for (const p of layout_1.PRESETS) {
            strict_1.default.equal(p.dst.length, p.count);
            strict_1.default.equal(p.focus.length, p.count);
            const area = p.dst.reduce((a, d) => a + d.w * d.h, 0);
            strict_1.default.ok(Math.abs(area - 1) < 1e-9, `${p.id} cubre todo el lienzo`);
            const l = (0, layout_1.layoutFromPreset)(p, ASPECT);
            strict_1.default.equal((0, layout_1.validateLayout)(l), null, p.id);
        }
    });
    (0, node_test_1.it)('el recuadro de origen tiene la proporción del hueco (sin deformar) y cabe en el fotograma', () => {
        for (const p of layout_1.PRESETS) {
            for (const w of (0, layout_1.layoutFromPreset)(p, ASPECT).windows) {
                const srcPx = (w.src.w * 1920) / (w.src.h * 1080);
                const dstPx = (w.dst.w * 1080) / (w.dst.h * 1920);
                strict_1.default.ok(Math.abs(srcPx - dstPx) < 0.01 || w.src.w > 0.999 || w.src.h > 0.999, `${p.id}: ${srcPx} vs ${dstPx}`);
                strict_1.default.ok(w.src.x >= 0 && w.src.y >= 0 && w.src.x + w.src.w <= 1 + 1e-9 && w.src.y + w.src.h <= 1 + 1e-9);
            }
        }
    });
    (0, node_test_1.it)('mover no se sale del fotograma y cambiar de tamaño conserva la proporción', () => {
        const l = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(2), ASPECT);
        const m = (0, layout_1.moveSrc)(l.windows[0].src, -5, -5);
        strict_1.default.deepEqual([m.x, m.y], [0, 0]);
        const m2 = (0, layout_1.moveSrc)(l.windows[1].src, 9, 9);
        strict_1.default.ok(m2.x + m2.w <= 1 + 1e-9 && m2.y + m2.h <= 1 + 1e-9);
        const big = (0, layout_1.resizeSrc)(l.windows[0].src, l.windows[0].dst, 0.9, ASPECT);
        strict_1.default.ok(big.x + big.w <= 1 + 1e-9 && big.y + big.h <= 1 + 1e-9);
        strict_1.default.ok(Math.abs(big.w - (0, layout_1.srcWidthFor)(l.windows[0].dst, big.h, ASPECT)) < 1e-9);
        const tiny = (0, layout_1.resizeSrc)(l.windows[0].src, l.windows[0].dst, 0, ASPECT);
        strict_1.default.ok(tiny.h >= 0.06 - 1e-9, 'no se puede hacer más pequeño que el mínimo');
    });
    (0, node_test_1.it)('cambiar de disposición conserva lo que cada ventana recogía (centro y alto)', () => {
        const a = (0, layout_1.layoutFromPreset)((0, layout_1.presetsFor)(2)[0], ASPECT);
        const b = (0, layout_1.applyPresetKeeping)(a, (0, layout_1.presetsFor)(2)[1], ASPECT);
        strict_1.default.equal(b.preset, (0, layout_1.presetsFor)(2)[1].id);
        const ca = a.windows[0].src, cb = b.windows[0].src;
        strict_1.default.ok(Math.abs(ca.x + ca.w / 2 - (cb.x + cb.w / 2)) < 0.05);
        const c = (0, layout_1.applyPresetKeeping)(a, (0, layout_1.presetsFor)(3)[0], ASPECT); // distinto número de ventanas: empieza de cero
        strict_1.default.equal(c.windows.length, 3);
    });
    (0, node_test_1.it)('el encuadre antiguo (cropX) equivale a una ventana a pantalla completa', () => {
        const l = (0, layout_1.layoutFromCropX)(0.5, ASPECT);
        strict_1.default.equal(l.windows.length, 1);
        strict_1.default.ok(Math.abs(l.windows[0].src.x + l.windows[0].src.w / 2 - 0.5) < 1e-9);
        strict_1.default.equal(l.windows[0].src.h, 1);
        strict_1.default.equal((0, layout_1.layoutFromCropX)(0, ASPECT).windows[0].src.x, 0);
    });
    (0, node_test_1.it)('validateLayout rechaza lo que no vale', () => {
        const ok = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(2), ASPECT);
        strict_1.default.equal((0, layout_1.validateLayout)(ok), null);
        strict_1.default.match((0, layout_1.validateLayout)({ windows: [] }), /de 1 a 3 ventanas/);
        strict_1.default.match((0, layout_1.validateLayout)({ windows: [ok.windows[0], ok.windows[0], ok.windows[0], ok.windows[0]] }), /de 1 a 3 ventanas/);
        strict_1.default.match((0, layout_1.validateLayout)(null), /no es válida/);
        const out = structuredClone(ok);
        out.windows[0].src.x = 0.9;
        strict_1.default.match((0, layout_1.validateLayout)(out), /se sale del fotograma/);
        const small = structuredClone(ok);
        small.windows[1].src.w = 0.01;
        strict_1.default.match((0, layout_1.validateLayout)(small), /demasiado pequeño/);
        const nan = structuredClone(ok);
        nan.windows[0].dst.h = NaN;
        strict_1.default.match((0, layout_1.validateLayout)(nan), /no son números/);
    });
    (0, node_test_1.it)('dstPixels da bordes pares y las ventanas contiguas no dejan huecos', () => {
        const l = (0, layout_1.layoutFromPreset)((0, layout_1.presetsFor)(3).find((p) => p.id === 'tres-dos-arriba'), ASPECT);
        const px = l.windows.map((w) => (0, layout_1.dstPixels)(w.dst));
        for (const p of px)
            strict_1.default.ok(p.x % 2 === 0 && p.y % 2 === 0 && p.w % 2 === 0 && p.h % 2 === 0);
        strict_1.default.equal(px[0].x + px[0].w, px[1].x);
        strict_1.default.equal(px[0].y + px[0].h, px[2].y);
        strict_1.default.equal(px[2].y + px[2].h, 1920);
    });
    (0, node_test_1.it)('un plan con composición se valida y se normaliza; con una mala se rechaza', () => {
        const layout = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(2), ASPECT);
        strict_1.default.equal((0, plan_1.validateClipSpec)({ start: 0, end: 5, title: 'x', layout }), null);
        strict_1.default.match((0, plan_1.validateClipSpec)({ start: 0, end: 5, title: 'x', layout: { windows: [] } }), /ventanas/);
        const n = (0, plan_1.normalizeClip)({ start: 0, end: 5, title: 'x', layout }, 'Clip');
        strict_1.default.deepEqual(n.layout, (0, layout_1.normalizeLayout)(layout));
    });
    (0, node_test_1.it)('el grafo de ffmpeg lleva una rama por ventana y termina en [base]', () => {
        const g = (0, ffmpeg_1.composeGraph)((0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(3), ASPECT));
        strict_1.default.match(g, /split=3/);
        strict_1.default.equal((g.match(/overlay=/g) ?? []).length, 3);
        strict_1.default.match(g, /\[base\]$/);
        strict_1.default.match((0, ffmpeg_1.composeGraph)((0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(1), ASPECT)), /null\[s0\]/);
    });
});
(0, node_test_1.describe)('composición vertical: render real con ffmpeg', () => {
    const tools = (0, tools_1.resolveToolPaths)('', '');
    let root;
    let src;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        src = node_path_1.default.join(root, 'cuadrantes.mp4');
        // cuatro cuadrantes de colores puros: rojo, verde / azul, amarillo
        (0, node_child_process_1.execFileSync)(tools.ffmpeg, [
            '-y', '-hide_banner', '-loglevel', 'error',
            '-f', 'lavfi', '-i', 'color=c=0xff0000:s=960x540:r=25:d=6', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=960x540:r=25:d=6',
            '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=960x540:r=25:d=6', '-f', 'lavfi', '-i', 'color=c=0xffff00:s=960x540:r=25:d=6',
            '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
            '-filter_complex', '[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack[v]',
            '-map', '[v]', '-map', '4:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src,
        ]);
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    const pixel = (file, x, y) => {
        const buf = (0, node_child_process_1.execFileSync)(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        return [buf[0], buf[1], buf[2]];
    };
    const near = (p, t) => p.every((v, i) => Math.abs(v - t[i]) < 40);
    const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255], YELLOW = [255, 255, 0];
    const layoutOf = (presetId, srcs) => {
        const base = (0, layout_1.layoutFromPreset)(layout_1.PRESETS.find((p) => p.id === presetId), ASPECT);
        // recuadros pequeños centrados en el punto indicado de cada ventana (dentro de un solo cuadrante)
        base.windows.forEach((w, i) => {
            w.src = (0, layout_1.fitSrc)(w.dst, srcs[i][0], srcs[i][1], 0.2, ASPECT);
        });
        return base;
    };
    (0, node_test_1.it)('2 ventanas apiladas: arriba lo del cuadrante rojo, abajo lo del amarillo', async () => {
        const out = node_path_1.default.join(root, 'dos.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'vertical', start: 0, end: 3, layout: layoutOf('dos-mitad', [[0.25, 0.25], [0.75, 0.75]]) }, out);
        const info = await (0, ffmpeg_1.validateRender)(tools, out, 'vertical', 3);
        strict_1.default.equal(info.hasAudio, true, 'el audio se conserva');
        strict_1.default.ok(near(pixel(out, 540, 480), RED), 'arriba, rojo');
        strict_1.default.ok(near(pixel(out, 540, 1440), YELLOW), 'abajo, amarillo');
    });
    (0, node_test_1.it)('3 ventanas (dos arriba y una grande): cada hueco enseña su cuadrante', async () => {
        const out = node_path_1.default.join(root, 'tres.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'vertical', start: 0, end: 3, layout: layoutOf('tres-dos-arriba', [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75]]) }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'vertical', 3);
        strict_1.default.ok(near(pixel(out, 270, 280), RED), 'arriba izquierda');
        strict_1.default.ok(near(pixel(out, 810, 280), GREEN), 'arriba derecha');
        strict_1.default.ok(near(pixel(out, 540, 1200), BLUE), 'abajo, grande');
    });
    (0, node_test_1.it)('1 ventana con un recuadro propio y con cortes, acercamiento y fundido a la vez', async () => {
        const out = node_path_1.default.join(root, 'una.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, {
            kind: 'vertical', start: 0, end: 5, cuts: [{ start: 2, end: 3 }],
            effects: [{ type: 'punch', at: 0.5, duration: 1 }, { type: 'fadeIn' }, { type: 'fadeOut' }],
            layout: layoutOf('una', [[0.75, 0.25]]),
        }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'vertical', 4, 2);
        strict_1.default.ok(near(pixel(out, 540, 960), GREEN));
    });
    (0, node_test_1.it)('un origen que no es 16:9 no se deforma ni falla', async () => {
        const odd = node_path_1.default.join(root, 'odd.mp4');
        (0, node_child_process_1.execFileSync)(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1000x562:rate=25:duration=4', '-pix_fmt', 'yuv420p', odd]);
        const out = node_path_1.default.join(root, 'odd-v.mp4');
        await (0, ffmpeg_1.renderClip)(tools, odd, { kind: 'vertical', start: 0, end: 2, layout: (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(3), 1000 / 562) }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'vertical', 2);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const autoEdit_1 = require("../shared/autoEdit");
const plan_1 = require("../shared/plan");
const timeline_1 = require("../shared/timeline");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const mkWords = (spec) => spec.map(([text, start]) => ({ text, start, end: start + 0.4 }));
// 0-12 s hablando, pausa de 5 s, 17-30 s hablando con una exclamación a los 22 s
const words = mkWords([
    ...Array.from({ length: 12 }, (_, i) => ['hola', i]),
    ...Array.from({ length: 10 }, (_, i) => ['seguimos', 17 + i * 0.5]),
    ['¡increíble!', 22],
    ...Array.from({ length: 10 }, (_, i) => ['vale', 23 + i * 0.7]),
]);
(0, node_test_1.describe)('edición profesional automática', () => {
    (0, node_test_1.it)('corta las pausas largas dejando un respiro, y no toca el habla continua', () => {
        const p = (0, autoEdit_1.planEdit)(words, { start: 0, end: 30 });
        strict_1.default.equal(p.cuts.length, 1);
        strict_1.default.ok(p.cuts[0].start > 11.5 && p.cuts[0].end < 17 && p.cuts[0].end - p.cuts[0].start > 3, JSON.stringify(p.cuts));
    });
    (0, node_test_1.it)('acerca la imagen con un golpe de sonido en la exclamación, un whoosh en el corte, fundidos y volumen parejo', () => {
        const p = (0, autoEdit_1.planEdit)(words, { start: 0, end: 30 });
        const punch = p.effects.filter((e) => e.type === 'punch');
        strict_1.default.equal(punch.length, 1);
        strict_1.default.ok(Math.abs(punch[0].at - 21.9) < 0.2);
        const sounds = p.effects.filter((e) => e.type === 'sfx').map((e) => e.sound);
        strict_1.default.deepEqual(sounds.sort(), ['hit', 'whoosh']);
        for (const t of ['fadeIn', 'fadeOut', 'polish'])
            strict_1.default.ok(p.effects.some((e) => e.type === t), t);
    });
    (0, node_test_1.it)('el plan siempre pasa la validación de clips y de vídeos largos', () => {
        const p = (0, autoEdit_1.planEdit)(words, { start: 0, end: 30 });
        strict_1.default.equal((0, plan_1.validateClipSpec)({ kind: 'both', start: 0, end: 30, title: 't', cuts: p.cuts, effects: p.effects }, 100), null);
        const l = (0, autoEdit_1.planLong)(words, [{ start: 0, end: 30 }]);
        strict_1.default.equal((0, plan_1.validateLongSpec)({ title: 't', segments: l.segments, effects: l.effects }, 100), null);
        strict_1.default.equal(l.segments.length, 2, 'la pausa parte el vídeo en dos tramos');
    });
    (0, node_test_1.it)('sin habla suficiente solo pone fundidos y volumen; nunca efectos fuera de lo conservado', () => {
        const p = (0, autoEdit_1.planEdit)([], { start: 0, end: 30 });
        strict_1.default.deepEqual(p.cuts, []);
        strict_1.default.deepEqual(p.effects.map((e) => e.type), ['fadeIn', 'fadeOut', 'polish']);
        const q = (0, autoEdit_1.planEdit)(words, { start: 0, end: 30 });
        const kept = (0, timeline_1.keptRanges)(0, 30, q.cuts);
        for (const e of q.effects)
            if ('at' in e)
                strict_1.default.ok(kept.some((r) => e.at >= r.start && e.at <= r.end));
    });
});
(0, node_test_1.describe)('edición profesional: render real', () => {
    const tools = (0, tools_1.resolveToolPaths)('', '');
    let root;
    let src;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        src = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'fx.mp4'), { w: 1280, h: 720, dur: 30, audio: true });
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    (0, node_test_1.it)('clip con corte, acercamiento, sonidos, fundidos y volumen parejo: sale con la duración esperada y con audio', async () => {
        const p = (0, autoEdit_1.planEdit)(words, { start: 0, end: 30 });
        for (const kind of ['vertical', 'horizontal']) {
            const out = node_path_1.default.join(root, `clip-${kind}.mp4`);
            await (0, ffmpeg_1.renderClip)(tools, src, { kind, start: 0, end: 30, cuts: p.cuts, effects: p.effects }, out);
            const info = await (0, ffmpeg_1.probe)(tools, out);
            const expected = 30 - p.cuts.reduce((a, c) => a + c.end - c.start, 0);
            strict_1.default.ok(Math.abs(info.durationSec - expected) < 1.5, `${kind}: ${info.durationSec} vs ${expected}`);
            strict_1.default.ok(info.hasAudio, `${kind} con audio`);
            await (0, ffmpeg_1.validateRender)(tools, out, kind, info.durationSec);
        }
    });
    (0, node_test_1.it)('vídeo largo con varios tramos y los mismos efectos', async () => {
        const l = (0, autoEdit_1.planLong)(words, [{ start: 0, end: 30 }]);
        const out = node_path_1.default.join(root, 'long.mp4');
        await (0, ffmpeg_1.renderLong)(tools, src, { title: 't', segments: l.segments, effects: l.effects }, out);
        const info = await (0, ffmpeg_1.probe)(tools, out);
        strict_1.default.ok(info.hasAudio && info.durationSec > 15);
    });
    (0, node_test_1.it)('con efectos de sonido el montaje dura solo lo pedido, no hasta el final del directo (antes se codificaba todo el resto)', async () => {
        const out = node_path_1.default.join(root, 'tramo-sfx.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 5, end: 11, effects: [{ type: 'sfx', at: 2, sound: 'whoosh' }, { type: 'polish' }] }, out);
        const info = await (0, ffmpeg_1.probe)(tools, out);
        strict_1.default.ok(Math.abs(info.durationSec - 6) < 1, `dura ${info.durationSec} s, debería durar 6`);
        const out2 = node_path_1.default.join(root, 'largo-tramos-sfx.mp4');
        await (0, ffmpeg_1.renderLong)(tools, src, { title: 't', segments: [{ start: 2, end: 8 }, { start: 12, end: 16 }], effects: [{ type: 'sfx', at: 3, sound: 'pop' }, { type: 'sfx', at: 13, sound: 'hit' }] }, out2);
        const i2 = await (0, ffmpeg_1.probe)(tools, out2);
        strict_1.default.ok(Math.abs(i2.durationSec - 10) < 1.2, `dura ${i2.durationSec} s, debería durar 10`);
    });
    (0, node_test_1.it)('un efecto de sonido de verdad se oye (el audio con sfx no es idéntico al original)', async () => {
        const plain = node_path_1.default.join(root, 'plain.mp4');
        const withFx = node_path_1.default.join(root, 'withfx.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 0, end: 6 }, plain);
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 0, end: 6, effects: [{ type: 'sfx', at: 2, sound: 'hit' }] }, withFx);
        const peakOf = (f) => {
            const r = (0, node_child_process_1.spawnSync)(tools.ffmpeg, ['-hide_banner', '-i', f, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
            return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
        };
        const [a, b] = [peakOf(plain), peakOf(withFx)];
        strict_1.default.ok(Number.isFinite(a) && Number.isFinite(b));
        strict_1.default.notEqual(a, b);
    });
});

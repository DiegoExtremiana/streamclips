"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const helpers_1 = require("./helpers");
const layout_1 = require("../shared/layout");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
let root;
let split;
(0, node_test_1.before)(() => {
    root = (0, helpers_1.tmpDir)();
    split = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'split.mp4'), { split: true, dur: 12 }); // izquierda roja, derecha azul
});
(0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
const oneWindow = (cx) => {
    const l = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(1), 16 / 9);
    l.windows[0].src = (0, layout_1.fitSrc)(l.windows[0].dst, cx, 0.5, 0.5, 16 / 9);
    return l;
};
(0, node_test_1.describe)('Biblioteca: composición vertical de un clip', () => {
    (0, node_test_1.it)('se guarda con el clip, cambia solo la versión vertical visible y se conserva al recortar', async () => {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const vod = (0, helpers_1.addDownloadedVod)(env, split);
        const clip = await env.ctx.clips.createClip(vod.id, { kind: 'both', start: 2, end: 6, title: 'Clip', cropX: 0 });
        strict_1.default.equal(clip.layout, undefined);
        strict_1.default.equal((0, helpers_1.dominantColor)(clip.files.vertical, 1), 'red');
        const blue = await env.ctx.library.reeditClip(clip.id, { layout: oneWindow(0.85) });
        strict_1.default.equal(blue.layout?.windows.length, 1);
        strict_1.default.equal((0, helpers_1.dominantColor)(blue.files.vertical, 1), 'blue');
        const trimmed = await env.ctx.library.reeditClip(clip.id, { start: 3, end: 5 }); // sin layout nuevo: se conserva
        strict_1.default.equal((0, helpers_1.dominantColor)(trimmed.files.vertical, 1), 'blue');
        strict_1.default.deepEqual(trimmed.layout, blue.layout);
        const back = await env.ctx.library.reeditClip(clip.id, { layout: null, cropX: 0 }); // vuelve al encuadre simple
        strict_1.default.equal(back.layout, undefined);
        strict_1.default.equal((0, helpers_1.dominantColor)(back.files.vertical, 1), 'red');
    });
    (0, node_test_1.it)('un encuadre simple nuevo sustituye a la composición; una composición no válida se rechaza sin tocar nada', async () => {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const vod = (0, helpers_1.addDownloadedVod)(env, split);
        const clip = await env.ctx.clips.createClip(vod.id, { kind: 'both', start: 2, end: 6, title: 'Clip' });
        await env.ctx.library.reeditClip(clip.id, { layout: oneWindow(0.85) });
        const simple = await env.ctx.library.reeditClip(clip.id, { cropX: 0 });
        strict_1.default.equal(simple.layout, undefined);
        const before = { ...env.ctx.store.data.outputs[0].files };
        const bad = (0, layout_1.layoutFromPreset)((0, layout_1.defaultPreset)(2), 16 / 9);
        bad.windows[0].src.x = 0.95;
        await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { layout: bad }), /Composición no válida/);
        strict_1.default.deepEqual(env.ctx.store.data.outputs[0].files, before);
    });
    (0, node_test_1.it)('un vídeo largo no admite composición', async () => {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const vod = (0, helpers_1.addDownloadedVod)(env, split);
        const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 3 }] });
        await strict_1.default.rejects(env.ctx.library.reeditClip(long.id, { layout: oneWindow(0.5) }), /solo se pueden cambiar los subtítulos/);
    });
});

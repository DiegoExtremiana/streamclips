"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const categories_1 = require("../shared/categories");
const helpers_1 = require("./helpers");
const CH = [
    { start: 0, end: 100, title: 'Minecraft' },
    { start: 100, end: 200, title: 'Just Chatting' },
    { start: 200, end: 300, title: 'Minecraft' },
];
(0, node_test_1.describe)('categorías de Twitch', () => {
    (0, node_test_1.it)('lee los capítulos de yt-dlp y descarta lo inválido', () => {
        const txt = JSON.stringify([{ start_time: 0, end_time: 50, title: 'Pokémon' }, { start_time: 60, end_time: 55, title: 'x' }, { title: 'sin tiempos' }]);
        strict_1.default.deepEqual((0, categories_1.parseChapters)(`${txt}\n`), [{ start: 0, end: 50, title: 'Pokémon' }]);
        strict_1.default.deepEqual((0, categories_1.parseChapters)('null'), []);
        strict_1.default.deepEqual((0, categories_1.parseChapters)('basura'), []);
    });
    (0, node_test_1.it)('detecta tramos que mezclan categorías, con tolerancia en el borde', () => {
        strict_1.default.equal((0, categories_1.mixedCategories)(CH, [{ start: 10, end: 90 }]), null);
        strict_1.default.match((0, categories_1.mixedCategories)(CH, [{ start: 90, end: 130 }]) ?? '', /Minecraft.*Just Chatting/);
        strict_1.default.equal((0, categories_1.mixedCategories)(CH, [{ start: 20, end: 101.5 }]), null, 'un par de segundos de borde no cuentan');
        strict_1.default.match((0, categories_1.mixedCategories)(CH, [{ start: 10, end: 20 }, { start: 150, end: 160 }]) ?? '', /2 categorías/);
        strict_1.default.equal((0, categories_1.mixedCategories)([{ start: 0, end: 300, title: 'Solo' }], [{ start: 0, end: 300 }]), null);
        strict_1.default.deepEqual((0, categories_1.categoriesOf)(CH, { start: 0, end: 300 }), ['Minecraft', 'Just Chatting']);
    });
    (0, node_test_1.it)('recorta un tramo a la categoría donde más está, o lo descarta si queda demasiado corto', () => {
        strict_1.default.deepEqual((0, categories_1.fitToCategory)({ start: 80, end: 160 }, CH, 15), { start: 100, end: 160 });
        strict_1.default.deepEqual((0, categories_1.fitToCategory)({ start: 60, end: 110 }, CH, 15), { start: 60, end: 100 });
        strict_1.default.equal((0, categories_1.fitToCategory)({ start: 95, end: 110 }, CH, 15), null);
        strict_1.default.deepEqual((0, categories_1.fitToCategory)({ start: 5, end: 9 }, [CH[0]], 15), { start: 5, end: 9 }, 'con una sola categoría no se toca');
    });
    (0, node_test_1.it)('el resumen se queda con la categoría que más tiempo suma', () => {
        const r = (0, categories_1.dominantCategory)([{ start: 10, end: 60 }, { start: 90, end: 130 }, { start: 210, end: 280 }], CH, 8);
        strict_1.default.equal(r.category, 'Minecraft');
        strict_1.default.deepEqual(r.segs, [{ start: 10, end: 60 }, { start: 90, end: 100 }, { start: 210, end: 280 }]);
    });
});
(0, node_test_1.describe)('línea «Categoría:»', () => {
    (0, node_test_1.it)('categoryOf elige la que más tiempo ocupa', () => {
        strict_1.default.equal((0, categories_1.categoryOf)(CH, [{ start: 80, end: 160 }]), 'Just Chatting');
        strict_1.default.equal((0, categories_1.categoryOf)(CH, [{ start: 400, end: 410 }]), undefined);
    });
    (0, node_test_1.it)('se añade al final de la descripción, sin duplicarse, y funciona con descripción vacía', () => {
        strict_1.default.equal((0, categories_1.withCategoryLine)('Un susto con un creeper.', 'Minecraft'), 'Un susto con un creeper.\n\nCategoría: Minecraft');
        strict_1.default.equal((0, categories_1.withCategoryLine)('Un susto.\n\nCategoría: Minecraft', 'Pokémon Champions'), 'Un susto.\n\nCategoría: Pokémon Champions');
        strict_1.default.equal((0, categories_1.withCategoryLine)('', 'Just Chatting'), 'Categoría: Just Chatting');
        strict_1.default.equal((0, categories_1.withCategoryLine)('Texto\n\nCategoría: X', undefined), 'Texto');
        strict_1.default.ok((0, categories_1.hasCategoryLine)('a\n\nCategoría: b') && !(0, categories_1.hasCategoryLine)('a'));
    });
});
(0, node_test_1.describe)('categorías: no se mezclan al crear clips y vídeos', () => {
    let e;
    let calls = 0;
    let vodId;
    (0, node_test_1.before)(() => {
        const root = (0, helpers_1.tmpDir)();
        e = (0, helpers_1.makeEnv)({ fetchChapters: async () => { calls++; return [{ start: 0, end: 20, title: 'Minecraft' }, { start: 20, end: 40, title: 'Just Chatting' }]; } }, root);
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(e.outputDir, 'vods', 'cat.mp4'), { w: 640, h: 360, dur: 40 });
        vodId = (0, helpers_1.addDownloadedVod)(e, src).id;
    });
    (0, node_test_1.after)(() => e.cleanup());
    (0, node_test_1.it)('un clip dentro de una categoría se crea; uno que cruza el cambio se rechaza con el motivo', async () => {
        const ok = await e.ctx.clips.createClip(vodId, { kind: 'horizontal', start: 2, end: 10, title: 'Bien' });
        strict_1.default.equal(ok.kind, 'clip');
        strict_1.default.equal(ok.category, 'Minecraft');
        await strict_1.default.rejects(e.ctx.clips.createClip(vodId, { kind: 'horizontal', start: 12, end: 30, title: 'Mezcla' }), /Minecraft.*Just Chatting/);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 1);
    });
    (0, node_test_1.it)('un vídeo largo con tramos de dos categorías se rechaza; con una sola, no', async () => {
        await strict_1.default.rejects(e.ctx.clips.createLong(vodId, { title: 'Mezcla', segments: [{ start: 2, end: 8 }, { start: 25, end: 32 }] }), /2 categorías/);
        const ok = await e.ctx.clips.createLong(vodId, { title: 'Una', segments: [{ start: 2, end: 8 }, { start: 10, end: 16 }] });
        strict_1.default.equal(ok.kind, 'long');
    });
    (0, node_test_1.it)('las categorías se piden una sola vez y se guardan en el VOD', () => {
        strict_1.default.equal(calls, 1);
        strict_1.default.equal(e.ctx.store.data.vods[0].chapters?.length, 2);
    });
});

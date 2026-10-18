import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { categoriesOf, categoryOf, hasCategoryLine, withCategoryLine, dominantCategory, fitToCategory, mixedCategories, parseChapters, type Chapter } from '../shared/categories';
import { addDownloadedVod, makeEnv, makeVideo, tmpDir, type TestEnv } from './helpers';

const CH: Chapter[] = [
  { start: 0, end: 100, title: 'Minecraft' },
  { start: 100, end: 200, title: 'Just Chatting' },
  { start: 200, end: 300, title: 'Minecraft' },
];

describe('categorías de Twitch', () => {
  it('lee los capítulos de yt-dlp y descarta lo inválido', () => {
    const txt = JSON.stringify([{ start_time: 0, end_time: 50, title: 'Pokémon' }, { start_time: 60, end_time: 55, title: 'x' }, { title: 'sin tiempos' }]);
    assert.deepEqual(parseChapters(`${txt}\n`), [{ start: 0, end: 50, title: 'Pokémon' }]);
    assert.deepEqual(parseChapters('null'), []);
    assert.deepEqual(parseChapters('basura'), []);
  });

  it('detecta tramos que mezclan categorías, con tolerancia en el borde', () => {
    assert.equal(mixedCategories(CH, [{ start: 10, end: 90 }]), null);
    assert.match(mixedCategories(CH, [{ start: 90, end: 130 }]) ?? '', /Minecraft.*Just Chatting/);
    assert.equal(mixedCategories(CH, [{ start: 20, end: 101.5 }]), null, 'un par de segundos de borde no cuentan');
    assert.match(mixedCategories(CH, [{ start: 10, end: 20 }, { start: 150, end: 160 }]) ?? '', /2 categorías/);
    assert.equal(mixedCategories([{ start: 0, end: 300, title: 'Solo' }], [{ start: 0, end: 300 }]), null);
    assert.deepEqual(categoriesOf(CH, { start: 0, end: 300 }), ['Minecraft', 'Just Chatting']);
  });

  it('recorta un tramo a la categoría donde más está, o lo descarta si queda demasiado corto', () => {
    assert.deepEqual(fitToCategory({ start: 80, end: 160 }, CH, 15), { start: 100, end: 160 });
    assert.deepEqual(fitToCategory({ start: 60, end: 110 }, CH, 15), { start: 60, end: 100 });
    assert.equal(fitToCategory({ start: 95, end: 110 }, CH, 15), null);
    assert.deepEqual(fitToCategory({ start: 5, end: 9 }, [CH[0]], 15), { start: 5, end: 9 }, 'con una sola categoría no se toca');
  });

  it('el resumen se queda con la categoría que más tiempo suma', () => {
    const r = dominantCategory([{ start: 10, end: 60 }, { start: 90, end: 130 }, { start: 210, end: 280 }], CH, 8);
    assert.equal(r.category, 'Minecraft');
    assert.deepEqual(r.segs, [{ start: 10, end: 60 }, { start: 90, end: 100 }, { start: 210, end: 280 }]);
  });
});

describe('línea «Categoría:»', () => {
  it('categoryOf elige la que más tiempo ocupa', () => {
    assert.equal(categoryOf(CH, [{ start: 80, end: 160 }]), 'Just Chatting');
    assert.equal(categoryOf(CH, [{ start: 400, end: 410 }]), undefined);
  });
  it('se añade al final de la descripción, sin duplicarse, y funciona con descripción vacía', () => {
    assert.equal(withCategoryLine('Un susto con un creeper.', 'Minecraft'), 'Un susto con un creeper.\n\nCategoría: Minecraft');
    assert.equal(withCategoryLine('Un susto.\n\nCategoría: Minecraft', 'Pokémon Champions'), 'Un susto.\n\nCategoría: Pokémon Champions');
    assert.equal(withCategoryLine('', 'Just Chatting'), 'Categoría: Just Chatting');
    assert.equal(withCategoryLine('Texto\n\nCategoría: X', undefined), 'Texto');
    assert.ok(hasCategoryLine('a\n\nCategoría: b') && !hasCategoryLine('a'));
  });
});

describe('categorías: no se mezclan al crear clips y vídeos', () => {
  let e: TestEnv;
  let calls = 0;
  let vodId: string;
  before(() => {
    const root = tmpDir();
    e = makeEnv({ fetchChapters: async () => { calls++; return [{ start: 0, end: 20, title: 'Minecraft' }, { start: 20, end: 40, title: 'Just Chatting' }]; } }, root);
    const src = makeVideo(path.join(e.outputDir, 'vods', 'cat.mp4'), { w: 640, h: 360, dur: 40 });
    vodId = addDownloadedVod(e, src).id;
  });
  after(() => e.cleanup());

  it('un clip dentro de una categoría se crea; uno que cruza el cambio se rechaza con el motivo', async () => {
    const ok = await e.ctx.clips.createClip(vodId, { kind: 'horizontal', start: 2, end: 10, title: 'Bien' });
    assert.equal(ok.kind, 'clip');
    assert.equal(ok.category, 'Minecraft');
    await assert.rejects(e.ctx.clips.createClip(vodId, { kind: 'horizontal', start: 12, end: 30, title: 'Mezcla' }), /Minecraft.*Just Chatting/);
    assert.equal(e.ctx.store.data.outputs.length, 1);
  });

  it('un vídeo largo con tramos de dos categorías se rechaza; con una sola, no', async () => {
    await assert.rejects(e.ctx.clips.createLong(vodId, { title: 'Mezcla', segments: [{ start: 2, end: 8 }, { start: 25, end: 32 }] }), /2 categorías/);
    const ok = await e.ctx.clips.createLong(vodId, { title: 'Una', segments: [{ start: 2, end: 8 }, { start: 10, end: 16 }] });
    assert.equal(ok.kind, 'long');
  });

  it('las categorías se piden una sola vez y se guardan en el VOD', () => {
    assert.equal(calls, 1);
    assert.equal(e.ctx.store.data.vods[0].chapters?.length, 2);
  });
});

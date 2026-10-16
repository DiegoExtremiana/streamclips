import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectSeries, seriesFor, seriesTitles } from '../shared/series';

describe('series de directos', () => {
  it('detecta serie y día en el título del directo', () => {
    assert.deepEqual(detectSeries('Minecraft Extremo Día 3'), { name: 'Minecraft Extremo', day: 3 });
    assert.deepEqual(detectSeries('MINECRAFT EXTREMO - dia 12 | Directo'), { name: 'MINECRAFT EXTREMO', day: 12 });
    assert.deepEqual(detectSeries('Locke en chanclas: Episodio 7'), { name: 'Locke en chanclas', day: 7 });
    assert.equal(detectSeries('Jugando a cosas'), null);
    assert.equal(detectSeries('Día 3'), null, 'sin nombre de serie no vale');
    assert.equal(detectSeries('Hoy es un gran día 0'), null);
  });
  it('usa la serie configurada cuando el título no dice nada', () => {
    assert.deepEqual(seriesFor('Directo', { name: ' Minecraft extremo ', nextDay: 4 }), { name: 'Minecraft extremo', day: 4, fromTitle: false });
    assert.equal(seriesFor('Directo', { name: '', nextDay: 1 }), null);
    assert.equal(seriesFor('Minecraft extremo día 9', { name: 'Otra', nextDay: 1 })?.day, 9, 'el título manda');
    assert.equal(seriesFor('Minecraft extremo día 9', { name: 'Otra', nextDay: 1 })?.fromTitle, true);
  });
  it('nombra el resumen y las partes', () => {
    assert.deepEqual(seriesTitles({ name: 'Minecraft extremo', day: 1 }, 1), { summary: 'Minecraft extremo Día 1 - Resumen', mains: ['Minecraft extremo Día 1'] });
    assert.deepEqual(seriesTitles({ name: 'Minecraft extremo', day: 2 }, 3).mains, ['Minecraft extremo Día 2 - Parte 1', 'Minecraft extremo Día 2 - Parte 2', 'Minecraft extremo Día 2 - Parte 3']);
  });
});

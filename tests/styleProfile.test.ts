import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addLore, cleanStyle, defaultStyle, loreIn, patchStyle, removeLore } from '../shared/styleProfile';

describe('perfil de estilo', () => {
  it('los valores por defecto son los de la entrevista', () => {
    const d = defaultStyle();
    assert.equal(d.silenceMaxSec, 2);
    assert.equal(d.shortShotMaxSec, 3);
    assert.deepEqual([d.shortMinSec, d.shortMaxSec, d.longMinSec, d.longMaxSec], [15, 120, 600, 900]);
    assert.equal(d.subtitlesDefaultOn, false);
    assert.equal(d.titleStyle, 'estetico');
    assert.equal(d.music.royaltyFreeOnly, true);
    assert.ok(d.music.level <= 0.2, 'la música va baja');
  });

  it('lo que llega roto se sanea sin perder lo bueno', () => {
    const c = cleanStyle({ silenceMaxSec: 'x', shortShotMaxSec: 99999, shortMinSec: 100, shortMaxSec: 20, titleStyle: 'raro', music: { level: 7, genre: '  jazz ' } });
    assert.equal(c.silenceMaxSec, 2);
    assert.equal(c.shortShotMaxSec, 30);
    assert.equal(c.shortMaxSec, 100, 'el máximo nunca baja del mínimo');
    assert.equal(c.titleStyle, 'estetico');
    assert.equal(c.music.level, 0.5);
    assert.equal(c.music.genre, 'jazz');
    assert.deepEqual(cleanStyle(null), defaultStyle());
  });

  it('patchStyle cambia solo lo que se pide', () => {
    const p = patchStyle(defaultStyle(), { silenceMaxSec: 1.5, music: { enabled: false } });
    assert.equal(p.silenceMaxSec, 1.5);
    assert.equal(p.music.enabled, false);
    assert.equal(p.music.genre, 'lofi');
    assert.equal(p.longMaxSec, 900);
  });

  it('el lore se añade, no admite duplicados ni vacíos y se quita', () => {
    let s = defaultStyle();
    s = addLore(s, 'El pollo', 'Chiste de 2021', ['pollo', ' POLLO ', 'el pollo']);
    assert.equal(s.lore.length, 1);
    assert.deepEqual(s.lore[0].triggers, ['pollo', 'el pollo']);
    assert.throws(() => addLore(s, 'el pollo'), /ya está/);
    assert.throws(() => addLore(s, '  '), /nombre/);
    s = removeLore(s, s.lore[0].id);
    assert.equal(s.lore.length, 0);
  });

  it('reconoce el lore nombrado en una transcripción', () => {
    const s = addLore(addLore(defaultStyle(), 'El pollo', '', ['pollo frito']), 'Gorens');
    assert.deepEqual(loreIn(s.lore, 'otra vez el POLLO FRITO, tío').map((l) => l.name), ['El pollo']);
    assert.deepEqual(loreIn(s.lore, 'dice gorens que sí').map((l) => l.name), ['Gorens']);
    assert.deepEqual(loreIn(s.lore, 'nada de nada'), []);
  });
});

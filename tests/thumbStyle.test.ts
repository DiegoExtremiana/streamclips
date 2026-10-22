import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCoverAss, candidateTimes, coverBadge, coverLines, coverText, frameScore, COVER_MAX_CHARS, COVER_MAX_WORDS } from '../shared/thumbStyle';

test('coverText: quita número de serie, emojis y palabras vacías y va en mayúsculas', () => {
  assert.equal(coverText('Minecraft extremo Día 12 - Resumen'), 'MINECRAFT EXTREMO');
  assert.equal(coverText('¡No me lo puedo creer! El mejor momento del directo'), '¡NO PUEDO CREER!');
  assert.equal(coverText('😱 Locura total 🔥'), 'LOCURA TOTAL');
});

test('coverText: nunca pasa del máximo de palabras y letras, ni queda vacío con un título normal', () => {
  const t = coverText('Una conversación larguísima sobre absolutamente todo lo que pasó ayer en el directo');
  assert.ok(t.split(' ').length <= COVER_MAX_WORDS);
  assert.ok(t.length <= COVER_MAX_CHARS, t);
  assert.ok(t.length > 0);
  assert.equal(coverText(''), '');
  assert.ok(coverText('Supercalifragilisticoespialidosoextraordinario').length <= COVER_MAX_CHARS);
});

test('coverBadge: número de episodio o día', () => {
  assert.equal(coverBadge('Pokémon Locke Toca Ep.9 - Algo'), 9);
  assert.equal(coverBadge('Minecraft Día 12 - Parte 2'), 12);
  assert.equal(coverBadge('Directo #7'), 7);
  assert.equal(coverBadge('Un clip sin número'), null);
});

test('coverLines: como mucho dos líneas equilibradas', () => {
  assert.deepEqual(coverLines('GOL'), ['GOL']);
  assert.deepEqual(coverLines('NO PUEDO CREER'), ['NO PUEDO', 'CREER']);
  assert.equal(coverLines('A B C').length <= 2, true);
  assert.deepEqual(coverLines(''), []);
});

test('buildCoverAss: texto, número y escape; null si no hay nada', () => {
  assert.equal(buildCoverAss('', null), null);
  const a = buildCoverAss('HOLA {X} MUNDO', 5)!;
  assert.match(a, /PlayResX: 1280/);
  assert.match(a, /Dialogue: 0,.*Hook/);
  assert.match(a, /Dialogue: 1,.*Badge,,0,0,0,,5$/m);
  assert.ok(!a.includes('{X}'), 'las llaves se eliminan');
  assert.ok(buildCoverAss('', 3)!.includes('Badge'));
  assert.ok(!buildCoverAss('', 3)!.includes('Hook,,'));
});

test('frameScore prefiere imágenes vivas y contrastadas a las apagadas u oscuras', () => {
  const vivid = frameScore({ satAvg: 80, yLow: 10, yHigh: 230, yAvg: 120 });
  const dull = frameScore({ satAvg: 10, yLow: 90, yHigh: 130, yAvg: 110 });
  const black = frameScore({ satAvg: 0, yLow: 16, yHigh: 17, yAvg: 16 });
  assert.ok(vivid > dull && dull > black);
});

test('candidateTimes: dentro del vídeo, ordenados y sin extremos', () => {
  const t = candidateTimes(100);
  assert.equal(t.length, 6);
  assert.ok(t[0] > 0 && t[t.length - 1] < 100);
  assert.deepEqual([...t].sort((a, b) => a - b), t);
  assert.deepEqual(candidateTimes(0.5), [0.25]);
  assert.equal(candidateTimes(3).length <= 3, true);
});

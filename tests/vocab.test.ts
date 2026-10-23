import assert from 'node:assert/strict';
import test from 'node:test';
import type { Word } from '../shared/subtitles';
import { applyVocabulary, cleanVocabulary, emptyVocabulary, formatVocabText, learnCorrections, mergeCorrections, normToken, parseVocabText, phonetic, similarity, whisperPrompt } from '../shared/vocab';
import { applyLineChanges, editableLines } from '../shared/subtitleEdit';

const w = (text: string, start: number, end = start + 0.3): Word => ({ text, start, end });
const texts = (ws: Word[]) => ws.map((x) => x.text);

test('por defecto trae las palabras del streamer', () => {
  const v = emptyVocabulary();
  for (const t of ['Movidas', 'Marrshall', 'MovidasMarshall', 'Gorens', 'Reaptor']) assert.ok(v.terms.includes(t), t);
});

test('normToken y phonetic: sin tildes ni mayúsculas, y suenan parecido', () => {
  assert.equal(normToken('¡Increíble!'), 'increible');
  assert.ok(similarity(phonetic('Marshall'), phonetic('Marsal')) >= 0.72);
  assert.ok(similarity(phonetic('Marshall'), phonetic('Marsan')) >= 0.72);
  assert.notEqual(phonetic('casa'), phonetic('perro'));
});

test('correcciones exactas de una y de varias palabras, con puntuación y tiempos', () => {
  const v = { terms: [], corrections: [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }, { from: 'gorenz', to: 'Gorens', n: 2 }] };
  const ws = [w('Hola,', 0), w('Movidas', 1, 1.5), w('Marsan.', 1.5, 2), w('y', 2.5), w('Gorenz!', 3, 3.4)];
  const out = applyVocabulary(ws, v);
  assert.deepEqual(texts(out), ['Hola,', 'MovidasMarshall.', 'y', 'Gorens!']);
  assert.deepEqual([out[1].start, out[1].end], [1, 2]);
});

test('parecido con un término largo: corrige lo que suena casi igual y respeta lo demás', () => {
  const v = { terms: ['Marrshall', 'Reaptor', 'Gorens'], corrections: [] };
  const out = applyVocabulary([w('Marsal', 0), w('el', 1), w('Reptor', 2), w('gorras', 3), w('Marrshall', 4), w('casa', 5)], v);
  assert.deepEqual(texts(out), ['Marrshall', 'el', 'Reaptor', 'gorras', 'Marrshall', 'casa']);
});

test('sin vocabulario o sin coincidencias devuelve las mismas palabras', () => {
  const ws = [w('hola', 0), w('mundo', 1)];
  assert.equal(applyVocabulary(ws, { terms: [], corrections: [] }), ws);
  assert.deepEqual(texts(applyVocabulary(ws, { terms: ['Marrshall'], corrections: [] })), ['hola', 'mundo']);
});

test('whisperPrompt: solo ASCII, corto, con el contexto del directo', () => {
  const p = whisperPrompt({ terms: ['Movidas', 'Pokémon', 'Ñandú'], corrections: [{ from: 'x', to: 'Marshall', n: 1 }] }, ['DÍA TOP: POKE-SURVIVOR || PRIME']);
  assert.ok(/^[\x20-\x7e]*$/.test(p), p);
  assert.ok(p.includes('Movidas') && p.includes('Pokemon') && p.includes('Marshall') && p.includes('POKE-SURVIVOR'));
  assert.ok(p.length <= 480);
  assert.equal(whisperPrompt({ terms: [], corrections: [] }), '');
});

test('parseVocabText / formatVocabText: términos y «mal => bien»', () => {
  const v = parseVocabText('Movidas\n\nmarsan => Marshall\n  Gorens  \nmovidas\nreptor = Reaptor');
  assert.deepEqual(v.terms, ['Movidas', 'Gorens']);
  assert.deepEqual(v.corrections.map((c) => [c.from, c.to]), [['marsan', 'Marshall'], ['reptor', 'Reaptor']]);
  assert.equal(formatVocabText(v), 'Movidas\nGorens\nmarsan => Marshall\nreptor => Reaptor');
  assert.deepEqual(parseVocabText(formatVocabText(v)).corrections.length, 2);
});

test('cleanVocabulary: tolera basura y vuelve a las palabras por defecto si no hay lista', () => {
  assert.deepEqual(cleanVocabulary(undefined).terms, emptyVocabulary().terms);
  const v = cleanVocabulary({ terms: ['a', 3, '', 'A'], corrections: [{ from: 'x', to: 'y', n: -4 }, { from: 5 }, null] });
  assert.deepEqual(v.terms, ['a']);
  assert.deepEqual(v.corrections, [{ from: 'x', to: 'y', n: 1 }]);
  assert.deepEqual(cleanVocabulary({ terms: [] }).terms, []);
});

test('learnCorrections: aprende cambios pequeños y no palabras corrientes', () => {
  assert.deepEqual(learnCorrections(['hola', 'movidas', 'marsan', 'como'], ['hola', 'MovidasMarshall', 'como']), [{ from: 'movidas marsan', to: 'MovidasMarshall' }]);
  assert.deepEqual(learnCorrections(['el', 'reptor', 'ataca'], ['el', 'Reaptor', 'ataca']), [{ from: 'reptor', to: 'Reaptor' }]);
  assert.deepEqual(learnCorrections(['yo', 'voy'], ['tu', 'voy']), [], 'una palabra corriente no se aprende');
  assert.deepEqual(learnCorrections(['igual', 'texto'], ['igual', 'texto']), []);
  assert.deepEqual(learnCorrections(['a', 'b', 'c', 'd', 'e'], ['x', 'y', 'z', 'q', 'r']), [], 'cambios enormes no se aprenden');
});

test('mergeCorrections: suma, actualiza y cuenta', () => {
  const m = mergeCorrections([{ from: 'Reptor', to: 'Reaptor', n: 1 }], [{ from: 'reptor', to: 'Reaptor' }, { from: 'gorenz', to: 'Gorens' }]);
  assert.deepEqual(m, [{ from: 'Reptor', to: 'Reaptor', n: 2 }, { from: 'gorenz', to: 'Gorens', n: 1 }]);
});

test('editableLines: agrupa por pausas y frases, y solo lo que conserva el vídeo', () => {
  const ws = [w('hola', 0), w('que', 0.4), w('tal.', 0.8), w('bien', 5), w('gracias', 5.4), w('fuera', 50)];
  const lines = editableLines(ws, [{ start: 0, end: 10 }]);
  assert.deepEqual(lines.map((l) => l.text), ['hola que tal.', 'bien gracias']);
  assert.deepEqual([lines[0].start, lines[0].end], [0, 1.1]);
  assert.equal(editableLines(ws, []).length, 0);
});

test('applyLineChanges: sustituye las palabras de la línea y deja el resto', () => {
  const ws = [w('hola', 0), w('movidas', 1), w('marsan', 1.5, 2), w('adios', 3)];
  const r = applyLineChanges(ws, [{ start: 1, end: 2, text: 'MovidasMarshall' }]);
  assert.deepEqual(texts(r.words), ['hola', 'MovidasMarshall', 'adios']);
  assert.deepEqual([r.words[1].start, r.words[1].end], [1, 2]);
  assert.deepEqual(r.changed, [{ before: ['movidas', 'marsan'], after: ['MovidasMarshall'] }]);
  // palabras pegadas: la línea que termina donde empieza la siguiente palabra no se la lleva
  const glued = [w('uno', 0, 1), w('dos', 1, 2), w('tres', 2, 3)];
  assert.deepEqual(texts(applyLineChanges(glued, [{ start: 0, end: 2, text: 'X' }]).words), ['X', 'tres']);
  // sin cambio de texto no se toca ni se aprende
  const same = applyLineChanges(ws, [{ start: 0, end: 0.3, text: 'hola' }]);
  assert.deepEqual(same.changed, []);
  assert.deepEqual(texts(same.words), texts(ws));
  // borrar una línea
  assert.deepEqual(texts(applyLineChanges(ws, [{ start: 3, end: 3.3, text: '' }]).words), ['hola', 'movidas', 'marsan']);
});

test('Pokémon y jerga competitiva: la lista incorporada corrige sin tocar la lista del usuario', () => {
  const v = emptyVocabulary();
  assert.ok(!v.terms.includes('Archaludon'), 'la lista del usuario no se llena con la incorporada');
  const ws = [w('Mi', 0), w('arkaludon', 1), w('gana', 2), w('el', 3), w('espid', 4), w('tai', 5), w('en', 6), w('be', 7), w('ge', 8), w('ce', 9), w('con', 10), w('nuzlock', 11)];
  const out = texts(applyVocabulary(ws, v));
  assert.ok(out.includes('Archaludon'), out.join(' '));
  assert.ok(out.includes('speed tie'), out.join(' '));
  assert.ok(out.includes('VGC'), out.join(' '));
  assert.ok(out.includes('Nuzlocke'), out.join(' '));
});

test('Pokémon: las palabras corrientes y los nombres bien escritos no se tocan', () => {
  const ws = 'la competición es una locura y el garaje de Pikachu y Gengar estaba cerca'.split(' ').map((t, i) => w(t, i));
  assert.deepEqual(texts(applyVocabulary(ws, emptyVocabulary())), texts(ws));
});

test('whisperPrompt: añade Pokémon solo si se piden y sigue en ASCII y bajo el límite', () => {
  const v = emptyVocabulary();
  assert.ok(!/Archaludon/.test(whisperPrompt(v, ['Just Chatting'])));
  const p = whisperPrompt(v, ['Pokémon VGC'], ['Archaludon', 'Pokémon Showdown']);
  assert.match(p, /Movidas/);
  assert.match(p, /Archaludon/);
  assert.ok(p.length <= 480);
  assert.ok(/^[\x20-\x7e]*$/.test(p), p);
});

test('looksLikePokemon reconoce el directo por el título y el juego', async () => {
  const { looksLikePokemon } = await import('../shared/vocabPokemon');
  assert.ok(looksLikePokemon(['Pokémon Escarlata', 'Directo']));
  assert.ok(looksLikePokemon(['Nuzlocke día 3']));
  assert.ok(!looksLikePokemon(['Minecraft', 'Día 3']));
});

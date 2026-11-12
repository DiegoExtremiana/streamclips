"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const vocab_1 = require("../shared/vocab");
const subtitleEdit_1 = require("../shared/subtitleEdit");
const w = (text, start, end = start + 0.3) => ({ text, start, end });
const texts = (ws) => ws.map((x) => x.text);
(0, node_test_1.default)('por defecto trae las palabras del streamer', () => {
    const v = (0, vocab_1.emptyVocabulary)();
    for (const t of ['Movidas', 'Marrshall', 'MovidasMarshall', 'Gorens', 'Reaptor'])
        strict_1.default.ok(v.terms.includes(t), t);
});
(0, node_test_1.default)('normToken y phonetic: sin tildes ni mayúsculas, y suenan parecido', () => {
    strict_1.default.equal((0, vocab_1.normToken)('¡Increíble!'), 'increible');
    strict_1.default.ok((0, vocab_1.similarity)((0, vocab_1.phonetic)('Marshall'), (0, vocab_1.phonetic)('Marsal')) >= 0.72);
    strict_1.default.ok((0, vocab_1.similarity)((0, vocab_1.phonetic)('Marshall'), (0, vocab_1.phonetic)('Marsan')) >= 0.72);
    strict_1.default.notEqual((0, vocab_1.phonetic)('casa'), (0, vocab_1.phonetic)('perro'));
});
(0, node_test_1.default)('correcciones exactas de una y de varias palabras, con puntuación y tiempos', () => {
    const v = { terms: [], corrections: [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }, { from: 'gorenz', to: 'Gorens', n: 2 }] };
    const ws = [w('Hola,', 0), w('Movidas', 1, 1.5), w('Marsan.', 1.5, 2), w('y', 2.5), w('Gorenz!', 3, 3.4)];
    const out = (0, vocab_1.applyVocabulary)(ws, v);
    strict_1.default.deepEqual(texts(out), ['Hola,', 'MovidasMarshall.', 'y', 'Gorens!']);
    strict_1.default.deepEqual([out[1].start, out[1].end], [1, 2]);
});
(0, node_test_1.default)('parecido con un término largo: corrige lo que suena casi igual y respeta lo demás', () => {
    const v = { terms: ['Marrshall', 'Reaptor', 'Gorens'], corrections: [] };
    const out = (0, vocab_1.applyVocabulary)([w('Marsal', 0), w('el', 1), w('Reptor', 2), w('gorras', 3), w('Marrshall', 4), w('casa', 5)], v);
    strict_1.default.deepEqual(texts(out), ['Marrshall', 'el', 'Reaptor', 'gorras', 'Marrshall', 'casa']);
});
(0, node_test_1.default)('sin vocabulario o sin coincidencias devuelve las mismas palabras', () => {
    const ws = [w('hola', 0), w('mundo', 1)];
    strict_1.default.equal((0, vocab_1.applyVocabulary)(ws, { terms: [], corrections: [] }), ws);
    strict_1.default.deepEqual(texts((0, vocab_1.applyVocabulary)(ws, { terms: ['Marrshall'], corrections: [] })), ['hola', 'mundo']);
});
(0, node_test_1.default)('whisperPrompt: solo ASCII, corto, con el contexto del directo', () => {
    const p = (0, vocab_1.whisperPrompt)({ terms: ['Movidas', 'Pokémon', 'Ñandú'], corrections: [{ from: 'x', to: 'Marshall', n: 1 }] }, ['DÍA TOP: POKE-SURVIVOR || PRIME']);
    strict_1.default.ok(/^[\x20-\x7e]*$/.test(p), p);
    strict_1.default.ok(p.includes('Movidas') && p.includes('Pokemon') && p.includes('Marshall') && p.includes('POKE-SURVIVOR'));
    strict_1.default.ok(p.length <= 480);
    strict_1.default.equal((0, vocab_1.whisperPrompt)({ terms: [], corrections: [] }), '');
});
(0, node_test_1.default)('parseVocabText / formatVocabText: términos y «mal => bien»', () => {
    const v = (0, vocab_1.parseVocabText)('Movidas\n\nmarsan => Marshall\n  Gorens  \nmovidas\nreptor = Reaptor');
    strict_1.default.deepEqual(v.terms, ['Movidas', 'Gorens']);
    strict_1.default.deepEqual(v.corrections.map((c) => [c.from, c.to]), [['marsan', 'Marshall'], ['reptor', 'Reaptor']]);
    strict_1.default.equal((0, vocab_1.formatVocabText)(v), 'Movidas\nGorens\nmarsan => Marshall\nreptor => Reaptor');
    strict_1.default.deepEqual((0, vocab_1.parseVocabText)((0, vocab_1.formatVocabText)(v)).corrections.length, 2);
});
(0, node_test_1.default)('cleanVocabulary: tolera basura y vuelve a las palabras por defecto si no hay lista', () => {
    strict_1.default.deepEqual((0, vocab_1.cleanVocabulary)(undefined).terms, (0, vocab_1.emptyVocabulary)().terms);
    const v = (0, vocab_1.cleanVocabulary)({ terms: ['a', 3, '', 'A'], corrections: [{ from: 'x', to: 'y', n: -4 }, { from: 5 }, null] });
    strict_1.default.deepEqual(v.terms, ['a']);
    strict_1.default.deepEqual(v.corrections, [{ from: 'x', to: 'y', n: 1 }]);
    strict_1.default.deepEqual((0, vocab_1.cleanVocabulary)({ terms: [] }).terms, []);
});
(0, node_test_1.default)('learnCorrections: aprende cambios pequeños y no palabras corrientes', () => {
    strict_1.default.deepEqual((0, vocab_1.learnCorrections)(['hola', 'movidas', 'marsan', 'como'], ['hola', 'MovidasMarshall', 'como']), [{ from: 'movidas marsan', to: 'MovidasMarshall' }]);
    strict_1.default.deepEqual((0, vocab_1.learnCorrections)(['el', 'reptor', 'ataca'], ['el', 'Reaptor', 'ataca']), [{ from: 'reptor', to: 'Reaptor' }]);
    strict_1.default.deepEqual((0, vocab_1.learnCorrections)(['yo', 'voy'], ['tu', 'voy']), [], 'una palabra corriente no se aprende');
    strict_1.default.deepEqual((0, vocab_1.learnCorrections)(['igual', 'texto'], ['igual', 'texto']), []);
    strict_1.default.deepEqual((0, vocab_1.learnCorrections)(['a', 'b', 'c', 'd', 'e'], ['x', 'y', 'z', 'q', 'r']), [], 'cambios enormes no se aprenden');
});
(0, node_test_1.default)('mergeCorrections: suma, actualiza y cuenta', () => {
    const m = (0, vocab_1.mergeCorrections)([{ from: 'Reptor', to: 'Reaptor', n: 1 }], [{ from: 'reptor', to: 'Reaptor' }, { from: 'gorenz', to: 'Gorens' }]);
    strict_1.default.deepEqual(m, [{ from: 'Reptor', to: 'Reaptor', n: 2 }, { from: 'gorenz', to: 'Gorens', n: 1 }]);
});
(0, node_test_1.default)('editableLines: agrupa por pausas y frases, y solo lo que conserva el vídeo', () => {
    const ws = [w('hola', 0), w('que', 0.4), w('tal.', 0.8), w('bien', 5), w('gracias', 5.4), w('fuera', 50)];
    const lines = (0, subtitleEdit_1.editableLines)(ws, [{ start: 0, end: 10 }]);
    strict_1.default.deepEqual(lines.map((l) => l.text), ['hola que tal.', 'bien gracias']);
    strict_1.default.deepEqual([lines[0].start, lines[0].end], [0, 1.1]);
    strict_1.default.equal((0, subtitleEdit_1.editableLines)(ws, []).length, 0);
});
(0, node_test_1.default)('applyLineChanges: sustituye las palabras de la línea y deja el resto', () => {
    const ws = [w('hola', 0), w('movidas', 1), w('marsan', 1.5, 2), w('adios', 3)];
    const r = (0, subtitleEdit_1.applyLineChanges)(ws, [{ start: 1, end: 2, text: 'MovidasMarshall' }]);
    strict_1.default.deepEqual(texts(r.words), ['hola', 'MovidasMarshall', 'adios']);
    strict_1.default.deepEqual([r.words[1].start, r.words[1].end], [1, 2]);
    strict_1.default.deepEqual(r.changed, [{ before: ['movidas', 'marsan'], after: ['MovidasMarshall'] }]);
    // palabras pegadas: la línea que termina donde empieza la siguiente palabra no se la lleva
    const glued = [w('uno', 0, 1), w('dos', 1, 2), w('tres', 2, 3)];
    strict_1.default.deepEqual(texts((0, subtitleEdit_1.applyLineChanges)(glued, [{ start: 0, end: 2, text: 'X' }]).words), ['X', 'tres']);
    // sin cambio de texto no se toca ni se aprende
    const same = (0, subtitleEdit_1.applyLineChanges)(ws, [{ start: 0, end: 0.3, text: 'hola' }]);
    strict_1.default.deepEqual(same.changed, []);
    strict_1.default.deepEqual(texts(same.words), texts(ws));
    // borrar una línea
    strict_1.default.deepEqual(texts((0, subtitleEdit_1.applyLineChanges)(ws, [{ start: 3, end: 3.3, text: '' }]).words), ['hola', 'movidas', 'marsan']);
});
(0, node_test_1.default)('Pokémon y jerga competitiva: la lista incorporada corrige sin tocar la lista del usuario', () => {
    const v = (0, vocab_1.emptyVocabulary)();
    strict_1.default.ok(!v.terms.includes('Archaludon'), 'la lista del usuario no se llena con la incorporada');
    const ws = [w('Mi', 0), w('arkaludon', 1), w('gana', 2), w('el', 3), w('espid', 4), w('tai', 5), w('en', 6), w('be', 7), w('ge', 8), w('ce', 9), w('con', 10), w('nuzlock', 11)];
    const out = texts((0, vocab_1.applyVocabulary)(ws, v));
    strict_1.default.ok(out.includes('Archaludon'), out.join(' '));
    strict_1.default.ok(out.includes('speed tie'), out.join(' '));
    strict_1.default.ok(out.includes('VGC'), out.join(' '));
    strict_1.default.ok(out.includes('Nuzlocke'), out.join(' '));
});
(0, node_test_1.default)('Pokémon: las palabras corrientes y los nombres bien escritos no se tocan', () => {
    const ws = 'la competición es una locura y el garaje de Pikachu y Gengar estaba cerca'.split(' ').map((t, i) => w(t, i));
    strict_1.default.deepEqual(texts((0, vocab_1.applyVocabulary)(ws, (0, vocab_1.emptyVocabulary)())), texts(ws));
});
(0, node_test_1.default)('whisperPrompt: añade Pokémon solo si se piden y sigue en ASCII y bajo el límite', () => {
    const v = (0, vocab_1.emptyVocabulary)();
    strict_1.default.ok(!/Archaludon/.test((0, vocab_1.whisperPrompt)(v, ['Just Chatting'])));
    const p = (0, vocab_1.whisperPrompt)(v, ['Pokémon VGC'], ['Archaludon', 'Pokémon Showdown']);
    strict_1.default.match(p, /Movidas/);
    strict_1.default.match(p, /Archaludon/);
    strict_1.default.ok(p.length <= 480);
    strict_1.default.ok(/^[\x20-\x7e]*$/.test(p), p);
});
(0, node_test_1.default)('looksLikePokemon reconoce el directo por el título y el juego', async () => {
    const { looksLikePokemon } = await Promise.resolve().then(() => __importStar(require('../shared/vocabPokemon')));
    strict_1.default.ok(looksLikePokemon(['Pokémon Escarlata', 'Directo']));
    strict_1.default.ok(looksLikePokemon(['Nuzlocke día 3']));
    strict_1.default.ok(!looksLikePokemon(['Minecraft', 'Día 3']));
});

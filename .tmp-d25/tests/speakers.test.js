"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const subtitles_1 = require("../shared/subtitles");
const speakers_1 = require("../shared/speakers");
const W = (text, start, end = start + 0.4, spk) => ({ text, start, end, ...(spk !== undefined ? { spk } : {}) });
(0, node_test_1.default)('assignSpeakers: cada palabra va al hablante que cubre su tiempo', () => {
    const ws = [W('hola', 1), W('qué', 1.5), W('tal', 6), W('bien', 6.5)];
    const out = (0, speakers_1.assignSpeakers)(ws, [{ start: 0, end: 4, speaker: 1 }, { start: 5, end: 9, speaker: 2 }]);
    strict_1.default.deepEqual(out.map((w) => w.spk), [1, 1, 2, 2]);
});
(0, node_test_1.default)('assignSpeakers: sin tramo, en el borde o con dos voces a la vez no se atribuye (nunca se inventa)', () => {
    const ws = [W('hueco', 10), W('borde', 4.8, 5.2), W('doble', 20, 20.4)];
    const out = (0, speakers_1.assignSpeakers)(ws, [{ start: 0, end: 5, speaker: 1 }, { start: 5, end: 9, speaker: 2 }, { start: 19, end: 22, speaker: 1 }, { start: 19.5, end: 22, speaker: 3 }]);
    strict_1.default.deepEqual(out.map((w) => w.spk), [undefined, undefined, undefined]);
    strict_1.default.ok(out.every((w) => !('spk' in w)), 'ni siquiera la clave');
});
(0, node_test_1.default)('assignSpeakers: una voz que domina claramente sobre otra solapada sí se atribuye', () => {
    const out = (0, speakers_1.assignSpeakers)([W('a', 10, 10.4)], [{ start: 9, end: 11, speaker: 1 }, { start: 10.3, end: 11, speaker: 2 }]);
    strict_1.default.equal(out[0].spk, 1);
});
(0, node_test_1.default)('assignSpeakers: borra una atribución anterior si ahora no hay seguridad', () => {
    const out = (0, speakers_1.assignSpeakers)([W('a', 50, 50.4, 7)], []);
    strict_1.default.equal(out[0].spk, undefined);
});
(0, node_test_1.default)('speakerStats ordena por tiempo hablado e ignora a los desconocidos', () => {
    const st = (0, speakers_1.speakerStats)([W('a', 0, 1, 1), W('b', 1, 4, 2), W('c', 4, 5, 2), W('d', 5, 6)]);
    strict_1.default.deepEqual(st.map((s) => [s.spk, s.words]), [[2, 2], [1, 1]]);
});
(0, node_test_1.default)('colorMap: el propio streamer en blanco y cada otro en un color distinto y estable', () => {
    const m = (0, speakers_1.colorMap)([5, 3, 9], 3);
    strict_1.default.equal(m[3], '#FFFFFF');
    strict_1.default.equal(new Set(Object.values(m)).size, 3);
    strict_1.default.deepEqual((0, speakers_1.colorMap)([5, 3, 9], 3), m);
    strict_1.default.notEqual(m[5], '#FFFFFF');
    // más hablantes que colores: se reutilizan sin romperse
    strict_1.default.equal(Object.keys((0, speakers_1.colorMap)(Array.from({ length: 20 }, (_, i) => i), 0)).length, 20);
});
(0, node_test_1.default)('matchProfile: reconoce una voz conocida, pero con duda o sin parecido es una voz nueva', () => {
    const p = (id, e) => ({ id, embedding: e, n: 1 });
    const known = [p(1, [1, 0, 0]), p(2, [0, 1, 0])];
    strict_1.default.equal((0, speakers_1.matchProfile)([0.95, 0.1, 0], known)?.id, 1);
    strict_1.default.equal((0, speakers_1.matchProfile)([0, 0, 1], known), null, 'no se parece a nadie');
    strict_1.default.equal((0, speakers_1.matchProfile)([1, 1, 0], known), null, 'igual de parecido a dos: duda');
    strict_1.default.equal((0, speakers_1.matchProfile)([1, 0, 0], []), null);
    strict_1.default.equal((0, speakers_1.cosine)([1, 2], [1, 2, 3]), 0);
});
(0, node_test_1.default)('updateProfile hace la media ponderada', () => {
    const u = (0, speakers_1.updateProfile)({ id: 1, embedding: [1, 0], n: 3 }, [0, 4], 1);
    strict_1.default.deepEqual(u.embedding, [0.75, 1]);
    strict_1.default.equal(u.n, 4);
});
(0, node_test_1.default)('los subtítulos parten el texto al cambiar de hablante y pintan a cada uno de su color', () => {
    const ws = [W('hola', 0, 0.4, 1), W('qué', 0.5, 0.9, 1), W('tal', 1.0, 1.4, 2), W('bien', 1.5, 1.9, 2), W('vale', 2.0, 2.4)];
    const cues = (0, subtitles_1.buildCues)(ws, subtitles_1.SUBTITLE_STYLES.clasico);
    strict_1.default.deepEqual(cues.map((c) => c.words.map((x) => x.text).join(' ')), ['hola qué', 'tal bien vale']);
    const ass = (0, subtitles_1.buildAss)(ws, subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080, { 1: '#FFE600', 2: '#5AB4FF' });
    strict_1.default.match(ass, /\{\\1c&H0000E6FF\}hola/);
    strict_1.default.match(ass, /\{\\1c&H00FFB45A\}tal/);
    strict_1.default.match(ass, /bien\{\\1c&H00FFFFFF\} vale/, 'la palabra de hablante desconocido usa el color del estilo');
    // sin mapa de colores no cambia nada respecto a antes
    strict_1.default.doesNotMatch((0, subtitles_1.buildAss)(ws, subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080), /\\1c/);
});
(0, node_test_1.default)('con resaltado palabra a palabra se mantiene el color del hablante', () => {
    const ws = [W('uno', 0, 0.4, 1), W('dos', 0.5, 0.9, 1)];
    const ass = (0, subtitles_1.buildAss)(ws, subtitles_1.SUBTITLE_STYLES.karaoke, 1920, 1080, { 1: '#5AB4FF' });
    strict_1.default.match(ass, /\{\\1c&H0000D4FF\}uno\{\\1c&H00FFB45A\} \{\\1c&H00FFB45A\}dos/);
});
(0, node_test_1.default)('wordsForOutput conserva el hablante de cada palabra', () => {
    const out = (0, subtitles_1.wordsForOutput)([W('a', 10, 10.4, 3), W('b', 11, 11.4)], [{ start: 9, end: 20 }]);
    strict_1.default.equal(out[0].spk, 3);
    strict_1.default.ok(!('spk' in out[1]));
});

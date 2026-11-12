import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAss, buildCues, SUBTITLE_STYLES, wordsForOutput, type Word } from '../shared/subtitles';
import { assignSpeakers, colorMap, cosine, matchProfile, speakerStats, updateProfile, type VoiceProfile } from '../shared/speakers';

const W = (text: string, start: number, end = start + 0.4, spk?: number): Word => ({ text, start, end, ...(spk !== undefined ? { spk } : {}) });

test('assignSpeakers: cada palabra va al hablante que cubre su tiempo', () => {
  const ws = [W('hola', 1), W('qué', 1.5), W('tal', 6), W('bien', 6.5)];
  const out = assignSpeakers(ws, [{ start: 0, end: 4, speaker: 1 }, { start: 5, end: 9, speaker: 2 }]);
  assert.deepEqual(out.map((w) => w.spk), [1, 1, 2, 2]);
});

test('assignSpeakers: sin tramo, en el borde o con dos voces a la vez no se atribuye (nunca se inventa)', () => {
  const ws = [W('hueco', 10), W('borde', 4.8, 5.2), W('doble', 20, 20.4)];
  const out = assignSpeakers(ws, [{ start: 0, end: 5, speaker: 1 }, { start: 5, end: 9, speaker: 2 }, { start: 19, end: 22, speaker: 1 }, { start: 19.5, end: 22, speaker: 3 }]);
  assert.deepEqual(out.map((w) => w.spk), [undefined, undefined, undefined]);
  assert.ok(out.every((w) => !('spk' in w)), 'ni siquiera la clave');
});

test('assignSpeakers: una voz que domina claramente sobre otra solapada sí se atribuye', () => {
  const out = assignSpeakers([W('a', 10, 10.4)], [{ start: 9, end: 11, speaker: 1 }, { start: 10.3, end: 11, speaker: 2 }]);
  assert.equal(out[0].spk, 1);
});

test('assignSpeakers: borra una atribución anterior si ahora no hay seguridad', () => {
  const out = assignSpeakers([W('a', 50, 50.4, 7)], []);
  assert.equal(out[0].spk, undefined);
});

test('speakerStats ordena por tiempo hablado e ignora a los desconocidos', () => {
  const st = speakerStats([W('a', 0, 1, 1), W('b', 1, 4, 2), W('c', 4, 5, 2), W('d', 5, 6)]);
  assert.deepEqual(st.map((s) => [s.spk, s.words]), [[2, 2], [1, 1]]);
});

test('colorMap: el propio streamer en blanco y cada otro en un color distinto y estable', () => {
  const m = colorMap([5, 3, 9], 3);
  assert.equal(m[3], '#FFFFFF');
  assert.equal(new Set(Object.values(m)).size, 3);
  assert.deepEqual(colorMap([5, 3, 9], 3), m);
  assert.notEqual(m[5], '#FFFFFF');
  // más hablantes que colores: se reutilizan sin romperse
  assert.equal(Object.keys(colorMap(Array.from({ length: 20 }, (_, i) => i), 0)).length, 20);
});

test('matchProfile: reconoce una voz conocida, pero con duda o sin parecido es una voz nueva', () => {
  const p = (id: number, e: number[]): VoiceProfile => ({ id, embedding: e, n: 1 });
  const known = [p(1, [1, 0, 0]), p(2, [0, 1, 0])];
  assert.equal(matchProfile([0.95, 0.1, 0], known)?.id, 1);
  assert.equal(matchProfile([0, 0, 1], known), null, 'no se parece a nadie');
  assert.equal(matchProfile([1, 1, 0], known), null, 'igual de parecido a dos: duda');
  assert.equal(matchProfile([1, 0, 0], []), null);
  assert.equal(cosine([1, 2], [1, 2, 3]), 0);
});

test('updateProfile hace la media ponderada', () => {
  const u = updateProfile({ id: 1, embedding: [1, 0], n: 3 }, [0, 4], 1);
  assert.deepEqual(u.embedding, [0.75, 1]);
  assert.equal(u.n, 4);
});

test('los subtítulos parten el texto al cambiar de hablante y pintan a cada uno de su color', () => {
  const ws = [W('hola', 0, 0.4, 1), W('qué', 0.5, 0.9, 1), W('tal', 1.0, 1.4, 2), W('bien', 1.5, 1.9, 2), W('vale', 2.0, 2.4)];
  const cues = buildCues(ws, SUBTITLE_STYLES.clasico);
  assert.deepEqual(cues.map((c) => c.words.map((x) => x.text).join(' ')), ['hola qué', 'tal bien vale']);
  const ass = buildAss(ws, SUBTITLE_STYLES.clasico, 1920, 1080, { 1: '#FFE600', 2: '#5AB4FF' });
  assert.match(ass, /\{\\1c&H0000E6FF\}hola/);
  assert.match(ass, /\{\\1c&H00FFB45A\}tal/);
  assert.match(ass, /bien\{\\1c&H00FFFFFF\} vale/, 'la palabra de hablante desconocido usa el color del estilo');
  // sin mapa de colores no cambia nada respecto a antes
  assert.doesNotMatch(buildAss(ws, SUBTITLE_STYLES.clasico, 1920, 1080), /\\1c/);
});

test('con resaltado palabra a palabra se mantiene el color del hablante', () => {
  const ws = [W('uno', 0, 0.4, 1), W('dos', 0.5, 0.9, 1)];
  const ass = buildAss(ws, SUBTITLE_STYLES.karaoke, 1920, 1080, { 1: '#5AB4FF' });
  assert.match(ass, /\{\\1c&H0000D4FF\}uno\{\\1c&H00FFB45A\} \{\\1c&H00FFB45A\}dos/);
});

test('wordsForOutput conserva el hablante de cada palabra', () => {
  const out = wordsForOutput([W('a', 10, 10.4, 3), W('b', 11, 11.4)], [{ start: 9, end: 20 }]);
  assert.equal(out[0].spk, 3);
  assert.ok(!('spk' in out[1]));
});

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planEdit, planLong } from '../shared/autoEdit';
import { validateClipSpec, validateLongSpec } from '../shared/plan';
import { keptRanges } from '../shared/timeline';
import { probe, renderClip, renderLong, validateRender } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { makeVideo, rmDir, tmpDir } from './helpers';
import type { Word } from '../shared/subtitles';

const mkWords = (spec: [string, number][]): Word[] => spec.map(([text, start]) => ({ text, start, end: start + 0.4 }));

// 0-12 s hablando, pausa de 5 s, 17-30 s hablando con una exclamación a los 22 s
const words = mkWords([
  ...Array.from({ length: 12 }, (_, i) => ['hola', i] as [string, number]),
  ...Array.from({ length: 10 }, (_, i) => ['seguimos', 17 + i * 0.5] as [string, number]),
  ['¡increíble!', 22],
  ...Array.from({ length: 10 }, (_, i) => ['vale', 23 + i * 0.7] as [string, number]),
]);

describe('edición profesional automática', () => {
  it('corta las pausas largas dejando un respiro, y no toca el habla continua', () => {
    const p = planEdit(words, { start: 0, end: 30 });
    assert.equal(p.cuts.length, 1);
    assert.ok(p.cuts[0].start > 11.5 && p.cuts[0].end < 17 && p.cuts[0].end - p.cuts[0].start > 3, JSON.stringify(p.cuts));
  });

  it('acerca la imagen con un golpe de sonido en la exclamación, un whoosh en el corte, fundidos y volumen parejo', () => {
    const p = planEdit(words, { start: 0, end: 30 });
    const punch = p.effects.filter((e) => e.type === 'punch');
    assert.equal(punch.length, 1);
    assert.ok(Math.abs((punch[0] as { at: number }).at - 21.9) < 0.2);
    const sounds = p.effects.filter((e) => e.type === 'sfx').map((e) => (e as { sound?: string }).sound);
    assert.deepEqual(sounds.sort(), ['hit', 'whoosh']);
    for (const t of ['fadeIn', 'fadeOut', 'polish']) assert.ok(p.effects.some((e) => e.type === t), t);
  });

  it('el plan siempre pasa la validación de clips y de vídeos largos', () => {
    const p = planEdit(words, { start: 0, end: 30 });
    assert.equal(validateClipSpec({ kind: 'both', start: 0, end: 30, title: 't', cuts: p.cuts, effects: p.effects }, 100), null);
    const l = planLong(words, [{ start: 0, end: 30 }]);
    assert.equal(validateLongSpec({ title: 't', segments: l.segments, effects: l.effects }, 100), null);
    assert.equal(l.segments.length, 2, 'la pausa parte el vídeo en dos tramos');
  });

  it('sin habla suficiente solo pone fundidos y volumen; nunca efectos fuera de lo conservado', () => {
    const p = planEdit([], { start: 0, end: 30 });
    assert.deepEqual(p.cuts, []);
    assert.deepEqual(p.effects.map((e) => e.type), ['fadeIn', 'fadeOut', 'polish']);
    const q = planEdit(words, { start: 0, end: 30 });
    const kept = keptRanges(0, 30, q.cuts);
    for (const e of q.effects) if ('at' in e) assert.ok(kept.some((r) => e.at >= r.start && e.at <= r.end));
  });
});

describe('edición profesional: render real', () => {
  const tools = resolveToolPaths('', '');
  let root: string;
  let src: string;
  before(() => {
    root = tmpDir();
    src = makeVideo(path.join(root, 'fx.mp4'), { w: 1280, h: 720, dur: 30, audio: true });
  });
  after(() => rmDir(root));

  it('clip con corte, acercamiento, sonidos, fundidos y volumen parejo: sale con la duración esperada y con audio', async () => {
    const p = planEdit(words, { start: 0, end: 30 });
    for (const kind of ['vertical', 'horizontal'] as const) {
      const out = path.join(root, `clip-${kind}.mp4`);
      await renderClip(tools, src, { kind, start: 0, end: 30, cuts: p.cuts, effects: p.effects }, out);
      const info = await probe(tools, out);
      const expected = 30 - p.cuts.reduce((a, c) => a + c.end - c.start, 0);
      assert.ok(Math.abs(info.durationSec - expected) < 1.5, `${kind}: ${info.durationSec} vs ${expected}`);
      assert.ok(info.hasAudio, `${kind} con audio`);
      await validateRender(tools, out, kind, info.durationSec);
    }
  });

  it('vídeo largo con varios tramos y los mismos efectos', async () => {
    const l = planLong(words, [{ start: 0, end: 30 }]);
    const out = path.join(root, 'long.mp4');
    await renderLong(tools, src, { title: 't', segments: l.segments, effects: l.effects }, out);
    const info = await probe(tools, out);
    assert.ok(info.hasAudio && info.durationSec > 15);
  });

  it('un efecto de sonido de verdad se oye (el audio con sfx no es idéntico al original)', async () => {
    const plain = path.join(root, 'plain.mp4');
    const withFx = path.join(root, 'withfx.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 0, end: 6 }, plain);
    await renderClip(tools, src, { kind: 'horizontal', start: 0, end: 6, effects: [{ type: 'sfx', at: 2, sound: 'hit' }] }, withFx);
    const peakOf = (f: string) => {
      const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-i', f, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' });
      return Number(/max_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1]);
    };
    const [a, b] = [peakOf(plain), peakOf(withFx)];
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
    assert.notEqual(a, b);
  });
});

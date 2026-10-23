import { describe, it, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { addDownloadedVod, fakeWhisper, installFakeModel, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  delete process.env.FAKE_LOG;
  while (envs.length) envs.pop()!.cleanup();
});

/** Directo de 4 min con dos "momentos" (ruido fuerte) hacia el segundo 60 y el 170. */
let root: string;
let video: string;
before(() => {
  root = tmpDir();
  video = path.join(root, 'live.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=240',
    '-f', 'lavfi', '-i', "aevalsrc='(0.02+0.9*(between(t,55,70)+between(t,165,180)))*sin(2*PI*300*t)':d=240:s=16000",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
});
after(() => rmDir(root));

function setup(auto: Record<string, unknown> = {}) {
  const e = makeEnv();
  envs.push(e);
  e.ctx.settings.set({ whisperPath: fakeWhisper(), whisperModel: 'tiny', whisperLanguage: 'es' });
  installFakeModel(e, 'tiny');
  const vod = addDownloadedVod(e, video);
  vod.title = 'DÍA TOP: LOCKE FALTABA con Marshall';
  e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false, ...auto } });
  return { e, vod };
}

describe('análisis rápido', () => {
  it('por defecto solo transcribe lo elegido (no el directo entero) y lo anota', async () => {
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    const v = e.ctx.store.data.vods[0];
    assert.equal(v.autopilot?.status, 'done');
    assert.equal(e.ctx.transcripts.isFull(vod.id), false, 'la transcripción es parcial');
    assert.equal(v.transcript?.partial, true);
    assert.ok(e.ctx.transcripts.words(vod.id).length > 0, 'hay palabras de lo elegido');
    assert.match(v.autopilot?.note ?? '', /Análisis rápido: se transcribieron \d+ min de 4/);
    assert.ok(e.ctx.store.data.outputs.length >= 3, 'monta resumen, vídeo principal y clips igualmente');
  });

  it('con el análisis rápido desactivado se transcribe todo el directo', async () => {
    const { e, vod } = setup({ fastAnalysis: false });
    await e.ctx.autopilot.run(vod.id);
    assert.equal(e.ctx.transcripts.isFull(vod.id), true);
    assert.doesNotMatch(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Análisis rápido/);
  });

  it('Whisper recibe el vocabulario y de qué va el directo (solo ASCII)', async () => {
    const log = path.join(root, `args-${Date.now()}.log`);
    process.env.FAKE_LOG = log;
    const { e, vod } = setup();
    await e.ctx.autopilot.run(vod.id);
    const runs = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    assert.ok(runs.length > 0);
    for (const args of runs) {
      const i = args.indexOf('--prompt');
      assert.ok(i >= 0, 'lleva --prompt');
      const p = args[i + 1];
      assert.ok(/^[\x20-\x7e]*$/.test(p), p);
      for (const t of ['Movidas', 'Marrshall', 'Gorens', 'Reaptor', 'LOCKE FALTABA']) assert.ok(p.includes(t), `${t} en «${p}»`);
    }
  });
});

describe('vocabulario y corrección de subtítulos', () => {
  const WORDS = [
    { text: 'hola', start: 1, end: 1.4 }, { text: 'movidas', start: 1.5, end: 2 }, { text: 'marsan', start: 2, end: 2.5 }, { text: 'como', start: 2.6, end: 3 },
    { text: 'va', start: 3, end: 3.3 }, { text: 'el', start: 8, end: 8.2 }, { text: 'reptor', start: 8.2, end: 8.8 }, { text: 'hoy.', start: 8.8, end: 9.2 },
  ];
  function withTranscript() {
    const { e, vod } = setup();
    const f = path.join(e.root, 't.json');
    fs.writeFileSync(f, JSON.stringify({ words: WORDS }));
    e.ctx.transcripts.importFile(vod.id, f);
    return { e, vod };
  }

  it('el vocabulario corrige lo que se lee sin tocar lo guardado, y también lo antiguo', () => {
    const { e, vod } = withTranscript();
    const before = e.ctx.transcripts.words(vod.id).map((w) => w.text);
    assert.ok(before.includes('Reaptor'), 'reptor → Reaptor por parecido: ' + before.join(' '));
    e.ctx.transcripts.setVocabulary({ terms: ['Marrshall'], corrections: [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }] });
    const after = e.ctx.transcripts.words(vod.id).map((w) => w.text);
    assert.deepEqual(after.slice(0, 3), ['hola', 'MovidasMarshall', 'como']);
    // lo guardado en disco sigue siendo lo que dijo Whisper
    const raw = JSON.parse(fs.readFileSync(path.join(e.userData, 'transcripts', fs.readdirSync(path.join(e.userData, 'transcripts'))[0]), 'utf8')) as { words: { text: string }[] };
    assert.ok(raw.words.some((w) => w.text === 'marsan'));
  });

  it('corregir el texto de una línea guarda las palabras y enseña al programa', () => {
    const { e, vod } = withTranscript();
    e.ctx.transcripts.setVocabulary({ terms: [], corrections: [] });
    const r = e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 3, text: 'hola MovidasMarshall como' }]);
    assert.equal(r.changed, 1);
    assert.deepEqual(r.learned, [{ from: 'movidas marsan', to: 'MovidasMarshall' }]);
    assert.deepEqual(e.ctx.transcripts.words(vod.id).map((w) => w.text).slice(0, 4), ['hola', 'MovidasMarshall', 'como', 'va']);
    const v = e.ctx.transcripts.vocabulary();
    assert.deepEqual(v.corrections, [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }]);
    assert.ok(v.terms.includes('MovidasMarshall'), 'un nombre propio nuevo pasa al vocabulario');
    // sin cambios no hay nada que aprender
    assert.equal(e.ctx.transcripts.editLines(vod.id, [{ start: 8, end: 8.2, text: 'el' }]).changed, 0);
  });

  it('lo aprendido se aplica solo a una transcripción nueva', () => {
    const { e, vod } = withTranscript();
    e.ctx.transcripts.setVocabulary({ terms: [], corrections: [] });
    e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 3, text: 'hola MovidasMarshall como' }]);
    const vod2 = addDownloadedVod(e, video, 'vod2');
    const f = path.join(e.root, 't2.json');
    fs.writeFileSync(f, JSON.stringify({ words: [{ text: 'ya', start: 1, end: 1.2 }, { text: 'Movidas', start: 1.3, end: 1.8 }, { text: 'Marsan,', start: 1.8, end: 2.3 }] }));
    e.ctx.transcripts.importFile(vod2.id, f);
    assert.deepEqual(e.ctx.transcripts.words(vod2.id).map((w) => w.text), ['ya', 'MovidasMarshall,']);
  });

  it('las correcciones no válidas se rechazan', () => {
    const { e, vod } = withTranscript();
    assert.throws(() => e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 2, text: 'x'.repeat(700) }]), /demasiado larga/);
    assert.throws(() => e.ctx.transcripts.editLines(vod.id, 'no' as never), /no son válidas/);
    assert.throws(() => e.ctx.transcripts.editLines('no-existe', []), /no existe/);
  });
});

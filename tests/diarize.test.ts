import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mergeClusters } from '../shared/speakers';
import { diarizeSamples, EMBEDDING_MODEL, downloadEmbeddingModel, embeddingInstalled, sherpaEngine, extractSamples, type DiarizeEngine } from '../electron/services/diarize';
import { tmpDir, rmDir } from './helpers';

const SR = 16000;
const unit = (i: number, n = 8) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0.02));

test('mergeClusters une los grupos que suenan igual y deja aparte los distintos', () => {
  // 0 y 5 son la misma voz, 7 y 8 también, 1 es distinta
  const e = new Map<number, number[]>([[0, unit(0)], [5, unit(0).map((x, i) => x + (i === 1 ? 0.1 : 0))], [1, unit(1)], [7, unit(2)], [8, unit(2).map((x, i) => x + (i === 3 ? 0.08 : 0))]]);
  const g = mergeClusters(e, 0.6);
  assert.equal(g.get(0), g.get(5));
  assert.equal(g.get(7), g.get(8));
  assert.equal(new Set(g.values()).size, 3);
  assert.deepEqual([g.get(0), g.get(1), g.get(7)], [0, 1, 2], 'numeradas por orden de aparición');
  assert.equal(new Set(mergeClusters(e, 0.999).values()).size, 5, 'con umbral altísimo no une nada');
  assert.equal(mergeClusters(new Map(), 0.5).size, 0);
});

/** Motor de mentira: dos «voces» con vectores distintos y un grupo partido de la voz 0. */
function fakeEngine(): DiarizeEngine {
  return {
    process: () => [
      { start: 0, end: 4, speaker: 0 },
      { start: 4, end: 8, speaker: 1 },
      { start: 8, end: 12, speaker: 2 }, // misma voz que la 0, partida
      { start: 12, end: 12.1, speaker: 3 }, // demasiado corto para fiarse
    ],
    embed: (s) => (s.length > 0 && s[0] > 0.5 ? unit(1) : s[0] < -0.5 ? unit(2) : unit(0)),
  };
}

test('diarizeSamples: tiempos en el VOD, voces unidas por vector y tramos cortos sin atribuir', () => {
  const samples = new Float32Array(13 * SR);
  samples.fill(0.1, 0, 4 * SR); // voz 0
  samples.fill(0.9, 4 * SR, 8 * SR); // voz 1
  samples.fill(0.1, 8 * SR, 12 * SR); // voz 0 otra vez (grupo 2)
  const r = diarizeSamples(fakeEngine(), samples, 1000);
  assert.deepEqual(r.segs.map((s) => [s.start, s.end, s.speaker]), [[1000, 1004, 0], [1004, 1008, 1], [1008, 1012, 0]]);
  assert.equal(r.embeddings.size, 2);
  assert.equal(Math.round(r.seconds.get(0)!), 8);
  assert.equal(Math.round(r.seconds.get(1)!), 4);
});

test('downloadEmbeddingModel rechaza descargas cortadas o cambiadas y no deja restos', async () => {
  const dir = tmpDir();
  try {
    const bad = (async () => new Response(new Uint8Array(1000), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(downloadEmbeddingModel(dir, () => undefined, bad), /incompleto/);
    const wrong = (async () => new Response(new Uint8Array(EMBEDDING_MODEL.bytes), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(downloadEmbeddingModel(dir, () => undefined, wrong), /huella distinta/);
    assert.equal(embeddingInstalled(dir), false);
    assert.deepEqual(fs.readdirSync(dir), []);
    const down = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    await assert.rejects(downloadEmbeddingModel(dir, () => undefined, down), /HTTP 404/);
  } finally {
    rmDir(dir);
  }
});

/** Prueba con el motor real: solo si se indica dónde están los modelos y un audio con varias voces (STREAMCLIPS_DIAR_TEST=carpeta). */
const dirReal = process.env.STREAMCLIPS_DIAR_TEST;
test('motor real (sherpa-onnx): separa las voces de un audio de varias personas', { skip: !dirReal || !fs.existsSync(path.join(dirReal ?? '', 'multi.wav')) }, async () => {
  const engine = sherpaEngine(path.join(dirReal!, 'seg.int8.onnx'), path.join(dirReal!, 'emb.onnx'));
  const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: '' };
  const samples = await extractSamples(tools, path.join(dirReal!, 'multi.wav'), { start: 0, end: 56 });
  const t0 = Date.now();
  const r = diarizeSamples(engine, samples, 0);
  console.log(`diarización real: ${r.embeddings.size} voces, ${r.segs.length} tramos, ${Date.now() - t0} ms`);
  assert.equal(r.embeddings.size, Number(process.env.STREAMCLIPS_DIAR_EXPECT ?? 4));
});

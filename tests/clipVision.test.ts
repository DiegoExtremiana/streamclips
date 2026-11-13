import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { askJson, visionConfig, type LlmConfig } from '../electron/services/llm';
import { CLIP_JUDGE_SYSTEM, CLIP_JUDGE_VISION_SYSTEM, clipJudgePrompt } from '../shared/clipCriteria';
import { ClipScoreService } from '../electron/domain/clipScores';
import { clipFrames } from '../electron/app/wiring/clipScores';
import { resolveToolPaths } from '../electron/services/tools';
import type { TwitchClip } from '../shared/types';

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});
const clip: TwitchClip = { id: 'c1', title: 'gag', url: 'https://clips.twitch.tv/c1', durationSec: 20, createdAt: '2026-11-10T10:00:00Z', creator: 'x', views: 1, thumbnail: '' };

describe('valorar clips viéndolos', () => {
  it('askJson envía las imágenes como image_url junto al texto', async () => {
    let body: { messages: { content: unknown }[] } | null = null;
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        body = JSON.parse(raw);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => srv.close());
    const cfg: LlmConfig = { provider: 'gemini', model: 'm', apiKey: 'K', baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
    await askJson(cfg, 's', 'u', { images: ['data:image/jpeg;base64,AAAA'] });
    const parts = body!.messages[1].content as { type: string }[];
    assert.deepEqual(parts.map((p) => p.type), ['text', 'image_url']);
  });

  it('Groq cambia a su modelo con visión; Gemini conserva el suyo; con servidor de pruebas no se toca', () => {
    assert.match(visionConfig({ provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'k' }).model, /qwen/);
    assert.equal(visionConfig({ provider: 'gemini', model: 'g', apiKey: 'k' }).model, 'g');
    assert.equal(visionConfig({ provider: 'groq', model: 'x', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }).model, 'x');
  });

  it('la rúbrica con imagen pide mirar los fotogramas y no dice que no se ve', () => {
    assert.doesNotMatch(CLIP_JUDGE_VISION_SYSTEM, /ni ves la imagen/);
    assert.match(CLIP_JUDGE_VISION_SYSTEM, /fotogramas/);
    assert.match(CLIP_JUDGE_VISION_SYSTEM, /Imagen:/);
    assert.match(CLIP_JUDGE_SYSTEM, /ni ves la imagen/);
    assert.match(clipJudgePrompt('t', [], 20, 5), /5 fotogramas/);
  });

  it('un clip casi mudo se valora por la imagen; si el modelo falla no recibe nota inventada', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-vision-'));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const seen: (string[] | undefined)[] = [];
    const mk = (judge: () => Promise<null | { criteria: { humor: number; historia: number; viral: number; interes: number }; reason: string; items: Record<string, number>; evidence: Record<string, string> }>) =>
      new ClipScoreService({
        file: path.join(dir, `${Math.random()}.json`),
        canRun: () => true,
        sleep: async () => undefined,
        analyze: async () => ({ durationSec: 20, words: [], frames: ['data:image/jpeg;base64,AA'] }),
        judge: async (_c, _w, f) => (seen.push(f), judge()),
      });
    const a = mk(async () => ({ criteria: { humor: 9, historia: 6, viral: 8, interes: 7 }, reason: 'Gag visual', items: {}, evidence: {} }));
    a.enqueue([clip]);
    await a.idle();
    assert.ok((a.scoreOf('c1') ?? 0) >= 7);
    assert.equal(seen[0]?.length, 1);
    const b = mk(async () => null);
    b.enqueue([clip]);
    await b.idle();
    assert.equal(b.scoreOf('c1'), undefined);
    assert.ok(b.skipReason('c1'));
  });

  it('saca fotogramas JPEG repartidos de un vídeo de verdad', async () => {
    const tools = resolveToolPaths('', '');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-frames-'));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const mp4 = path.join(dir, 'c.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=10', '-pix_fmt', 'yuv420p', mp4]);
    const frames = await clipFrames(tools.ffmpeg, mp4, path.join(dir, 'f'), 10, 5);
    assert.equal(frames.length, 5);
    assert.ok(frames.every((f) => f.startsWith('data:image/jpeg;base64,/9j/')));
    assert.equal(new Set(frames).size, 5, 'cada fotograma es distinto');
  });
});

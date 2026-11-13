import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { applyVisual, frameTimes, parseVisual } from '../shared/visual';
import { judgeVisual, vodFrame } from '../electron/services/visualJudge';
import { resolveToolPaths } from '../electron/services/tools';
import type { Judged } from '../shared/judge';

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});
const tools = resolveToolPaths('', '');
const j = (id: string, start: number, total: number): Judged => ({
  id, start, end: start + 40, signal: 1, total,
  judgement: { id, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind: 'gracia', reason: 'Buen remate.', discard: false },
});

describe('mirar el directo', () => {
  it('valida la respuesta y aplica la nota visual con tope de ±1,5', () => {
    const v = parseVisual({ imagen: [{ id: 'a', visual: 10, nota: 'cara de susto', muerta: false }, { id: 'b', visual: 1, muerta: true, nota: 'pantalla de espera' }, { id: 'x', visual: 5 }, { id: 'a', visual: 2 }, { id: 'c', visual: 'mal' }] }, new Set(['a', 'b', 'c']));
    assert.deepEqual(v.map((x) => x.id), ['a', 'b']);
    const out = applyVisual([j('a', 0, 7), j('b', 100, 8), j('c', 200, 6)], v);
    assert.equal(out[0].total, 8.5);
    assert.match(out[0].judgement.reason, /Imagen \(10\/10\): cara de susto/);
    assert.equal(out[1].judgement.discard, true, 'imagen muerta: se descarta');
    assert.equal(out[1].total, 6.8);
    assert.deepEqual(out[2], j('c', 200, 6), 'sin nota visual no se toca');
    assert.deepEqual(parseVisual('nada', new Set()), []);
  });
  it('reparte los fotogramas dentro del tramo', () => {
    assert.deepEqual(frameTimes({ start: 100, end: 140 }, 3), [110, 120, 130]);
  });
  it('saca un fotograma de un vídeo y el modelo recibe imágenes; el resultado se guarda y no se repite', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-vodvis-'));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const mp4 = path.join(dir, 'v.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=640x360:r=30:d=60', '-pix_fmt', 'yuv420p', mp4]);
    assert.ok((await vodFrame(tools.ffmpeg, mp4, 5, dir)).startsWith('data:image/jpeg;base64,/9j/'));
    let calls = 0;
    let images = 0;
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        calls++;
        const b = JSON.parse(raw) as { messages: { content: { type: string }[] }[] };
        images += b.messages[1].content.filter((p) => p.type === 'image_url').length;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ imagen: [{ id: 'a', visual: 9, muerta: false, nota: 'gesto' }, { id: 'b', visual: 2, muerta: true, nota: 'menú' }] }) } }] }));
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => srv.close());
    const conf = { provider: 'gemini' as const, model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
    const cacheFile = path.join(dir, 'v.visual.json');
    const opts = { ffmpeg: tools.ffmpeg, file: mp4, tmpDir: path.join(dir, 'tmp'), cacheFile, sleep: async () => undefined };
    const r1 = await judgeVisual(conf, [], [j('a', 2, 7), j('b', 5, 6)], opts);
    assert.equal(r1.looked, 2);
    assert.equal(r1.dead, 1);
    assert.equal(images, 6, '3 fotogramas por momento');
    assert.equal(r1.judged.find((x) => x.id === 'b')!.judgement.discard, true);
    const r2 = await judgeVisual(conf, [], [j('a', 2, 7), j('b', 5, 6)], opts);
    assert.equal(r2.cached, 2);
    assert.equal(calls, 1, 'lo ya mirado no se vuelve a preguntar');
  });
  it('si el modelo no admite imágenes devuelve la selección intacta y lo avisa', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-vodvis2-'));
    closers.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const mp4 = path.join(dir, 'v.mp4');
    execFileSync(tools.ffmpeg, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:r=30:d=60', '-pix_fmt', 'yuv420p', mp4]);
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(400);
        res.end('{}');
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => srv.close());
    const conf = { provider: 'groq' as const, model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
    const input = [j('a', 2, 7)];
    const r = await judgeVisual(conf, [], input, { ffmpeg: tools.ffmpeg, file: mp4, tmpDir: path.join(dir, 't'), sleep: async () => undefined });
    assert.equal(r.failed, true);
    assert.deepEqual(r.judged, input);
  });
});

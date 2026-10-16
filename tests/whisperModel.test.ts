import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { downloadModel, modelInstalled, parseWhisperCppJson, isKnownModel, WHISPER_MODELS } from '../electron/services/whisper';

let server: http.Server;
let base: string;
let dir: string;
let hits = 0;
const BIG = 71_000_000;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wm-'));
  server = http.createServer((req, res) => {
    hits++;
    const url = req.url ?? '';
    const chunk = Buffer.alloc(1 << 20);
    const send = (declared: number, actual: number) => {
      res.writeHead(200, { 'content-length': declared });
      let left = actual;
      const pump = () => {
        while (left > 0) {
          const n = Math.min(left, chunk.length);
          left -= n;
          if (!res.write(chunk.subarray(0, n))) return void res.once('drain', pump);
        }
        if (actual < declared) res.destroy();
        else res.end();
      };
      pump();
    };
    if (url.endsWith('ggml-tiny.bin')) return send(BIG, BIG);
    if (url.endsWith('ggml-base.bin')) return send(1000, 1000); // demasiado pequeño
    if (url.endsWith('ggml-small.bin')) return send(500_000_000, 10_000_000); // se corta
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('descarga del modelo de Whisper', () => {
  it('descarga, informa del avance y deja el archivo sin restos', async () => {
    const pcts: number[] = [];
    const f = await downloadModel(dir, 'tiny', (p) => pcts.push(p), { baseUrl: base });
    assert.equal(fs.statSync(f).size, BIG);
    assert.equal(pcts[pcts.length - 1], 100);
    assert.ok(pcts.some((p) => p > 0 && p < 100));
    assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b));
    assert.ok(modelInstalled(dir, 'tiny'));
    assert.equal(fs.existsSync(`${f}.part`), false);
  });
  it('si ya está instalado no vuelve a descargar', async () => {
    const before = hits;
    await downloadModel(dir, 'tiny', () => {}, { baseUrl: base });
    assert.equal(hits, before);
  });
  it('rechaza un archivo demasiado pequeño y no lo deja instalado', async () => {
    await assert.rejects(() => downloadModel(dir, 'base', () => {}, { baseUrl: base }), /demasiado pequeño/);
    assert.equal(modelInstalled(dir, 'base'), false);
    assert.equal(fs.existsSync(path.join(dir, 'ggml-base.bin.part')), false);
  });
  it('una descarga cortada falla y limpia', async () => {
    await assert.rejects(() => downloadModel(dir, 'small', () => {}, { baseUrl: base }));
    assert.equal(modelInstalled(dir, 'small'), false);
    assert.equal(fs.existsSync(path.join(dir, 'ggml-small.bin.part')), false);
  });
  it('errores HTTP y de red salen con mensaje claro', async () => {
    await assert.rejects(() => downloadModel(dir, 'medium', () => {}, { baseUrl: base }), /HTTP 404/);
    await assert.rejects(() => downloadModel(dir, 'medium', () => {}, { baseUrl: 'http://127.0.0.1:1' }), /conexión/);
  });
  it('un modelo a medio descargar o truncado en disco no cuenta como instalado', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wm2-'));
    fs.writeFileSync(path.join(d, 'ggml-tiny.bin'), 'x');
    assert.equal(modelInstalled(d, 'tiny'), false);
    fs.rmSync(d, { recursive: true, force: true });
  });
  it('solo acepta modelos conocidos', () => {
    assert.ok(isKnownModel('tiny') && isKnownModel('small'));
    assert.ok(!isKnownModel('../../etc') && !isKnownModel('toString'));
    assert.deepEqual(Object.keys(WHISPER_MODELS), ['tiny', 'base', 'small', 'medium']);
  });
});

describe('parseWhisperCppJson', () => {
  const j = (items: unknown[]) => JSON.stringify({ transcription: items });
  it('convierte milisegundos a segundos, suma el desfase y descarta marcas que no son habla', () => {
    const w = parseWhisperCppJson(
      j([
        { text: ' [BLANK_AUDIO]', offsets: { from: 0, to: 100 } },
        { text: ' Hola', offsets: { from: 1000, to: 1500 } },
        { text: ' (aplausos)', offsets: { from: 1500, to: 1800 } },
        { text: ' ♪', offsets: { from: 1800, to: 2000 } },
        { text: ' mundo.', offsets: { from: 2000, to: 2600 } },
      ]),
      10,
    );
    assert.deepEqual(w.map((x) => x.text), ['Hola', 'mundo.']);
    assert.equal(w[0].start, 11);
    assert.equal(w[1].end, 12.6);
  });
  it('falla con JSON roto o sin la clave transcription', () => {
    assert.throws(() => parseWhisperCppJson('{no'), /JSON/);
    assert.throws(() => parseWhisperCppJson(JSON.stringify({ result: {} })), /formato esperado/);
    assert.deepEqual(parseWhisperCppJson(JSON.stringify({ transcription: [] })), []);
  });
});

describe('descarga del modelo: huella SHA-256', () => {
  const SIZE = 71_000_000;
  const zeros = Buffer.alloc(SIZE);
  const goodHash = crypto.createHash('sha256').update(zeros).digest('hex');
  let srv: http.Server;
  let url: string;
  let etag = goodHash;
  let body: Buffer = zeros;
  before(async () => {
    srv = http.createServer((req, res) => {
      if (req.method === 'HEAD') return void res.writeHead(307, etag ? { 'x-linked-etag': `"${etag}"` } : {}).end();
      res.writeHead(200, { 'content-length': body.length }).end(body);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  });
  after(() => srv.close());
  const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-wmh-'));

  it('acepta el archivo cuando la huella coincide', async () => {
    const d = fresh();
    etag = goodHash;
    body = zeros;
    await downloadModel(d, 'tiny', () => undefined, { baseUrl: url });
    assert.ok(modelInstalled(d, 'tiny'));
  });
  it('rechaza un archivo del tamaño correcto pero corrupto y no deja nada instalado', async () => {
    const d = fresh();
    etag = goodHash;
    body = Buffer.alloc(SIZE, 1);
    await assert.rejects(() => downloadModel(d, 'tiny', () => undefined, { baseUrl: url }), /dañado/);
    assert.equal(modelInstalled(d, 'tiny'), false);
    assert.deepEqual(fs.readdirSync(d), []);
  });
  it('sin huella publicada sigue con las comprobaciones de tamaño', async () => {
    const d = fresh();
    etag = '';
    body = zeros;
    await downloadModel(d, 'tiny', () => undefined, { baseUrl: url });
    assert.ok(modelInstalled(d, 'tiny'));
  });
});

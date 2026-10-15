import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { askJson, extractJson, type LlmConfig } from '../electron/services/llm';
import { ChatBins, ChatLogger } from '../electron/services/chatlog';

const closers: (() => void)[] = [];
afterEach(() => {
  while (closers.length) closers.pop()!();
});

function llmServer(handler: (n: number, body: Record<string, unknown>, auth: string) => { status: number; body: unknown; headers?: Record<string, string> }) {
  let n = 0;
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const r = handler(++n, JSON.parse(raw), req.headers.authorization ?? '');
      res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise<{ cfg: LlmConfig; calls: () => number }>((resolve) =>
    srv.listen(0, '127.0.0.1', () => {
      closers.push(() => srv.close());
      resolve({ cfg: { provider: 'groq', model: 'm', apiKey: 'K', baseUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` }, calls: () => n });
    }),
  );
}
const ok = (content: string) => ({ status: 200, body: { choices: [{ message: { content } }] } });
const noSleep = { sleep: async () => undefined };

describe('modelo de lenguaje', () => {
  it('extractJson acepta JSON limpio, con ```json y con texto alrededor; rechaza lo demás', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(extractJson('Claro: {"a":3} ¡listo!'), { a: 3 });
    assert.throws(() => extractJson('nada'), /JSON/);
  });
  it('envía clave, modelo y mensajes y devuelve el JSON', async () => {
    let seen: Record<string, unknown> = {};
    let auth = '';
    const { cfg } = await llmServer((_n, b, a) => ((seen = b), (auth = a), ok('{"x":1}')));
    assert.deepEqual(await askJson(cfg, 'sis', 'usr'), { x: 1 });
    assert.equal(auth, 'Bearer K');
    assert.equal(seen.model, 'm');
    assert.deepEqual((seen.messages as { role: string }[]).map((m) => m.role), ['system', 'user']);
  });
  it('reintenta tras un 429 y acaba funcionando; si sigue el 429, mensaje claro', async () => {
    const a = await llmServer((n) => (n < 3 ? { status: 429, body: {}, headers: { 'retry-after': '1' } } : ok('{"ok":true}')));
    assert.deepEqual(await askJson(a.cfg, 's', 'u', noSleep), { ok: true });
    assert.equal(a.calls(), 3);
    const b = await llmServer(() => ({ status: 429, body: {} }));
    await assert.rejects(() => askJson(b.cfg, 's', 'u', noSleep), /límite gratuito/);
  });
  it('clave mala, error del servidor, respuesta vacía y sin clave', async () => {
    await assert.rejects(async () => askJson((await llmServer(() => ({ status: 401, body: {} }))).cfg, 's', 'u'), /rechazó la clave/);
    await assert.rejects(async () => askJson((await llmServer(() => ({ status: 500, body: {} }))).cfg, 's', 'u'), /\(500\)/);
    await assert.rejects(async () => askJson((await llmServer(() => ok(''))).cfg, 's', 'u'), /vacía/);
    await assert.rejects(() => askJson({ provider: 'groq', model: 'm', apiKey: '' }, 's', 'u'), /Falta la clave/);
    await assert.rejects(() => askJson({ provider: 'groq', model: 'm', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }, 's', 'u'), /conectar/);
  });
});

describe('chat de Twitch (IRC anónimo)', () => {
  it('entra al canal, cuenta mensajes, contesta PING y se reconecta', async () => {
    const received: string[] = [];
    let conns = 0;
    const srv = net.createServer((s) => {
      conns++;
      s.setEncoding('utf8');
      s.on('data', (d: string) => received.push(d));
      if (conns === 1) {
        setTimeout(() => s.write(':a!a@a.tmi.twitch.tv PRIVMSG #canal :hola\r\nPING :tmi.twitch.tv\r\n@badge=1 :b!b@b.tmi.twitch.tv PRIVMSG #canal :qué pasa\r\n:tmi.twitch.tv 001 x :Welcome\r\n'), 50);
        setTimeout(() => s.destroy(), 200);
      } else setTimeout(() => s.write(':c!c@c PRIVMSG #canal :otra\r\n'), 50);
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    closers.push(() => srv.close());
    let n = 0;
    const log = new ChatLogger({ channel: 'Canal', host: '127.0.0.1', port: (srv.address() as AddressInfo).port, onMessage: () => n++, reconnectMs: 50 });
    closers.push(() => log.stop());
    log.start();
    for (let i = 0; i < 50 && n < 3; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(n, 3);
    assert.equal(conns, 2);
    const all = received.join('');
    assert.match(all, /NICK justinfan\d+/);
    assert.match(all, /JOIN #canal/);
    assert.match(all, /PONG :tmi\.twitch\.tv/);
    log.stop();
  });
  it('ChatBins agrupa por segundo y se guarda/recupera', () => {
    const b = new ChatBins();
    for (const t of [100.1, 100.9, 102.5, 99]) b.add(t, 100);
    assert.deepEqual(b.toArray(), [2, 0, 1]);
    assert.deepEqual(ChatBins.fromArray([2, 0, 1]).toArray(), [2, 0, 1]);
    assert.deepEqual(new ChatBins().toArray(), []);
  });
});

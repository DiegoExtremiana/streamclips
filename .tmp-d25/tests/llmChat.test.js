"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = __importDefault(require("node:http"));
const node_net_1 = __importDefault(require("node:net"));
const llm_1 = require("../electron/services/llm");
const chatlog_1 = require("../electron/services/chatlog");
const closers = [];
(0, node_test_1.afterEach)(() => {
    while (closers.length)
        closers.pop()();
});
function llmServer(handler) {
    let n = 0;
    const srv = node_http_1.default.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const r = handler(++n, JSON.parse(raw), req.headers.authorization ?? '');
            res.writeHead(r.status, { 'content-type': 'application/json', ...(r.headers ?? {}) });
            res.end(JSON.stringify(r.body));
        });
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => {
        closers.push(() => srv.close());
        resolve({ cfg: { provider: 'groq', model: 'm', apiKey: 'K', baseUrl: `http://127.0.0.1:${srv.address().port}` }, calls: () => n });
    }));
}
const ok = (content) => ({ status: 200, body: { choices: [{ message: { content } }] } });
const noSleep = { sleep: async () => undefined };
(0, node_test_1.describe)('modelo de lenguaje', () => {
    (0, node_test_1.it)('extractJson acepta JSON limpio, con ```json y con texto alrededor; rechaza lo demás', () => {
        strict_1.default.deepEqual((0, llm_1.extractJson)('{"a":1}'), { a: 1 });
        strict_1.default.deepEqual((0, llm_1.extractJson)('```json\n{"a":2}\n```'), { a: 2 });
        strict_1.default.deepEqual((0, llm_1.extractJson)('Claro: {"a":3} ¡listo!'), { a: 3 });
        strict_1.default.throws(() => (0, llm_1.extractJson)('nada'), /JSON/);
    });
    (0, node_test_1.it)('envía clave, modelo y mensajes y devuelve el JSON', async () => {
        let seen = {};
        let auth = '';
        const { cfg } = await llmServer((_n, b, a) => ((seen = b), (auth = a), ok('{"x":1}')));
        strict_1.default.deepEqual(await (0, llm_1.askJson)(cfg, 'sis', 'usr'), { x: 1 });
        strict_1.default.equal(auth, 'Bearer K');
        strict_1.default.equal(seen.model, 'm');
        strict_1.default.deepEqual(seen.messages.map((m) => m.role), ['system', 'user']);
    });
    (0, node_test_1.it)('reintenta tras un 429 y acaba funcionando; si sigue el 429, mensaje claro', async () => {
        const a = await llmServer((n) => (n < 3 ? { status: 429, body: {}, headers: { 'retry-after': '1' } } : ok('{"ok":true}')));
        strict_1.default.deepEqual(await (0, llm_1.askJson)(a.cfg, 's', 'u', noSleep), { ok: true });
        strict_1.default.equal(a.calls(), 3);
        const b = await llmServer(() => ({ status: 429, body: {} }));
        await strict_1.default.rejects(() => (0, llm_1.askJson)(b.cfg, 's', 'u', noSleep), /límite gratuito/);
    });
    (0, node_test_1.it)('clave mala, error del servidor, respuesta vacía y sin clave', async () => {
        await strict_1.default.rejects(async () => (0, llm_1.askJson)((await llmServer(() => ({ status: 401, body: {} }))).cfg, 's', 'u'), /rechazó la clave/);
        await strict_1.default.rejects(async () => (0, llm_1.askJson)((await llmServer(() => ({ status: 500, body: {} }))).cfg, 's', 'u'), /\(500\)/);
        await strict_1.default.rejects(async () => (0, llm_1.askJson)((await llmServer(() => ok(''))).cfg, 's', 'u'), /vacía/);
        await strict_1.default.rejects(() => (0, llm_1.askJson)({ provider: 'groq', model: 'm', apiKey: '' }, 's', 'u'), /Falta la clave/);
        await strict_1.default.rejects(() => (0, llm_1.askJson)({ provider: 'groq', model: 'm', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' }, 's', 'u'), /conectar/);
    });
});
(0, node_test_1.describe)('chat de Twitch (IRC anónimo)', () => {
    (0, node_test_1.it)('entra al canal, cuenta mensajes, contesta PING y se reconecta', async () => {
        const received = [];
        let conns = 0;
        const srv = node_net_1.default.createServer((s) => {
            conns++;
            s.setEncoding('utf8');
            s.on('data', (d) => received.push(d));
            if (conns === 1) {
                setTimeout(() => s.write(':a!a@a.tmi.twitch.tv PRIVMSG #canal :hola\r\nPING :tmi.twitch.tv\r\n@badge=1 :b!b@b.tmi.twitch.tv PRIVMSG #canal :qué pasa\r\n:tmi.twitch.tv 001 x :Welcome\r\n'), 50);
                setTimeout(() => s.destroy(), 200);
            }
            else
                setTimeout(() => s.write(':c!c@c PRIVMSG #canal :otra\r\n'), 50);
        });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        closers.push(() => srv.close());
        let n = 0;
        const log = new chatlog_1.ChatLogger({ channel: 'Canal', host: '127.0.0.1', port: srv.address().port, onMessage: () => n++, reconnectMs: 50 });
        closers.push(() => log.stop());
        log.start();
        for (let i = 0; i < 50 && n < 3; i++)
            await new Promise((r) => setTimeout(r, 50));
        strict_1.default.equal(n, 3);
        strict_1.default.equal(conns, 2);
        const all = received.join('');
        strict_1.default.match(all, /NICK justinfan\d+/);
        strict_1.default.match(all, /JOIN #canal/);
        strict_1.default.match(all, /PONG :tmi\.twitch\.tv/);
        log.stop();
    });
    (0, node_test_1.it)('ChatBins agrupa por segundo y se guarda/recupera', () => {
        const b = new chatlog_1.ChatBins();
        for (const t of [100.1, 100.9, 102.5, 99])
            b.add(t, 100);
        strict_1.default.deepEqual(b.toArray(), [2, 0, 1]);
        strict_1.default.deepEqual(chatlog_1.ChatBins.fromArray([2, 0, 1]).toArray(), [2, 0, 1]);
        strict_1.default.deepEqual(new chatlog_1.ChatBins().toArray(), []);
    });
});

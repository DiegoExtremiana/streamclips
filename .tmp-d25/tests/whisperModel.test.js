"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const whisper_1 = require("../electron/services/whisper");
let server;
let base;
let dir;
let hits = 0;
const BIG = 71_000_000;
(0, node_test_1.before)(async () => {
    dir = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-wm-'));
    server = node_http_1.default.createServer((req, res) => {
        hits++;
        const url = req.url ?? '';
        const chunk = Buffer.alloc(1 << 20);
        const send = (declared, actual) => {
            res.writeHead(200, { 'content-length': declared });
            let left = actual;
            const pump = () => {
                while (left > 0) {
                    const n = Math.min(left, chunk.length);
                    left -= n;
                    if (!res.write(chunk.subarray(0, n)))
                        return void res.once('drain', pump);
                }
                if (actual < declared)
                    res.destroy();
                else
                    res.end();
            };
            pump();
        };
        if (url.endsWith('ggml-tiny.bin'))
            return send(BIG, BIG);
        if (url.endsWith('ggml-base.bin'))
            return send(1000, 1000); // demasiado pequeño
        if (url.endsWith('ggml-small.bin'))
            return send(500_000_000, 10_000_000); // se corta
        res.writeHead(404).end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
(0, node_test_1.after)(() => {
    server.close();
    node_fs_1.default.rmSync(dir, { recursive: true, force: true });
});
(0, node_test_1.describe)('descarga del modelo de Whisper', () => {
    (0, node_test_1.it)('descarga, informa del avance y deja el archivo sin restos', async () => {
        const pcts = [];
        const f = await (0, whisper_1.downloadModel)(dir, 'tiny', (p) => pcts.push(p), { baseUrl: base });
        strict_1.default.equal(node_fs_1.default.statSync(f).size, BIG);
        strict_1.default.equal(pcts[pcts.length - 1], 100);
        strict_1.default.ok(pcts.some((p) => p > 0 && p < 100));
        strict_1.default.deepEqual(pcts, [...pcts].sort((a, b) => a - b));
        strict_1.default.ok((0, whisper_1.modelInstalled)(dir, 'tiny'));
        strict_1.default.equal(node_fs_1.default.existsSync(`${f}.part`), false);
    });
    (0, node_test_1.it)('si ya está instalado no vuelve a descargar', async () => {
        const before = hits;
        await (0, whisper_1.downloadModel)(dir, 'tiny', () => { }, { baseUrl: base });
        strict_1.default.equal(hits, before);
    });
    (0, node_test_1.it)('rechaza un archivo demasiado pequeño y no lo deja instalado', async () => {
        await strict_1.default.rejects(() => (0, whisper_1.downloadModel)(dir, 'base', () => { }, { baseUrl: base }), /demasiado pequeño/);
        strict_1.default.equal((0, whisper_1.modelInstalled)(dir, 'base'), false);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(dir, 'ggml-base.bin.part')), false);
    });
    (0, node_test_1.it)('una descarga cortada falla y limpia', async () => {
        await strict_1.default.rejects(() => (0, whisper_1.downloadModel)(dir, 'small', () => { }, { baseUrl: base }));
        strict_1.default.equal((0, whisper_1.modelInstalled)(dir, 'small'), false);
        strict_1.default.equal(node_fs_1.default.existsSync(node_path_1.default.join(dir, 'ggml-small.bin.part')), false);
    });
    (0, node_test_1.it)('errores HTTP y de red salen con mensaje claro', async () => {
        await strict_1.default.rejects(() => (0, whisper_1.downloadModel)(dir, 'medium', () => { }, { baseUrl: base }), /HTTP 404/);
        await strict_1.default.rejects(() => (0, whisper_1.downloadModel)(dir, 'medium', () => { }, { baseUrl: 'http://127.0.0.1:1' }), /conexión/);
    });
    (0, node_test_1.it)('un modelo a medio descargar o truncado en disco no cuenta como instalado', () => {
        const d = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-wm2-'));
        node_fs_1.default.writeFileSync(node_path_1.default.join(d, 'ggml-tiny.bin'), 'x');
        strict_1.default.equal((0, whisper_1.modelInstalled)(d, 'tiny'), false);
        node_fs_1.default.rmSync(d, { recursive: true, force: true });
    });
    (0, node_test_1.it)('solo acepta modelos conocidos', () => {
        strict_1.default.ok((0, whisper_1.isKnownModel)('tiny') && (0, whisper_1.isKnownModel)('small'));
        strict_1.default.ok(!(0, whisper_1.isKnownModel)('../../etc') && !(0, whisper_1.isKnownModel)('toString'));
        strict_1.default.deepEqual(Object.keys(whisper_1.WHISPER_MODELS), ['tiny', 'base', 'small', 'medium']);
    });
});
(0, node_test_1.describe)('parseWhisperCppJson', () => {
    const j = (items) => JSON.stringify({ transcription: items });
    (0, node_test_1.it)('convierte milisegundos a segundos, suma el desfase y descarta marcas que no son habla', () => {
        const w = (0, whisper_1.parseWhisperCppJson)(j([
            { text: ' [BLANK_AUDIO]', offsets: { from: 0, to: 100 } },
            { text: ' Hola', offsets: { from: 1000, to: 1500 } },
            { text: ' (aplausos)', offsets: { from: 1500, to: 1800 } },
            { text: ' ♪', offsets: { from: 1800, to: 2000 } },
            { text: ' mundo.', offsets: { from: 2000, to: 2600 } },
        ]), 10);
        strict_1.default.deepEqual(w.map((x) => x.text), ['Hola', 'mundo.']);
        strict_1.default.equal(w[0].start, 11);
        strict_1.default.equal(w[1].end, 12.6);
    });
    (0, node_test_1.it)('falla con JSON roto o sin la clave transcription', () => {
        strict_1.default.throws(() => (0, whisper_1.parseWhisperCppJson)('{no'), /JSON/);
        strict_1.default.throws(() => (0, whisper_1.parseWhisperCppJson)(JSON.stringify({ result: {} })), /formato esperado/);
        strict_1.default.deepEqual((0, whisper_1.parseWhisperCppJson)(JSON.stringify({ transcription: [] })), []);
    });
});
(0, node_test_1.describe)('descarga del modelo: huella SHA-256', () => {
    const SIZE = 71_000_000;
    const zeros = Buffer.alloc(SIZE);
    const goodHash = node_crypto_1.default.createHash('sha256').update(zeros).digest('hex');
    let srv;
    let url;
    let etag = goodHash;
    let body = zeros;
    (0, node_test_1.before)(async () => {
        srv = node_http_1.default.createServer((req, res) => {
            if (req.method === 'HEAD')
                return void res.writeHead(307, etag ? { 'x-linked-etag': `"${etag}"` } : {}).end();
            res.writeHead(200, { 'content-length': body.length }).end(body);
        });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        url = `http://127.0.0.1:${srv.address().port}`;
    });
    (0, node_test_1.after)(() => srv.close());
    const fresh = () => node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-wmh-'));
    (0, node_test_1.it)('acepta el archivo cuando la huella coincide', async () => {
        const d = fresh();
        etag = goodHash;
        body = zeros;
        await (0, whisper_1.downloadModel)(d, 'tiny', () => undefined, { baseUrl: url });
        strict_1.default.ok((0, whisper_1.modelInstalled)(d, 'tiny'));
    });
    (0, node_test_1.it)('rechaza un archivo del tamaño correcto pero corrupto y no deja nada instalado', async () => {
        const d = fresh();
        etag = goodHash;
        body = Buffer.alloc(SIZE, 1);
        await strict_1.default.rejects(() => (0, whisper_1.downloadModel)(d, 'tiny', () => undefined, { baseUrl: url }), /dañado/);
        strict_1.default.equal((0, whisper_1.modelInstalled)(d, 'tiny'), false);
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(d), []);
    });
    (0, node_test_1.it)('sin huella publicada sigue con las comprobaciones de tamaño', async () => {
        const d = fresh();
        etag = '';
        body = zeros;
        await (0, whisper_1.downloadModel)(d, 'tiny', () => undefined, { baseUrl: url });
        strict_1.default.ok((0, whisper_1.modelInstalled)(d, 'tiny'));
    });
});
function fakeGgml(opts = {}) {
    const parts = [];
    const i32 = (...v) => parts.push(Buffer.from(Int32Array.from(v).buffer));
    i32(0x67676d6c);
    i32(3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1); // hiperparámetros
    i32(2, 3); // mel 2x3
    parts.push(Buffer.alloc(24));
    i32(2); // vocabulario de 2 palabras
    for (const w of ['ab', 'c']) {
        i32(w.length);
        parts.push(Buffer.from(w));
    }
    for (const [name, dims, ft] of [['encoder.a.weight', [4, 3], 1], ['encoder.a.bias', [5], 0]]) {
        i32(dims.length, name.length, ft, ...dims);
        parts.push(Buffer.from(name));
        const n = dims.reduce((a, b) => a * b, 1) * (ft === 1 ? 2 : 4);
        parts.push(Buffer.alloc(n + (opts.shift && name.endsWith('weight') ? 5 : 0), 7));
    }
    if (opts.trailing)
        parts.push(Buffer.alloc(opts.trailing, 1));
    return Buffer.concat(parts);
}
(0, node_test_1.describe)('ggmlProblem: estructura del modelo', () => {
    const write = (b) => {
        const f = node_path_1.default.join(dir, `g${Math.random()}.bin`);
        node_fs_1.default.writeFileSync(f, b);
        return f;
    };
    (0, node_test_1.it)('acepta un modelo bien formado', () => strict_1.default.equal((0, whisper_1.ggmlProblem)(write(fakeGgml())), null));
    (0, node_test_1.it)('descubre datos desplazados o sobrantes (mismo tamaño aparente, estructura rota)', () => {
        strict_1.default.match((0, whisper_1.ggmlProblem)(write(fakeGgml({ shift: true }))) ?? '', /.+/);
        strict_1.default.match((0, whisper_1.ggmlProblem)(write(fakeGgml({ trailing: 9 }))) ?? '', /.+/);
    });
    (0, node_test_1.it)('descubre un archivo cortado', () => {
        const b = fakeGgml();
        strict_1.default.match((0, whisper_1.ggmlProblem)(write(b.subarray(0, b.length - 3))) ?? '', /.+/);
    });
    (0, node_test_1.it)('no juzga lo que no es ggml', () => strict_1.default.equal((0, whisper_1.ggmlProblem)(write(Buffer.alloc(100))), null));
});

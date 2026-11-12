"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHUNK_SEC = exports.MODEL_BASE_URL = exports.WHISPER_MODELS = void 0;
exports.isKnownModel = isKnownModel;
exports.modelPath = modelPath;
exports.modelInstalled = modelInstalled;
exports.ggmlProblem = ggmlProblem;
exports.downloadModel = downloadModel;
exports.parseWhisperCppJson = parseWhisperCppJson;
exports.transcribeVideo = transcribeVideo;
const node_child_process_1 = require("node:child_process");
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_stream_1 = require("node:stream");
const promises_1 = require("node:stream/promises");
const transcript_1 = require("../../shared/transcript");
const ffmpeg_1 = require("./ffmpeg");
const abort_1 = require("./abort");
const tools_1 = require("./tools");
/** Modelos de whisper.cpp (ggml). `minBytes` sirve para descartar descargas cortadas o páginas de error. */
exports.WHISPER_MODELS = {
    tiny: { file: 'ggml-tiny.bin', minBytes: 70_000_000, approxMb: 78 },
    base: { file: 'ggml-base.bin', minBytes: 140_000_000, approxMb: 148 },
    small: { file: 'ggml-small.bin', minBytes: 460_000_000, approxMb: 488 },
    medium: { file: 'ggml-medium.bin', minBytes: 1_500_000_000, approxMb: 1530 },
};
exports.MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main';
/** Audio troceado para no cargar horas de directo en memoria de una vez. */
exports.CHUNK_SEC = 20 * 60;
function isKnownModel(name) {
    return Object.prototype.hasOwnProperty.call(exports.WHISPER_MODELS, name);
}
function modelPath(dir, name) {
    if (!isKnownModel(name))
        throw new Error(`Modelo de Whisper desconocido: ${name} (usa tiny, base, small o medium).`);
    return node_path_1.default.join(dir, exports.WHISPER_MODELS[name].file);
}
function modelInstalled(dir, name) {
    try {
        return node_fs_1.default.statSync(modelPath(dir, name)).size >= exports.WHISPER_MODELS[name].minBytes;
    }
    catch {
        return false;
    }
}
/** Bytes por elemento (o por bloque) de cada tipo de tensor ggml que puede traer un modelo de Whisper. */
const GGML_TYPES = {
    0: { block: 1, bytes: 4 },
    1: { block: 1, bytes: 2 },
    2: { block: 32, bytes: 18 },
    3: { block: 32, bytes: 20 },
    6: { block: 32, bytes: 22 },
    7: { block: 32, bytes: 24 },
    8: { block: 32, bytes: 34 },
};
/**
 * Recorre la estructura de un modelo ggml (cabecera, filtros mel, vocabulario y la cabecera de cada tensor) saltando los datos,
 * y comprueba que todo encaja y que el archivo termina exactamente donde debe. Un archivo con tamaño correcto pero con bloques
 * dañados (descarga corrupta, antivirus, disco) se descubre así sin tener que cargarlo entero. Devuelve el problema o null.
 * Si el archivo no empieza por la firma ggml no se juzga (null): lo rechazará Whisper con su propio mensaje.
 */
function ggmlProblem(file) {
    let fd = -1;
    try {
        fd = node_fs_1.default.openSync(file, 'r');
        const size = node_fs_1.default.fstatSync(fd).size;
        const buf = Buffer.alloc(4096);
        let pos = 0;
        const read = (n) => {
            if (pos + n > size)
                throw new Error('el archivo termina antes de tiempo');
            const b = n <= buf.length ? buf : Buffer.alloc(n);
            node_fs_1.default.readSync(fd, b, 0, n, pos);
            pos += n;
            return b;
        };
        const i32 = () => read(4).readInt32LE(0);
        if (size < 4 || read(4).readUInt32LE(0) !== 0x67676d6c)
            return null;
        for (let i = 0; i < 11; i++)
            i32(); // hiperparámetros
        const melRows = i32();
        const melCols = i32();
        if (melRows < 0 || melCols < 0 || melRows * melCols > 1_000_000)
            throw new Error('filtros mel con tamaño absurdo');
        pos += melRows * melCols * 4;
        const nVocab = i32();
        if (nVocab < 0 || nVocab > 200_000)
            throw new Error('vocabulario con tamaño absurdo');
        for (let i = 0; i < nVocab; i++) {
            const len = read(4).readUInt32LE(0);
            if (len > 1000)
                throw new Error('palabra de vocabulario con tamaño absurdo');
            pos += len;
        }
        let tensors = 0;
        while (pos < size) {
            const at = pos;
            const nd = i32();
            const nameLen = i32();
            const ft = i32();
            if (nd < 1 || nd > 4 || nameLen < 1 || nameLen > 200 || !GGML_TYPES[ft])
                throw new Error(`cabecera de tensor ${tensors} dañada (byte ${at})`);
            let n = 1;
            for (let d = 0; d < nd; d++) {
                const v = i32();
                if (v < 1 || v > 1_000_000)
                    throw new Error(`dimensión absurda en el tensor ${tensors} (byte ${at})`);
                n *= v;
            }
            const name = read(nameLen).toString('latin1', 0, nameLen);
            if (!/^[A-Za-z0-9_.]+$/.test(name))
                throw new Error(`nombre de tensor ilegible en el byte ${at}`);
            const t = GGML_TYPES[ft];
            pos += Math.ceil(n / t.block) * t.bytes;
            tensors++;
        }
        if (pos !== size)
            throw new Error('los datos no terminan donde deberían');
        return tensors > 0 ? null : 'no contiene tensores';
    }
    catch (e) {
        return e.message;
    }
    finally {
        if (fd >= 0)
            node_fs_1.default.closeSync(fd);
    }
}
/** Descarga el modelo a un archivo temporal y solo lo da por bueno si llega entero. */
async function downloadModel(dir, name, onProgress, o = {}) {
    const dest = modelPath(dir, name);
    if (modelInstalled(dir, name))
        return dest;
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const part = `${dest}.part`;
    const url = `${o.baseUrl ?? exports.MODEL_BASE_URL}/${exports.WHISPER_MODELS[name].file}`;
    try {
        // Hugging Face publica la huella SHA-256 del archivo en la primera respuesta (antes de la redirección): se usa para
        // comprobar que lo descargado es idéntico. Si no se puede leer, se sigue solo con las comprobaciones de tamaño.
        let expected = '';
        try {
            const head = await (o.fetchFn ?? fetch)(url, { method: 'HEAD', redirect: 'manual' });
            const tag = (head.headers.get('x-linked-etag') ?? '').replace(/"/g, '').toLowerCase();
            if (/^[0-9a-f]{64}$/.test(tag))
                expected = tag;
        }
        catch {
            /* sin huella */
        }
        // Segunda fuente de la huella: el listado oficial del repositorio (solo con la URL oficial).
        if (!expected && !o.baseUrl) {
            try {
                const r = await (o.fetchFn ?? fetch)('https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main');
                const list = (await r.json());
                const oid = list.find((x) => x.path === exports.WHISPER_MODELS[name].file)?.lfs?.oid?.toLowerCase() ?? '';
                if (/^[0-9a-f]{64}$/.test(oid))
                    expected = oid;
            }
            catch {
                /* sin huella */
            }
        }
        const hash = node_crypto_1.default.createHash('sha256');
        let res;
        try {
            res = await (o.fetchFn ?? fetch)(url, { redirect: 'follow' });
        }
        catch {
            throw new Error('No se pudo conectar para descargar el modelo de Whisper. Comprueba tu conexión a internet.');
        }
        if (!res.ok || !res.body)
            throw new Error(`No se pudo descargar el modelo de Whisper (HTTP ${res.status}).`);
        const total = Number(res.headers.get('content-length') ?? 0);
        let got = 0;
        let last = -1;
        // Cada trozo se copia antes de escribirlo: así lo que se guarda no depende de memoria que la red pueda reutilizar.
        const fd = node_fs_1.default.openSync(part, 'w');
        try {
            for await (const raw of node_stream_1.Readable.fromWeb(res.body)) {
                const c = Buffer.from(raw);
                hash.update(c);
                let off = 0;
                while (off < c.length)
                    off += node_fs_1.default.writeSync(fd, c, off, c.length - off);
                got += c.length;
                if (total) {
                    const pct = Math.floor((got / total) * 100);
                    if (pct !== last) {
                        last = pct;
                        onProgress(pct);
                    }
                }
            }
        }
        finally {
            node_fs_1.default.closeSync(fd);
        }
        if (total && got !== total)
            throw new Error('La descarga del modelo se cortó. Vuelve a intentarlo.');
        if (got < exports.WHISPER_MODELS[name].minBytes)
            throw new Error('El archivo descargado es demasiado pequeño para ser el modelo. Vuelve a intentarlo.');
        const streamed = hash.digest('hex');
        if (expected && streamed !== expected)
            throw new Error('El modelo de Whisper se descargó dañado (su huella no coincide). Vuelve a intentarlo.');
        // Lo que quedó en el disco tiene que ser idéntico a lo que llegó por la red.
        const onDisk = node_crypto_1.default.createHash('sha256');
        await (0, promises_1.pipeline)(node_fs_1.default.createReadStream(part), onDisk);
        if (onDisk.digest('hex') !== streamed)
            throw new Error('El modelo de Whisper se descargó dañado (lo guardado en el disco no coincide con lo recibido; revisa el disco o el antivirus).');
        const bad = ggmlProblem(part);
        if (bad)
            throw new Error(`El modelo de Whisper se descargó dañado (${bad}). Vuelve a intentarlo.`);
        node_fs_1.default.renameSync(part, dest);
        onProgress(100);
        return dest;
    }
    finally {
        node_fs_1.default.rmSync(part, { force: true });
    }
}
/** Texto que Whisper pone para sonidos o silencio, que no es habla: [BLANK_AUDIO], (música), ♪... */
const NON_SPEECH = /^[\s[(♪*].*[\])♪*\s]$|^\s*$/;
/** JSON de whisper.cpp (-oj): una lista `transcription` con `offsets` en milisegundos. */
function parseWhisperCppJson(text, offsetSec = 0) {
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (e) {
        throw new Error(`La salida de Whisper no es JSON válido: ${e.message}`);
    }
    if (!Array.isArray(raw.transcription))
        throw new Error('La salida de Whisper no tiene el formato esperado (falta "transcription").');
    const out = [];
    for (const seg of raw.transcription) {
        const from = seg.offsets?.from;
        const to = seg.offsets?.to;
        if (typeof seg.text !== 'string' || typeof from !== 'number' || typeof to !== 'number')
            continue;
        if (NON_SPEECH.test(seg.text) && seg.text.trim().length > 0)
            continue;
        out.push(...(0, transcript_1.spreadWords)(seg.text, offsetSec + from / 1000, offsetSec + Math.max(to, from) / 1000));
    }
    return out;
}
function runCli(exe, args, onPct) {
    return new Promise((resolve, reject) => {
        const signal = (0, abort_1.currentAbort)();
        if (signal?.aborted)
            return reject(new abort_1.CancelledError());
        const p = (0, node_child_process_1.spawn)(exe, args, { windowsHide: true, ...(signal ? { signal } : {}) });
        let tail = '';
        const feed = (d) => {
            const t = d.toString();
            tail = (tail + t).slice(-4000);
            // varias líneas pueden llegar juntas: se informa de todas, en orden
            for (const m of t.matchAll(/progress\s*=\s*(\d+)%/g))
                onPct(Math.min(100, Number(m[1])));
        };
        p.stdout.on('data', feed);
        p.stderr.on('data', feed);
        p.on('error', (e) => reject(signal?.aborted ? new abort_1.CancelledError() : new Error(`No se pudo ejecutar Whisper (${exe}): ${e.message}`)));
        p.on('close', (code) => (signal?.aborted ? reject(new abort_1.CancelledError()) : code === 0 ? resolve() : reject(new Error(`Whisper terminó con código ${code}\n${tail.trim().split('\n').slice(-10).join('\n')}`))));
    });
}
/** Transcribe el audio de un vídeo por trozos y devuelve las palabras con su tiempo en el vídeo. */
async function transcribeVideo(tools, input, o) {
    if (!node_fs_1.default.existsSync(o.model))
        throw new Error('Falta el modelo de Whisper.');
    const total = (await (0, ffmpeg_1.probe)(tools, input)).durationSec;
    const from = Math.max(0, o.range?.start ?? 0);
    const to = Math.min(total || Infinity, o.range?.end ?? total);
    const dur = Math.max(0, to - from);
    const chunk = o.chunkSec ?? exports.CHUNK_SEC;
    const n = Math.max(1, Math.ceil(dur / chunk));
    const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-whisper-'));
    const parts = Array.from({ length: n }, () => []);
    const done = new Set();
    // Varios trozos a la vez: un solo Whisper no aprovecha todos los núcleos (por encima de ~4-6 hilos apenas gana).
    const cpus = node_os_1.default.cpus().length;
    const jobs = Math.max(1, Math.min(n, o.jobs ?? (cpus >= 12 ? 3 : cpus >= 6 ? 2 : 1)));
    const threads = o.threads ?? (jobs === 1 ? Math.max(1, cpus - 1) : Math.max(2, Math.round(cpus / 2 / jobs)));
    const pct = new Array(n).fill(0);
    // Trozos ya hechos en un intento anterior (misma entrada, modelo, idioma y troceado)
    const ck = o.checkpointDir;
    const ckKey = ck ? JSON.stringify({ input: node_path_1.default.basename(input), size: node_fs_1.default.statSync(input).size, mtime: Math.round(node_fs_1.default.statSync(input).mtimeMs), model: node_path_1.default.basename(o.model), lang: o.language || 'auto', chunk, from, to }) : '';
    const ckFile = (i) => node_path_1.default.join(ck, `c${i}.json`);
    if (ck) {
        node_fs_1.default.mkdirSync(ck, { recursive: true });
        const meta = node_path_1.default.join(ck, 'meta.json');
        let same = false;
        try {
            same = node_fs_1.default.readFileSync(meta, 'utf8') === ckKey;
        }
        catch {
            /* sin intento anterior */
        }
        if (!same) {
            for (const f of node_fs_1.default.readdirSync(ck))
                node_fs_1.default.rmSync(node_path_1.default.join(ck, f), { force: true });
            node_fs_1.default.writeFileSync(meta, ckKey);
        }
        else {
            for (let i = 0; i < n; i++) {
                try {
                    const w = JSON.parse(node_fs_1.default.readFileSync(ckFile(i), 'utf8'));
                    if (Array.isArray(w)) {
                        parts[i] = w;
                        pct[i] = 100;
                        done.add(i);
                    }
                }
                catch {
                    /* trozo sin terminar o dañado: se rehace */
                }
            }
        }
    }
    const report = () => o.onProgress?.((pct.reduce((a, b) => a + b, 0) / n), `${n} trozo${n > 1 ? 's' : ''}`);
    o.onInfo?.({ durationSec: dur, skippedFraction: n ? done.size / n : 0 });
    const abort = (0, abort_1.currentAbort)();
    let next = 0;
    let failed;
    try {
        const worker = async () => {
            while (failed === undefined) {
                if (abort?.aborted)
                    throw new abort_1.CancelledError();
                const i = next++;
                if (i >= n)
                    return;
                if (done.has(i))
                    continue;
                const offset = from + i * chunk;
                const len = Math.min(chunk, Math.max(0.5, to - offset));
                const wav = node_path_1.default.join(tmp, `c${i}.wav`);
                await (0, tools_1.run)(tools.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(offset), '-t', String(len), '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
                if (!node_fs_1.default.existsSync(wav) || node_fs_1.default.statSync(wav).size < 2000) {
                    pct[i] = 100;
                    if (ck)
                        node_fs_1.default.writeFileSync(ckFile(i), '[]');
                    report();
                    continue;
                } // trozo sin audio
                const base = node_path_1.default.join(tmp, `c${i}`);
                // -bs 1 -bo 1: decodificación voraz. Por defecto whisper.cpp usa búsqueda en haz de 5 (bastante más lenta y casi igual de precisa en voz clara).
                const args = ['-m', o.model, '-f', wav, '-l', o.language || 'auto', '-oj', '-ml', '1', '-sow', '-pp', '-bs', '1', '-bo', '1', '-t', String(threads), ...(o.prompt ? ['--prompt', o.prompt] : []), '-of', base];
                await runCli(o.exe, args, (p) => { pct[i] = Math.min(99, p); report(); });
                const json = `${base}.json`;
                if (!node_fs_1.default.existsSync(json))
                    throw new Error('Whisper terminó pero no generó la transcripción.');
                parts[i] = parseWhisperCppJson(node_fs_1.default.readFileSync(json, 'utf8'), offset);
                if (ck) {
                    node_fs_1.default.writeFileSync(`${ckFile(i)}.tmp`, JSON.stringify(parts[i]));
                    node_fs_1.default.renameSync(`${ckFile(i)}.tmp`, ckFile(i)); // atómico: nunca queda un trozo a medias
                }
                node_fs_1.default.rmSync(wav, { force: true });
                pct[i] = 100;
                report();
            }
        };
        await Promise.all(Array.from({ length: jobs }, () => worker().catch((e) => { failed ??= e; throw e; })));
    }
    finally {
        // en Windows el archivo puede seguir en uso unos instantes tras cancelar: no debe tumbar el análisis
        try {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        }
        catch {
            /* se borra solo con la carpeta temporal */
        }
    }
    const words = parts.flat();
    if (!words.length && !o.range)
        throw new Error('Whisper no encontró ninguna palabra en el audio.');
    return words;
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.judgeCandidates = judgeCandidates;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const judge_1 = require("../../shared/judge");
const llm_1 = require("./llm");
const VERSION = 'v2';
const CHUNK = 6;
const keyOf = (words, c) => node_crypto_1.default.createHash('sha1').update(`${VERSION}|${Math.round(c.end - c.start)}|${(0, judge_1.judgeText)(words, c)}`).digest('hex').slice(0, 20);
function loadCache(file) {
    if (!file)
        return {};
    try {
        const j = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
        return typeof j === 'object' && j ? j : {};
    }
    catch {
        return {};
    }
}
function saveCache(file, data) {
    if (!file)
        return;
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
        node_fs_1.default.writeFileSync(file, JSON.stringify(data));
    }
    catch {
        /* sin caché no pasa nada: solo se vuelve a preguntar */
    }
}
/**
 * Valora candidatos con el modelo de lenguaje, por lotes. Las valoraciones se guardan por contenido en `cacheFile`: al
 * regenerar el montaje de un directo ya analizado no se vuelve a preguntar por lo mismo.
 * Si fallan más de la mitad de los lotes (clave, límite gratuito, red) lanza el error para que el piloto use la selección por señales.
 */
async function judgeCandidates(conf, words, cands, d = {}) {
    const cache = loadCache(d.cacheFile);
    const found = [];
    const todo = [];
    for (const c of cands) {
        const s = cache[keyOf(words, c)];
        if (s)
            found.push({ id: c.id, scores: s.scores, kind: s.kind, reason: s.reason, title: s.title, discard: s.discard, trim: s.trim ? { start: c.start + s.trim.a, end: c.start + s.trim.b } : undefined });
        else
            todo.push(c);
    }
    const cached = found.length;
    const chunks = [];
    for (let i = 0; i < todo.length; i += CHUNK)
        chunks.push(todo.slice(i, i + CHUNK));
    let failed = 0;
    let lastError = null;
    for (const [n, chunk] of chunks.entries()) {
        d.signal?.();
        if (n > 0)
            await (d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(d.paceMs ?? llm_1.MIN_INTERVAL_MS[conf.provider]);
        try {
            const raw = await (0, llm_1.askJson)(conf, judge_1.JUDGE_SYSTEM, (0, judge_1.judgePrompt)(words, chunk), { fetchFn: d.fetchFn, sleep: d.sleep, temperature: 0.2 });
            const js = (0, judge_1.parseJudgements)(raw, chunk);
            for (const j of js) {
                const c = chunk.find((x) => x.id === j.id);
                cache[keyOf(words, c)] = { scores: j.scores, kind: j.kind, reason: j.reason, title: j.title, discard: j.discard, trim: j.trim ? { a: j.trim.start - c.start, b: j.trim.end - c.start } : undefined };
                found.push(j);
            }
            saveCache(d.cacheFile, cache);
            if (!js.length) {
                failed++;
                lastError = new Error('El modelo no devolvió valoraciones utilizables.');
            }
        }
        catch (e) {
            if (/rechaz|clave/i.test(e.message))
                throw e; // una clave mala no mejora reintentando
            failed++;
            lastError = e;
        }
        d.onProgress?.(n + 1, chunks.length);
    }
    if (chunks.length && failed > chunks.length / 2)
        throw lastError ?? new Error('No se pudo valorar con el modelo de lenguaje.');
    return { judged: (0, judge_1.toJudged)(cands, found), cached, asked: todo.length, failedChunks: failed, chunks: chunks.length };
}

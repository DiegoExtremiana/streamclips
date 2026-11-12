"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublishError = exports.defaultSleep = void 0;
exports.readChunk = readChunk;
exports.timedFetch = timedFetch;
exports.apiMessage = apiMessage;
const node_fs_1 = __importDefault(require("node:fs"));
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
exports.defaultSleep = defaultSleep;
class PublishError extends Error {
}
exports.PublishError = PublishError;
/** Lee un trozo de un archivo grande sin cargarlo entero en memoria. */
async function readChunk(file, start, endExclusive) {
    const fh = await node_fs_1.default.promises.open(file, 'r');
    try {
        const len = endExclusive - start;
        const buf = Buffer.alloc(len);
        let got = 0;
        while (got < len) {
            const { bytesRead } = await fh.read(buf, got, len - got, start + got);
            if (!bytesRead)
                break;
            got += bytesRead;
        }
        return got === len ? buf : buf.subarray(0, got);
    }
    finally {
        await fh.close();
    }
}
async function timedFetch(f, url, init, ms = 60_000) {
    try {
        return await f(url, { ...init, signal: AbortSignal.timeout(ms) });
    }
    catch (e) {
        const n = e.name;
        if (n === 'TimeoutError' || n === 'AbortError')
            throw new PublishError('La red social no respondió a tiempo.');
        throw new PublishError('No se pudo conectar con la red social. Comprueba tu conexión a internet.');
    }
}
/** Texto corto y limpio del error que devuelve una API (sin volcar HTML ni datos privados). */
async function apiMessage(res) {
    const t = await res.text().catch(() => '');
    try {
        const j = JSON.parse(t);
        const reason = typeof j.error === 'object' ? j.error?.errors?.[0]?.reason : undefined;
        const m = typeof j.error === 'object' ? j.error?.message : (j.error ?? j.message);
        return [reason, m].filter(Boolean).join(': ').slice(0, 300) || `HTTP ${res.status}`;
    }
    catch {
        return `HTTP ${res.status}`;
    }
}

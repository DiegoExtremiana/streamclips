"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const speakers_1 = require("../shared/speakers");
const diarize_1 = require("../electron/services/diarize");
const helpers_1 = require("./helpers");
const SR = 16000;
const unit = (i, n = 8) => Array.from({ length: n }, (_, k) => (k === i ? 1 : 0.02));
(0, node_test_1.default)('mergeClusters une los grupos que suenan igual y deja aparte los distintos', () => {
    // 0 y 5 son la misma voz, 7 y 8 también, 1 es distinta
    const e = new Map([[0, unit(0)], [5, unit(0).map((x, i) => x + (i === 1 ? 0.1 : 0))], [1, unit(1)], [7, unit(2)], [8, unit(2).map((x, i) => x + (i === 3 ? 0.08 : 0))]]);
    const g = (0, speakers_1.mergeClusters)(e, 0.6);
    strict_1.default.equal(g.get(0), g.get(5));
    strict_1.default.equal(g.get(7), g.get(8));
    strict_1.default.equal(new Set(g.values()).size, 3);
    strict_1.default.deepEqual([g.get(0), g.get(1), g.get(7)], [0, 1, 2], 'numeradas por orden de aparición');
    strict_1.default.equal(new Set((0, speakers_1.mergeClusters)(e, 0.999).values()).size, 5, 'con umbral altísimo no une nada');
    strict_1.default.equal((0, speakers_1.mergeClusters)(new Map(), 0.5).size, 0);
});
/** Motor de mentira: dos «voces» con vectores distintos y un grupo partido de la voz 0. */
function fakeEngine() {
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
(0, node_test_1.default)('diarizeSamples: tiempos en el VOD, voces unidas por vector y tramos cortos sin atribuir', () => {
    const samples = new Float32Array(13 * SR);
    samples.fill(0.1, 0, 4 * SR); // voz 0
    samples.fill(0.9, 4 * SR, 8 * SR); // voz 1
    samples.fill(0.1, 8 * SR, 12 * SR); // voz 0 otra vez (grupo 2)
    const r = (0, diarize_1.diarizeSamples)(fakeEngine(), samples, 1000);
    strict_1.default.deepEqual(r.segs.map((s) => [s.start, s.end, s.speaker]), [[1000, 1004, 0], [1004, 1008, 1], [1008, 1012, 0]]);
    strict_1.default.equal(r.embeddings.size, 2);
    strict_1.default.equal(Math.round(r.seconds.get(0)), 8);
    strict_1.default.equal(Math.round(r.seconds.get(1)), 4);
});
(0, node_test_1.default)('downloadEmbeddingModel rechaza descargas cortadas o cambiadas y no deja restos', async () => {
    const dir = (0, helpers_1.tmpDir)();
    try {
        const bad = (async () => new Response(new Uint8Array(1000), { status: 200 }));
        await strict_1.default.rejects((0, diarize_1.downloadEmbeddingModel)(dir, () => undefined, bad), /incompleto/);
        const wrong = (async () => new Response(new Uint8Array(diarize_1.EMBEDDING_MODEL.bytes), { status: 200 }));
        await strict_1.default.rejects((0, diarize_1.downloadEmbeddingModel)(dir, () => undefined, wrong), /huella distinta/);
        strict_1.default.equal((0, diarize_1.embeddingInstalled)(dir), false);
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(dir), []);
        const down = (async () => new Response(null, { status: 404 }));
        await strict_1.default.rejects((0, diarize_1.downloadEmbeddingModel)(dir, () => undefined, down), /HTTP 404/);
    }
    finally {
        (0, helpers_1.rmDir)(dir);
    }
});
/** Prueba con el motor real: solo si se indica dónde están los modelos y un audio con varias voces (STREAMCLIPS_DIAR_TEST=carpeta). */
const dirReal = process.env.STREAMCLIPS_DIAR_TEST;
(0, node_test_1.default)('motor real (sherpa-onnx): separa las voces de un audio de varias personas', { skip: !dirReal || !node_fs_1.default.existsSync(node_path_1.default.join(dirReal ?? '', 'multi.wav')) }, async () => {
    const engine = (0, diarize_1.sherpaEngine)(node_path_1.default.join(dirReal, 'seg.int8.onnx'), node_path_1.default.join(dirReal, 'emb.onnx'));
    const tools = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: '' };
    const samples = await (0, diarize_1.extractSamples)(tools, node_path_1.default.join(dirReal, 'multi.wav'), { start: 0, end: 56 });
    const t0 = Date.now();
    const r = (0, diarize_1.diarizeSamples)(engine, samples, 0);
    console.log(`diarización real: ${r.embeddings.size} voces, ${r.segs.length} tramos, ${Date.now() - t0} ms`);
    strict_1.default.equal(r.embeddings.size, Number(process.env.STREAMCLIPS_DIAR_EXPECT ?? 4));
});

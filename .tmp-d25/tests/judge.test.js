"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const judge_1 = require("../shared/judge");
const cand = (id, start, end, signal = 1) => ({ id, start, end, signal });
const sc = (n) => ({ humor: n, originalidad: n, interaccion: n, reaccion: n, contexto: n, autonomia: n });
const raw = (id, n, extra = {}) => ({ id, ...sc(n), tipo: 'gracia', descartar: false, motivo: 'm', ...extra });
const W = (text, start) => ({ text, start, end: start + 0.3 });
(0, node_test_1.default)('los pesos de los criterios suman 1 y la nota va de 0 a 10', () => {
    strict_1.default.ok(Math.abs(judge_1.CRITERIA.reduce((a, c) => a + judge_1.WEIGHTS[c], 0) - 1) < 1e-9);
    strict_1.default.equal((0, judge_1.entertainment)({ scores: sc(10) }, 5), 10);
    strict_1.default.equal((0, judge_1.entertainment)({ scores: sc(0) }, 0), 0);
    // las señales de audio solo suman un 15 %
    strict_1.default.ok((0, judge_1.entertainment)({ scores: sc(5) }, 5) - (0, judge_1.entertainment)({ scores: sc(5) }, 0) <= 1.51);
});
(0, node_test_1.default)('parseJudgements ignora lo incompleto, lo repetido y lo que no es de los candidatos; limita a 0-10', () => {
    const cs = [cand('a', 100, 160), cand('b', 300, 360)];
    const js = (0, judge_1.parseJudgements)({ juicios: [raw('a', 14), { id: 'b', humor: 5 }, raw('zzz', 5), raw('a', 2), 'basura', null] }, cs);
    strict_1.default.equal(js.length, 1);
    strict_1.default.equal(js[0].id, 'a');
    strict_1.default.ok(judge_1.CRITERIA.every((c) => js[0].scores[c] === 10));
    strict_1.default.deepEqual((0, judge_1.parseJudgements)({}, cs), []);
    strict_1.default.deepEqual((0, judge_1.parseJudgements)(null, cs), []);
});
(0, node_test_1.default)('parseJudgements: tipo desconocido pasa a «otro»; el recorte solo vale si es razonable', () => {
    const c = cand('a', 100, 160);
    const [ok] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { tipo: 'rarisimo', inicio: 10, fin: 50 })] }, [c]);
    strict_1.default.equal(ok.kind, 'otro');
    strict_1.default.deepEqual(ok.trim, { start: 110, end: 150 });
    const [short] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { inicio: 10, fin: 15 })] }, [c]);
    strict_1.default.equal(short.trim, undefined, 'menos de 10 s');
    const [tiny] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { inicio: 30, fin: 45 })] }, [c]);
    strict_1.default.equal(tiny.trim, undefined, 'se come más de la mitad');
    const [out] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { inicio: -5, fin: 999 })] }, [c]);
    strict_1.default.deepEqual(out.trim, { start: 100, end: 160 }, 'se limita al candidato');
    const [tags] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { motivo: '<b>Muy</b>  gracioso' })] }, [c]);
    strict_1.default.equal(tags.reason, 'bMuy/b gracioso');
});
(0, node_test_1.default)('judgeText marca el tiempo relativo cada ~10 s y no pasa del límite', () => {
    const ws = Array.from({ length: 30 }, (_, i) => W(`p${i}`, 100 + i));
    const t = (0, judge_1.judgeText)(ws, { start: 100, end: 130 });
    strict_1.default.match(t, /^\[0s\] p0/);
    strict_1.default.match(t, /\[10s\] p10/);
    strict_1.default.ok((0, judge_1.judgeText)(ws, { start: 100, end: 130 }, 30).length <= 31);
});
const judged = (specs, text = {}) => {
    const cs = specs.map(([id, s, e, sig]) => cand(id, s, e, sig));
    const js = specs.map(([id, , , , kind], i) => ({ id, scores: sc(specs[i][3]), kind: kind ?? 'gracia', reason: text[id] ?? '', discard: false }));
    return (0, judge_1.toJudged)(cs, js);
};
(0, node_test_1.default)('selectBest: el suelo de calidad manda, no se rellena y sale en orden cronológico', () => {
    const items = judged([['a', 100, 160, 9], ['b', 400, 460, 8], ['c', 800, 860, 4], ['d', 1200, 1260, 3]]);
    const sel = (0, judge_1.selectBest)(items, { maxSec: 10_000, minTotal: 6 });
    strict_1.default.deepEqual(sel.chosen.map((c) => c.id), ['a', 'b']);
    strict_1.default.equal(sel.eligible, 2);
    strict_1.default.equal(sel.totalSec, 120);
    strict_1.default.deepEqual((0, judge_1.selectBest)(items, { maxSec: 10_000, minTotal: 9.9 }).chosen, []);
});
(0, node_test_1.default)('selectBest: respeta la duración máxima y el número máximo', () => {
    const items = judged([['a', 0, 100, 9], ['b', 300, 400, 9], ['c', 600, 700, 9]]);
    strict_1.default.equal((0, judge_1.selectBest)(items, { maxSec: 250, minTotal: 5 }).chosen.length, 2);
    strict_1.default.equal((0, judge_1.selectBest)(items, { maxSec: 1000, minTotal: 5, maxCount: 1 }).chosen.length, 1);
});
(0, node_test_1.default)('selectBest: da variedad (no todo del mismo tipo) y descarta lo marcado', () => {
    const items = judged([['g1', 0, 60, 8, 'gracia'], ['g2', 200, 260, 8, 'gracia'], ['g3', 400, 460, 8, 'gracia'], ['f1', 600, 660, 7, 'fail']]);
    const sel = (0, judge_1.selectBest)(items, { maxSec: 10_000, minTotal: 5, maxCount: 3, kindPenalty: 1.5 });
    strict_1.default.ok(sel.chosen.some((c) => c.id === 'f1'), 'entra el fail aunque tenga menos nota');
    const d = judged([['a', 0, 60, 9]]);
    d[0].judgement.discard = true;
    strict_1.default.equal((0, judge_1.selectBest)(d, { maxSec: 999, minTotal: 1 }).chosen.length, 0);
});
(0, node_test_1.default)('selectBest: no repite tramos que hablan de lo mismo ni tramos pegados', () => {
    const items = judged([['a', 0, 60, 9], ['b', 300, 360, 8.5], ['c', 700, 760, 8], ['d', 770, 830, 8]]);
    const texts = { 0: 'el creeper explotó la casa construida con diamantes', 300: 'el creeper explotó la casa construida con diamantes otra vez', 700: 'hablando de pizza hawaiana y piña', 770: 'otra cosa distinta completamente sobre cohetes espaciales' };
    const sel = (0, judge_1.selectBest)(items, { maxSec: 9999, minTotal: 5, textFor: (s) => texts[Math.round(s.start)] ?? '', minGap: 20 });
    strict_1.default.deepEqual(sel.chosen.map((c) => c.id), ['a', 'c'], 'b repite a; d está pegado a c');
});
(0, node_test_1.default)('selectBest: aplica el recorte del modelo y limita el largo alrededor del centro', () => {
    const items = judged([['a', 100, 200, 9]]);
    items[0].judgement.trim = { start: 120, end: 190 };
    const [c] = (0, judge_1.selectBest)(items, { maxSec: 999, minTotal: 5 }).chosen;
    strict_1.default.deepEqual(c.seg, { start: 120, end: 190 });
    const [d] = (0, judge_1.selectBest)(items, { maxSec: 999, minTotal: 5, maxLen: 40 }).chosen;
    strict_1.default.equal(d.seg.end - d.seg.start, 40);
    strict_1.default.ok(d.seg.start >= 120 && d.seg.end <= 190);
});
(0, node_test_1.default)('similarityOfText: lo parecido sube y lo distinto es 0', () => {
    strict_1.default.ok((0, judge_1.similarityOfText)('el creeper explotó la casa', 'la casa explotó por el creeper') > 0.7);
    strict_1.default.equal((0, judge_1.similarityOfText)('pizza hawaiana', 'cohetes espaciales'), 0);
    strict_1.default.equal((0, judge_1.similarityOfText)('', 'algo'), 0);
});
(0, node_test_1.default)('resolveModel: sustituye los Gemini retirados y respeta el modelo elegido', async () => {
    const { resolveModel, LLM_PROVIDERS } = await Promise.resolve().then(() => __importStar(require('../electron/services/llm')));
    strict_1.default.equal(resolveModel('gemini', ''), LLM_PROVIDERS.gemini.defaultModel);
    strict_1.default.equal(resolveModel('gemini', 'gemini-2.0-flash'), LLM_PROVIDERS.gemini.defaultModel);
    strict_1.default.equal(resolveModel('gemini', 'gemini-1.5-flash'), LLM_PROVIDERS.gemini.defaultModel);
    strict_1.default.equal(resolveModel('gemini', 'gemini-3.8-flash'), 'gemini-3.8-flash');
    strict_1.default.equal(resolveModel('groq', 'llama-3.1-8b-instant'), 'llama-3.1-8b-instant');
});
(0, node_test_1.default)('judgeCandidates espera entre lotes para no pasar el límite gratuito', async () => {
    const { judgeCandidates } = await Promise.resolve().then(() => __importStar(require('../electron/services/momentJudge')));
    const cands = Array.from({ length: 13 }, (_, i) => cand(`c${i}`, i * 200, i * 200 + 60));
    const words = cands.flatMap((c) => [W(`texto${c.id}`, c.start + 1), W('más', c.start + 2)]);
    const waits = [];
    const fetchFn = (async (_u, init) => {
        const ids = [...JSON.parse(init.body).messages[1].content.matchAll(/"id":"(c\d+)"/g)].map((m) => m[1]);
        const juicios = ids.map((id) => raw(id, 7));
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ message: { content: JSON.stringify({ juicios }) } }] }) };
    });
    const r = await judgeCandidates({ provider: 'groq', model: 'x', apiKey: 'k' }, words, cands, { fetchFn, sleep: async (ms) => void waits.push(ms) });
    strict_1.default.equal(r.chunks, 3);
    strict_1.default.equal(r.judged.length, 13);
    strict_1.default.deepEqual(waits, [14_000, 14_000], 'no espera antes del primero');
});
(0, node_test_1.default)('el modelo también da un nombre corto al momento (limpio y de tamaño razonable)', () => {
    const c = cand('a', 100, 160);
    const [ok] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { titulo: '  El "susto" del <b>creeper</b>  ' })] }, [c]);
    strict_1.default.equal(ok.title, 'El susto del bcreeper/b');
    const [none] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { titulo: 'ab' })] }, [c]);
    strict_1.default.equal(none.title, undefined);
    const [long] = (0, judge_1.parseJudgements)({ juicios: [raw('a', 7, { titulo: 'x'.repeat(200) })] }, [c]);
    strict_1.default.equal(long.title.length, 40);
});

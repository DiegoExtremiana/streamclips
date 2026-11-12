"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_http_1 = __importDefault(require("node:http"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const helpers_1 = require("./helpers");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
let root;
let video;
(0, node_test_1.before)(() => {
    root = (0, helpers_1.tmpDir)();
    video = node_path_1.default.join(root, 'live.mp4');
    (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=240',
        '-f', 'lavfi', '-i', "aevalsrc='(0.02+0.9*(between(t,55,70)+between(t,165,180)))*sin(2*PI*300*t)':d=240:s=16000",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
});
(0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
/** Modelo de mentira: valora alto lo que habla de «jugada» y bajo lo de «locura»; para los títulos devuelve un JSON vacío. */
function llm(mode = 'normal') {
    const state = { judgeCalls: 0, titleCalls: 0 };
    const srv = node_http_1.default.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const body = JSON.parse(raw);
            const isJudge = /EXIGENTE/.test(body.messages[0].content);
            if (!isJudge) {
                state.titleCalls++;
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
                return;
            }
            state.judgeCalls++;
            if (mode === 'fail') {
                res.writeHead(500).end('{}');
                return;
            }
            const items = JSON.parse(/Fragmentos:\n(.*)$/s.exec(body.messages[1].content)[1]);
            const juicios = items.map((it) => {
                const n = mode === 'low' ? 3 : /jugada/.test(it.texto) ? 9 : 3;
                return { id: it.id, humor: n, originalidad: n, interaccion: n, reaccion: n, contexto: n, autonomia: n, tipo: 'fail', descartar: false, inicio: 0, fin: 40, motivo: n > 5 ? 'Jugada inesperada con remate' : 'Charla sin gracia' };
            });
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ juicios }) } }] }));
        });
    });
    return new Promise((ok) => srv.listen(0, '127.0.0.1', () => {
        const s = Object.defineProperties({ url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() }, {
            judgeCalls: { get: () => state.judgeCalls },
            titleCalls: { get: () => state.titleCalls },
        });
        ok(s);
    }));
}
function setup(url, auto = {}) {
    const e = (0, helpers_1.makeEnv)({ llmBaseUrl: url });
    envs.push(e);
    const vod = (0, helpers_1.addDownloadedVod)(e, video);
    const tr = node_path_1.default.join(root, `tr-${Math.random().toString(36).slice(2)}.json`);
    const words = [
        ...['Hola', 'qué', 'locura', 'tío', 'esto', 'no', 'puede', 'ser'].map((text, i) => ({ text, start: 52 + i, end: 52.5 + i })),
        ...['Increíble', 'jugada', 'no', 'me', 'lo', 'creo', 'ganamos'].map((text, i) => ({ text, start: 162 + i, end: 162.5 + i })),
    ];
    node_fs_1.default.writeFileSync(tr, JSON.stringify({ words }));
    e.ctx.transcripts.importFile(vod.id, tr);
    e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false, llm: { provider: 'groq', model: 'x', apiKey: 'CLAVE' }, ...auto } });
    return { e, vod };
}
(0, node_test_1.describe)('selección inteligente', () => {
    (0, node_test_1.it)('solo entra lo que supera la nota mínima, con su nota y su motivo, y no se rellena con lo flojo', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url);
            await e.ctx.autopilot.run(vod.id);
            const v = e.ctx.store.data.vods[0];
            strict_1.default.equal(v.autopilot?.status, 'done', v.autopilot?.note);
            const clips = e.ctx.store.data.outputs.filter((o) => o.auto?.role === 'clip');
            strict_1.default.equal(clips.length, 1, 'de 2 clips pedidos solo uno es bueno: ' + v.autopilot?.note);
            strict_1.default.equal(clips[0].auto.kind, 'fail');
            strict_1.default.match(clips[0].auto.reason ?? '', /Jugada inesperada/);
            strict_1.default.ok((clips[0].auto.score ?? 0) >= 6.5);
            strict_1.default.match(v.autopilot?.note ?? '', /Selección inteligente: \d+ candidatos valorados/);
            strict_1.default.match(v.autopilot?.note ?? '', /Solo 1 de 2 clips superan la nota mínima/);
            strict_1.default.ok(srv.judgeCalls >= 1);
            // el clip empieza donde dijo el modelo (recorte de 0 a 40 s del candidato), no donde acaba el ruido
            strict_1.default.ok(clips[0].durationSec <= 41, String(clips[0].durationSec));
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('al repetir el análisis no se vuelve a preguntar por lo ya valorado', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url);
            await e.ctx.autopilot.run(vod.id);
            const first = srv.judgeCalls;
            strict_1.default.ok(first >= 1);
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(srv.judgeCalls, first, 'las valoraciones salen de lo guardado');
            strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /ya estaban guardados/);
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('si el modelo falla, se usa el volumen y el chat y se avisa', async () => {
        const srv = await llm('fail');
        try {
            const { e, vod } = setup(srv.url);
            await e.ctx.autopilot.run(vod.id);
            const v = e.ctx.store.data.vods[0];
            strict_1.default.equal(v.autopilot?.status, 'done');
            strict_1.default.match(v.autopilot?.note ?? '', /Selección inteligente no disponible/);
            strict_1.default.equal(e.ctx.store.data.outputs.length, 4, 'monta lo de siempre');
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('si nada llega a la nota mínima y no hay vídeos principales, no se genera relleno', async () => {
        const srv = await llm('low');
        try {
            const { e, vod } = setup(srv.url, { maxVideos: 0 });
            await e.ctx.autopilot.run(vod.id);
            const v = e.ctx.store.data.vods[0];
            strict_1.default.equal(v.autopilot?.status, 'skipped', v.autopilot?.note);
            strict_1.default.match(v.autopilot?.note ?? '', /nota mínima/);
            strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('con la selección inteligente desactivada no se consulta al modelo para elegir', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url, { smartSelect: false });
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(srv.judgeCalls, 0);
            strict_1.default.equal(e.ctx.store.data.outputs.length, 4);
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('la nota mínima se valida, se redondea a medios puntos y se aplica', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url, { maxVideos: 0 });
            strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { minQuality: 2 } }), /entre 3 y 9,5/);
            strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { minQuality: 11 } }), /entre 3 y 9,5/);
            strict_1.default.equal(e.ctx.store.data.settings.autopilot.minQuality, undefined);
            e.ctx.settings.set({ autopilot: { minQuality: 9.3 } });
            strict_1.default.equal(e.ctx.store.data.settings.autopilot.minQuality, 9.5);
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'skipped', 'ni lo mejor llega a 9,5');
            e.ctx.settings.set({ autopilot: { minQuality: 5 } });
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(e.ctx.store.data.outputs.filter((o) => o.auto?.role === 'clip').length, 1, 'con 5 sigue sin entrar el de nota 3: solo el bueno');
        }
        finally {
            srv.close();
        }
    });
});

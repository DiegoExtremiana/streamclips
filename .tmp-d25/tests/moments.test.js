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
const momentStore_1 = require("../electron/services/momentStore");
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
const clipsOf = (e) => e.ctx.store.data.outputs.filter((o) => o.auto?.role === 'clip');
(0, node_test_1.describe)('revisión de momentos', () => {
    (0, node_test_1.it)('excluir un momento y regenerar lo quita sin volver a preguntar al modelo; fijar uno flojo lo mete; limpiar lo devuelve', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url);
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(clipsOf(e).length, 1);
            const calls = srv.judgeCalls;
            const v1 = e.ctx.moments.list(vod.id);
            strict_1.default.equal(v1.available, true);
            strict_1.default.equal(v1.quality, 6.5);
            strict_1.default.equal(v1.pending, false);
            const good = v1.rows.find((r) => r.chosen);
            const weak = v1.rows.find((r) => !r.chosen && r.total < 6.5);
            strict_1.default.ok(good && weak, JSON.stringify(v1.rows.map((r) => [r.key, r.total, r.chosen])));
            strict_1.default.match(good.text, /jugada/);
            strict_1.default.match(good.reason, /Jugada inesperada/);
            strict_1.default.equal(weak.belowFloor, true);
            // excluir el bueno: no queda nada que supere la nota
            const v2 = e.ctx.moments.setState(vod.id, good.key, 'exclude');
            strict_1.default.equal(v2.pending, true);
            strict_1.default.equal(v2.rows.find((r) => r.key === good.key).excluded, true);
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(clipsOf(e).length, 0, e.ctx.store.data.vods[0].autopilot?.note);
            strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /corrección\(es\) tuyas/);
            strict_1.default.equal(srv.judgeCalls, calls, 'las valoraciones no se piden otra vez');
            // fijar el flojo: entra aunque no llegue a la nota
            e.ctx.moments.setState(vod.id, weak.key, 'include');
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(clipsOf(e).length, 1);
            strict_1.default.equal(srv.judgeCalls, calls);
            strict_1.default.equal(e.ctx.moments.list(vod.id).rows.find((r) => r.key === weak.key).chosen, true);
            // limpiar: vuelve lo que eligió el piloto
            e.ctx.moments.clear(vod.id);
            strict_1.default.equal(e.ctx.moments.list(vod.id).pending, false);
            await e.ctx.autopilot.run(vod.id);
            const back = clipsOf(e);
            strict_1.default.equal(back.length, 1);
            strict_1.default.match(back[0].auto.reason ?? '', /Jugada inesperada/);
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('los tiempos y las claves se validan y un momento añadido a mano se puede mover y quitar', () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        const vod = (0, helpers_1.addDownloadedVod)(e, video);
        e.ctx.store.data.vods[0].durationSec = 240;
        const j = (start, total) => ({ id: `c${start}`, start, end: start + 40, signal: 5, total, judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind: 'fail', reason: 'motivo', discard: false } });
        (0, momentStore_1.saveSnapshot)(node_path_1.default.join(e.userData, 'moments'), vod.id, [j(50, 8), j(160, 4)], [50], 6.5);
        strict_1.default.deepEqual(e.ctx.moments.list(vod.id).rows.map((r) => [r.key, r.chosen]), [['50', true], ['160', false]]);
        strict_1.default.throws(() => e.ctx.moments.setState(vod.id, '999', 'exclude'), /ya no existe/);
        strict_1.default.throws(() => e.ctx.moments.trim(vod.id, '50', 60, 63), /al menos/);
        strict_1.default.throws(() => e.ctx.moments.trim(vod.id, '50', 60, 300), /no puede durar más|fuera/);
        strict_1.default.throws(() => e.ctx.moments.trim(vod.id, '50', 200, 250), /fuera del directo/);
        strict_1.default.throws(() => e.ctx.moments.add(vod.id, NaN, 80), /no son válidos/);
        const t = e.ctx.moments.trim(vod.id, '50', 55, 95);
        strict_1.default.deepEqual([t.rows[0].start, t.rows[0].end, t.rows[0].edited], [55, 95, true]);
        // el recorte guardado sobrevive a leer otra vez de disco
        strict_1.default.equal(e.ctx.moments.list(vod.id).rows[0].edited, true);
        const a = e.ctx.moments.add(vod.id, 200, 230, 'Mi momento');
        strict_1.default.equal(a.rows.find((r) => r.manual).title, 'Mi momento');
        strict_1.default.throws(() => e.ctx.moments.add(vod.id, 200, 235), /Ya hay un momento/);
        const m = e.ctx.moments.trim(vod.id, '200', 205, 240);
        strict_1.default.deepEqual(m.rows.filter((r) => r.manual).map((r) => r.key), ['205']);
        strict_1.default.equal(e.ctx.moments.remove(vod.id, '205').rows.some((r) => r.manual), false);
        strict_1.default.equal(e.ctx.moments.setState(vod.id, '50', 'reset').rows[0].edited, false);
        strict_1.default.throws(() => e.ctx.moments.list('no-existe'), /no existe/);
    });
    (0, node_test_1.it)('un directo sin selección guardada lo dice en vez de inventar momentos', () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        const vod = (0, helpers_1.addDownloadedVod)(e, video);
        const v = e.ctx.moments.list(vod.id);
        strict_1.default.deepEqual([v.available, v.rows.length, v.quality], [false, 0, null]);
    });
    (0, node_test_1.it)('aprende de lo que descartas y fijas, sin contar dos veces lo mismo ni lo que no estaba elegido', () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        const vod = (0, helpers_1.addDownloadedVod)(e, video);
        e.ctx.store.data.vods[0].durationSec = 2000;
        const j = (start, total, kind) => ({ id: `c${start}`, start, end: start + 40, signal: 5, total, judgement: { id: `c${start}`, scores: { humor: 5, originalidad: 5, interaccion: 5, reaccion: 5, contexto: 5, autonomia: 5 }, kind, reason: '', discard: false } });
        const all = [100, 300, 500, 700].map((s) => j(s, 8, 'fail')).concat([j(900, 3, 'gracia')]);
        (0, momentStore_1.saveSnapshot)(node_path_1.default.join(e.userData, 'moments'), vod.id, all, [100, 300, 500, 700], 6.5);
        strict_1.default.deepEqual(e.ctx.moments.prefs(), { enabled: true, kinds: [] });
        e.ctx.moments.setState(vod.id, '100', 'exclude');
        e.ctx.moments.setState(vod.id, '100', 'exclude'); // repetir no cuenta
        e.ctx.moments.setState(vod.id, '900', 'exclude'); // no estaba elegido: no dice nada
        e.ctx.moments.setState(vod.id, '300', 'include'); // ya estaba elegido: tampoco
        strict_1.default.deepEqual(e.ctx.moments.prefs().kinds, [{ kind: 'fail', bias: -0.25, count: 1, active: false }]);
        e.ctx.moments.setState(vod.id, '300', 'exclude');
        e.ctx.moments.setState(vod.id, '500', 'exclude');
        strict_1.default.deepEqual(e.ctx.moments.prefs().kinds, [{ kind: 'fail', bias: -0.75, count: 3, active: true }]);
        // fijar uno que no estaba elegido sube su tipo
        e.ctx.moments.setState(vod.id, '900', 'include');
        strict_1.default.equal(e.ctx.moments.prefs().kinds.find((k) => k.kind === 'gracia').bias, 0.25);
        strict_1.default.equal(e.ctx.moments.setPrefsEnabled(false).enabled, false);
        strict_1.default.equal(e.ctx.moments.resetPrefs().kinds.length, 0);
        strict_1.default.equal(e.ctx.moments.prefs().enabled, false, 'borrar lo aprendido no cambia si está activado');
    });
    (0, node_test_1.it)('las preferencias aprendidas bajan la nota del tipo que sueles descartar y se avisa en la nota del análisis', async () => {
        const srv = await llm();
        try {
            const { e, vod } = setup(srv.url);
            const prefsFile = node_path_1.default.join(e.userData, 'preferences.json');
            // sin lo aprendido: se ve la nota real del momento bueno
            await e.ctx.autopilot.run(vod.id);
            const score = clipsOf(e)[0].auto.score;
            strict_1.default.ok(score > 7, String(score));
            // la nota mínima justo por debajo de esa nota; el ajuste de -1,5 lo deja fuera
            e.ctx.settings.set({ autopilot: { minQuality: Math.floor(score * 2) / 2 } });
            (0, momentStore_1.savePrefs)(prefsFile, { enabled: true, kindBias: { fail: -1.5 }, counts: { fail: 6 } });
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Preferencias aprendidas aplicadas: fail -1\.5/);
            strict_1.default.equal(clipsOf(e).length, 0, 'el momento bueno de tipo fail queda por debajo de la nota mínima');
            // con ellas apagadas vuelve a salir
            e.ctx.moments.setPrefsEnabled(false);
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(clipsOf(e).length, 1);
            strict_1.default.doesNotMatch(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Preferencias aprendidas/);
        }
        finally {
            srv.close();
        }
    });
});

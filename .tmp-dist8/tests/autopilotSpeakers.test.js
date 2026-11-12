"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
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
const unit = (i) => Array.from({ length: 16 }, (_, k) => (k === i ? 1 : 0.02));
/** Motor de mentira: alterna dos voces cada 10 s; la primera voz de cada análisis suena a «A» y la segunda a «B». */
function fake(calls) {
    return () => {
        let k = 0;
        return {
            process: (s) => {
                calls.n++;
                k = 0;
                const out = [];
                for (let t = 0; t < s.length / 16000; t += 10)
                    out.push({ start: t, end: Math.min(t + 10, s.length / 16000), speaker: (t / 10) % 2 });
                return out;
            },
            embed: () => unit(k++ % 2),
        };
    };
}
const WORDS = [
    ...Array.from({ length: 12 }, (_, i) => ({ text: `uno${i}`, start: 52 + i * 0.8, end: 52.5 + i * 0.8 })),
    ...Array.from({ length: 12 }, (_, i) => ({ text: `dos${i}`, start: 162 + i * 0.8, end: 162.5 + i * 0.8 })),
];
function setup(auto = {}, engine = true) {
    const calls = { n: 0 };
    const e = (0, helpers_1.makeEnv)(engine ? { diarizationEngine: fake(calls) } : {});
    envs.push(e);
    const vod = (0, helpers_1.addDownloadedVod)(e, video);
    const tr = node_path_1.default.join(root, `tr-${Math.random().toString(36).slice(2)}.json`);
    node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: WORDS }));
    e.ctx.transcripts.importFile(vod.id, tr);
    e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 1, requireApproval: true, platforms: ['youtube'], cleanup: false, ...auto } });
    return { e, vod, calls };
}
(0, node_test_1.describe)('hablantes', () => {
    (0, node_test_1.it)('el piloto identifica las voces de lo elegido, las recuerda y las pone en las palabras', async () => {
        const { e, vod, calls } = setup();
        await e.ctx.autopilot.run(vod.id);
        const v = e.ctx.store.data.vods[0];
        strict_1.default.equal(v.autopilot?.status, 'done', v.autopilot?.note);
        strict_1.default.match(v.autopilot?.note ?? '', /Hablantes: 2 voz/);
        strict_1.default.ok(calls.n >= 1);
        strict_1.default.equal(e.ctx.speakers.profiles().length, 2);
        const ws = e.ctx.transcripts.words(vod.id);
        const spk = new Set(ws.filter((w) => w.spk !== undefined).map((w) => w.spk));
        strict_1.default.equal(spk.size, 2, 'las palabras de lo elegido llevan hablante');
        strict_1.default.ok(ws.some((w) => w.spk === undefined), 'lo que no se analizó queda sin atribuir');
        // lo guardado en disco no se toca
        const dir = node_path_1.default.join(e.userData, 'transcripts');
        const raw = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, node_fs_1.default.readdirSync(dir)[0]), 'utf8'));
        strict_1.default.ok(raw.words.every((w) => w.spk === undefined));
    });
    (0, node_test_1.it)('no repite el análisis de lo ya analizado', async () => {
        const { e, vod, calls } = setup();
        await e.ctx.autopilot.run(vod.id);
        const before = calls.n;
        const r = await e.ctx.speakers.diarize(vod.id, [{ start: 50, end: 66 }]);
        strict_1.default.equal(r.sec, 0);
        strict_1.default.equal(calls.n, before);
    });
    (0, node_test_1.it)('una voz que ya se conoce se reconoce en otro directo (no se crea otra)', async () => {
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(e.ctx.speakers.profiles().length, 2);
        const vod2 = (0, helpers_1.addDownloadedVod)(e, video, 'vod2');
        await e.ctx.speakers.diarize(vod2.id, [{ start: 0, end: 60 }]);
        strict_1.default.equal(e.ctx.speakers.profiles().length, 2, 'mismas dos voces');
        strict_1.default.ok(e.ctx.speakers.overlay('vod2').segs.every((s) => [1, 2].includes(s.speaker)));
    });
    (0, node_test_1.it)('alias, «soy yo» y unir voces se guardan y se aplican a todos los directos', async () => {
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        const [a, b] = e.ctx.speakers.profiles();
        e.ctx.speakers.rename(a.id, '  Marçal <b> ');
        strict_1.default.equal(e.ctx.speakers.profiles()[0].alias, 'Marçal b');
        e.ctx.speakers.rename(a.id, '');
        strict_1.default.equal(e.ctx.speakers.profiles()[0].named, false);
        e.ctx.speakers.setSelf(b.id);
        const ws = e.ctx.transcripts.words(vod.id);
        const colors = e.ctx.speakers.colorsFor(ws);
        strict_1.default.equal(colors[b.id], '#FFFFFF', 'tu voz en blanco');
        strict_1.default.notEqual(colors[a.id], '#FFFFFF');
        e.ctx.speakers.setSelf(a.id);
        strict_1.default.equal(e.ctx.speakers.profiles().filter((p) => p.self).length, 1, 'solo una voz es la tuya');
        e.ctx.speakers.merge(a.id, b.id);
        strict_1.default.equal(e.ctx.speakers.profiles().length, 1);
        strict_1.default.equal(e.ctx.speakers.profiles()[0].self, true, 'conserva lo de ser tú');
        strict_1.default.equal(new Set(e.ctx.transcripts.words(vod.id).filter((w) => w.spk !== undefined).map((w) => w.spk)).size, 1);
        strict_1.default.equal(e.ctx.speakers.colorsFor(e.ctx.transcripts.words(vod.id)), undefined, 'con una sola voz no se colorea');
        strict_1.default.throws(() => e.ctx.speakers.merge(b.id, b.id), /distintos/);
        strict_1.default.throws(() => e.ctx.speakers.rename(999, 'x'), /no existe/);
        // sobrevive a cerrar y abrir
        e.ctx.store.save();
        const saved = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(e.userData, 'data.json'), 'utf8'));
        strict_1.default.equal(saved.speakers.profiles.length, 1);
    });
    (0, node_test_1.it)('con la opción desactivada no se identifica a nadie', async () => {
        const { e, vod, calls } = setup({ speakers: false });
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(calls.n, 0);
        strict_1.default.equal(e.ctx.speakers.profiles().length, 0);
    });
    (0, node_test_1.it)('si el módulo de diarización no está, el análisis sigue y lo avisa', async () => {
        const { e, vod } = setup({}, false);
        await e.ctx.autopilot.run(vod.id);
        const v = e.ctx.store.data.vods[0];
        strict_1.default.equal(v.autopilot?.status, 'done');
        strict_1.default.match(v.autopilot?.note ?? '', /Hablantes sin identificar/);
    });
    (0, node_test_1.it)('la configuración de colores se valida', () => {
        const { e } = setup();
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { speakerColors: ['rojo'] } }), /#RRGGBB/);
        e.ctx.settings.set({ autopilot: { speakerColors: ['#ffffff', '#ff0000'] } });
        strict_1.default.deepEqual(e.ctx.store.data.settings.autopilot.speakerColors, ['#FFFFFF', '#FF0000']);
    });
});

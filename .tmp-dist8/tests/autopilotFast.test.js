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
    delete process.env.FAKE_LOG;
    while (envs.length)
        envs.pop().cleanup();
});
/** Directo de 4 min con dos "momentos" (ruido fuerte) hacia el segundo 60 y el 170. */
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
function setup(auto = {}) {
    const e = (0, helpers_1.makeEnv)();
    envs.push(e);
    e.ctx.settings.set({ whisperPath: (0, helpers_1.fakeWhisper)(), whisperModel: 'tiny', whisperLanguage: 'es' });
    (0, helpers_1.installFakeModel)(e, 'tiny');
    const vod = (0, helpers_1.addDownloadedVod)(e, video);
    vod.title = 'DÍA TOP: LOCKE FALTABA con Marshall';
    e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false, ...auto } });
    return { e, vod };
}
(0, node_test_1.describe)('análisis rápido', () => {
    (0, node_test_1.it)('por defecto solo transcribe lo elegido (no el directo entero) y lo anota', async () => {
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        const v = e.ctx.store.data.vods[0];
        strict_1.default.equal(v.autopilot?.status, 'done');
        strict_1.default.equal(e.ctx.transcripts.isFull(vod.id), false, 'la transcripción es parcial');
        strict_1.default.equal(v.transcript?.partial, true);
        strict_1.default.ok(e.ctx.transcripts.words(vod.id).length > 0, 'hay palabras de lo elegido');
        strict_1.default.match(v.autopilot?.note ?? '', /Análisis rápido: se transcribieron \d+ min de 4/);
        strict_1.default.ok(e.ctx.store.data.outputs.length >= 3, 'monta resumen, vídeo principal y clips igualmente');
    });
    (0, node_test_1.it)('con el análisis rápido desactivado se transcribe todo el directo', async () => {
        const { e, vod } = setup({ fastAnalysis: false });
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(e.ctx.transcripts.isFull(vod.id), true);
        strict_1.default.doesNotMatch(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Análisis rápido/);
    });
    (0, node_test_1.it)('Whisper recibe el vocabulario y de qué va el directo (solo ASCII)', async () => {
        const log = node_path_1.default.join(root, `args-${Date.now()}.log`);
        process.env.FAKE_LOG = log;
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        const runs = node_fs_1.default.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        strict_1.default.ok(runs.length > 0);
        for (const args of runs) {
            const i = args.indexOf('--prompt');
            strict_1.default.ok(i >= 0, 'lleva --prompt');
            const p = args[i + 1];
            strict_1.default.ok(/^[\x20-\x7e]*$/.test(p), p);
            for (const t of ['Movidas', 'Marrshall', 'Gorens', 'Reaptor', 'LOCKE FALTABA'])
                strict_1.default.ok(p.includes(t), `${t} en «${p}»`);
        }
    });
});
(0, node_test_1.describe)('vocabulario y corrección de subtítulos', () => {
    const WORDS = [
        { text: 'hola', start: 1, end: 1.4 }, { text: 'movidas', start: 1.5, end: 2 }, { text: 'marsan', start: 2, end: 2.5 }, { text: 'como', start: 2.6, end: 3 },
        { text: 'va', start: 3, end: 3.3 }, { text: 'el', start: 8, end: 8.2 }, { text: 'reptor', start: 8.2, end: 8.8 }, { text: 'hoy.', start: 8.8, end: 9.2 },
    ];
    function withTranscript() {
        const { e, vod } = setup();
        const f = node_path_1.default.join(e.root, 't.json');
        node_fs_1.default.writeFileSync(f, JSON.stringify({ words: WORDS }));
        e.ctx.transcripts.importFile(vod.id, f);
        return { e, vod };
    }
    (0, node_test_1.it)('el vocabulario corrige lo que se lee sin tocar lo guardado, y también lo antiguo', () => {
        const { e, vod } = withTranscript();
        const before = e.ctx.transcripts.words(vod.id).map((w) => w.text);
        strict_1.default.ok(before.includes('Reaptor'), 'reptor → Reaptor por parecido: ' + before.join(' '));
        e.ctx.transcripts.setVocabulary({ terms: ['Marrshall'], corrections: [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }] });
        const after = e.ctx.transcripts.words(vod.id).map((w) => w.text);
        strict_1.default.deepEqual(after.slice(0, 3), ['hola', 'MovidasMarshall', 'como']);
        // lo guardado en disco sigue siendo lo que dijo Whisper
        const raw = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(e.userData, 'transcripts', node_fs_1.default.readdirSync(node_path_1.default.join(e.userData, 'transcripts'))[0]), 'utf8'));
        strict_1.default.ok(raw.words.some((w) => w.text === 'marsan'));
    });
    (0, node_test_1.it)('corregir el texto de una línea guarda las palabras y enseña al programa', () => {
        const { e, vod } = withTranscript();
        e.ctx.transcripts.setVocabulary({ terms: [], corrections: [] });
        const r = e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 3, text: 'hola MovidasMarshall como' }]);
        strict_1.default.equal(r.changed, 1);
        strict_1.default.deepEqual(r.learned, [{ from: 'movidas marsan', to: 'MovidasMarshall' }]);
        strict_1.default.deepEqual(e.ctx.transcripts.words(vod.id).map((w) => w.text).slice(0, 4), ['hola', 'MovidasMarshall', 'como', 'va']);
        const v = e.ctx.transcripts.vocabulary();
        strict_1.default.deepEqual(v.corrections, [{ from: 'movidas marsan', to: 'MovidasMarshall', n: 1 }]);
        strict_1.default.ok(v.terms.includes('MovidasMarshall'), 'un nombre propio nuevo pasa al vocabulario');
        // sin cambios no hay nada que aprender
        strict_1.default.equal(e.ctx.transcripts.editLines(vod.id, [{ start: 8, end: 8.2, text: 'el' }]).changed, 0);
    });
    (0, node_test_1.it)('lo aprendido se aplica solo a una transcripción nueva', () => {
        const { e, vod } = withTranscript();
        e.ctx.transcripts.setVocabulary({ terms: [], corrections: [] });
        e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 3, text: 'hola MovidasMarshall como' }]);
        const vod2 = (0, helpers_1.addDownloadedVod)(e, video, 'vod2');
        const f = node_path_1.default.join(e.root, 't2.json');
        node_fs_1.default.writeFileSync(f, JSON.stringify({ words: [{ text: 'ya', start: 1, end: 1.2 }, { text: 'Movidas', start: 1.3, end: 1.8 }, { text: 'Marsan,', start: 1.8, end: 2.3 }] }));
        e.ctx.transcripts.importFile(vod2.id, f);
        strict_1.default.deepEqual(e.ctx.transcripts.words(vod2.id).map((w) => w.text), ['ya', 'MovidasMarshall,']);
    });
    (0, node_test_1.it)('las correcciones no válidas se rechazan', () => {
        const { e, vod } = withTranscript();
        strict_1.default.throws(() => e.ctx.transcripts.editLines(vod.id, [{ start: 1, end: 2, text: 'x'.repeat(700) }]), /demasiado larga/);
        strict_1.default.throws(() => e.ctx.transcripts.editLines(vod.id, 'no'), /no son válidas/);
        strict_1.default.throws(() => e.ctx.transcripts.editLines('no-existe', []), /no existe/);
    });
});

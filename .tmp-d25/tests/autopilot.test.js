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
const slots_1 = require("../shared/slots");
const helpers_1 = require("./helpers");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
(0, node_test_1.describe)('horas de publicación', () => {
    const at = (s) => new Date(s);
    (0, node_test_1.it)('la siguiente hora local, estrictamente posterior; si ya pasó hoy, mañana', () => {
        const a = (0, slots_1.nextSlot)(at('2026-10-15T05:00:00'), '07:00');
        strict_1.default.equal(a.getHours(), 7);
        strict_1.default.equal(a.getDate(), 15);
        strict_1.default.equal((0, slots_1.nextSlot)(at('2026-10-15T07:00:00'), '07:00').getDate(), 16);
        strict_1.default.equal((0, slots_1.nextSlot)(at('2026-10-15T23:59:00'), '16:00').getDate(), 16);
    });
    (0, node_test_1.it)('salta las horas ocupadas', () => {
        const taken = new Set([(0, slots_1.nextSlot)(at('2026-10-15T05:00:00'), '07:00').getTime()]);
        const b = (0, slots_1.nextSlot)(at('2026-10-15T05:00:00'), '07:00', taken);
        strict_1.default.equal(b.getDate(), 16);
        strict_1.default.equal(b.getHours(), 7);
    });
    (0, node_test_1.it)('nextFreeSlot elige el primer hueco libre entre varias horas y pasa al día siguiente cuando se acaban', () => {
        const times = ['08:00', '12:00', '16:00', '21:30'];
        const at = (d, h, m = 0) => new Date(2026, 9, d, h, m, 0, 0);
        strict_1.default.deepEqual((0, slots_1.nextFreeSlot)(at(16, 7), times), at(16, 8));
        strict_1.default.deepEqual((0, slots_1.nextFreeSlot)(at(16, 9), times), at(16, 12));
        strict_1.default.deepEqual((0, slots_1.nextFreeSlot)(at(16, 22), times), at(17, 8));
        const taken = new Set([at(16, 8).getTime(), at(16, 12).getTime(), at(16, 16).getTime(), at(16, 21, 30).getTime(), at(17, 8).getTime()]);
        strict_1.default.deepEqual((0, slots_1.nextFreeSlot)(at(16, 7), times, taken), at(17, 12));
        strict_1.default.throws(() => (0, slots_1.nextFreeSlot)(at(16, 7), []), /No hay horas/);
    });
    (0, node_test_1.it)('aguanta el cambio de hora de octubre/marzo', () => {
        for (const d of ['2026-10-24T20:00:00', '2027-03-27T20:00:00']) {
            const a = (0, slots_1.nextSlot)(at(d), '07:00');
            strict_1.default.equal(a.getHours(), 7);
            strict_1.default.equal(a.getMinutes(), 0);
        }
    });
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
function setup(extra = {}) {
    const e = (0, helpers_1.makeEnv)(extra);
    envs.push(e);
    const vod = (0, helpers_1.addDownloadedVod)(e, video);
    e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1, maxClips: 2, maxVideos: 2, requireApproval: true, platforms: ['youtube'], cleanup: false } });
    return { e, vod };
}
function llmServer(reply) {
    const calls = [];
    const srv = node_http_1.default.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            calls.push(JSON.parse(raw));
            const r = reply();
            res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
        });
    });
    return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}`, calls, close: () => srv.close() })));
}
(0, node_test_1.describe)('piloto automático', () => {
    (0, node_test_1.it)('analiza, monta resumen + principal + clips y los deja pendientes de tu visto bueno', async () => {
        const { e, vod } = setup();
        const t0 = Date.now();
        await e.ctx.autopilot.run(vod.id);
        const outs = e.ctx.store.data.outputs;
        const roles = outs.map((o) => o.auto?.role).sort();
        strict_1.default.deepEqual(roles, ['clip', 'clip', 'main', 'summary'], JSON.stringify(outs.map((o) => [o.title, o.auto])));
        strict_1.default.ok(outs.every((o) => o.auto.review === 'pending'));
        strict_1.default.equal(e.ctx.store.data.publications.length, 0, 'nada se programa sin visto bueno');
        for (const o of outs)
            strict_1.default.ok(Object.values(o.files).every((f) => node_fs_1.default.existsSync(f)));
        const clips = outs.filter((o) => o.kind === 'clip');
        strict_1.default.ok(clips.every((c) => c.files.vertical && c.files.horizontal));
        // los clips caen sobre los momentos fuertes
        const starts = clips.map((c) => c.start).sort((a, b) => a - b);
        strict_1.default.ok(starts[0] < 70 && clips.some((c) => c.start < 70 && c.end > 55), JSON.stringify(starts));
        strict_1.default.ok(clips.some((c) => c.start < 180 && c.end > 165));
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
        strict_1.default.ok(e.notifier.tasks.some((t) => t.kind === 'analyze' && t.status === 'done'));
        console.log(`      (piloto completo en ${Math.round((Date.now() - t0) / 1000)} s)`);
    });
    (0, node_test_1.it)('nunca mezcla categorías de Twitch: cada clip y cada vídeo cae entero en una sola', async () => {
        const { e, vod } = setup();
        vod.chapters = [
            { start: 0, end: 120, title: 'Minecraft' },
            { start: 120, end: 240, title: 'Just Chatting' },
        ];
        await e.ctx.autopilot.run(vod.id);
        const outs = e.ctx.store.data.outputs;
        strict_1.default.ok(outs.length >= 2, 'hay resultados');
        const within = (a, b) => vod.chapters.some((c) => a >= c.start - 0.01 && b <= c.end + 0.01);
        for (const o of outs) {
            strict_1.default.ok(o.category === 'Minecraft' || o.category === 'Just Chatting', `categoría de ${o.title}`);
            strict_1.default.match(o.description ?? '', new RegExp(`Categoría: ${o.category}$`), `la descripción termina con la categoría (${o.title})`);
            const segs = o.kind === 'long' ? o.segments : [{ start: o.start, end: o.end }];
            strict_1.default.ok(segs.every((g) => within(g.start, g.end)) && new Set(segs.map((g) => vod.chapters.find((c) => g.start >= c.start - 0.01 && g.start < c.end)?.title)).size === 1, `${o.title}: ${JSON.stringify(segs)}`);
        }
    });
    (0, node_test_1.it)('al dar el visto bueno rellena los huecos: vídeos en las horas de vídeos, clips en las de clips, uno por hueco', async () => {
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        node_test_1.mock.timers.enable({ apis: ['Date'], now: new Date(2030, 9, 16, 7, 0, 0).getTime() });
        try {
            const order = { summary: 0, main: 1, clip: 2 };
            for (const o of [...e.ctx.store.data.outputs].sort((a, b) => order[a.auto.role] - order[b.auto.role]))
                e.ctx.autopilot.approve(o.id);
        }
        finally {
            node_test_1.mock.timers.reset();
        }
        const pubs = e.ctx.store.data.publications;
        const by = (role) => e.ctx.store.data.outputs.filter((o) => o.auto?.role === role).map((o) => new Date(pubs.find((p) => p.outputId === o.id).scheduledAt));
        const [sum] = by('summary');
        const [main] = by('main');
        strict_1.default.deepEqual([sum.getDate(), sum.getHours(), sum.getMinutes()], [16, 8, 0]);
        strict_1.default.deepEqual([main.getDate(), main.getHours(), main.getMinutes()], [16, 12, 0]);
        const clips = by('clip').sort((a, b) => a.getTime() - b.getTime());
        strict_1.default.deepEqual(clips.map((d) => [d.getDate(), d.getHours()]), [[16, 10], [16, 14]]);
        strict_1.default.ok(e.ctx.store.data.outputs.every((o) => o.auto.review === 'approved'));
        // aprobar dos veces no duplica
        e.ctx.autopilot.approve(e.ctx.store.data.outputs[0].id);
        strict_1.default.equal(e.ctx.store.data.publications.length, 4);
    });
    (0, node_test_1.it)('los huecos ocupados se saltan y al acabarse el día sigue con el siguiente', async () => {
        const { e, vod } = setup();
        await e.ctx.autopilot.run(vod.id);
        const others = e.ctx.store.data.outputs.filter((o) => o.auto?.role !== 'summary');
        const sum = e.ctx.store.data.outputs.find((o) => o.auto?.role === 'summary');
        node_test_1.mock.timers.enable({ apis: ['Date'], now: new Date(2030, 9, 16, 7, 0, 0).getTime() });
        try {
            // hoy ya hay algo en las 08:00, 12:00 y 16:00
            [8, 12, 16].forEach((h, i) => e.ctx.pubs.schedule(others[i].id, ['youtube'], new Date(2030, 9, 16, h, 0, 0).toISOString()));
            e.ctx.autopilot.approve(sum.id);
            const at = new Date(e.ctx.store.data.publications.find((p) => p.outputId === sum.id).scheduledAt);
            strict_1.default.deepEqual([at.getDate(), at.getHours(), at.getMinutes()], [16, 21, 30]);
        }
        finally {
            node_test_1.mock.timers.reset();
        }
    });
    (0, node_test_1.it)('sin aprobación previa lo programa todo directamente', async () => {
        const { e, vod } = setup();
        e.ctx.settings.set({ autopilot: { requireApproval: false } });
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /4 programados/);
        strict_1.default.equal(e.ctx.store.data.publications.length, e.ctx.store.data.outputs.length);
        strict_1.default.ok(e.ctx.store.data.outputs.every((o) => o.auto.review === 'approved'));
    });
    (0, node_test_1.it)('rechazar borra archivos, miniatura y publicaciones pendientes', async () => {
        const { e, vod } = setup();
        e.ctx.settings.set({ autopilot: { maxClips: 1 } });
        await e.ctx.autopilot.run(vod.id);
        const clip = e.ctx.store.data.outputs.find((o) => o.kind === 'clip');
        e.ctx.autopilot.approve(clip.id);
        const files = [...Object.values(clip.files), clip.thumbnail].filter(Boolean);
        strict_1.default.ok(files.length >= 2);
        e.ctx.library.remove(clip.id);
        strict_1.default.ok(files.every((f) => !node_fs_1.default.existsSync(f)));
        strict_1.default.ok(!e.ctx.store.data.outputs.some((o) => o.id === clip.id));
        strict_1.default.ok(!e.ctx.store.data.publications.some((p) => p.outputId === clip.id));
    });
    (0, node_test_1.it)('con modelo de lenguaje usa sus títulos (limpiados) y envía solo texto de la transcripción', async () => {
        const srv = await llmServer(() => ({
            status: 200,
            body: { choices: [{ message: { content: JSON.stringify({ resumen: { titulo: 'Gran <b>resumen</b>', descripcion: 'Lo mejor.' }, videos: [{ id: 'video1', titulo: 'La historia', descripcion: 'Desc principal' }], clips: [{ id: 'clip1', titulo: 'Clip uno', descripcion: 'd' }, { id: 'clip2', titulo: 'Clip dos', descripcion: 'd' }] }) } }] },
        }));
        try {
            const { e, vod } = setup({ llmBaseUrl: srv.url });
            const tr = node_path_1.default.join(root, 'tr.json');
            node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: [{ text: 'Hola', start: 56, end: 56.4 }, { text: 'qué', start: 57, end: 57.3 }, { text: 'locura.', start: 58, end: 58.6 }, { text: 'Increíble', start: 166, end: 166.5 }, { text: 'jugada.', start: 167, end: 167.5 }] }));
            e.ctx.transcripts.importFile(vod.id, tr);
            e.ctx.settings.set({ autopilot: { llm: { provider: 'groq', model: 'x', apiKey: 'CLAVE' }, smartSelect: false } });
            await e.ctx.autopilot.run(vod.id);
            const titles = e.ctx.store.data.outputs.map((o) => o.title).sort();
            strict_1.default.deepEqual(titles, ['Clip dos', 'Clip uno', 'Gran resumen', 'La historia']);
            strict_1.default.equal(e.ctx.store.data.outputs.find((o) => o.title === 'La historia').description, 'Desc principal');
            strict_1.default.equal(srv.calls.length, 1);
            strict_1.default.match(JSON.stringify(srv.calls[0]), /locura/);
            strict_1.default.ok(!JSON.stringify(srv.calls[0]).includes('CLAVE'));
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('si el modelo falla, se usan títulos propios y se avisa en la nota', async () => {
        const srv = await llmServer(() => ({ status: 500, body: {} }));
        try {
            const { e, vod } = setup({ llmBaseUrl: srv.url });
            const tr = node_path_1.default.join(root, 'tr2.json');
            node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: [{ text: '¡Increíble', start: 166, end: 166.5 }, { text: 'jugada!', start: 167, end: 167.5 }] }));
            e.ctx.transcripts.importFile(vod.id, tr);
            e.ctx.settings.set({ autopilot: { llm: { provider: 'gemini', model: '', apiKey: 'k' }, smartSelect: false } });
            await e.ctx.autopilot.run(vod.id);
            strict_1.default.equal(e.ctx.store.data.outputs.length, 4);
            strict_1.default.match(e.ctx.store.data.vods[0].autopilot.note, /Títulos sin modelo de lenguaje/);
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('un directo plano no inventa vídeos y lo dice', async () => {
        const e = (0, helpers_1.makeEnv)({ energy: async () => new Array(240).fill(-30) });
        envs.push(e);
        const vod = (0, helpers_1.addDownloadedVod)(e, video);
        e.ctx.settings.set({ autopilot: { summaryMinutes: 1, mainMinutes: 1 } });
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(e.ctx.store.data.outputs.length, 0);
        strict_1.default.equal(vod.autopilot?.status, 'skipped');
    });
    (0, node_test_1.it)('un fallo total deja el VOD en error con el motivo, y se puede relanzar', async () => {
        const e = (0, helpers_1.makeEnv)({ energy: async () => { throw new Error('boom'); } });
        envs.push(e);
        const vod = (0, helpers_1.addDownloadedVod)(e, video);
        e.ctx.settings.set({ autopilot: { chatCapture: false } });
        await strict_1.default.rejects(() => e.ctx.autopilot.run(vod.id), /ninguna señal/);
        strict_1.default.equal(vod.autopilot?.status, 'error');
        strict_1.default.equal(e.notifier.tasks.filter((t) => t.kind === 'analyze').pop()?.status, 'error');
    });
    (0, node_test_1.it)('el chat guardado de ese directo se usa como señal', async () => {
        const { e, vod } = setup({ energy: async () => new Array(240).fill(-30) });
        vod.streamStartedAt = new Date().toISOString();
        const dir = node_path_1.default.join(e.userData, 'chat');
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        const bins = new Array(240).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0));
        for (let i = 100; i < 115; i++)
            bins[i] = 15;
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'x.json'), JSON.stringify({ startedAt: vod.streamStartedAt, bins }));
        e.ctx.settings.set({ autopilot: { maxClips: 1 } });
        await e.ctx.autopilot.run(vod.id);
        const clip = e.ctx.store.data.outputs.find((o) => o.kind === 'clip');
        strict_1.default.ok(clip.start < 115 && clip.end > 100, `${clip.start}-${clip.end}`);
    });
    (0, node_test_1.it)('una serie configurada nombra los vídeos «Serie Día N» y el día sube solo con cada directo', async () => {
        const { e, vod } = setup();
        e.ctx.settings.set({ autopilot: { maxClips: 0, maxVideos: 1, series: { name: 'Minecraft extremo', nextDay: 3 } } });
        await e.ctx.autopilot.run(vod.id);
        const [o] = e.ctx.store.data.outputs;
        strict_1.default.equal(e.ctx.store.data.outputs.length, 1);
        strict_1.default.equal(o.title, 'Minecraft extremo Día 3 - Resumen');
        strict_1.default.equal(e.ctx.store.data.settings.autopilot.series.nextDay, 4);
        strict_1.default.match(e.ctx.store.data.vods[0].autopilot.note, /Serie «Minecraft extremo», día 3/);
    });
    (0, node_test_1.it)('si el título del directo ya dice el día, se usa ese y la cuenta configurada no se toca', async () => {
        const { e, vod } = setup();
        vod.title = 'Locke en chanclas - día 12 | directo';
        e.ctx.settings.set({ autopilot: { maxClips: 0, maxVideos: 1, series: { name: 'Otra', nextDay: 5 } } });
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(e.ctx.store.data.outputs[0].title, 'Locke en chanclas Día 12 - Resumen');
        strict_1.default.equal(e.ctx.store.data.settings.autopilot.series.nextDay, 5);
    });
    (0, node_test_1.it)('suggestTitle: título provisional según lo que se dice en el tramo; sin transcripción, nada', async () => {
        const srv = await llmServer(() => ({ status: 200, body: { choices: [{ message: { content: '{"titulo":"El susto del creeper"}' } }], candidates: [{ content: { parts: [{ text: '{"titulo":"El susto del creeper"}' }] } }] } }));
        try {
            const { e, vod } = setup({ llmBaseUrl: srv.url });
            await strict_1.default.rejects(() => e.ctx.autopilot.suggestTitle(vod.id, 10, 40), /Whisper/, 'sin transcripción ni Whisper, el motivo llega al usuario');
            const tr = node_path_1.default.join(root, 'tr-sug.json');
            node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!'].map((text, i) => ({ text, start: 20 + i * 0.5, end: 20.5 + i * 0.5 })) }));
            e.ctx.transcripts.importFile(vod.id, tr);
            const local = await e.ctx.autopilot.suggestTitle(vod.id, 10, 40);
            strict_1.default.equal(local?.source, 'transcript');
            strict_1.default.match(local.title, /creeper/);
            strict_1.default.equal(await e.ctx.autopilot.suggestTitle(vod.id, 100, 130), null, 'otro tramo sin palabras');
            e.ctx.settings.set({ autopilot: { llm: { provider: 'gemini', model: '', apiKey: 'k' } } });
            const llm = await e.ctx.autopilot.suggestTitle(vod.id, 10, 40);
            strict_1.default.deepEqual(llm, { title: 'El susto del creeper', source: 'llm' });
        }
        finally {
            srv.close();
        }
    });
    (0, node_test_1.it)('nombres cortos en la Biblioteca: renombra lo largo o genérico, respeta lo escrito por el usuario y evita repetidos; al llegar la transcripción se hace solo', async () => {
        const { e, vod } = setup();
        const mk = (id, title, o = {}) => {
            e.ctx.store.data.outputs.push({ id, vodId: vod.id, kind: 'clip', title, files: {}, durationSec: 30, createdAt: '2026-10-10T10:00:00Z', start: 10, end: 40, ...o });
        };
        mk('a', 'Un título larguísimo que describe todo lo que pasa en este clip de Twitch');
        mk('b', 'Mi clip favorito');
        mk('c', 'Otro título larguísimo escrito por mí mismo que no se debe tocar nunca jamás', { titleSource: 'manual' });
        mk('d', 'Clip 3', { start: 100, end: 130 });
        const tr = node_path_1.default.join(root, 'tr-lib.json');
        node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!'].map((text, i) => ({ text, start: 20 + i * 0.5, end: 20.5 + i * 0.5 })) }));
        e.ctx.transcripts.importFile(vod.id, tr); // al guardarse la transcripción, lo ya creado se nombra solo
        for (let i = 0; i < 50 && e.ctx.store.data.outputs[0].titleSource !== 'auto'; i++)
            await new Promise((r) => setTimeout(r, 20));
        const by = (id) => e.ctx.store.data.outputs.find((o) => o.id === id);
        strict_1.default.match(by('a').title, /creeper/i);
        strict_1.default.ok(by('a').title.length <= 40 && by('a').titleSource === 'auto', by('a').title);
        strict_1.default.equal(by('b').title, 'Mi clip favorito');
        strict_1.default.match(by('c').title, /escrito por mí mismo/);
        strict_1.default.equal(by('d').title, 'Clip 3', 'sin palabras en su tramo no hay de qué sacar el nombre');
        const r = await e.ctx.autopilot.autoNameLibrary();
        strict_1.default.deepEqual(r, { renamed: 0, described: 0, noTranscript: 1, kept: 3 });
        strict_1.default.match(by('a').description ?? '', /creeper/i, 'también se escribe la descripción de YouTube');
        strict_1.default.equal(by('a').descSource, 'auto');
        // dos elementos del mismo tramo no se llaman igual
        mk('e', 'Otro título larguísimo del mismo tramo que se tiene que distinguir del anterior');
        await e.ctx.autopilot.autoNameLibrary();
        strict_1.default.notEqual(by('e').title.toLowerCase(), by('a').title.toLowerCase());
        strict_1.default.match(by('e').title, /creeper/i);
        // lo que el usuario escribe después queda como suyo
        e.ctx.library.setMeta('a', { title: 'Mi nombre' });
        strict_1.default.equal(by('a').titleSource, 'manual');
        await e.ctx.autopilot.autoNameLibrary();
        strict_1.default.equal(by('a').title, 'Mi nombre');
    });
    (0, node_test_1.it)('al arrancar: renombra solo lo genérico no escrito por el usuario, describe lo que no tiene descripción y respeta la del usuario', async () => {
        const { e, vod } = setup();
        const mk = (id, title, o = {}) => {
            e.ctx.store.data.outputs.push({ id, vodId: vod.id, kind: 'clip', title, files: {}, durationSec: 30, createdAt: '2026-10-10T10:00:00Z', start: 10, end: 40, ...o });
        };
        mk('g1', 'Momento 4');
        mk('g2', 'Directo del 4 de octubre (parte 2)');
        mk('g3', 'Resumen del directo - 4 de octubre', { kind: 'long', segments: [{ start: 10, end: 40 }] });
        mk('keep', 'Un título largo pero que no es genérico, así que el arranque no lo toca para nada');
        mk('mine', 'Momento 9', { titleSource: 'manual' });
        mk('desc', 'Mi clip', { description: 'Descripción mía', descSource: 'manual' });
        const tr = node_path_1.default.join(root, 'tr-start.json');
        node_fs_1.default.writeFileSync(tr, JSON.stringify({ words: ['¡No', 'me', 'lo', 'puedo', 'creer,', 'un', 'creeper', 'a', 'mis', 'espaldas!', 'Casi', 'me', 'da', 'un', 'infarto', 'aquí', 'delante', 'de', 'todos.'].map((text, i) => ({ text, start: 12 + i * 0.5, end: 12.5 + i * 0.5 })) }));
        e.ctx.transcripts.importFile(vod.id, tr);
        await new Promise((r) => setTimeout(r, 100)); // el guardado de la transcripción lanza su propio repaso
        for (const o of e.ctx.store.data.outputs) {
            if (o.id === 'keep' || o.id === 'mine') {
                o.title = o.id === 'keep' ? 'Un título largo pero que no es genérico, así que el arranque no lo toca para nada' : 'Momento 9';
                o.titleSource = o.id === 'keep' ? undefined : 'manual';
                delete o.description;
                delete o.descSource;
            }
        }
        for (const id of ['g1', 'g2', 'g3']) {
            const o = e.ctx.store.data.outputs.find((x) => x.id === id);
            o.title = id === 'g1' ? 'Momento 4' : id === 'g2' ? 'Directo del 4 de octubre (parte 2)' : 'Resumen del directo - 4 de octubre';
            o.titleSource = undefined;
            delete o.description;
            delete o.descSource;
        }
        const r = await e.ctx.autopilot.refreshLibraryAtStart();
        const by = (id) => e.ctx.store.data.outputs.find((o) => o.id === id);
        strict_1.default.ok(r && r.renamed >= 3, JSON.stringify(r));
        for (const id of ['g1', 'g2', 'g3']) {
            strict_1.default.match(by(id).title, /creeper|infarto|espaldas/i, by(id).title);
            strict_1.default.equal(by(id).titleSource, 'auto');
            strict_1.default.ok((by(id).description ?? '').length > 30 && (by(id).description ?? '').length <= 300, by(id).description);
            strict_1.default.equal(by(id).descSource, 'auto');
        }
        strict_1.default.equal(by('keep').title.startsWith('Un título largo'), true, 'un nombre largo pero no genérico no se toca al arrancar');
        strict_1.default.equal(by('mine').title, 'Momento 9', 'lo escrito por el usuario no se toca aunque suene genérico');
        strict_1.default.equal(by('desc').description, 'Descripción mía');
        strict_1.default.equal(new Set(['g1', 'g2', 'g3'].map((id) => by(id).title.toLowerCase())).size, 3, 'sin repetidos');
    });
    (0, node_test_1.it)('desactivado, no hace nada al terminar un directo; los ajustes se validan', () => {
        const e = (0, helpers_1.makeEnv)();
        envs.push(e);
        e.ctx.settings.set({ autopilot: { enabled: false } });
        e.ctx.autopilot.onLiveVod((0, helpers_1.addDownloadedVod)(e, video));
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot, undefined);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { videoTimes: ['25:00'] } }), /HH:MM/);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { clipTimes: ['9:00'] } }), /HH:MM/);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { maxVideos: 50 } }), /entre 0 y 12/);
        strict_1.default.deepEqual(e.ctx.settings.set({ autopilot: { videoTimes: ['21:30', '08:00', '08:00'] } }).autopilot.videoTimes, ['08:00', '21:30']);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { maxClips: 99 } }), /entre 0 y 20/);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { series: { name: 'x'.repeat(61), nextDay: 1 } } }), /60 caracteres/);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { series: { name: 'a', nextDay: 0 } } }), /entre 1 y 9999/);
        strict_1.default.deepEqual(e.ctx.settings.set({ autopilot: { series: { name: '  Mi   serie ', nextDay: 2 } } }).autopilot.series, { name: 'Mi serie', nextDay: 2 });
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { platforms: ['myspace'] } }), /no reconocida/);
        strict_1.default.throws(() => e.ctx.settings.set({ autopilot: { subtitles: 'feo' } }), /subtítulos/);
        const s = e.ctx.settings.set({ autopilot: { llm: { provider: 'groq', apiKey: 'secreta' } } });
        strict_1.default.equal(s.autopilot.llm.apiKey, '********');
        strict_1.default.equal(e.ctx.settings.llmKey(), 'secreta');
        strict_1.default.ok(!node_fs_1.default.readFileSync(e.ctx.store.file, 'utf8').includes('secreta') || node_fs_1.default.readFileSync(e.ctx.store.file, 'utf8').includes('plain:') === false);
    });
});

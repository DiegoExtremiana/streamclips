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
(0, node_test_1.describe)('piloto automático: varios directos a la vez', () => {
    (0, node_test_1.it)('dos directos se analizan a la vez y cada uno recibe su día de serie, sin repetirse', async () => {
        const { e, vod } = setup();
        e.ctx.settings.set({ autopilot: { maxClips: 0, maxVideos: 1, parallel: 2, series: { name: 'Serie', nextDay: 1 } } });
        const vod2 = (0, helpers_1.addDownloadedVod)(e, video, 'vod2');
        const seen = new Set();
        const watch = setInterval(() => {
            for (const v of e.ctx.store.data.vods)
                if (v.autopilot && ['transcribing', 'analyzing', 'rendering'].includes(v.autopilot.status))
                    seen.add(v.id);
        }, 50);
        try {
            await Promise.all([e.ctx.autopilot.run(vod.id), e.ctx.autopilot.run(vod2.id)]);
        }
        finally {
            clearInterval(watch);
        }
        strict_1.default.ok(e.ctx.store.data.vods.every((v) => v.autopilot?.status === 'done'));
        strict_1.default.equal(seen.size, 2, 'los dos estuvieron trabajando a la vez');
        const titles = e.ctx.store.data.outputs.map((o) => o.title).sort();
        strict_1.default.deepEqual(titles, ['Serie Día 1 - Resumen', 'Serie Día 2 - Resumen']);
        strict_1.default.equal(e.ctx.store.data.settings.autopilot.series.nextDay, 3);
    });
});
(0, node_test_1.describe)('piloto automático: reanálisis y limpieza', () => {
    (0, node_test_1.it)('«Pausar» detiene el análisis dejándolo en pausa y «Reanudar» lo termina', async () => {
        const { e, vod } = setupCopy(false);
        const first = e.ctx.autopilot.run(vod.id);
        first.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
        strict_1.default.equal(e.ctx.autopilot.pause(vod.id), true);
        await strict_1.default.rejects(first);
        const st = e.ctx.store.data.vods[0].autopilot;
        strict_1.default.equal(st?.status, 'paused');
        strict_1.default.match(st?.note ?? '', /pausa/i);
        strict_1.default.equal(e.ctx.autopilot.pause(vod.id), false, 'ya no hay nada en marcha que pausar');
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    });
    function setupCopy(cleanup) {
        const { e, vod } = setup();
        const copy = node_path_1.default.join(e.root, 'copia-live.mp4');
        node_fs_1.default.copyFileSync(video, copy);
        vod.filePath = copy;
        e.ctx.settings.set({ autopilot: { cleanup } });
        return { e, vod, copy };
    }
    (0, node_test_1.it)('al terminar borra el directo completo y deja los vídeos, los clips y sus transcripciones', async () => {
        const { e, vod, copy } = setupCopy(true);
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.equal(node_fs_1.default.existsSync(copy), false, 'el archivo del directo se borra');
        strict_1.default.equal(e.ctx.store.data.vods[0].filePath, undefined);
        strict_1.default.ok(e.ctx.store.data.vods[0].cleaned && e.ctx.store.data.vods[0].cleaned.freedBytes > 0);
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
        strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /Directo completo borrado/);
        const outs = e.ctx.store.data.outputs;
        strict_1.default.ok(outs.length >= 2);
        for (const o of outs)
            strict_1.default.ok(Object.values(o.files).every((f) => node_fs_1.default.existsSync(f)), 'los vídeos y clips siguen en disco');
    });
    (0, node_test_1.it)('con la limpieza desactivada el directo se queda', async () => {
        const { e, vod, copy } = setupCopy(false);
        await e.ctx.autopilot.run(vod.id);
        strict_1.default.ok(node_fs_1.default.existsSync(copy));
        strict_1.default.equal(e.ctx.store.data.vods[0].cleaned, undefined);
    });
    (0, node_test_1.it)('un análisis ya empezado se puede cancelar y se puede volver a lanzar sin esperar', async () => {
        const { e, vod } = setupCopy(false);
        const first = e.ctx.autopilot.run(vod.id);
        first.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
        strict_1.default.ok(e.ctx.autopilot.isRunning(vod.id));
        await strict_1.default.rejects(e.ctx.autopilot.run(vod.id), /ya está trabajando/);
        strict_1.default.equal(e.ctx.autopilot.cancel(vod.id), true);
        await strict_1.default.rejects(first);
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'error');
        strict_1.default.match(e.ctx.store.data.vods[0].autopilot?.note ?? '', /cancelado/i);
        strict_1.default.equal(e.ctx.autopilot.isRunning(vod.id), false);
        await e.ctx.autopilot.run(vod.id, { restart: true });
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    });
    (0, node_test_1.it)('«Volver a analizar» durante un análisis en marcha lo reinicia, y sustituye lo pendiente de revisión', async () => {
        const { e, vod } = setupCopy(false);
        await e.ctx.autopilot.run(vod.id);
        const n = e.ctx.store.data.outputs.length;
        const second = e.ctx.autopilot.run(vod.id, { restart: true });
        second.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 200));
        const third = e.ctx.autopilot.run(vod.id, { restart: true });
        await strict_1.default.rejects(second);
        await third;
        strict_1.default.equal(e.ctx.store.data.outputs.length, n);
        strict_1.default.equal(e.ctx.store.data.vods[0].autopilot?.status, 'done');
    });
    (0, node_test_1.it)('un análisis que quedó a medias al cerrar el programa se marca como interrumpido al arrancar', () => {
        const { e, vod } = setupCopy(false);
        vod.autopilot = { status: 'rendering', at: new Date().toISOString() };
        strict_1.default.equal(e.ctx.autopilot.recoverInterrupted(), 1);
        const st = e.ctx.store.data.vods[0].autopilot;
        strict_1.default.equal(st?.status, 'paused');
        strict_1.default.match(st?.note ?? '', /interrumpi.*Reanudar/);
        strict_1.default.equal(e.ctx.autopilot.recoverInterrupted(), 0);
    });
    (0, node_test_1.it)('«Liberar espacio» a mano borra el directo y conserva lo creado', async () => {
        const { e, vod, copy } = setupCopy(false);
        await e.ctx.autopilot.run(vod.id);
        const r = e.ctx.autopilot.discard(vod.id);
        strict_1.default.ok(r.freedBytes > 0 && r.kept >= 2);
        strict_1.default.equal(node_fs_1.default.existsSync(copy), false);
    });
});

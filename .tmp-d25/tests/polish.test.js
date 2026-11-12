"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_events_1 = require("node:events");
const store_1 = require("../electron/services/store");
const files_1 = require("../electron/services/files");
const crash_1 = require("../electron/app/crash");
const helpers_1 = require("./helpers");
(0, node_test_1.describe)('almacén: copia de seguridad y recuperación', () => {
    (0, node_test_1.it)('guarda una copia .bak y, si data.json se daña, recupera la última copia buena', () => {
        const dir = (0, helpers_1.tmpDir)();
        const s1 = new store_1.Store(dir, '/out');
        s1.data.groups.push({ id: 'g1', name: 'Pokémon', kind: 'theme', section: 'clips', createdAt: 'x' });
        s1.save(1_000_000); // primer guardado: aún no hay nada que copiar
        s1.data.groups.push({ id: 'g2', name: 'Minecraft', kind: 'theme', section: 'clips', createdAt: 'x' });
        s1.save(1_000_000 + 11 * 60_000); // pasa el intervalo: la versión anterior queda en .bak
        strict_1.default.ok(node_fs_1.default.existsSync(`${s1.file}.bak`));
        node_fs_1.default.writeFileSync(s1.file, '{ esto no es json');
        const s2 = new store_1.Store(dir, '/out');
        strict_1.default.equal(s2.restoredFromBackup, true);
        strict_1.default.ok(s2.recoveredFrom && node_fs_1.default.existsSync(s2.recoveredFrom), 'se conserva el archivo dañado');
        strict_1.default.deepEqual(s2.data.groups.map((g) => g.name), ['Pokémon']);
        s2.save();
        strict_1.default.equal(JSON.parse(node_fs_1.default.readFileSync(s2.file, 'utf8')).groups.length, 1, 'el archivo sano sustituye al dañado');
        strict_1.default.equal(JSON.parse(node_fs_1.default.readFileSync(`${s2.file}.bak`, 'utf8')).groups.length, 1, 'la copia buena no se pisa con el archivo dañado');
        (0, helpers_1.rmDir)(dir);
    });
    (0, node_test_1.it)('sin copia buena empieza limpio pero conserva el dañado', () => {
        const dir = (0, helpers_1.tmpDir)();
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'data.json'), 'basura');
        const s = new store_1.Store(dir, '/out');
        strict_1.default.equal(s.restoredFromBackup, false);
        strict_1.default.deepEqual(s.data.outputs, []);
        strict_1.default.ok(node_fs_1.default.existsSync(s.recoveredFrom));
        (0, helpers_1.rmDir)(dir);
    });
    (0, node_test_1.it)('las listas de identificadores vistos no crecen sin límite', () => {
        const dir = (0, helpers_1.tmpDir)();
        const s = new store_1.Store(dir, '/out');
        s.data.channel.seenVodIds = Array.from({ length: 5000 }, (_, i) => `v${i}`);
        s.save();
        const again = new store_1.Store(dir, '/out');
        strict_1.default.equal(again.data.channel.seenVodIds.length, 2000);
        strict_1.default.equal(again.data.channel.seenVodIds.at(-1), 'v4999', 'se conservan los más recientes');
        (0, helpers_1.rmDir)(dir);
    });
});
(0, node_test_1.describe)('espacio en disco', () => {
    (0, node_test_1.it)('ensureFreeSpace avisa con cifras y no bloquea si no se puede medir', () => {
        strict_1.default.throws(() => (0, files_1.ensureFreeSpace)('/x', 10 * 1024 ** 3, 'descargar el VOD', () => 2 * 1024 ** 3), /quedan 2,0 GB y hacen falta unos 10,0 GB/);
        strict_1.default.doesNotThrow(() => (0, files_1.ensureFreeSpace)('/x', 10, 'x', () => null));
        strict_1.default.doesNotThrow(() => (0, files_1.ensureFreeSpace)('/x', 10, 'x', () => 11));
    });
    (0, node_test_1.it)('freeBytes mide el disco real, incluso de una carpeta que aún no existe', () => {
        const v = (0, files_1.freeBytes)(node_path_1.default.join((0, helpers_1.tmpDir)(), 'no', 'existe', 'todavia'));
        strict_1.default.ok(v === null || v >= 0);
    });
    (0, node_test_1.it)('la estimación crece con la duración (directos de 3–4 h) y tiene un valor por defecto', () => {
        const gb = 1024 ** 3;
        strict_1.default.ok((0, files_1.vodBytesEstimate)(4 * 3600) > 12 * gb && (0, files_1.vodBytesEstimate)(4 * 3600) < 16 * gb);
        strict_1.default.ok((0, files_1.vodBytesEstimate)(3 * 3600) < (0, files_1.vodBytesEstimate)(4 * 3600));
        strict_1.default.equal((0, files_1.vodBytesEstimate)(undefined), 6 * gb);
    });
    (0, node_test_1.it)('un VOD no se descarga si no cabe, y el motivo se ve en la interfaz', async () => {
        let called = 0;
        const env = (0, helpers_1.makeEnv)({ freeBytes: () => 1024 ** 3, download: async () => { called++; throw new Error('no debería llamarse'); } });
        const job = env.ctx.vods.add('https://www.twitch.tv/videos/77', 'Directo', { origin: 'live', durationSec: 4 * 3600 });
        await env.ctx.downloadQueue.idle();
        strict_1.default.equal(job.status, 'error');
        strict_1.default.match(job.error, /No hay espacio suficiente.*descargar el VOD/);
        strict_1.default.equal(called, 0);
        env.cleanup();
    });
    (0, node_test_1.it)('un clip no se monta si no hay espacio y no deja archivos a medias', async () => {
        const env = (0, helpers_1.makeEnv)({ freeBytes: () => 100 });
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(env.root, 'src.mp4'), { dur: 6 });
        (0, helpers_1.addDownloadedVod)(env, src);
        await strict_1.default.rejects(env.ctx.clips.createClip('vod1', { start: 1, end: 3, title: 'x' }), /No hay espacio suficiente/);
        strict_1.default.equal(env.ctx.store.data.outputs.length, 0);
        strict_1.default.ok(!node_fs_1.default.existsSync(node_path_1.default.join(env.outputDir, 'vertical')) || node_fs_1.default.readdirSync(node_path_1.default.join(env.outputDir, 'vertical')).length === 0);
        env.cleanup();
    });
});
function seedOutput(env, id, title = id) {
    const v = node_path_1.default.join(env.outputDir, 'vertical', `${id}.mp4`);
    const h = node_path_1.default.join(env.outputDir, 'horizontal', `${id}.mp4`);
    const t = node_path_1.default.join(env.outputDir, 'miniaturas', `${id}.jpg`);
    for (const f of [v, h, t]) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(f), { recursive: true });
        node_fs_1.default.writeFileSync(f, 'x');
    }
    const o = { id, kind: 'clip', title, files: { vertical: v, horizontal: h }, thumbnail: t, durationSec: 5, createdAt: new Date().toISOString() };
    env.ctx.store.data.outputs.push(o);
    env.ctx.store.save();
    return o;
}
(0, node_test_1.describe)('borrar vídeos', () => {
    (0, node_test_1.it)('borra sus archivos y miniatura, cancela lo pendiente y conserva el registro de lo publicado', () => {
        const env = (0, helpers_1.makeEnv)();
        const o = seedOutput(env, 'a');
        const soon = new Date(Date.now() + 3_600_000).toISOString();
        env.ctx.pubs.schedule('a', ['youtube', 'tiktok'], soon);
        env.ctx.store.data.publications.find((p) => p.platform === 'tiktok').status = 'published';
        const r = env.ctx.library.removeMany(['a']);
        strict_1.default.deepEqual([r.removed, r.errors.length, r.filesLeft.length], [1, 0, 0]);
        for (const f of [...Object.values(o.files), o.thumbnail])
            strict_1.default.ok(!node_fs_1.default.existsSync(f), f);
        strict_1.default.equal(env.ctx.store.data.outputs.length, 0);
        strict_1.default.deepEqual(env.ctx.store.data.publications.map((p) => p.status), ['published']);
        env.cleanup();
    });
    (0, node_test_1.it)('no borra lo que se está publicando (ni en el PC ni en la nube) y el resto de la selección sí', () => {
        const env = (0, helpers_1.makeEnv)();
        seedOutput(env, 'a');
        seedOutput(env, 'b');
        seedOutput(env, 'c');
        const at = new Date(Date.now() + 3_600_000).toISOString();
        env.ctx.store.data.publications.push({ key: 'a:youtube', outputId: 'a', platform: 'youtube', scheduledAt: at, status: 'publishing' });
        env.ctx.store.data.publications.push({ key: 'b:youtube', outputId: 'b', platform: 'youtube', scheduledAt: at, status: 'scheduled', cloud: { state: 'publishing' } });
        const r = env.ctx.library.removeMany(['a', 'b', 'c', 'c', 'zzz']);
        strict_1.default.equal(r.removed, 1);
        strict_1.default.deepEqual(r.errors.map((e) => e.id).sort(), ['a', 'b', 'zzz']);
        strict_1.default.match(r.errors.find((e) => e.id === 'a').reason, /[Ss]e está publicando/);
        strict_1.default.deepEqual(env.ctx.store.data.outputs.map((o) => o.id).sort(), ['a', 'b']);
        env.cleanup();
    });
    (0, node_test_1.it)('si un archivo no se puede borrar, el vídeo se quita igualmente y se informa de lo que queda', () => {
        const env = (0, helpers_1.makeEnv)();
        const o = seedOutput(env, 'a');
        node_fs_1.default.rmSync(o.files.vertical);
        node_fs_1.default.mkdirSync(node_path_1.default.join(o.files.vertical, 'dentro'), { recursive: true }); // un directorio no se borra como archivo
        const r = env.ctx.library.removeMany(['a']);
        strict_1.default.equal(r.removed, 1);
        strict_1.default.deepEqual(r.filesLeft, [o.files.vertical]);
        strict_1.default.equal(env.ctx.store.data.outputs.length, 0, 'sin datos a medias');
        strict_1.default.ok(!node_fs_1.default.existsSync(o.files.horizontal));
        env.cleanup();
    });
    (0, node_test_1.it)('el VOD de origen nunca se toca', () => {
        const env = (0, helpers_1.makeEnv)();
        const src = (0, helpers_1.makeVideo)(node_path_1.default.join(env.root, 'src.mp4'), { dur: 3 });
        (0, helpers_1.addDownloadedVod)(env, src);
        seedOutput(env, 'a');
        env.ctx.library.removeMany(['a']);
        strict_1.default.ok(node_fs_1.default.existsSync(src));
        strict_1.default.equal(env.ctx.store.data.vods.length, 1);
        env.cleanup();
    });
});
(0, node_test_1.describe)('varias subidas al día', () => {
    const day = (h, m = 0) => {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        d.setHours(h, m, 0, 0);
        return d.toISOString();
    };
    (0, node_test_1.it)('se pueden programar tantas como se quiera el mismo día, de vídeos distintos', () => {
        const env = (0, helpers_1.makeEnv)();
        for (const id of ['a', 'b', 'c', 'd'])
            seedOutput(env, id);
        const hours = [8, 12, 16, 20];
        ['a', 'b', 'c', 'd'].forEach((id, i) => {
            const r = env.ctx.pubs.schedule(id, ['youtube'], day(hours[i]));
            strict_1.default.equal(r.scheduled.length, 1);
            strict_1.default.equal(r.warnings, undefined, 'separadas y pocas: sin avisos');
        });
        strict_1.default.equal(env.ctx.store.data.publications.filter((p) => p.status === 'scheduled').length, 4);
        env.cleanup();
    });
    (0, node_test_1.it)('avisa (sin impedirlo) de dos subidas muy juntas en la misma red', () => {
        const env = (0, helpers_1.makeEnv)();
        seedOutput(env, 'a', 'Primero');
        seedOutput(env, 'b');
        env.ctx.pubs.schedule('a', ['youtube', 'tiktok'], day(16, 0));
        const r = env.ctx.pubs.schedule('b', ['youtube'], day(16, 10));
        strict_1.default.equal(r.scheduled.length, 1);
        strict_1.default.equal(r.warnings?.length, 1);
        strict_1.default.match(r.warnings[0], /otra subida a YouTube.*«Primero»/);
        const other = env.ctx.pubs.schedule('b', ['instagram'], day(16, 10));
        strict_1.default.equal(other.warnings, undefined, 'otra red no cuenta');
        env.cleanup();
    });
    (0, node_test_1.it)('avisa si en un día hay más subidas a YouTube de las que permite la cuota gratuita', () => {
        const env = (0, helpers_1.makeEnv)();
        let last;
        for (let i = 0; i < 7; i++) {
            seedOutput(env, `v${i}`);
            last = env.ctx.pubs.schedule(`v${i}`, ['youtube'], day(6 + i * 2));
        }
        strict_1.default.ok(last.warnings?.some((w) => /7 subidas a YouTube.*unas 6 al día/.test(w)), JSON.stringify(last.warnings));
        env.cleanup();
    });
    (0, node_test_1.it)('el mismo vídeo sigue sin poder publicarse dos veces en la misma red', () => {
        const env = (0, helpers_1.makeEnv)();
        seedOutput(env, 'a');
        env.ctx.pubs.schedule('a', ['youtube'], day(8));
        env.ctx.store.data.publications[0].status = 'published';
        const r = env.ctx.pubs.schedule('a', ['youtube'], day(20));
        strict_1.default.equal(r.scheduled.length, 0);
        strict_1.default.match(r.skipped[0].reason, /ya está publicado/);
        env.cleanup();
    });
});
(0, node_test_1.describe)('errores no controlados', () => {
    (0, node_test_1.it)('se anotan con su detalle y no tumban el proceso', () => {
        const proc = new node_events_1.EventEmitter();
        const lines = [];
        (0, crash_1.installCrashHandlers)(proc, () => ({ error: (m) => void lines.push(m) }));
        proc.emit('uncaughtException', new Error('boom'));
        proc.emit('unhandledRejection', 'motivo suelto');
        strict_1.default.equal(lines.length, 2);
        strict_1.default.match(lines[0], /Error no controlado: boom/);
        strict_1.default.match(lines[1], /Promesa rechazada sin controlar: motivo suelto/);
    });
    (0, node_test_1.it)('si aún no hay registro, escribe en stderr sin fallar', () => {
        const proc = new node_events_1.EventEmitter();
        (0, crash_1.installCrashHandlers)(proc, () => undefined);
        strict_1.default.doesNotThrow(() => proc.emit('uncaughtException', new Error('antes del registro')));
    });
});

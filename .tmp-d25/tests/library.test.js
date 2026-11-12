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
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const media_1 = require("../shared/media");
const store_1 = require("../electron/services/store");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const media_2 = require("../electron/app/media");
const helpers_1 = require("./helpers");
const envs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
});
let srcRoot;
let split;
(0, node_test_1.before)(() => {
    srcRoot = (0, helpers_1.tmpDir)();
    split = (0, helpers_1.makeVideo)(node_path_1.default.join(srcRoot, 'split.mp4'), { split: true, dur: 12 });
});
(0, node_test_1.after)(() => (0, helpers_1.rmDir)(srcRoot));
async function withClip(cropX = 0, kind = 'both') {
    const env = (0, helpers_1.makeEnv)();
    envs.push(env);
    const vod = (0, helpers_1.addDownloadedVod)(env, split);
    const clip = await env.ctx.clips.createClip(vod.id, { kind, start: 2, end: 6, title: 'Clip', cropX });
    return { env, vod, clip };
}
const TOOLS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' };
(0, node_test_1.describe)('Biblioteca: miniaturas automáticas', () => {
    (0, node_test_1.it)('cada clip nuevo guarda su tramo y su encuadre, y una miniatura 16:9 igual para todos', async () => {
        const { clip } = await withClip(0);
        strict_1.default.deepEqual([clip.start, clip.end, clip.cropX], [2, 6, 0]);
        strict_1.default.ok(clip.thumbnail && node_fs_1.default.existsSync(clip.thumbnail));
        const t = await (0, ffmpeg_1.probe)(TOOLS, clip.thumbnail);
        strict_1.default.deepEqual([t.width, t.height], [1280, 720]); // portada con estilo
    });
    (0, node_test_1.it)('un clip solo vertical también tiene miniatura (de su versión vertical)', async () => {
        const { clip } = await withClip(0, 'vertical');
        const t = await (0, ffmpeg_1.probe)(TOOLS, clip.thumbnail);
        strict_1.default.deepEqual([t.width, t.height], [360, 640]);
    });
    (0, node_test_1.it)('backfill crea las miniaturas que faltan (clips antiguos)', async () => {
        const { env, clip } = await withClip();
        node_fs_1.default.rmSync(clip.thumbnail);
        const n = await env.ctx.library.backfillThumbnails();
        strict_1.default.equal(n, 1);
        strict_1.default.ok(node_fs_1.default.existsSync(env.ctx.store.data.outputs[0].thumbnail));
    });
});
(0, node_test_1.describe)('Biblioteca: nombre', () => {
    (0, node_test_1.it)('renombra, recorta espacios y rechaza vacíos o demasiado largos', async () => {
        const { env, clip } = await withClip();
        strict_1.default.equal(env.ctx.library.rename(clip.id, '  Nuevo nombre ').title, 'Nuevo nombre');
        strict_1.default.throws(() => env.ctx.library.rename(clip.id, '   '), /vacío/);
        strict_1.default.throws(() => env.ctx.library.rename(clip.id, 'x'.repeat(121)), /120/);
        strict_1.default.throws(() => env.ctx.library.rename('nope', 'a'), /no existe/);
        strict_1.default.equal(env.ctx.store.data.outputs[0].title, 'Nuevo nombre');
    });
});
(0, node_test_1.describe)('Biblioteca: datos de YouTube', () => {
    function two() {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const base = { durationSec: 5, createdAt: 'x' };
        env.ctx.store.data.outputs.push({ ...base, id: 'l', kind: 'long', title: 'Largo', files: { long: '/x' } }, { ...base, id: 'c', kind: 'clip', title: 'Clip', files: { vertical: '/x' } });
        return env;
    }
    (0, node_test_1.it)('guarda nombre, descripción, lista y visibilidad de un vídeo largo (con espacios recortados)', () => {
        const { ctx } = two();
        const o = ctx.library.setMeta('l', { title: ' Nuevo ', description: 'Hola\n\n  ', playlist: '  Road to Master ', visibility: 'public' });
        strict_1.default.deepEqual([o.title, o.description, o.playlist, o.visibility], ['Nuevo', 'Hola', 'Road to Master', 'public']);
        const cleared = ctx.library.setMeta('l', { description: '', playlist: '   ' });
        strict_1.default.deepEqual([cleared.description, cleared.playlist, cleared.visibility], [undefined, undefined, 'public']);
    });
    (0, node_test_1.it)('un campo no enviado no se toca', () => {
        const { ctx } = two();
        ctx.library.setMeta('l', { description: 'D', visibility: 'public' });
        ctx.library.setMeta('l', { playlist: 'P' });
        const o = ctx.store.data.outputs[0];
        strict_1.default.deepEqual([o.description, o.playlist, o.visibility, o.title], ['D', 'P', 'public', 'Largo']);
    });
    (0, node_test_1.it)('si un campo no es válido no se guarda NINGUNO (ni el nombre)', () => {
        const { ctx } = two();
        const before = JSON.stringify(ctx.store.data.outputs[0]);
        for (const [meta, re] of [
            [{ title: 'Bien', description: 'a <b> c' }, /< ni >/],
            [{ title: 'x'.repeat(101) }, /100/],
            [{ title: 'a>b' }, /< ni >/],
            [{ title: '  ' }, /vacío/],
            [{ title: 'Bien', description: 'x'.repeat(5001) }, /5000/],
            [{ title: 'Bien', playlist: 'x'.repeat(151) }, /150/],
            [{ title: 'Bien', playlist: 'a<b' }, /< ni >/],
            [{ title: 'Bien', visibility: 'unlisted' }, /pública o privada/],
            [{ title: 5 }, /no es válido/],
            [{ description: 5 }, /no es válida/],
        ]) {
            strict_1.default.throws(() => ctx.library.setMeta('l', meta), re, JSON.stringify(meta).slice(0, 60));
        }
        strict_1.default.equal(JSON.stringify(ctx.store.data.outputs[0]), before);
    });
    (0, node_test_1.it)('los clips admiten nombre (hasta 120), descripción, lista y visibilidad (salen como Shorts)', () => {
        const { ctx } = two();
        strict_1.default.equal(ctx.library.setMeta('c', { title: 'x'.repeat(120) }).title.length, 120);
        const c = ctx.library.setMeta('c', { description: 'Mi clip', playlist: 'Shorts', visibility: 'public' });
        strict_1.default.deepEqual([c.description, c.playlist, c.visibility], ['Mi clip', 'Shorts', 'public']);
        strict_1.default.throws(() => ctx.library.setMeta('c', { description: '<b>' }), /< ni >/);
        strict_1.default.throws(() => ctx.library.setMeta('c', { visibility: 'secreto' }), /pública o privada/);
        strict_1.default.throws(() => ctx.library.setMeta('nope', {}), /no existe/);
    });
    (0, node_test_1.it)('lo guardado sobrevive a reabrir el almacén', () => {
        const env = two();
        env.ctx.library.setMeta('l', { description: 'D', playlist: 'P', visibility: 'public' });
        const re = new store_1.Store(env.userData, env.outputDir);
        strict_1.default.deepEqual([re.data.outputs[0].description, re.data.outputs[0].playlist, re.data.outputs[0].visibility], ['D', 'P', 'public']);
    });
});
(0, node_test_1.describe)('Biblioteca: miniatura elegida', () => {
    (0, node_test_1.it)('desde un fotograma del vídeo largo: 1280x720 y borra la anterior', async () => {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const vod = (0, helpers_1.addDownloadedVod)(env, split);
        const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 4 }] });
        const old = long.thumbnail;
        const updated = await env.ctx.library.setThumbnailFromFrame(long.id, 1);
        strict_1.default.notEqual(updated.thumbnail, old);
        strict_1.default.ok(!node_fs_1.default.existsSync(old), 'la miniatura anterior se borra');
        const info = await (0, ffmpeg_1.probe)(TOOLS, updated.thumbnail);
        strict_1.default.deepEqual([info.width, info.height], [1280, 720]);
        strict_1.default.ok((await env.ctx.library.setThumbnailFromFrame(long.id, 999)).thumbnail, 'un instante pasado el final se ajusta al final');
        strict_1.default.throws(() => env.ctx.library.setThumbnailFromFrame(long.id, -1), /Instante/);
    });
    (0, node_test_1.it)('desde una imagen del usuario: se convierte a 1280x720; un archivo que no es imagen no cambia nada', async () => {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        const vod = (0, helpers_1.addDownloadedVod)(env, split);
        const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 4 }] });
        const before = long.thumbnail;
        const png = node_path_1.default.join(env.root, 'mi.png');
        const { execFileSync } = await Promise.resolve().then(() => __importStar(require('node:child_process')));
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=800x800', '-frames:v', '1', png]);
        const r = await env.ctx.library.setThumbnailFromImage(long.id, png);
        const info = await (0, ffmpeg_1.probe)(TOOLS, r.thumbnail);
        strict_1.default.deepEqual([info.width, info.height], [1280, 720]);
        const current = r.thumbnail;
        const bad = node_path_1.default.join(env.root, 'no-imagen.png');
        node_fs_1.default.writeFileSync(bad, 'esto no es una imagen');
        await strict_1.default.rejects(env.ctx.library.setThumbnailFromImage(long.id, bad), /No se pudo leer esa imagen/);
        await strict_1.default.rejects(env.ctx.library.setThumbnailFromImage(long.id, node_path_1.default.join(env.root, 'nada.png')), /no existe/);
        strict_1.default.equal(env.ctx.store.data.outputs[0].thumbnail, current);
        strict_1.default.notEqual(current, before);
        strict_1.default.ok(node_fs_1.default.existsSync(current));
    });
});
(0, node_test_1.describe)('Biblioteca: recorte y encuadre de un clip', () => {
    (0, node_test_1.it)('cambiar el encuadre vuelve a renderizar las dos versiones: cambia el color del lado, valida y borra lo anterior', async () => {
        const { env, clip } = await withClip(0);
        const old = { ...clip.files };
        strict_1.default.equal((0, helpers_1.dominantColor)(old.vertical, 1), 'red');
        const r = await env.ctx.library.reeditClip(clip.id, { cropX: 1 });
        strict_1.default.equal(r.id, clip.id);
        strict_1.default.deepEqual(Object.keys(r.files).sort(), ['horizontal', 'vertical']);
        for (const k of ['horizontal', 'vertical']) {
            strict_1.default.notEqual(r.files[k], old[k]);
            strict_1.default.ok(!node_fs_1.default.existsSync(old[k]), `${k} anterior borrado`);
        }
        strict_1.default.equal((0, helpers_1.dominantColor)(r.files.vertical, 1), 'blue');
        strict_1.default.equal(r.cropX, 1);
        strict_1.default.ok(node_fs_1.default.existsSync(r.thumbnail));
        strict_1.default.equal(env.ctx.store.data.outputs.length, 1);
    });
    (0, node_test_1.it)('recortar inicio y fin cambia la duración de las dos versiones', async () => {
        const { env, clip } = await withClip();
        const r = await env.ctx.library.reeditClip(clip.id, { start: 3, end: 5 });
        strict_1.default.ok(Math.abs(r.durationSec - 2) < 0.6, String(r.durationSec));
        strict_1.default.deepEqual([r.start, r.end], [3, 5]);
        for (const f of Object.values(r.files))
            strict_1.default.ok(Math.abs((await (0, ffmpeg_1.probe)(TOOLS, f)).durationSec - 2) < 0.6);
    });
    (0, node_test_1.it)('regenera la versión que faltaba (clip creado solo en vertical)', async () => {
        const { env, clip } = await withClip(0.5, 'vertical');
        strict_1.default.deepEqual(Object.keys(clip.files), ['vertical']);
        const r = await env.ctx.library.reeditClip(clip.id, {});
        strict_1.default.deepEqual(Object.keys(r.files).sort(), ['horizontal', 'vertical']);
        strict_1.default.ok(node_fs_1.default.existsSync(r.files.horizontal));
    });
    (0, node_test_1.it)('un cambio no válido no toca el clip ni deja archivos sueltos', async () => {
        const { env, clip } = await withClip(0.5);
        const snapshot = JSON.stringify(env.ctx.store.data.outputs[0]);
        const count = () => ['vertical', 'horizontal'].map((d) => node_fs_1.default.readdirSync(node_path_1.default.join(env.outputDir, d)).length);
        const before = count();
        await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { start: 5, end: 3 }), /Clip no válido/);
        await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { start: 8, end: 13 }), /después del final/);
        await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 2 }), /cropX/);
        strict_1.default.equal(JSON.stringify(env.ctx.store.data.outputs[0]), snapshot);
        strict_1.default.deepEqual(count(), before);
        for (const f of Object.values(clip.files))
            strict_1.default.ok(node_fs_1.default.existsSync(f));
    });
    (0, node_test_1.it)('rechaza vídeos largos, clips sin origen, VOD borrado y publicación en curso', async () => {
        const { env, clip, vod } = await withClip();
        const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 3 }] });
        await strict_1.default.rejects(env.ctx.library.reeditClip(long.id, { start: 1 }), /solo se pueden cambiar los subtítulos/);
        env.ctx.store.data.outputs.push({ id: 'viejo', kind: 'clip', title: 'v', files: clip.files, durationSec: 4, createdAt: 'x' });
        await strict_1.default.rejects(env.ctx.library.reeditClip('viejo', { cropX: 1 }), /anterior a la Biblioteca/);
        env.ctx.store.data.publications.push({ key: `${clip.id}:youtube`, outputId: clip.id, platform: 'youtube', scheduledAt: 'x', status: 'publishing' });
        await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 1 }), /publicando/);
        env.ctx.store.data.publications.length = 0;
        node_fs_1.default.renameSync(split, `${split}.bak`);
        try {
            await strict_1.default.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 1 }), /VOD de origen|No se pudo volver a descargar/); // el directo borrado se intenta recuperar solo (aquí no hay yt-dlp)
        }
        finally {
            node_fs_1.default.renameSync(`${split}.bak`, split);
        }
    });
    (0, node_test_1.it)('las publicaciones del clip se conservan al reeditarlo', async () => {
        const { env, clip } = await withClip();
        env.ctx.pubs.schedule(clip.id, ['youtube'], new Date(Date.now() + 3600_000).toISOString());
        await env.ctx.library.reeditClip(clip.id, { cropX: 0.2 });
        strict_1.default.equal(env.ctx.store.data.publications[0].outputId, clip.id);
    });
    (0, node_test_1.it)('vista previa del encuadre: fotograma completo del VOD en base64', async () => {
        const { env, clip } = await withClip();
        const p = await env.ctx.library.framingPreview(clip.id);
        strict_1.default.match(p.dataUrl, /^data:image\/jpeg;base64,/);
        strict_1.default.deepEqual([p.width, p.height], [640, 360]);
        strict_1.default.equal(node_fs_1.default.readdirSync(node_path_1.default.join(env.outputDir, 'miniaturas')).some((f) => f.startsWith('preview-')), false, 'no deja temporales');
        const long = await env.ctx.clips.createLong(clip.vodId, { title: 'L', segments: [{ start: 0, end: 3 }] });
        await strict_1.default.rejects(env.ctx.library.framingPreview(long.id), /Solo los clips/);
    });
});
(0, node_test_1.describe)('Biblioteca: descargar una versión', () => {
    (0, node_test_1.it)('copia la versión elegida donde se indique, añade .mp4 y deja el original intacto', async () => {
        const { env, clip } = await withClip();
        strict_1.default.equal(env.ctx.library.exportName(clip.id, 'vertical'), 'clip-vertical.mp4');
        strict_1.default.equal(env.ctx.library.exportName(clip.id, 'horizontal'), 'clip-horizontal.mp4');
        const dest = node_path_1.default.join(env.root, 'descargas', 'mi video');
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(dest));
        const saved = await env.ctx.library.exportFile(clip.id, 'vertical', dest);
        strict_1.default.equal(saved, `${dest}.mp4`);
        const info = await (0, ffmpeg_1.probe)(TOOLS, saved);
        strict_1.default.deepEqual([info.width, info.height], [1080, 1920]);
        strict_1.default.ok(node_fs_1.default.existsSync(clip.files.vertical), 'el original sigue en la biblioteca');
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(node_path_1.default.dirname(dest)), ['mi video.mp4'], 'sin temporales');
        const h = await env.ctx.library.exportFile(clip.id, 'horizontal', node_path_1.default.join(env.root, 'descargas', 'h.mp4'));
        strict_1.default.deepEqual([(await (0, ffmpeg_1.probe)(TOOLS, h)).width, (await (0, ffmpeg_1.probe)(TOOLS, h)).height], [1920, 1080]);
        // sobrescribir un destino existente (el usuario lo confirmó en el cuadro de guardado)
        node_fs_1.default.writeFileSync(node_path_1.default.join(env.root, 'descargas', 'viejo.mp4'), 'viejo');
        await env.ctx.library.exportFile(clip.id, 'horizontal', node_path_1.default.join(env.root, 'descargas', 'viejo.mp4'));
        strict_1.default.ok(node_fs_1.default.statSync(node_path_1.default.join(env.root, 'descargas', 'viejo.mp4')).size > 1000);
    });
    (0, node_test_1.it)('los vídeos largos se llaman solo con su título', async () => {
        const { env, vod } = await withClip();
        const long = await env.ctx.clips.createLong(vod.id, { title: 'Resumen Épico', segments: [{ start: 0, end: 3 }] });
        strict_1.default.equal(env.ctx.library.exportName(long.id, 'long'), 'resumen-epico.mp4');
    });
    (0, node_test_1.it)('errores claros: versión inexistente, ruta relativa, carpeta inexistente, el propio archivo', async () => {
        const { env, clip } = await withClip(0, 'vertical');
        strict_1.default.throws(() => env.ctx.library.exportName(clip.id, 'horizontal'), /no tiene versión horizontal/);
        await strict_1.default.rejects(env.ctx.library.exportFile(clip.id, 'horizontal', node_path_1.default.join(env.root, 'x.mp4')), /no tiene versión/);
        await strict_1.default.rejects(env.ctx.library.exportFile(clip.id, 'vertical', 'relativa/x.mp4'), /no es válida/);
        await strict_1.default.rejects(env.ctx.library.exportFile(clip.id, 'vertical', node_path_1.default.join(env.root, 'no-existe', 'x.mp4')), /carpeta de destino no existe/);
        await strict_1.default.rejects(env.ctx.library.exportFile(clip.id, 'vertical', clip.files.vertical), /propio archivo/);
        strict_1.default.throws(() => env.ctx.library.exportName('nope', 'vertical'), /no existe/);
        node_fs_1.default.rmSync(clip.files.vertical);
        strict_1.default.throws(() => env.ctx.library.exportName(clip.id, 'vertical'), /no tiene versión vertical/);
    });
});
(0, node_test_1.describe)('Biblioteca: programación por red', () => {
    const future = (h) => new Date(Date.now() + h * 3600_000).toISOString();
    function setup() {
        const env = (0, helpers_1.makeEnv)();
        envs.push(env);
        env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
        return env;
    }
    (0, node_test_1.it)('cada red con su hora; quitar una red la desprograma; lo publicado no se toca', () => {
        const env = setup();
        const { pubs } = env.ctx;
        const r = pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }, { platform: 'tiktok', atIso: future(2) }]);
        strict_1.default.equal(r.scheduled.length, 2);
        const list = () => env.ctx.store.data.publications;
        strict_1.default.notEqual(list()[0].scheduledAt, list()[1].scheduledAt);
        list().find((p) => p.platform === 'tiktok').status = 'published';
        pubs.setSchedule('o1', [{ platform: 'instagram', atIso: future(3) }]); // youtube se quita, tiktok (publicado) se conserva
        strict_1.default.deepEqual(list().map((p) => `${p.platform}:${p.status}`).sort(), ['instagram:scheduled', 'tiktok:published']);
        const again = pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: future(5) }, { platform: 'instagram', atIso: future(3) }]);
        strict_1.default.deepEqual(again.skipped.map((s) => s.platform), ['tiktok']);
        strict_1.default.equal(list().find((p) => p.platform === 'tiktok').status, 'published');
    });
    (0, node_test_1.it)('validación atómica: si una entrada es mala no cambia nada', () => {
        const env = setup();
        const { pubs } = env.ctx;
        pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }]);
        const before = JSON.stringify(env.ctx.store.data.publications);
        strict_1.default.throws(() => pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: future(1) }, { platform: 'instagram', atIso: 'ayer' }]), /no válidas/);
        strict_1.default.throws(() => pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: new Date(Date.now() - 3600_000).toISOString() }]), /ya ha pasado/);
        strict_1.default.throws(() => pubs.setSchedule('o1', [{ platform: 'facebook', atIso: future(1) }]), /no reconocida/);
        strict_1.default.throws(() => pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }, { platform: 'youtube', atIso: future(2) }]), /repetida/);
        strict_1.default.throws(() => pubs.setSchedule('nope', []), /no existe/);
        strict_1.default.equal(JSON.stringify(env.ctx.store.data.publications), before);
    });
    (0, node_test_1.it)('una hora pasada que no se toca (esperando conexión) se conserva; editar otra red no la rechaza', () => {
        const env = setup();
        env.ctx.store.data.publications.push({
            key: 'o1:youtube', outputId: 'o1', platform: 'youtube',
            scheduledAt: new Date(Date.now() - 3600_000).toISOString(), status: 'scheduled', note: 'En espera: x',
        });
        const same = env.ctx.store.data.publications[0].scheduledAt;
        env.ctx.pubs.setSchedule('o1', [{ platform: 'youtube', atIso: same }, { platform: 'tiktok', atIso: future(1) }]);
        strict_1.default.equal(env.ctx.store.data.publications.length, 2);
        strict_1.default.equal(env.ctx.store.data.publications[0].note, 'En espera: x');
    });
    (0, node_test_1.it)('lista vacía: quita lo pendiente y lo fallido, deja lo publicado y lo que se está publicando', () => {
        const env = setup();
        const mk = (platform, status) => env.ctx.store.data.publications.push({ key: `o1:${platform}`, outputId: 'o1', platform, scheduledAt: future(1), status });
        mk('youtube', 'scheduled');
        mk('tiktok', 'failed');
        mk('instagram', 'published');
        env.ctx.pubs.setSchedule('o1', []);
        strict_1.default.deepEqual(env.ctx.store.data.publications.map((p) => p.platform), ['instagram']);
    });
});
(0, node_test_1.describe)('Biblioteca: servir medios al reproductor', () => {
    (0, node_test_1.it)('las URL se construyen y se interpretan sin ambigüedades', () => {
        strict_1.default.equal((0, media_1.mediaUrl)('abc', 'vertical'), 'sc-media://o/abc/vertical');
        strict_1.default.equal((0, media_1.mediaUrl)('a b', 'thumb', 'x/y'), 'sc-media://o/a%20b/thumb?v=x%2Fy');
        strict_1.default.deepEqual((0, media_1.parseMediaUrl)('sc-media://o/abc/thumb?v=1'), { outputId: 'abc', part: 'thumb' });
        strict_1.default.deepEqual((0, media_1.parseMediaUrl)('sc-media://o/abc/horizontal'), { outputId: 'abc', part: 'horizontal' });
        for (const bad of ['http://o/abc/vertical', 'sc-media://x/abc/vertical', 'sc-media://o/abc/otra', 'sc-media://o/abc/video', 'sc-media://o/a/b/vertical', 'sc-media://o//vertical', 'basura', 'sc-media://o/%E0%A4%A/vertical']) {
            strict_1.default.equal((0, media_1.parseMediaUrl)(bad), null, bad);
        }
    });
    (0, node_test_1.it)('solo resuelve archivos registrados; ningún intento de ruta sale de ahí', async () => {
        const { env, clip } = await withClip();
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'vertical')), clip.files.vertical);
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'horizontal')), clip.files.horizontal);
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'thumb')), clip.thumbnail);
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'long')), null, 'un clip no tiene versión long');
        for (const bad of [(0, media_1.mediaUrl)('../../etc/passwd', 'vertical'), 'sc-media://o/..%2F..%2Fetc%2Fpasswd/vertical', 'sc-media://o/nope/vertical', 'file:///etc/passwd']) {
            strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, bad), null, bad);
        }
        node_fs_1.default.rmSync(clip.files.vertical);
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'vertical')), null, 'archivo borrado => 404');
        env.ctx.store.data.outputs[0].thumbnail = undefined;
        strict_1.default.equal((0, media_2.resolveMedia)(env.ctx, (0, media_1.mediaUrl)(clip.id, 'thumb')), null);
    });
});
(0, node_test_1.describe)('Biblioteca: respuestas con rango (necesarias para saltar en el reproductor)', () => {
    const file = () => {
        const f = node_path_1.default.join(srcRoot, 'rango.bin');
        node_fs_1.default.writeFileSync(f, Buffer.alloc(1000));
        return f;
    };
    (0, node_test_1.it)('sin Range envía todo; con Range envía 206 con el tramo exacto', () => {
        const f = file();
        strict_1.default.deepEqual([(0, media_2.planMediaResponse)(f, null).status, (0, media_2.planMediaResponse)(f, null).end], [200, 999]);
        const r = (0, media_2.planMediaResponse)(f, 'bytes=100-199');
        strict_1.default.deepEqual([r.status, r.start, r.end, r.headers['Content-Range'], r.headers['Content-Length']], [206, 100, 199, 'bytes 100-199/1000', '100']);
        const open = (0, media_2.planMediaResponse)(f, 'bytes=900-');
        strict_1.default.deepEqual([open.start, open.end, open.headers['Content-Length']], [900, 999, '100']);
        const suffix = (0, media_2.planMediaResponse)(f, 'bytes=-50');
        strict_1.default.deepEqual([suffix.start, suffix.end], [950, 999]);
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'bytes=0-99999').end, 999);
    });
    (0, node_test_1.it)('rangos imposibles dan 416 y los ilegibles se ignoran', () => {
        const f = file();
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'bytes=1000-').status, 416);
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'bytes=500-100').status, 416);
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'bytes=0-1,5-9').status, 200);
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'basura').status, 200);
        strict_1.default.equal((0, media_2.planMediaResponse)(f, 'bytes=-').status, 200);
    });
    (0, node_test_1.it)('el tipo de contenido sale de la extensión', () => {
        const mp4 = (0, helpers_1.makeVideo)(node_path_1.default.join(srcRoot, 'a.mp4'), { dur: 1 });
        strict_1.default.equal((0, media_2.planMediaResponse)(mp4, null).headers['Content-Type'], 'video/mp4');
        strict_1.default.equal((0, media_2.planMediaResponse)(file(), null).headers['Content-Type'], 'application/octet-stream');
    });
});

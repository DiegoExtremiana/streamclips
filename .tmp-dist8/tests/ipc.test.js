"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../shared/types");
const register_1 = require("../electron/ipc/register");
const twitch_1 = require("../electron/services/twitch");
const helpers_1 = require("./helpers");
const envs = [];
const extraDirs = [];
(0, node_test_1.afterEach)(() => {
    while (envs.length)
        envs.pop().cleanup();
    while (extraDirs.length)
        (0, helpers_1.rmDir)(extraDirs.pop());
});
function setup(twitch) {
    const env = (0, helpers_1.makeEnv)(twitch ? { twitch } : {});
    envs.push(env);
    const handlers = new Map();
    const ipc = { handle: (ch, fn) => void handlers.set(ch, fn) };
    const platformCalls = { shown: [], opened: [], picked: 0, image: null, transcript: null, savedAs: [], savePath: null };
    const platform = {
        pickFolder: async () => {
            platformCalls.picked++;
            return '/elegida';
        },
        pickImage: async () => platformCalls.image,
        pickTranscript: async () => platformCalls.transcript,
        pickSavePath: async (name) => {
            platformCalls.savedAs.push(name);
            return platformCalls.savePath;
        },
        showItem: (f) => void platformCalls.shown.push(f),
        openFolder: async (d) => void platformCalls.opened.push(d),
    };
    (0, register_1.registerIpc)(ipc, env.ctx, platform);
    const call = async (ch, ...args) => (await handlers.get(ch)({}, ...args));
    return { env, handlers, call, platformCalls };
}
const failMsg = (r) => {
    strict_1.default.equal(r.ok, false, 'se esperaba un error');
    return r.error;
};
(0, node_test_1.describe)('IPC', () => {
    (0, node_test_1.it)('registra un manejador por cada canal de petición (los eventos no)', () => {
        const { handlers } = setup();
        for (const [name, ch] of Object.entries(types_1.CHANNELS)) {
            if (ch.startsWith('event:'))
                strict_1.default.ok(!handlers.has(ch), `${name} no debe tener manejador`);
            else
                strict_1.default.ok(handlers.has(ch), `falta el manejador de ${name}`);
        }
    });
    (0, node_test_1.it)('devuelve siempre Result, con el mensaje de error limpio (sin prefijos de Electron)', async () => {
        const { call } = setup();
        const r = await call(types_1.CHANNELS.settingsSet, { outputDir: 'relativa' });
        strict_1.default.match(failMsg(r), /^La carpeta de salida debe ser una ruta absoluta\.$/);
    });
    (0, node_test_1.it)('settings: get enmascara el secreto, set lo guarda', async () => {
        const { call } = setup();
        const set = await call(types_1.CHANNELS.settingsSet, { twitch: { clientSecret: 'abc', clientId: 'id', login: 'diego' } });
        strict_1.default.ok(set.ok && set.value.twitch.clientSecret === '********');
        const get = await call(types_1.CHANNELS.settingsGet);
        strict_1.default.ok(get.ok && get.value.twitch.login === 'diego' && get.value.twitch.clientSecret === '********');
    });
    (0, node_test_1.it)('valida el tipo de cada parámetro antes de usarlo', async () => {
        const { call } = setup();
        for (const [ch, args] of [
            [types_1.CHANNELS.settingsSet, [null]],
            [types_1.CHANNELS.settingsSet, ['texto']],
            [types_1.CHANNELS.settingsSet, [[1, 2]]],
            [types_1.CHANNELS.vodsAdd, [123]],
            [types_1.CHANNELS.vodsAdd, [undefined]],
            [types_1.CHANNELS.clipsCreate, ['vod', 'no-objeto']],
            [types_1.CHANNELS.clipsCreate, [5, {}]],
            [types_1.CHANNELS.clipsLong, ['vod', null]],
            [types_1.CHANNELS.planApply, ['vod', { clips: [] }]],
            [types_1.CHANNELS.pubsSchedule, ['o', 'youtube', 'fecha']],
            [types_1.CHANNELS.pubsSchedule, ['o', ['youtube'], 12345]],
            [types_1.CHANNELS.pubsCancel, [{}]],
            [types_1.CHANNELS.shellOpen, [42]],
        ]) {
            strict_1.default.match(failMsg(await call(ch, ...args)), /Parámetro no válido/, `${ch} ${JSON.stringify(args)}`);
        }
    });
    (0, node_test_1.it)('vods:add rechaza URLs peligrosas con un mensaje claro y no crea nada', async () => {
        const { call, env } = setup();
        for (const bad of ['--exec rm -rf /', 'file:///etc/passwd', 'javascript:alert(1)', '']) {
            strict_1.default.match(failMsg(await call(types_1.CHANNELS.vodsAdd, bad)), /URL no es válida/);
        }
        strict_1.default.equal(env.ctx.store.data.vods.length, 0);
    });
    (0, node_test_1.it)('pickFolder pasa por la plataforma', async () => {
        const { call, platformCalls } = setup();
        const r = await call(types_1.CHANNELS.pickFolder);
        strict_1.default.deepEqual(r, { ok: true, value: '/elegida' });
        strict_1.default.equal(platformCalls.picked, 1);
    });
    (0, node_test_1.it)('twitch: usa el cliente con las credenciales guardadas (descifradas) y devuelve sus resultados', async () => {
        const seen = [];
        const fake = new twitch_1.TwitchClient((async (input, init) => {
            const url = String(input);
            seen.push(url + (init?.body ? ` ${String(init.body)}` : ''));
            if (url.includes('oauth2'))
                return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
            if (url.includes('users'))
                return new Response(JSON.stringify({ data: [{ id: '1', display_name: 'Diego' }] }));
            return new Response(JSON.stringify({ data: [{ id: '9', title: 'V', url: 'https://www.twitch.tv/videos/9', duration: '1h', created_at: 'x' }] }));
        }));
        const { call } = setup(fake);
        await call(types_1.CHANNELS.settingsSet, { twitch: { clientId: 'cid', clientSecret: 'el-secreto', login: 'diego' } });
        const t = await call(types_1.CHANNELS.twitchTest);
        strict_1.default.ok(t.ok && t.value.ok && /Diego/.test(t.value.message));
        strict_1.default.ok(seen.some((s) => s.includes('client_secret=el-secreto')), 'el secreto descifrado llega a Twitch');
        const v = await call(types_1.CHANNELS.twitchVods);
        strict_1.default.ok(v.ok && v.value[0].id === '9' && v.value[0].durationSec === 3600);
    });
    (0, node_test_1.it)('twitch sin credenciales: la prueba informa; listar VODs da error claro', async () => {
        const { call } = setup();
        const t = await call(types_1.CHANNELS.twitchTest);
        strict_1.default.ok(t.ok && t.value.ok === false);
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.twitchVods)), /Faltan las credenciales/);
    });
    (0, node_test_1.it)('shell:open solo abre rutas de la aplicación', async () => {
        const { call, env, platformCalls } = setup();
        const inside = node_path_1.default.join(env.outputDir, 'vertical', 'a.mp4');
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(inside), { recursive: true });
        node_fs_1.default.writeFileSync(inside, 'x');
        strict_1.default.deepEqual(await call(types_1.CHANNELS.shellOpen, inside), { ok: true, value: undefined });
        strict_1.default.deepEqual(platformCalls.shown, [inside]); // archivo -> se muestra en su carpeta
        await call(types_1.CHANNELS.shellOpen, env.outputDir);
        strict_1.default.deepEqual(platformCalls.opened, [env.outputDir]); // carpeta -> se abre
        for (const bad of ['/etc/passwd', '/', node_path_1.default.join(env.outputDir, '..', 'fuera.txt'), 'C:\\Windows\\System32\\cmd.exe', '../../etc']) {
            strict_1.default.match(failMsg(await call(types_1.CHANNELS.shellOpen, bad)), /no pertenece a la aplicación/, bad);
        }
        strict_1.default.equal(platformCalls.shown.length, 1);
        strict_1.default.equal(platformCalls.opened.length, 1);
    });
    (0, node_test_1.it)('shell:open admite archivos conocidos aunque estén fuera de la carpeta actual (se cambió de carpeta)', async () => {
        const { call, env, platformCalls } = setup();
        const other = (0, helpers_1.tmpDir)();
        extraDirs.push(other);
        const file = node_path_1.default.join(other, 'viejo.mp4');
        node_fs_1.default.writeFileSync(file, 'x');
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.shellOpen, file)), /no pertenece/);
        (0, helpers_1.addDownloadedVod)(env, file);
        await call(types_1.CHANNELS.shellOpen, file);
        strict_1.default.deepEqual(platformCalls.shown, [file]);
    });
    (0, node_test_1.it)('programar y cancelar publicaciones de extremo a extremo por IPC', async () => {
        const { call, env } = setup();
        env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
        const when = new Date(Date.now() + 3600_000).toISOString();
        const s = await call(types_1.CHANNELS.pubsSchedule, 'o1', ['youtube', 'tiktok'], when);
        strict_1.default.ok(s.ok && s.value.scheduled.length === 2);
        const l = await call(types_1.CHANNELS.pubsList);
        strict_1.default.ok(l.ok && l.value.length === 2);
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.pubsSchedule, 'o1', ['youtube'], new Date(Date.now() - 86400_000).toISOString())), /ya ha pasado/);
        await call(types_1.CHANNELS.pubsCancel, 'o1:youtube');
        const l2 = await call(types_1.CHANNELS.pubsList);
        strict_1.default.ok(l2.ok && l2.value.length === 1);
    });
    (0, node_test_1.it)('Biblioteca: valida parámetros, cancelar el selector de imagen no cambia nada', async () => {
        const { call, env, platformCalls } = setup();
        env.ctx.store.data.outputs.push({ id: 'o1', kind: 'long', title: 't', files: { long: '/x' }, durationSec: 5, createdAt: 'x' });
        for (const [ch, args] of [
            [types_1.CHANNELS.outputsRename, ['o1', 5]],
            [types_1.CHANNELS.outputsMeta, ['o1', null]],
            [types_1.CHANNELS.outputsMeta, [3, {}]],
            [types_1.CHANNELS.outputsThumbFrame, ['o1', '3']],
            [types_1.CHANNELS.outputsReedit, ['o1', null]],
            [types_1.CHANNELS.pubsSet, ['o1', 'youtube']],
            [types_1.CHANNELS.pubsSet, ['o1', [{ platform: 1, atIso: 'x' }]]],
            [types_1.CHANNELS.groupsCreate, [5, 'theme', 'clips']],
            [types_1.CHANNELS.groupsUpdate, ['g', null]],
            [types_1.CHANNELS.outputsMove, [7, null]],
        ]) {
            strict_1.default.match(failMsg(await call(ch, ...args)), /Parámetro no válido/, ch);
        }
        platformCalls.image = null;
        strict_1.default.deepEqual(await call(types_1.CHANNELS.outputsThumbImage, 'o1'), { ok: true, value: null });
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.outputsThumbImage, 'nope')), /no existe/);
    });
    (0, node_test_1.it)('Biblioteca: carpetas por IPC (crear, mover, borrar conserva los vídeos)', async () => {
        const { call, env } = setup();
        env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
        const g = await call(types_1.CHANNELS.groupsCreate, 'Pokémon', 'theme', 'clips');
        strict_1.default.ok(g.ok);
        const sub = await call(types_1.CHANNELS.groupsCreate, 'Road to Master', 'series', 'clips', g.value.id);
        strict_1.default.ok(sub.ok);
        strict_1.default.ok((await call(types_1.CHANNELS.outputsMove, 'o1', sub.value.id)).ok);
        strict_1.default.ok((await call(types_1.CHANNELS.groupsDelete, sub.value.id)).ok);
        strict_1.default.equal(env.ctx.store.data.outputs[0].groupId, g.value.id);
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.groupsMove, g.value.id, g.value.id)), /sí misma/);
    });
    (0, node_test_1.it)('descargar una versión: pregunta dónde guardar, copia el archivo y cancelar no hace nada', async () => {
        const { call, env, platformCalls } = setup();
        const src = node_path_1.default.join(env.outputDir, 'vertical', 'v.mp4');
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(src), { recursive: true });
        node_fs_1.default.writeFileSync(src, 'contenido');
        env.ctx.store.data.outputs.push({ id: 'c1', kind: 'clip', title: 'Mi Clip', files: { vertical: src }, durationSec: 5, createdAt: 'x' });
        platformCalls.savePath = null; // el usuario cancela
        strict_1.default.deepEqual(await call(types_1.CHANNELS.outputsExport, 'c1', 'vertical'), { ok: true, value: null });
        strict_1.default.deepEqual(platformCalls.savedAs, ['mi-clip-vertical.mp4']);
        platformCalls.savePath = node_path_1.default.join(env.root, 'copia.mp4');
        const r = await call(types_1.CHANNELS.outputsExport, 'c1', 'vertical');
        strict_1.default.ok(r.ok && r.value === platformCalls.savePath);
        strict_1.default.equal(node_fs_1.default.readFileSync(platformCalls.savePath, 'utf8'), 'contenido');
        // versión inexistente: error claro y sin abrir el cuadro de guardado
        const before = platformCalls.savedAs.length;
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.outputsExport, 'c1', 'horizontal')), /no tiene versión horizontal/);
        strict_1.default.equal(platformCalls.savedAs.length, before);
        strict_1.default.match(failMsg(await call(types_1.CHANNELS.outputsExport, 5, 'vertical')), /Parámetro no válido/);
    });
    (0, node_test_1.it)('shell:open admite los archivos de todas las versiones de un clip', async () => {
        const { call, env, platformCalls } = setup();
        const other = (0, helpers_1.tmpDir)();
        extraDirs.push(other);
        const f = node_path_1.default.join(other, 'h.mp4');
        node_fs_1.default.writeFileSync(f, 'x');
        env.ctx.store.data.outputs.push({ id: 'c1', kind: 'clip', title: 't', files: { horizontal: f }, durationSec: 5, createdAt: 'x' });
        strict_1.default.ok((await call(types_1.CHANNELS.shellOpen, f)).ok);
        strict_1.default.deepEqual(platformCalls.shown, [f]);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("../electron/services/store");
const secrets_1 = require("../electron/services/secrets");
const logger_1 = require("../electron/services/logger");
const queue_1 = require("../electron/services/queue");
const files_1 = require("../electron/services/files");
const bundled_1 = require("../electron/app/bundled");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const dirs = [];
const mk = () => {
    const d = (0, helpers_1.tmpDir)();
    dirs.push(d);
    return d;
};
(0, node_test_1.afterEach)(() => {
    while (dirs.length)
        (0, helpers_1.rmDir)(dirs.pop());
});
(0, node_test_1.describe)('Store', () => {
    (0, node_test_1.it)('crea valores por defecto en la primera ejecución', () => {
        const s = new store_1.Store(mk(), '/salida');
        strict_1.default.equal(s.data.schemaVersion, store_1.STORE_VERSION);
        strict_1.default.equal(s.data.settings.outputDir, '/salida');
        strict_1.default.deepEqual(s.data.vods, []);
        strict_1.default.equal(s.recoveredFrom, undefined);
    });
    (0, node_test_1.it)('guarda y recarga lo mismo, y no deja archivos temporales', () => {
        const dir = mk();
        const a = new store_1.Store(dir, '/salida');
        a.data.settings.twitch.login = 'diego';
        a.data.vods.push({ id: '1', url: 'u', title: 't', status: 'downloaded', progress: 100, createdAt: 'x' });
        a.save();
        const b = new store_1.Store(dir, '/otra');
        strict_1.default.equal(b.data.settings.twitch.login, 'diego');
        strict_1.default.equal(b.data.vods.length, 1);
        strict_1.default.equal(b.data.settings.outputDir, '/salida'); // lo guardado manda sobre el valor por defecto
        strict_1.default.deepEqual(node_fs_1.default.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
    });
    (0, node_test_1.it)('un JSON dañado no se pierde: se conserva copia y se empieza limpio', () => {
        const dir = mk();
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'data.json'), '{"vods": [ esto no es json');
        const s = new store_1.Store(dir, '/salida');
        strict_1.default.ok(s.recoveredFrom && node_fs_1.default.existsSync(s.recoveredFrom));
        strict_1.default.match(node_fs_1.default.readFileSync(s.recoveredFrom, 'utf8'), /esto no es json/);
        strict_1.default.deepEqual(s.data.vods, []);
    });
    (0, node_test_1.it)('un JSON válido pero con otra forma también se recupera', () => {
        for (const content of ['[]', '5', 'null', '"x"']) {
            const dir = mk();
            node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'data.json'), content);
            const s = new store_1.Store(dir, '/salida');
            strict_1.default.ok(s.recoveredFrom, `contenido ${content}`);
        }
    });
    (0, node_test_1.it)('completa campos que faltan y descarta listas con tipo erróneo', () => {
        const dir = mk();
        node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'data.json'), JSON.stringify({ settings: { twitch: { login: 'x' } }, vods: 'roto', outputs: null }));
        const s = new store_1.Store(dir, '/salida');
        strict_1.default.equal(s.data.settings.twitch.login, 'x');
        strict_1.default.equal(s.data.settings.twitch.clientId, '');
        strict_1.default.equal(s.data.settings.outputDir, '/salida');
        strict_1.default.deepEqual(s.data.vods, []);
        strict_1.default.deepEqual(s.data.outputs, []);
        strict_1.default.deepEqual(s.data.publications, []);
    });
});
(0, node_test_1.describe)('Secrets', () => {
    (0, node_test_1.it)('cifra y descifra con el cifrado del sistema', () => {
        const s = new secrets_1.Secrets(helpers_1.fakeCipher);
        const enc = s.encode('mi-secreto');
        strict_1.default.match(enc, /^enc:/);
        strict_1.default.ok(!enc.includes('mi-secreto'));
        strict_1.default.equal(s.decode(enc), 'mi-secreto');
    });
    (0, node_test_1.it)('sin cifrado del sistema usa el formato plain: y sigue funcionando', () => {
        const s = new secrets_1.Secrets(helpers_1.noCipher);
        const enc = s.encode('abc ñ €');
        strict_1.default.match(enc, /^plain:/);
        strict_1.default.equal(s.decode(enc), 'abc ñ €');
    });
    (0, node_test_1.it)('vacío -> vacío; basura o descifrado fallido -> vacío, sin lanzar', () => {
        const s = new secrets_1.Secrets(helpers_1.fakeCipher);
        strict_1.default.equal(s.encode(''), '');
        strict_1.default.equal(s.decode(''), '');
        strict_1.default.equal(s.decode('sin-prefijo'), '');
        const broken = new secrets_1.Secrets({ ...helpers_1.fakeCipher, decrypt: () => { throw new Error('otro PC'); } });
        strict_1.default.equal(broken.decode('enc:AAAA'), '');
    });
});
(0, node_test_1.describe)('Logger', () => {
    (0, node_test_1.it)('escribe líneas con nivel y fecha, e incluye el detalle del error', () => {
        const dir = mk();
        const log = new logger_1.Logger(dir);
        log.info('hola');
        log.warn('cuidado');
        log.error('fallo', new Error('causa'));
        const text = node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'app.log'), 'utf8');
        strict_1.default.match(text, /^\d{4}-\d{2}-\d{2}T.* INFO hola$/m);
        strict_1.default.match(text, /WARN cuidado/);
        strict_1.default.match(text, /ERROR fallo \| causa/);
    });
    (0, node_test_1.it)('rota el archivo al pasar del tamaño máximo', () => {
        const dir = mk();
        const log = new logger_1.Logger(dir, 200);
        for (let i = 0; i < 20; i++)
            log.info(`linea ${i} ${'x'.repeat(30)}`);
        strict_1.default.ok(node_fs_1.default.existsSync(node_path_1.default.join(dir, 'app.old.log')));
        strict_1.default.ok(node_fs_1.default.statSync(node_path_1.default.join(dir, 'app.log')).size < 600);
    });
    (0, node_test_1.it)('un fallo al escribir nunca lanza', () => {
        const dir = node_path_1.default.join(mk(), 'logs');
        const log = new logger_1.Logger(dir);
        node_fs_1.default.rmSync(dir, { recursive: true });
        strict_1.default.doesNotThrow(() => log.error('sigue funcionando', 'texto'));
    });
});
(0, node_test_1.describe)('files', () => {
    (0, node_test_1.it)('slug limpia tildes, símbolos y longitud', () => {
        strict_1.default.equal((0, files_1.slug)('Ñandú ÉPICO!! '), 'nandu-epico');
        strict_1.default.equal((0, files_1.slug)(''), 'video');
        strict_1.default.equal((0, files_1.slug)('???'), 'video');
        strict_1.default.equal((0, files_1.slug)('../../etc/passwd'), 'etc-passwd');
        strict_1.default.ok((0, files_1.slug)('a'.repeat(200)).length <= 50);
    });
    (0, node_test_1.it)('uniqueOutputPath es único incluso en el mismo milisegundo y queda dentro de la carpeta', () => {
        const set = new Set(Array.from({ length: 200 }, () => (0, files_1.uniqueOutputPath)('/out', 'vertical', 'Mismo título')));
        strict_1.default.equal(set.size, 200);
        const p = (0, files_1.uniqueOutputPath)('/out', 'long', '../../escape');
        strict_1.default.ok((0, files_1.isInside)('/out', p));
        strict_1.default.match(p, /\.mp4$/);
        strict_1.default.ok(p.includes(`${node_path_1.default.sep}long${node_path_1.default.sep}`));
    });
    (0, node_test_1.it)('isInside resuelve .. y no se deja engañar por prefijos', () => {
        strict_1.default.ok((0, files_1.isInside)('/a/b', '/a/b'));
        strict_1.default.ok((0, files_1.isInside)('/a/b', '/a/b/c/d.mp4'));
        strict_1.default.ok(!(0, files_1.isInside)('/a/b', '/a/bc'));
        strict_1.default.ok(!(0, files_1.isInside)('/a/b', '/a/b/../c'));
        strict_1.default.ok(!(0, files_1.isInside)('/a/b', '/etc/passwd'));
        strict_1.default.ok(!(0, files_1.isInside)('/a/b', '/'));
    });
    (0, node_test_1.it)('stripQuotes quita las comillas de "Copiar como ruta" de Windows', () => {
        strict_1.default.equal((0, files_1.stripQuotes)('"C:\\Mis vídeos\\a.exe"'), 'C:\\Mis vídeos\\a.exe');
        strict_1.default.equal((0, files_1.stripQuotes)("  'C:\\x'  "), 'C:\\x');
        strict_1.default.equal((0, files_1.stripQuotes)('sin comillas'), 'sin comillas');
    });
    (0, node_test_1.it)('isAbsoluteAnyOs reconoce rutas de Windows y de Unix', () => {
        strict_1.default.ok((0, files_1.isAbsoluteAnyOs)('C:\\a\\b'));
        strict_1.default.ok((0, files_1.isAbsoluteAnyOs)('D:/a'));
        strict_1.default.ok((0, files_1.isAbsoluteAnyOs)('/a/b'));
        strict_1.default.ok(!(0, files_1.isAbsoluteAnyOs)('a/b'));
        strict_1.default.ok(!(0, files_1.isAbsoluteAnyOs)('..'));
        strict_1.default.ok(!(0, files_1.isAbsoluteAnyOs)(''));
    });
});
(0, node_test_1.describe)('SerialQueue', () => {
    (0, node_test_1.it)('ejecuta de una en una y en orden', async () => {
        const q = new queue_1.SerialQueue();
        let running = 0;
        let max = 0;
        const order = [];
        const task = (n, ms) => () => (async () => {
            running++;
            max = Math.max(max, running);
            await (0, helpers_1.sleep)(ms);
            order.push(n);
            running--;
            return n;
        })();
        const results = await Promise.all([q.run(task(1, 30)), q.run(task(2, 5)), q.run(task(3, 1))]);
        strict_1.default.deepEqual(results, [1, 2, 3]);
        strict_1.default.deepEqual(order, [1, 2, 3]);
        strict_1.default.equal(max, 1);
    });
    (0, node_test_1.it)('con límite 2 van dos a la vez, en orden de llegada, y el límite se puede cambiar en caliente', async () => {
        let limit = 2;
        const q = new queue_1.SerialQueue(() => limit);
        let running = 0;
        let max = 0;
        const started = [];
        const task = (n) => () => (async () => {
            started.push(n);
            running++;
            max = Math.max(max, running);
            await (0, helpers_1.sleep)(30);
            running--;
            return n;
        })();
        strict_1.default.deepEqual(await Promise.all([1, 2, 3, 4, 5].map((n) => q.run(task(n)))), [1, 2, 3, 4, 5]);
        strict_1.default.equal(max, 2);
        strict_1.default.deepEqual(started, [1, 2, 3, 4, 5]);
        limit = 1;
        max = 0;
        await Promise.all([6, 7, 8].map((n) => q.run(task(n))));
        strict_1.default.equal(max, 1);
        await q.idle();
        strict_1.default.equal(q.size, 0);
    });
    (0, node_test_1.it)('un fallo no bloquea las siguientes tareas', async () => {
        const q = new queue_1.SerialQueue();
        const a = q.run(async () => {
            throw new Error('boom');
        });
        const b = q.run(async () => 'ok');
        await strict_1.default.rejects(a, /boom/);
        strict_1.default.equal(await b, 'ok');
    });
    (0, node_test_1.it)('idle espera a que se vacíe, también con tareas añadidas mientras tanto', async () => {
        const q = new queue_1.SerialQueue();
        const done = [];
        void q.run(async () => {
            await (0, helpers_1.sleep)(20);
            done.push(1);
            void q.run(async () => {
                await (0, helpers_1.sleep)(10);
                done.push(2);
            });
        });
        await q.idle();
        strict_1.default.deepEqual(done, [1, 2]);
        strict_1.default.equal(q.size, 0);
    });
});
(0, node_test_1.describe)('tools', () => {
    (0, node_test_1.it)('resolveToolPaths usa el PATH si no hay ruta y deriva ffprobe de ffmpeg', () => {
        strict_1.default.deepEqual((0, tools_1.resolveToolPaths)('', ''), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' });
        const t = (0, tools_1.resolveToolPaths)('C:\\ff\\bin\\ffmpeg.exe', 'C:\\t\\yt-dlp.exe');
        strict_1.default.equal(t.ffprobe, 'C:\\ff\\bin\\ffprobe.exe');
        strict_1.default.equal(t.ytdlp, 'C:\\t\\yt-dlp.exe');
        strict_1.default.equal((0, tools_1.resolveToolPaths)('/opt/ff/ffmpeg', '').ffprobe, '/opt/ff/ffprobe');
    });
    (0, node_test_1.it)('run distingue "no existe" de "ha fallado" y no usa shell', async () => {
        await strict_1.default.rejects((0, tools_1.run)('/no/existe/nada', []), /No se encuentra/);
        await strict_1.default.rejects((0, tools_1.run)('node', ['-e', 'process.exit(3)']), /falló/);
        // sin shell: un argumento con metacaracteres llega tal cual, no se ejecuta
        const r = await (0, tools_1.run)('node', ['-e', 'console.log(process.argv[1])', '$(echo hackeado); ls']);
        strict_1.default.equal(r.stdout.trim(), '$(echo hackeado); ls');
    });
    (0, node_test_1.it)('checkTools detecta herramientas presentes y ausentes', async () => {
        const ok = await (0, tools_1.checkTools)((0, tools_1.resolveToolPaths)('', ''));
        strict_1.default.equal(ok.ffmpeg.ok, true);
        strict_1.default.equal(ok.ffprobe.ok, true);
        strict_1.default.equal(ok.ytdlp.ok, false); // en este entorno no hay yt-dlp real
        const bad = await (0, tools_1.checkTools)({ ffmpeg: '/no/ffmpeg', ffprobe: '/no/ffprobe', ytdlp: '/no/yt' });
        strict_1.default.deepEqual([bad.ffmpeg.ok, bad.ffprobe.ok, bad.ytdlp.ok], [false, false, false]);
    });
});
(0, node_test_1.describe)('herramientas incluidas con el programa', () => {
    (0, node_test_1.it)('prioridad: ruta de Ajustes > incluida > PATH', () => {
        const b = { ffmpeg: '/app/ffmpeg', ffprobe: '/app/ffprobe', ytdlp: '/app/yt-dlp' };
        strict_1.default.deepEqual((0, tools_1.resolveToolPaths)('', '', b), { ffmpeg: '/app/ffmpeg', ffprobe: '/app/ffprobe', ytdlp: '/app/yt-dlp' });
        strict_1.default.deepEqual((0, tools_1.resolveToolPaths)('', '', {}), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' });
        const u = (0, tools_1.resolveToolPaths)('/mi/ffmpeg', '/mi/yt-dlp', b);
        strict_1.default.deepEqual(u, { ffmpeg: '/mi/ffmpeg', ffprobe: '/mi/ffprobe', ytdlp: '/mi/yt-dlp' });
        strict_1.default.equal((0, tools_1.resolveToolPaths)('', '', { ffmpeg: '/app/ffmpeg' }).ffprobe, 'ffprobe');
    });
    (0, node_test_1.it)('unpackedPath saca los ejecutables del asar (barras de Windows y de Linux)', () => {
        strict_1.default.equal((0, bundled_1.unpackedPath)('/r/app.asar/node_modules/ffmpeg-static/ffmpeg'), '/r/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
        strict_1.default.equal((0, bundled_1.unpackedPath)('C:\\r\\app.asar\\node_modules\\ffmpeg.exe'), 'C:\\r\\app.asar.unpacked\\node_modules\\ffmpeg.exe');
        strict_1.default.equal((0, bundled_1.unpackedPath)('/sin/asar/ffmpeg'), '/sin/asar/ffmpeg');
    });
    (0, node_test_1.it)('findBundledTools solo devuelve lo que existe y no se cae si un paquete falta', () => {
        const present = new Set(['/r/app.asar.unpacked/ff', '/res/bin/yt-dlp.exe']);
        const found = (0, bundled_1.findBundledTools)({
            resourcesDir: '/res',
            platform: 'win32',
            load: (n) => (n === 'ffmpeg-static' ? '/r/app.asar/ff' : (() => { throw new Error('no instalado'); })()),
            exists: (p) => present.has(p.replace(/\\/g, '/')),
        });
        strict_1.default.deepEqual(found, { ffmpeg: '/r/app.asar.unpacked/ff', ytdlp: node_path_1.default.join('/res', 'bin', 'yt-dlp.exe') });
        strict_1.default.deepEqual((0, bundled_1.findBundledTools)({ resourcesDir: '/x', platform: 'linux', load: () => null, exists: () => false }), {});
        strict_1.default.deepEqual((0, bundled_1.findBundledTools)({ resourcesDir: '/x', platform: 'linux', load: () => ({ path: 5 }), exists: () => true }), { ytdlp: node_path_1.default.join('/x', 'bin', 'yt-dlp'), whisper: node_path_1.default.join('/x', 'bin', 'whisper-cli') });
    });
    (0, node_test_1.it)('los binarios que trae npm funcionan de verdad (ffmpeg y ffprobe incluidos)', async () => {
        const b = (0, bundled_1.findBundledTools)({ resourcesDir: '/no', platform: process.platform, // eslint-disable-next-line @typescript-eslint/no-require-imports
            load: (n) => require(n) });
        strict_1.default.ok(b.ffmpeg && b.ffprobe, 'ffmpeg-static y ffprobe-static deben estar instalados');
        const st = await (0, tools_1.checkTools)((0, tools_1.resolveToolPaths)('', '', b));
        strict_1.default.ok(st.ffmpeg.ok && st.ffprobe.ok, JSON.stringify(st));
    });
});
(0, node_test_1.describe)('migración del almacén (versión 1 → 2)', () => {
    (0, node_test_1.it)('normalizeOutput convierte los elementos sueltos antiguos en clips con sus versiones', () => {
        const old = { id: 'a', kind: 'vertical', title: 'T', file: '/v.mp4', durationSec: 3, createdAt: 'x', groupId: 'g', thumbnail: '/t.jpg' };
        strict_1.default.deepEqual((0, store_1.normalizeOutput)(old), { id: 'a', kind: 'clip', title: 'T', files: { vertical: '/v.mp4' }, durationSec: 3, createdAt: 'x', groupId: 'g', thumbnail: '/t.jpg' });
        strict_1.default.deepEqual((0, store_1.normalizeOutput)({ id: 'b', kind: 'horizontal', title: 'T', file: '/h.mp4' })?.files, { horizontal: '/h.mp4' });
        const long = (0, store_1.normalizeOutput)({ id: 'c', kind: 'long', title: 'L', file: '/l.mp4', description: 'd' });
        strict_1.default.deepEqual([long?.kind, long?.files, long?.description], ['long', { long: '/l.mp4' }, 'd']);
        strict_1.default.equal('file' in long, false, 'el campo antiguo desaparece');
    });
    (0, node_test_1.it)('lo ya nuevo se conserva y lo irrecuperable se descarta sin romper nada', () => {
        const fresh = { id: 'n', kind: 'clip', title: 'N', files: { vertical: '/v', horizontal: '/h', otra: '/x' }, durationSec: 1, createdAt: 'x' };
        strict_1.default.deepEqual((0, store_1.normalizeOutput)(fresh)?.files, { vertical: '/v', horizontal: '/h' });
        for (const bad of [null, 5, 'x', {}, { id: 'a' }, { id: 'a', title: 't' }, { id: 'a', title: 't', kind: 'raro', file: '/x' }, { id: 1, title: 't', file: '/x' }, { id: 'a', title: 't', files: {} }]) {
            strict_1.default.equal((0, store_1.normalizeOutput)(bad), null, JSON.stringify(bad));
        }
    });
    (0, node_test_1.it)('al abrir un data.json de la versión 1 se migra y al guardar queda en la versión 2', () => {
        const dir = (0, helpers_1.tmpDir)();
        try {
            node_fs_1.default.writeFileSync(node_path_1.default.join(dir, 'data.json'), JSON.stringify({
                schemaVersion: 1,
                settings: {},
                vods: [],
                outputs: [
                    { id: 'a', kind: 'vertical', title: 'A', file: '/a.mp4', durationSec: 1, createdAt: 'x' },
                    { id: 'b', kind: 'long', title: 'B', file: '/b.mp4', durationSec: 1, createdAt: 'x' },
                    { basura: true },
                ],
                publications: [],
            }));
            const s = new store_1.Store(dir, '/salida');
            strict_1.default.deepEqual(s.data.outputs.map((o) => [o.id, o.kind, Object.keys(o.files)[0]]), [['a', 'clip', 'vertical'], ['b', 'long', 'long']]);
            strict_1.default.equal(s.recoveredFrom, undefined);
            s.save();
            const disk = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(dir, 'data.json'), 'utf8'));
            strict_1.default.equal(disk.schemaVersion, store_1.STORE_VERSION);
            strict_1.default.equal(store_1.STORE_VERSION, 2);
            strict_1.default.ok(disk.outputs.every((o) => o.file === undefined));
        }
        finally {
            (0, helpers_1.rmDir)(dir);
        }
    });
});

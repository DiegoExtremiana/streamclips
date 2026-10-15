import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store, STORE_VERSION, normalizeOutput } from '../electron/services/store';
import { Secrets } from '../electron/services/secrets';
import { Logger } from '../electron/services/logger';
import { SerialQueue } from '../electron/services/queue';
import { isAbsoluteAnyOs, isInside, slug, stripQuotes, uniqueOutputPath } from '../electron/services/files';
import { findBundledTools, unpackedPath } from '../electron/app/bundled';
import { checkTools, resolveToolPaths, run } from '../electron/services/tools';
import { fakeCipher, noCipher, rmDir, sleep, tmpDir } from './helpers';

const dirs: string[] = [];
const mk = () => {
  const d = tmpDir();
  dirs.push(d);
  return d;
};
afterEach(() => {
  while (dirs.length) rmDir(dirs.pop()!);
});

describe('Store', () => {
  it('crea valores por defecto en la primera ejecución', () => {
    const s = new Store(mk(), '/salida');
    assert.equal(s.data.schemaVersion, STORE_VERSION);
    assert.equal(s.data.settings.outputDir, '/salida');
    assert.deepEqual(s.data.vods, []);
    assert.equal(s.recoveredFrom, undefined);
  });

  it('guarda y recarga lo mismo, y no deja archivos temporales', () => {
    const dir = mk();
    const a = new Store(dir, '/salida');
    a.data.settings.twitch.login = 'diego';
    a.data.vods.push({ id: '1', url: 'u', title: 't', status: 'downloaded', progress: 100, createdAt: 'x' });
    a.save();
    const b = new Store(dir, '/otra');
    assert.equal(b.data.settings.twitch.login, 'diego');
    assert.equal(b.data.vods.length, 1);
    assert.equal(b.data.settings.outputDir, '/salida'); // lo guardado manda sobre el valor por defecto
    assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  });

  it('un JSON dañado no se pierde: se conserva copia y se empieza limpio', () => {
    const dir = mk();
    fs.writeFileSync(path.join(dir, 'data.json'), '{"vods": [ esto no es json');
    const s = new Store(dir, '/salida');
    assert.ok(s.recoveredFrom && fs.existsSync(s.recoveredFrom));
    assert.match(fs.readFileSync(s.recoveredFrom!, 'utf8'), /esto no es json/);
    assert.deepEqual(s.data.vods, []);
  });

  it('un JSON válido pero con otra forma también se recupera', () => {
    for (const content of ['[]', '5', 'null', '"x"']) {
      const dir = mk();
      fs.writeFileSync(path.join(dir, 'data.json'), content);
      const s = new Store(dir, '/salida');
      assert.ok(s.recoveredFrom, `contenido ${content}`);
    }
  });

  it('completa campos que faltan y descarta listas con tipo erróneo', () => {
    const dir = mk();
    fs.writeFileSync(
      path.join(dir, 'data.json'),
      JSON.stringify({ settings: { twitch: { login: 'x' } }, vods: 'roto', outputs: null }),
    );
    const s = new Store(dir, '/salida');
    assert.equal(s.data.settings.twitch.login, 'x');
    assert.equal(s.data.settings.twitch.clientId, '');
    assert.equal(s.data.settings.outputDir, '/salida');
    assert.deepEqual(s.data.vods, []);
    assert.deepEqual(s.data.outputs, []);
    assert.deepEqual(s.data.publications, []);
  });
});

describe('Secrets', () => {
  it('cifra y descifra con el cifrado del sistema', () => {
    const s = new Secrets(fakeCipher);
    const enc = s.encode('mi-secreto');
    assert.match(enc, /^enc:/);
    assert.ok(!enc.includes('mi-secreto'));
    assert.equal(s.decode(enc), 'mi-secreto');
  });

  it('sin cifrado del sistema usa el formato plain: y sigue funcionando', () => {
    const s = new Secrets(noCipher);
    const enc = s.encode('abc ñ €');
    assert.match(enc, /^plain:/);
    assert.equal(s.decode(enc), 'abc ñ €');
  });

  it('vacío -> vacío; basura o descifrado fallido -> vacío, sin lanzar', () => {
    const s = new Secrets(fakeCipher);
    assert.equal(s.encode(''), '');
    assert.equal(s.decode(''), '');
    assert.equal(s.decode('sin-prefijo'), '');
    const broken = new Secrets({ ...fakeCipher, decrypt: () => { throw new Error('otro PC'); } });
    assert.equal(broken.decode('enc:AAAA'), '');
  });
});

describe('Logger', () => {
  it('escribe líneas con nivel y fecha, e incluye el detalle del error', () => {
    const dir = mk();
    const log = new Logger(dir);
    log.info('hola');
    log.warn('cuidado');
    log.error('fallo', new Error('causa'));
    const text = fs.readFileSync(path.join(dir, 'app.log'), 'utf8');
    assert.match(text, /^\d{4}-\d{2}-\d{2}T.* INFO hola$/m);
    assert.match(text, /WARN cuidado/);
    assert.match(text, /ERROR fallo \| causa/);
  });

  it('rota el archivo al pasar del tamaño máximo', () => {
    const dir = mk();
    const log = new Logger(dir, 200);
    for (let i = 0; i < 20; i++) log.info(`linea ${i} ${'x'.repeat(30)}`);
    assert.ok(fs.existsSync(path.join(dir, 'app.old.log')));
    assert.ok(fs.statSync(path.join(dir, 'app.log')).size < 600);
  });

  it('un fallo al escribir nunca lanza', () => {
    const dir = path.join(mk(), 'logs');
    const log = new Logger(dir);
    fs.rmSync(dir, { recursive: true });
    assert.doesNotThrow(() => log.error('sigue funcionando', 'texto'));
  });
});

describe('files', () => {
  it('slug limpia tildes, símbolos y longitud', () => {
    assert.equal(slug('Ñandú ÉPICO!! '), 'nandu-epico');
    assert.equal(slug(''), 'video');
    assert.equal(slug('???'), 'video');
    assert.equal(slug('../../etc/passwd'), 'etc-passwd');
    assert.ok(slug('a'.repeat(200)).length <= 50);
  });

  it('uniqueOutputPath es único incluso en el mismo milisegundo y queda dentro de la carpeta', () => {
    const set = new Set(Array.from({ length: 200 }, () => uniqueOutputPath('/out', 'vertical', 'Mismo título')));
    assert.equal(set.size, 200);
    const p = uniqueOutputPath('/out', 'long', '../../escape');
    assert.ok(isInside('/out', p));
    assert.match(p, /\.mp4$/);
    assert.ok(p.includes(`${path.sep}long${path.sep}`));
  });

  it('isInside resuelve .. y no se deja engañar por prefijos', () => {
    assert.ok(isInside('/a/b', '/a/b'));
    assert.ok(isInside('/a/b', '/a/b/c/d.mp4'));
    assert.ok(!isInside('/a/b', '/a/bc'));
    assert.ok(!isInside('/a/b', '/a/b/../c'));
    assert.ok(!isInside('/a/b', '/etc/passwd'));
    assert.ok(!isInside('/a/b', '/'));
  });

  it('stripQuotes quita las comillas de "Copiar como ruta" de Windows', () => {
    assert.equal(stripQuotes('"C:\\Mis vídeos\\a.exe"'), 'C:\\Mis vídeos\\a.exe');
    assert.equal(stripQuotes("  'C:\\x'  "), 'C:\\x');
    assert.equal(stripQuotes('sin comillas'), 'sin comillas');
  });

  it('isAbsoluteAnyOs reconoce rutas de Windows y de Unix', () => {
    assert.ok(isAbsoluteAnyOs('C:\\a\\b'));
    assert.ok(isAbsoluteAnyOs('D:/a'));
    assert.ok(isAbsoluteAnyOs('/a/b'));
    assert.ok(!isAbsoluteAnyOs('a/b'));
    assert.ok(!isAbsoluteAnyOs('..'));
    assert.ok(!isAbsoluteAnyOs(''));
  });
});

describe('SerialQueue', () => {
  it('ejecuta de una en una y en orden', async () => {
    const q = new SerialQueue();
    let running = 0;
    let max = 0;
    const order: number[] = [];
    const task = (n: number, ms: number) => () =>
      (async () => {
        running++;
        max = Math.max(max, running);
        await sleep(ms);
        order.push(n);
        running--;
        return n;
      })();
    const results = await Promise.all([q.run(task(1, 30)), q.run(task(2, 5)), q.run(task(3, 1))]);
    assert.deepEqual(results, [1, 2, 3]);
    assert.deepEqual(order, [1, 2, 3]);
    assert.equal(max, 1);
  });

  it('un fallo no bloquea las siguientes tareas', async () => {
    const q = new SerialQueue();
    const a = q.run(async () => {
      throw new Error('boom');
    });
    const b = q.run(async () => 'ok');
    await assert.rejects(a, /boom/);
    assert.equal(await b, 'ok');
  });

  it('idle espera a que se vacíe, también con tareas añadidas mientras tanto', async () => {
    const q = new SerialQueue();
    const done: number[] = [];
    void q.run(async () => {
      await sleep(20);
      done.push(1);
      void q.run(async () => {
        await sleep(10);
        done.push(2);
      });
    });
    await q.idle();
    assert.deepEqual(done, [1, 2]);
    assert.equal(q.size, 0);
  });
});

describe('tools', () => {
  it('resolveToolPaths usa el PATH si no hay ruta y deriva ffprobe de ffmpeg', () => {
    assert.deepEqual(resolveToolPaths('', ''), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' });
    const t = resolveToolPaths('C:\\ff\\bin\\ffmpeg.exe', 'C:\\t\\yt-dlp.exe');
    assert.equal(t.ffprobe, 'C:\\ff\\bin\\ffprobe.exe');
    assert.equal(t.ytdlp, 'C:\\t\\yt-dlp.exe');
    assert.equal(resolveToolPaths('/opt/ff/ffmpeg', '').ffprobe, '/opt/ff/ffprobe');
  });

  it('run distingue "no existe" de "ha fallado" y no usa shell', async () => {
    await assert.rejects(run('/no/existe/nada', []), /No se encuentra/);
    await assert.rejects(run('node', ['-e', 'process.exit(3)']), /falló/);
    // sin shell: un argumento con metacaracteres llega tal cual, no se ejecuta
    const r = await run('node', ['-e', 'console.log(process.argv[1])', '$(echo hackeado); ls']);
    assert.equal(r.stdout.trim(), '$(echo hackeado); ls');
  });

  it('checkTools detecta herramientas presentes y ausentes', async () => {
    const ok = await checkTools(resolveToolPaths('', ''));
    assert.equal(ok.ffmpeg.ok, true);
    assert.equal(ok.ffprobe.ok, true);
    assert.equal(ok.ytdlp.ok, false); // en este entorno no hay yt-dlp real
    const bad = await checkTools({ ffmpeg: '/no/ffmpeg', ffprobe: '/no/ffprobe', ytdlp: '/no/yt' });
    assert.deepEqual([bad.ffmpeg.ok, bad.ffprobe.ok, bad.ytdlp.ok], [false, false, false]);
  });
});

describe('herramientas incluidas con el programa', () => {
  it('prioridad: ruta de Ajustes > incluida > PATH', () => {
    const b = { ffmpeg: '/app/ffmpeg', ffprobe: '/app/ffprobe', ytdlp: '/app/yt-dlp' };
    assert.deepEqual(resolveToolPaths('', '', b), { ffmpeg: '/app/ffmpeg', ffprobe: '/app/ffprobe', ytdlp: '/app/yt-dlp' });
    assert.deepEqual(resolveToolPaths('', '', {}), { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' });
    const u = resolveToolPaths('/mi/ffmpeg', '/mi/yt-dlp', b);
    assert.deepEqual(u, { ffmpeg: '/mi/ffmpeg', ffprobe: '/mi/ffprobe', ytdlp: '/mi/yt-dlp' });
    assert.equal(resolveToolPaths('', '', { ffmpeg: '/app/ffmpeg' }).ffprobe, 'ffprobe');
  });

  it('unpackedPath saca los ejecutables del asar (barras de Windows y de Linux)', () => {
    assert.equal(unpackedPath('/r/app.asar/node_modules/ffmpeg-static/ffmpeg'), '/r/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg');
    assert.equal(unpackedPath('C:\\r\\app.asar\\node_modules\\ffmpeg.exe'), 'C:\\r\\app.asar.unpacked\\node_modules\\ffmpeg.exe');
    assert.equal(unpackedPath('/sin/asar/ffmpeg'), '/sin/asar/ffmpeg');
  });

  it('findBundledTools solo devuelve lo que existe y no se cae si un paquete falta', () => {
    const present = new Set(['/r/app.asar.unpacked/ff', '/res/bin/yt-dlp.exe']);
    const found = findBundledTools({
      resourcesDir: '/res',
      platform: 'win32',
      load: (n) => (n === 'ffmpeg-static' ? '/r/app.asar/ff' : (() => { throw new Error('no instalado'); })()),
      exists: (p) => present.has(p.replace(/\\/g, '/')),
    });
    assert.deepEqual(found, { ffmpeg: '/r/app.asar.unpacked/ff', ytdlp: path.join('/res', 'bin', 'yt-dlp.exe') });
    assert.deepEqual(findBundledTools({ resourcesDir: '/x', platform: 'linux', load: () => null, exists: () => false }), {});
    assert.deepEqual(findBundledTools({ resourcesDir: '/x', platform: 'linux', load: () => ({ path: 5 }), exists: () => true }), { ytdlp: path.join('/x', 'bin', 'yt-dlp'), whisper: path.join('/x', 'bin', 'whisper-cli') });
  });

  it('los binarios que trae npm funcionan de verdad (ffmpeg y ffprobe incluidos)', async () => {
    const b = findBundledTools({ resourcesDir: '/no', platform: process.platform, // eslint-disable-next-line @typescript-eslint/no-require-imports
      load: (n) => require(n) as unknown });
    assert.ok(b.ffmpeg && b.ffprobe, 'ffmpeg-static y ffprobe-static deben estar instalados');
    const st = await checkTools(resolveToolPaths('', '', b));
    assert.ok(st.ffmpeg.ok && st.ffprobe.ok, JSON.stringify(st));
  });
});

describe('migración del almacén (versión 1 → 2)', () => {
  it('normalizeOutput convierte los elementos sueltos antiguos en clips con sus versiones', () => {
    const old = { id: 'a', kind: 'vertical', title: 'T', file: '/v.mp4', durationSec: 3, createdAt: 'x', groupId: 'g', thumbnail: '/t.jpg' };
    assert.deepEqual(normalizeOutput(old), { id: 'a', kind: 'clip', title: 'T', files: { vertical: '/v.mp4' }, durationSec: 3, createdAt: 'x', groupId: 'g', thumbnail: '/t.jpg' });
    assert.deepEqual(normalizeOutput({ id: 'b', kind: 'horizontal', title: 'T', file: '/h.mp4' })?.files, { horizontal: '/h.mp4' });
    const long = normalizeOutput({ id: 'c', kind: 'long', title: 'L', file: '/l.mp4', description: 'd' });
    assert.deepEqual([long?.kind, long?.files, long?.description], ['long', { long: '/l.mp4' }, 'd']);
    assert.equal('file' in (long as object), false, 'el campo antiguo desaparece');
  });

  it('lo ya nuevo se conserva y lo irrecuperable se descarta sin romper nada', () => {
    const fresh = { id: 'n', kind: 'clip', title: 'N', files: { vertical: '/v', horizontal: '/h', otra: '/x' }, durationSec: 1, createdAt: 'x' };
    assert.deepEqual(normalizeOutput(fresh)?.files, { vertical: '/v', horizontal: '/h' });
    for (const bad of [null, 5, 'x', {}, { id: 'a' }, { id: 'a', title: 't' }, { id: 'a', title: 't', kind: 'raro', file: '/x' }, { id: 1, title: 't', file: '/x' }, { id: 'a', title: 't', files: {} }]) {
      assert.equal(normalizeOutput(bad), null, JSON.stringify(bad));
    }
  });

  it('al abrir un data.json de la versión 1 se migra y al guardar queda en la versión 2', () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
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
      const s = new Store(dir, '/salida');
      assert.deepEqual(s.data.outputs.map((o) => [o.id, o.kind, Object.keys(o.files)[0]]), [['a', 'clip', 'vertical'], ['b', 'long', 'long']]);
      assert.equal(s.recoveredFrom, undefined);
      s.save();
      const disk = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')) as { schemaVersion: number; outputs: { file?: string }[] };
      assert.equal(disk.schemaVersion, STORE_VERSION);
      assert.equal(STORE_VERSION, 2);
      assert.ok(disk.outputs.every((o) => o.file === undefined));
    } finally {
      rmDir(dir);
    }
  });
});

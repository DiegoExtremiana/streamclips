import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { OutputItem } from '../shared/types';
import { Store } from '../electron/services/store';
import { ensureFreeSpace, freeBytes, vodBytesEstimate } from '../electron/services/files';
import { installCrashHandlers } from '../electron/app/crash';
import { addDownloadedVod, makeEnv, makeVideo, rmDir, tmpDir } from './helpers';

describe('almacén: copia de seguridad y recuperación', () => {
  it('guarda una copia .bak y, si data.json se daña, recupera la última copia buena', () => {
    const dir = tmpDir();
    const s1 = new Store(dir, '/out');
    s1.data.groups.push({ id: 'g1', name: 'Pokémon', kind: 'theme', section: 'clips', createdAt: 'x' });
    s1.save(1_000_000); // primer guardado: aún no hay nada que copiar
    s1.data.groups.push({ id: 'g2', name: 'Minecraft', kind: 'theme', section: 'clips', createdAt: 'x' });
    s1.save(1_000_000 + 11 * 60_000); // pasa el intervalo: la versión anterior queda en .bak
    assert.ok(fs.existsSync(`${s1.file}.bak`));
    fs.writeFileSync(s1.file, '{ esto no es json');
    const s2 = new Store(dir, '/out');
    assert.equal(s2.restoredFromBackup, true);
    assert.ok(s2.recoveredFrom && fs.existsSync(s2.recoveredFrom), 'se conserva el archivo dañado');
    assert.deepEqual(s2.data.groups.map((g) => g.name), ['Pokémon']);
    s2.save();
    assert.equal(JSON.parse(fs.readFileSync(s2.file, 'utf8')).groups.length, 1, 'el archivo sano sustituye al dañado');
    assert.equal(JSON.parse(fs.readFileSync(`${s2.file}.bak`, 'utf8')).groups.length, 1, 'la copia buena no se pisa con el archivo dañado');
    rmDir(dir);
  });

  it('sin copia buena empieza limpio pero conserva el dañado', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'data.json'), 'basura');
    const s = new Store(dir, '/out');
    assert.equal(s.restoredFromBackup, false);
    assert.deepEqual(s.data.outputs, []);
    assert.ok(fs.existsSync(s.recoveredFrom!));
    rmDir(dir);
  });

  it('las listas de identificadores vistos no crecen sin límite', () => {
    const dir = tmpDir();
    const s = new Store(dir, '/out');
    s.data.channel.seenVodIds = Array.from({ length: 5000 }, (_, i) => `v${i}`);
    s.save();
    const again = new Store(dir, '/out');
    assert.equal(again.data.channel.seenVodIds.length, 2000);
    assert.equal(again.data.channel.seenVodIds.at(-1), 'v4999', 'se conservan los más recientes');
    rmDir(dir);
  });
});

describe('espacio en disco', () => {
  it('ensureFreeSpace avisa con cifras y no bloquea si no se puede medir', () => {
    assert.throws(() => ensureFreeSpace('/x', 10 * 1024 ** 3, 'descargar el VOD', () => 2 * 1024 ** 3), /quedan 2,0 GB y hacen falta unos 10,0 GB/);
    assert.doesNotThrow(() => ensureFreeSpace('/x', 10, 'x', () => null));
    assert.doesNotThrow(() => ensureFreeSpace('/x', 10, 'x', () => 11));
  });
  it('freeBytes mide el disco real, incluso de una carpeta que aún no existe', () => {
    const v = freeBytes(path.join(tmpDir(), 'no', 'existe', 'todavia'));
    assert.ok(v === null || v >= 0);
  });
  it('la estimación crece con la duración (directos de 3–4 h) y tiene un valor por defecto', () => {
    const gb = 1024 ** 3;
    assert.ok(vodBytesEstimate(4 * 3600) > 12 * gb && vodBytesEstimate(4 * 3600) < 16 * gb);
    assert.ok(vodBytesEstimate(3 * 3600) < vodBytesEstimate(4 * 3600));
    assert.equal(vodBytesEstimate(undefined), 6 * gb);
  });
  it('un VOD no se descarga si no cabe, y el motivo se ve en la interfaz', async () => {
    let called = 0;
    const env = makeEnv({ freeBytes: () => 1024 ** 3, download: async () => { called++; throw new Error('no debería llamarse'); } });
    const job = env.ctx.vods.add('https://www.twitch.tv/videos/77', 'Directo', { origin: 'live', durationSec: 4 * 3600 });
    await env.ctx.downloadQueue.idle();
    assert.equal(job.status, 'error');
    assert.match(job.error!, /No hay espacio suficiente.*descargar el VOD/);
    assert.equal(called, 0);
    env.cleanup();
  });
  it('un clip no se monta si no hay espacio y no deja archivos a medias', async () => {
    const env = makeEnv({ freeBytes: () => 100 });
    const src = makeVideo(path.join(env.root, 'src.mp4'), { dur: 6 });
    addDownloadedVod(env, src);
    await assert.rejects(env.ctx.clips.createClip('vod1', { start: 1, end: 3, title: 'x' }), /No hay espacio suficiente/);
    assert.equal(env.ctx.store.data.outputs.length, 0);
    assert.ok(!fs.existsSync(path.join(env.outputDir, 'vertical')) || fs.readdirSync(path.join(env.outputDir, 'vertical')).length === 0);
    env.cleanup();
  });
});

function seedOutput(env: ReturnType<typeof makeEnv>, id: string, title = id): OutputItem {
  const v = path.join(env.outputDir, 'vertical', `${id}.mp4`);
  const h = path.join(env.outputDir, 'horizontal', `${id}.mp4`);
  const t = path.join(env.outputDir, 'miniaturas', `${id}.jpg`);
  for (const f of [v, h, t]) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
  }
  const o: OutputItem = { id, kind: 'clip', title, files: { vertical: v, horizontal: h }, thumbnail: t, durationSec: 5, createdAt: new Date().toISOString() };
  env.ctx.store.data.outputs.push(o);
  env.ctx.store.save();
  return o;
}

describe('borrar vídeos', () => {
  it('borra sus archivos y miniatura, cancela lo pendiente y conserva el registro de lo publicado', () => {
    const env = makeEnv();
    const o = seedOutput(env, 'a');
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    env.ctx.pubs.schedule('a', ['youtube', 'tiktok'], soon);
    env.ctx.store.data.publications.find((p) => p.platform === 'tiktok')!.status = 'published';
    const r = env.ctx.library.removeMany(['a']);
    assert.deepEqual([r.removed, r.errors.length, r.filesLeft.length], [1, 0, 0]);
    for (const f of [...Object.values(o.files), o.thumbnail!]) assert.ok(!fs.existsSync(f), f);
    assert.equal(env.ctx.store.data.outputs.length, 0);
    assert.deepEqual(env.ctx.store.data.publications.map((p) => p.status), ['published']);
    env.cleanup();
  });

  it('no borra lo que se está publicando (ni en el PC ni en la nube) y el resto de la selección sí', () => {
    const env = makeEnv();
    seedOutput(env, 'a');
    seedOutput(env, 'b');
    seedOutput(env, 'c');
    const at = new Date(Date.now() + 3_600_000).toISOString();
    env.ctx.store.data.publications.push({ key: 'a:youtube', outputId: 'a', platform: 'youtube', scheduledAt: at, status: 'publishing' });
    env.ctx.store.data.publications.push({ key: 'b:youtube', outputId: 'b', platform: 'youtube', scheduledAt: at, status: 'scheduled', cloud: { state: 'publishing' } });
    const r = env.ctx.library.removeMany(['a', 'b', 'c', 'c', 'zzz']);
    assert.equal(r.removed, 1);
    assert.deepEqual(r.errors.map((e) => e.id).sort(), ['a', 'b', 'zzz']);
    assert.match(r.errors.find((e) => e.id === 'a')!.reason, /[Ss]e está publicando/);
    assert.deepEqual(env.ctx.store.data.outputs.map((o) => o.id).sort(), ['a', 'b']);
    env.cleanup();
  });

  it('si un archivo no se puede borrar, el vídeo se quita igualmente y se informa de lo que queda', () => {
    const env = makeEnv();
    const o = seedOutput(env, 'a');
    fs.rmSync(o.files.vertical!);
    fs.mkdirSync(path.join(o.files.vertical!, 'dentro'), { recursive: true }); // un directorio no se borra como archivo
    const r = env.ctx.library.removeMany(['a']);
    assert.equal(r.removed, 1);
    assert.deepEqual(r.filesLeft, [o.files.vertical]);
    assert.equal(env.ctx.store.data.outputs.length, 0, 'sin datos a medias');
    assert.ok(!fs.existsSync(o.files.horizontal!));
    env.cleanup();
  });

  it('el VOD de origen nunca se toca', () => {
    const env = makeEnv();
    const src = makeVideo(path.join(env.root, 'src.mp4'), { dur: 3 });
    addDownloadedVod(env, src);
    seedOutput(env, 'a');
    env.ctx.library.removeMany(['a']);
    assert.ok(fs.existsSync(src));
    assert.equal(env.ctx.store.data.vods.length, 1);
    env.cleanup();
  });
});

describe('varias subidas al día', () => {
  const day = (h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };

  it('se pueden programar tantas como se quiera el mismo día, de vídeos distintos', () => {
    const env = makeEnv();
    for (const id of ['a', 'b', 'c', 'd']) seedOutput(env, id);
    const hours = [8, 12, 16, 20];
    ['a', 'b', 'c', 'd'].forEach((id, i) => {
      const r = env.ctx.pubs.schedule(id, ['youtube'], day(hours[i]));
      assert.equal(r.scheduled.length, 1);
      assert.equal(r.warnings, undefined, 'separadas y pocas: sin avisos');
    });
    assert.equal(env.ctx.store.data.publications.filter((p) => p.status === 'scheduled').length, 4);
    env.cleanup();
  });

  it('avisa (sin impedirlo) de dos subidas muy juntas en la misma red', () => {
    const env = makeEnv();
    seedOutput(env, 'a', 'Primero');
    seedOutput(env, 'b');
    env.ctx.pubs.schedule('a', ['youtube', 'tiktok'], day(16, 0));
    const r = env.ctx.pubs.schedule('b', ['youtube'], day(16, 10));
    assert.equal(r.scheduled.length, 1);
    assert.equal(r.warnings?.length, 1);
    assert.match(r.warnings![0], /otra subida a YouTube.*«Primero»/);
    const other = env.ctx.pubs.schedule('b', ['instagram'], day(16, 10));
    assert.equal(other.warnings, undefined, 'otra red no cuenta');
    env.cleanup();
  });

  it('avisa si en un día hay más subidas a YouTube de las que permite la cuota gratuita', () => {
    const env = makeEnv();
    let last: ReturnType<typeof env.ctx.pubs.schedule> | undefined;
    for (let i = 0; i < 7; i++) {
      seedOutput(env, `v${i}`);
      last = env.ctx.pubs.schedule(`v${i}`, ['youtube'], day(6 + i * 2));
    }
    assert.ok(last!.warnings?.some((w) => /7 subidas a YouTube.*unas 6 al día/.test(w)), JSON.stringify(last!.warnings));
    env.cleanup();
  });

  it('el mismo vídeo sigue sin poder publicarse dos veces en la misma red', () => {
    const env = makeEnv();
    seedOutput(env, 'a');
    env.ctx.pubs.schedule('a', ['youtube'], day(8));
    env.ctx.store.data.publications[0].status = 'published';
    const r = env.ctx.pubs.schedule('a', ['youtube'], day(20));
    assert.equal(r.scheduled.length, 0);
    assert.match(r.skipped[0].reason, /ya está publicado/);
    env.cleanup();
  });
});

describe('errores no controlados', () => {
  it('se anotan con su detalle y no tumban el proceso', () => {
    const proc = new EventEmitter();
    const lines: string[] = [];
    installCrashHandlers(proc as unknown as Parameters<typeof installCrashHandlers>[0], () => ({ error: (m) => void lines.push(m) }));
    proc.emit('uncaughtException', new Error('boom'));
    proc.emit('unhandledRejection', 'motivo suelto');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Error no controlado: boom/);
    assert.match(lines[1], /Promesa rechazada sin controlar: motivo suelto/);
  });
  it('si aún no hay registro, escribe en stderr sin fallar', () => {
    const proc = new EventEmitter();
    installCrashHandlers(proc as unknown as Parameters<typeof installCrashHandlers>[0], () => undefined);
    assert.doesNotThrow(() => proc.emit('uncaughtException', new Error('antes del registro')));
  });
});

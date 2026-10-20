import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { OutputItem, Platform } from '../shared/types';
import { MASKED_SECRET } from '../shared/types';
import { Scheduler } from '../electron/domain/scheduler';
import { NotConnectedError, defaultPublishers, type Publisher, type Publishers } from '../electron/domain/publishers';
import { Logger } from '../electron/services/logger';
import { Store } from '../electron/services/store';
import { silentNotifier } from '../electron/domain/notifier';
import { PublicationService } from '../electron/domain/publications';
import { probe } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import {
  RecordingNotifier, addDownloadedVod, addOutput, fakeYtdlp, makeEnv, makeVideo, noCipher, rmDir, sleep, tmpDir,
  type TestEnv,
} from './helpers';

const envs: TestEnv[] = [];
const mkEnv = (extra: Parameters<typeof makeEnv>[0] = {}) => {
  const e = makeEnv(extra);
  envs.push(e);
  return e;
};
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

// ───────────────────────────── SettingsService ─────────────────────────────
describe('SettingsService', () => {
  it('el secreto de Twitch se guarda cifrado, nunca sale al exterior y el valor enmascarado no lo pisa', () => {
    const e = mkEnv();
    e.ctx.settings.set({ twitch: { clientId: ' cid ', clientSecret: 'super-secreto', login: '@Don_Diegons' } });
    const pub = e.ctx.settings.get();
    assert.equal(pub.twitch.clientSecret, MASKED_SECRET);
    assert.equal(pub.twitch.login, 'don_diegons');
    assert.equal(pub.twitch.clientId, 'cid');
    const onDisk = fs.readFileSync(path.join(e.userData, 'data.json'), 'utf8');
    assert.ok(!onDisk.includes('super-secreto'), 'el secreto no debe estar en claro en el disco');
    assert.match(onDisk, /"clientSecret": "enc:/);
    // reenviar lo que vio la interfaz (máscara) no destruye el secreto
    e.ctx.settings.set({ twitch: { clientSecret: MASKED_SECRET } });
    assert.equal(e.ctx.settings.twitchCreds().clientSecret, 'super-secreto');
    // vaciarlo sí lo borra
    e.ctx.settings.set({ twitch: { clientSecret: '' } });
    assert.equal(e.ctx.settings.get().twitch.clientSecret, '');
  });

  it('sin cifrado del sistema el secreto sigue sin guardarse en texto plano legible', () => {
    const e = mkEnv({ cipher: noCipher });
    e.ctx.settings.set({ twitch: { clientSecret: 'super-secreto' } });
    assert.ok(!fs.readFileSync(path.join(e.userData, 'data.json'), 'utf8').includes('super-secreto'));
    assert.equal(e.ctx.settings.twitchCreds().clientSecret, 'super-secreto');
  });

  it('es atómico: si una parte del parche es inválida no se aplica nada', () => {
    const e = mkEnv();
    const before = JSON.stringify(e.ctx.settings.get());
    assert.throws(
      () => e.ctx.settings.set({ twitch: { clientId: 'nuevo', login: 'no válido!' }, ffmpegPath: '' }),
      /nombre de canal/,
    );
    assert.equal(JSON.stringify(e.ctx.settings.get()), before);
    assert.throws(() => e.ctx.settings.set({ twitch: { clientId: 'nuevo' }, outputDir: 'relativa/ruta' }), /absoluta/);
    assert.equal(e.ctx.settings.get().twitch.clientId, '');
  });

  it('valida la carpeta de salida: absoluta, creable, y quita las comillas de Windows', () => {
    const e = mkEnv();
    assert.throws(() => e.ctx.settings.set({ outputDir: '' }), /vacía/);
    assert.throws(() => e.ctx.settings.set({ outputDir: 'relativa' }), /absoluta/);
    const target = path.join(e.root, 'nueva', 'carpeta');
    const s = e.ctx.settings.set({ outputDir: `"${target}"` });
    assert.equal(s.outputDir, target);
    assert.ok(fs.statSync(target).isDirectory());
    // una ruta imposible (un archivo en medio) falla con mensaje claro
    const file = path.join(e.root, 'archivo.txt');
    fs.writeFileSync(file, 'x');
    assert.throws(() => e.ctx.settings.set({ outputDir: path.join(file, 'dentro') }), /No se puede escribir/);
  });

  it('valida las rutas de herramientas: absolutas, existentes y que sean archivos', () => {
    const e = mkEnv();
    assert.throws(() => e.ctx.settings.set({ ffmpegPath: 'ffmpeg.exe' }), /absoluta/);
    assert.throws(() => e.ctx.settings.set({ ytdlpPath: '/no/existe/yt-dlp' }), /No existe yt-dlp/);
    assert.throws(() => e.ctx.settings.set({ ytdlpPath: e.root }), /No existe yt-dlp/); // es una carpeta
    const s = e.ctx.settings.set({ ytdlpPath: `"${fakeYtdlp()}"` });
    assert.equal(s.ytdlpPath, fakeYtdlp());
    assert.equal(e.ctx.tools().ytdlp, fakeYtdlp());
    assert.equal(e.ctx.settings.set({ ytdlpPath: '' }).ytdlpPath, '');
    assert.equal(e.ctx.tools().ytdlp, 'yt-dlp');
  });

  it('login vacío borra el canal; sobrevive a un reinicio', () => {
    const e = mkEnv();
    e.ctx.settings.set({ twitch: { login: 'abc', clientId: 'x' } });
    const again = makeEnv({}, e.root); // mismo disco
    assert.equal(again.ctx.settings.get().twitch.login, 'abc');
    assert.equal(again.ctx.settings.set({ twitch: { login: '' } }).twitch.login, '');
  });
});

// ───────────────────────────── VodService ─────────────────────────────
describe('VodService', () => {
  const URL1 = 'https://www.twitch.tv/videos/111';

  it('rechaza URLs no válidas sin crear nada en la cola', () => {
    const e = mkEnv();
    for (const bad of ['', '--exec rm -rf /', 'file:///etc/passwd', 'hola', 'https://localhost/x']) {
      assert.throws(() => e.ctx.vods.add(bad), /URL no es válida/, bad);
    }
    assert.equal(e.ctx.store.data.vods.length, 0);
  });

  it('descarga con el flujo en cola -> descargando -> descargado y avisa a la interfaz', async () => {
    const calls: string[] = [];
    const e = mkEnv({
      download: async (_t, url, outDir, onProgress) => {
        calls.push(url);
        for (const p of [10, 50, 100]) onProgress(p);
        return { title: 'Título real', filePath: path.join(outDir, 'x.mp4') };
      },
    });
    const job = e.ctx.vods.add(URL1, 'Título provisional');
    assert.equal(job.status, 'queued');
    await e.ctx.downloadQueue.idle();
    assert.equal(job.status, 'downloaded');
    assert.equal(job.title, 'Título real');
    assert.equal(job.progress, 100);
    assert.equal(job.filePath, path.join(e.outputDir, 'vods', 'x.mp4'));
    assert.deepEqual([...new Set(e.notifier.vodEvents.map((v) => v.status))], ['downloading', 'downloaded']);
    // persistido
    assert.equal(JSON.parse(fs.readFileSync(path.join(e.userData, 'data.json'), 'utf8')).vods[0].status, 'downloaded');
    assert.deepEqual(calls, [URL1]);
  });

  it('el mismo VOD no se descarga dos veces, pero tras un error se puede reintentar', async () => {
    let n = 0;
    const e = mkEnv({
      download: async (_t, _u, outDir) => {
        n++;
        if (n === 1) throw new Error('403 Forbidden');
        return { title: 't', filePath: path.join(outDir, 'a.mp4') };
      },
    });
    const a = e.ctx.vods.add(URL1);
    const b = e.ctx.vods.add(`${URL1}#t=10`); // mismo VOD (el fragmento no cuenta)
    assert.equal(a.id, b.id);
    await e.ctx.downloadQueue.idle();
    assert.equal(a.status, 'error');
    assert.match(a.error!, /403/);
    const retry = e.ctx.vods.add(URL1);
    assert.notEqual(retry.id, a.id);
    await e.ctx.downloadQueue.idle();
    assert.equal(retry.status, 'downloaded');
    assert.equal(n, 2);
  });

  it('las descargas van de una en una', async () => {
    let running = 0;
    let max = 0;
    const e = mkEnv({
      download: async (_t, url, outDir) => {
        running++;
        max = Math.max(max, running);
        await sleep(20);
        running--;
        return { title: url, filePath: path.join(outDir, 'a.mp4') };
      },
    });
    for (const i of [1, 2, 3]) e.ctx.vods.add(`https://www.twitch.tv/videos/${i}`);
    await e.ctx.downloadQueue.idle();
    assert.equal(max, 1);
    assert.ok(e.ctx.store.data.vods.every((v) => v.status === 'downloaded'));
  });

  it('limita los avisos de progreso (no más de uno por cada 1 %)', async () => {
    const e = mkEnv({
      download: async (_t, _u, outDir, onProgress) => {
        for (let i = 0; i < 2000; i++) onProgress(i / 20); // 2000 actualizaciones de 0 a 100
        return { title: 't', filePath: path.join(outDir, 'a.mp4') };
      },
    });
    e.ctx.vods.add(URL1);
    await e.ctx.downloadQueue.idle();
    assert.ok(e.notifier.vodEvents.length <= 110, `eventos: ${e.notifier.vodEvents.length}`);
  });

  it('al arrancar, lo que estaba descargándose se marca como error (no se queda colgado)', () => {
    const e = mkEnv();
    e.ctx.store.data.vods.push(
      { id: 'a', url: 'u1', title: '', status: 'downloading', progress: 40, createdAt: 'x' },
      { id: 'b', url: 'u2', title: '', status: 'queued', progress: 0, createdAt: 'x' },
      { id: 'c', url: 'u3', title: '', status: 'downloaded', progress: 100, filePath: '/x', createdAt: 'x' },
    );
    assert.equal(e.ctx.vods.recoverInterrupted(), 2);
    assert.deepEqual(e.ctx.store.data.vods.map((v) => v.status), ['error', 'error', 'downloaded']);
    assert.match(e.ctx.store.data.vods[0].error!, /interrumpió/);
    assert.equal(e.ctx.vods.recoverInterrupted(), 0);
  });
});

// ───────────────────────────── ClipService (ffmpeg real) ─────────────────────────────
describe('ClipService', () => {
  const tools = resolveToolPaths('', '');

  function withVod(dur = 12) {
    const e = mkEnv();
    const src = makeVideo(path.join(e.outputDir, 'vods', 'src.mp4'), { w: 1280, h: 720, dur });
    const vod = addDownloadedVod(e, src);
    return { e, vod, src };
  }

  it('un clip se crea con sus dos versiones (vertical y horizontal), validadas, en su carpeta y registradas', async () => {
    const { e, vod } = withVod();
    const a = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Épico ñ' });
    const b = await e.ctx.clips.createClip(vod.id, { start: 2, end: 6, title: 'Reacción' });
    assert.equal(a.kind, 'clip');
    assert.deepEqual(Object.keys(a.files).sort(), ['horizontal', 'vertical']);
    for (const [k, w, hh] of [['vertical', 1080, 1920], ['horizontal', 1920, 1080]] as const) {
      const f = a.files[k]!;
      const info = await probe(tools, f);
      assert.deepEqual([info.width, info.height], [w, hh], k);
      assert.ok(Math.abs(info.durationSec - 4) < 1);
      assert.equal(path.basename(path.dirname(f)), k);
      assert.ok(f.startsWith(e.outputDir));
    }
    assert.ok(a.thumbnail && fs.existsSync(a.thumbnail), 'miniatura horizontal');
    assert.equal(e.ctx.store.data.outputs.length, 2);
    assert.equal(e.ctx.store.data.outputs[0].id, b.id); // el último, primero
    assert.ok(e.notifier.changes >= 2);
  });

  it('se puede pedir una sola versión', async () => {
    const { e, vod } = withVod();
    const v = await e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 1, end: 5, title: 'Solo V' });
    assert.deepEqual(Object.keys(v.files), ['vertical']);
    const h = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 1, end: 5, title: 'Solo H' });
    assert.deepEqual(Object.keys(h.files), ['horizontal']);
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'cuadrado' as never, start: 1, end: 5, title: 'x' }), /"both"/);
  });

  it('si falla una de las dos versiones no queda ninguna (ni archivos sueltos ni registro)', async () => {
    const { e, vod } = withVod();
    // ffmpeg envuelto: todo normal salvo el render vertical, que falla
    const bin = path.join(e.root, 'wrapbin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\ncase "$*" in *"ih*9/16"*) echo "fallo simulado" >&2; exit 1;; esac\nexec ffmpeg "$@"\n', { mode: 0o755 });
    fs.symlinkSync(execFileSync('which', ['ffprobe']).toString().trim(), path.join(bin, 'ffprobe'));
    e.ctx.settings.set({ ffmpegPath: path.join(bin, 'ffmpeg') });
    await assert.rejects(e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Roto', cropX: 0.5 }), /fallo simulado/);
    assert.equal(e.ctx.store.data.outputs.length, 0);
    for (const d of ['horizontal', 'vertical']) {
      const dir = path.join(e.outputDir, d);
      assert.deepEqual(fs.existsSync(dir) ? fs.readdirSync(dir) : [], [], `sin restos en ${d}`);
    }
    // con la herramienta arreglada el mismo clip se crea sin problema
    e.ctx.settings.set({ ffmpegPath: '' });
    assert.equal((await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Roto' })).kind, 'clip');
  });

  it('por defecto el clip vertical lleva dos ventanas (cámara arriba, pantalla debajo); con cropX explícito, una sola columna', async () => {
    const { e, vod } = withVod();
    const dflt = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Dos ventanas' });
    assert.equal(dflt.layout?.windows.length, 2);
    assert.equal(dflt.layout?.preset, 'dos-camara-arriba');
    assert.ok(dflt.layout!.windows[0].dst.y < dflt.layout!.windows[1].dst.y, 'la cámara va arriba');
    const crop = await e.ctx.clips.createClip(vod.id, { start: 1, end: 5, title: 'Columna', cropX: 0.2 });
    assert.equal(crop.layout, undefined);
  });

  it('rechaza clips no válidos sin renderizar ni registrar nada', async () => {
    const { e, vod } = withVod();
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 5, end: 2, title: 't' }), /Clip no válido: el fin/);
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 500, title: 't' }), /más de 3 minutos/);
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 5, title: 't', cropX: 3 }), /cropX/);
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 10, end: 20, title: 't' }), /después del final del VOD/);
    await assert.rejects(e.ctx.clips.createClip(vod.id, null as never), /no es un objeto/);
    assert.equal(e.ctx.store.data.outputs.length, 0);
    assert.ok(!fs.existsSync(path.join(e.outputDir, 'vertical')), 'no debe quedar ni la carpeta');
  });

  it('errores claros si el VOD no existe, no está descargado o se ha borrado del disco', async () => {
    const { e, vod, src } = withVod();
    const spec = { kind: 'horizontal', start: 0, end: 3, title: 't' } as const;
    await assert.rejects(e.ctx.clips.createClip('no-existe', spec), /El VOD no existe/);
    e.ctx.store.data.vods.unshift({ id: 'pend', url: 'u', title: '', status: 'downloading', progress: 5, createdAt: 'x' });
    await assert.rejects(e.ctx.clips.createClip('pend', spec), /todavía no está descargado/);
    fs.rmSync(src);
    vod.origin = 'clip'; // un clip de Twitch no se puede volver a descargar como un directo
    await assert.rejects(e.ctx.clips.createClip(vod.id, spec), /ya no está en su sitio/);
    assert.equal(e.ctx.store.data.outputs.length, 0);
  });

  it('un origen corrupto falla sin dejar basura ni registros', async () => {
    const e = mkEnv();
    const bad = path.join(e.outputDir, 'vods', 'bad.mp4');
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, 'no soy un vídeo');
    const vod = addDownloadedVod(e, bad, 'bad');
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 3, title: 't' }));
    assert.equal(e.ctx.store.data.outputs.length, 0);
  });

  it('si el render no supera la validación se borra el archivo y no se registra', async () => {
    const e = mkEnv();
    const src = makeVideo(path.join(e.outputDir, 'vods', 'src.mp4'), { w: 640, h: 360, dur: 6 });
    const vod = addDownloadedVod(e, src);
    // ffmpeg "falso" que escribe basura y dice que todo fue bien; ffprobe real enlazado al lado
    const bin = path.join(e.root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'ffmpeg'), '#!/bin/sh\nfor last; do :; done\necho basura > "$last"\n', { mode: 0o755 });
    const realProbe = (await import('node:child_process')).execFileSync('which', ['ffprobe']).toString().trim();
    fs.symlinkSync(realProbe, path.join(bin, 'ffprobe'));
    e.ctx.settings.set({ ffmpegPath: path.join(bin, 'ffmpeg') });
    await assert.rejects(e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 3, title: 'bueno' }));
    assert.equal(e.ctx.store.data.outputs.length, 0);
    const left = fs.existsSync(path.join(e.outputDir, 'horizontal')) ? fs.readdirSync(path.join(e.outputDir, 'horizontal')) : [];
    assert.deepEqual(left, [], 'no debe quedar el archivo que no pasó la validación');
  });

  it('createLong monta los tramos y valida la duración total', async () => {
    const { e, vod } = withVod();
    const o = await e.ctx.clips.createLong(vod.id, { title: 'Resumen', segments: [{ start: 0, end: 3 }, { start: 6, end: 9 }] });
    assert.equal(o.kind, 'long');
    const info = await probe(tools, o.files.long!);
    assert.deepEqual([info.width, info.height], [1920, 1080]);
    assert.ok(Math.abs(info.durationSec - 6) < 1);
    await assert.rejects(e.ctx.clips.createLong(vod.id, { title: 'x', segments: [] }), /no tiene tramos/);
    await assert.rejects(e.ctx.clips.createLong(vod.id, { title: 'x', segments: [{ start: 0, end: 99 }] }), /después del final/);
  });

  it('applyPlan: lo válido se crea, lo inválido se explica y nada se interrumpe', async () => {
    const { e, vod } = withVod();
    const plan = {
      clips: [
        { kind: 'vertical', start: 0, end: 3, title: 'V1' },
        { kind: 'horizontal', start: 3, end: 6, title: 'H1' },
        { kind: 'vertical', start: 50, end: 60, title: 'Fuera' },
      ],
      long: { title: 'Largo', segments: [{ start: 0, end: 4 }, { start: 6, end: 10 }] },
    };
    const r = await e.ctx.clips.applyPlan(vod.id, JSON.stringify(plan));
    assert.equal(r.created.length, 3);
    assert.deepEqual(r.created.map((o) => o.kind).sort(), ['clip', 'clip', 'long']);
    assert.deepEqual(r.created.map((o) => Object.keys(o.files).sort().join('+')).sort(), ['horizontal', 'long', 'vertical']);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /clip 3.*después del final/);
    await assert.rejects(e.ctx.clips.applyPlan(vod.id, 'no es json'), /JSON no válido/);
    await assert.rejects(e.ctx.clips.applyPlan('nada', '{"clips":[]}'), /El VOD no existe/);
  });

  it('peticiones simultáneas se renderizan de una en una y terminan todas bien', async () => {
    const { e, vod } = withVod();
    const all = await Promise.all(
      [0, 1, 2, 3].map((i) => e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: i, end: i + 2, title: 'mismo título' })),
    );
    assert.equal(new Set(all.map((o) => o.files.horizontal)).size, 4, 'mismo título, archivos distintos');
    assert.ok(all.every((o) => fs.existsSync(o.files.horizontal!)));
  });
});

// ───────────────────────────── PublicationService ─────────────────────────────
describe('PublicationService', () => {
  const setup = (now = Date.now()) => {
    const e = mkEnv();
    addOutput(e, 'o1');
    const n = new RecordingNotifier();
    const svc = new PublicationService(e.ctx.store, n, () => now);
    return { e, svc, n, now };
  };
  const at = (now: number, ms: number) => new Date(now + ms).toISOString();

  it('programa una publicación por red con clave única vídeo:red', () => {
    const { svc, now, n } = setup();
    const r = svc.schedule('o1', ['youtube', 'tiktok'], at(now, 3600_000));
    assert.deepEqual(r.scheduled.map((p) => p.key), ['o1:youtube', 'o1:tiktok']);
    assert.deepEqual(r.skipped, []);
    assert.ok(r.scheduled.every((p) => p.status === 'scheduled'));
    assert.ok(n.changes >= 1);
  });

  it('reprogramar no duplica: actualiza la misma publicación', () => {
    const { svc, now, e } = setup();
    svc.schedule('o1', ['youtube'], at(now, 3600_000));
    const r = svc.schedule('o1', ['youtube'], at(now, 7200_000));
    assert.equal(e.ctx.store.data.publications.length, 1);
    assert.equal(r.scheduled[0].scheduledAt, at(now, 7200_000));
  });

  it('lo ya publicado o publicándose se omite y se explica; lo fallido se puede reintentar', () => {
    const { svc, now, e } = setup();
    svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 1000));
    const pubs = e.ctx.store.data.publications;
    pubs[0].status = 'published';
    pubs[1].status = 'publishing';
    pubs[2].status = 'failed';
    pubs[2].note = 'boom';
    const r = svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 5000));
    assert.deepEqual(r.skipped.map((s) => s.platform), ['youtube', 'tiktok']);
    assert.match(r.skipped[0].reason, /ya está publicado/);
    assert.match(r.skipped[1].reason, /se está publicando/);
    assert.equal(pubs[0].status, 'published'); // intacto
    assert.equal(pubs[2].status, 'scheduled');
    assert.equal(pubs[2].note, undefined);
  });

  it('valida vídeo, fecha, redes y no acepta horas pasadas (con 1 minuto de cortesía)', () => {
    const { svc, now } = setup();
    assert.throws(() => svc.schedule('nada', ['youtube'], at(now, 1000)), /El vídeo no existe/);
    assert.throws(() => svc.schedule('o1', ['youtube'], 'ayer'), /no válidas/);
    assert.throws(() => svc.schedule('o1', ['youtube'], at(now, -3600_000)), /ya ha pasado/);
    assert.doesNotThrow(() => svc.schedule('o1', ['youtube'], at(now, -30_000)));
    assert.throws(() => svc.schedule('o1', [], at(now, 1000)), /al menos una red/);
    assert.throws(() => svc.schedule('o1', ['facebook' as Platform], at(now, 1000)), /no reconocida/);
  });

  it('redes repetidas en la petición se cuentan una sola vez', () => {
    const { svc, now } = setup();
    const r = svc.schedule('o1', ['youtube', 'youtube', 'youtube'], at(now, 1000));
    assert.equal(r.scheduled.length, 1);
  });

  it('cancel solo quita lo pendiente o fallido', () => {
    const { svc, now, e } = setup();
    svc.schedule('o1', ['youtube', 'tiktok', 'instagram'], at(now, 1000));
    const pubs = e.ctx.store.data.publications;
    pubs[1].status = 'published';
    pubs[2].status = 'failed';
    assert.equal(svc.cancel('o1:youtube'), true);
    assert.equal(svc.cancel('o1:tiktok'), false);
    assert.equal(svc.cancel('o1:instagram'), true);
    assert.equal(svc.cancel('no:existe'), false);
    assert.deepEqual(e.ctx.store.data.publications.map((p) => p.key), ['o1:tiktok']);
  });
});

// ───────────────────────────── Scheduler ─────────────────────────────
describe('Scheduler', () => {
  function setup(publishers: Partial<Publishers>, now = () => Date.now()) {
    const e = mkEnv();
    addOutput(e, 'o1');
    const log = new Logger(path.join(e.root, 'l'));
    const sched = new Scheduler(e.ctx.store, silentNotifier, log, { ...defaultPublishers, ...publishers }, 3_600_000, now);
    const add = (platform: Platform, ms = -1000, status: 'scheduled' | 'publishing' = 'scheduled') =>
      e.ctx.store.data.publications.push({
        key: `o1:${platform}`, outputId: 'o1', platform, status,
        scheduledAt: new Date(Date.now() + ms).toISOString(),
      });
    const get = (platform: Platform) => e.ctx.store.data.publications.find((p) => p.platform === platform)!;
    return { e, sched, add, get };
  }
  const counting = (impl?: (o: OutputItem) => Promise<void>) => {
    const seen: string[] = [];
    const pub: Publisher = { publish: async (o) => { seen.push(o.id); await impl?.(o); } };
    return { pub, seen };
  };

  it('publica lo vencido una sola vez, aunque haya muchas pasadas', async () => {
    const yt = counting();
    const { sched, add, get } = setup({ youtube: yt.pub });
    add('youtube');
    await sched.tick();
    await sched.tick();
    await sched.tick();
    assert.equal(get('youtube').status, 'published');
    assert.deepEqual(yt.seen, ['o1']);
  });

  it('no toca lo que aún no ha llegado su hora', async () => {
    const yt = counting();
    const { sched, add, get } = setup({ youtube: yt.pub });
    add('youtube', 3600_000);
    await sched.tick();
    assert.equal(get('youtube').status, 'scheduled');
    assert.equal(yt.seen.length, 0);
  });

  it('usa el reloj inyectado: publica exactamente cuando llega la hora', async () => {
    let now = 1_000_000;
    const yt = counting();
    const { sched, e } = setup({ youtube: yt.pub }, () => now);
    e.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'scheduled', scheduledAt: new Date(now + 60_000).toISOString() });
    await sched.tick();
    assert.equal(yt.seen.length, 0);
    now += 60_000;
    await sched.tick();
    assert.equal(yt.seen.length, 1);
  });

  it('un error real marca fallida con el motivo y NO se reintenta sola', async () => {
    let calls = 0;
    const { sched, add, get } = setup({
      tiktok: { publish: async () => { calls++; throw new Error('TikTok: spam_risk_too_many_posts'); } },
    });
    add('tiktok');
    await sched.tick();
    await sched.tick();
    assert.equal(get('tiktok').status, 'failed');
    assert.match(get('tiktok').note!, /spam_risk/);
    assert.equal(calls, 1);
  });

  it('red no conectada: queda en espera con nota y se publica en cuanto se conecta', async () => {
    let connected = false;
    const seen: string[] = [];
    const { sched, add, get } = setup({
      instagram: {
        publish: async (o) => {
          if (!connected) throw new NotConnectedError('Instagram aún no está conectado');
          seen.push(o.id);
        },
      },
    });
    add('instagram');
    await sched.tick();
    assert.equal(get('instagram').status, 'scheduled');
    assert.match(get('instagram').note!, /En espera/);
    connected = true;
    await sched.tick();
    assert.equal(get('instagram').status, 'published');
    assert.deepEqual(seen, ['o1']);
  });

  it('las publicaciones por defecto (sin conectores reales) se quedan en espera, no fallan', async () => {
    const { sched, add, get } = setup({});
    add('youtube');
    await sched.tick();
    assert.equal(get('youtube').status, 'scheduled');
    assert.match(get('youtube').note!, /aún no está conectado/);
  });

  it('si el vídeo ya no existe, falla con un motivo claro', async () => {
    const yt = counting();
    const { sched, add, get, e } = setup({ youtube: yt.pub });
    add('youtube');
    e.ctx.store.data.outputs = [];
    await sched.tick();
    assert.equal(get('youtube').status, 'failed');
    assert.match(get('youtube').note!, /ya no existe/);
    assert.equal(yt.seen.length, 0);
  });

  it('dos pasadas simultáneas no publican dos veces', async () => {
    const yt = counting(() => sleep(60));
    const { sched, add } = setup({ youtube: yt.pub });
    add('youtube');
    await Promise.all([sched.tick(), sched.tick(), sched.tick()]);
    assert.equal(yt.seen.length, 1);
  });

  it('el estado "publicando" se guarda en disco ANTES de llamar a la red', async () => {
    let statusOnDiskDuringCall = '';
    const { sched, add, e } = setup({
      youtube: {
        publish: async () => {
          const disk = new Store(e.userData, e.outputDir);
          statusOnDiskDuringCall = disk.data.publications[0].status;
        },
      },
    });
    add('youtube');
    e.ctx.store.save();
    await sched.tick();
    assert.equal(statusOnDiskDuringCall, 'publishing');
  });

  it('tras un cierre a mitad de publicación, al arrancar se marca fallida y no se reenvía', async () => {
    const yt = counting();
    const { sched, add, get } = setup({ youtube: yt.pub });
    add('youtube', -1000, 'publishing'); // se quedó así al cerrar la app
    assert.equal(sched.recoverInterrupted(), 1);
    await sched.tick();
    assert.equal(get('youtube').status, 'failed');
    assert.match(get('youtube').note!, /Interrumpida/);
    assert.equal(yt.seen.length, 0, 'jamás se reintenta automáticamente');
  });

  it('start() publica lo vencido y el temporizador sigue revisando; stop() lo detiene', async () => {
    const yt = counting();
    const e = mkEnv();
    addOutput(e, 'o1');
    const sched = new Scheduler(e.ctx.store, silentNotifier, new Logger(path.join(e.root, 'l')), { ...defaultPublishers, youtube: yt.pub }, 25);
    e.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'scheduled', scheduledAt: new Date(Date.now() - 5).toISOString() });
    sched.start();
    await sleep(80);
    assert.equal(yt.seen.length, 1);
    // algo programado más tarde lo recoge el temporizador
    e.ctx.store.data.publications.push({ key: 'o1:tiktok', outputId: 'o1', platform: 'tiktok', status: 'scheduled', scheduledAt: new Date(Date.now() + 40).toISOString() });
    sched.stop();
    await sleep(120);
    assert.equal(e.ctx.store.data.publications[1].status, 'scheduled', 'detenido: ya no publica');
  });
});

describe('arranque sin tocar disco ajeno', () => {
  it('AppContext.start recupera descargas y publicaciones interrumpidas', () => {
    const root = tmpDir();
    try {
      const e1 = makeEnv({}, root);
      addOutput(e1, 'o1');
      e1.ctx.store.data.vods.push({ id: 'v', url: 'u', title: '', status: 'downloading', progress: 3, createdAt: 'x' });
      e1.ctx.store.data.publications.push({ key: 'o1:youtube', outputId: 'o1', platform: 'youtube', status: 'publishing', scheduledAt: new Date().toISOString() });
      e1.ctx.store.save();
      const e2 = makeEnv({}, root); // "reinicio"
      e2.ctx.start();
      e2.ctx.stop();
      assert.equal(e2.ctx.store.data.vods[0].status, 'error');
      assert.equal(e2.ctx.store.data.publications[0].status, 'failed');
    } finally {
      rmDir(root);
    }
  });
});

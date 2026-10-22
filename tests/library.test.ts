import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ClipFormat } from '../shared/types';
import { mediaUrl, parseMediaUrl } from '../shared/media';
import { Store } from '../electron/services/store';
import { probe } from '../electron/services/ffmpeg';
import { planMediaResponse, resolveMedia } from '../electron/app/media';
import { addDownloadedVod, dominantColor, makeEnv, makeVideo, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

let srcRoot: string;
let split: string;
before(() => {
  srcRoot = tmpDir();
  split = makeVideo(path.join(srcRoot, 'split.mp4'), { split: true, dur: 12 });
});
after(() => rmDir(srcRoot));

async function withClip(cropX = 0, kind: ClipFormat = 'both') {
  const env = makeEnv();
  envs.push(env);
  const vod = addDownloadedVod(env, split);
  const clip = await env.ctx.clips.createClip(vod.id, { kind, start: 2, end: 6, title: 'Clip', cropX });
  return { env, vod, clip };
}

const TOOLS = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: 'yt-dlp' };

describe('Biblioteca: miniaturas automáticas', () => {
  it('cada clip nuevo guarda su tramo y su encuadre, y una miniatura 16:9 igual para todos', async () => {
    const { clip } = await withClip(0);
    assert.deepEqual([clip.start, clip.end, clip.cropX], [2, 6, 0]);
    assert.ok(clip.thumbnail && fs.existsSync(clip.thumbnail));
    const t = await probe(TOOLS, clip.thumbnail!);
    assert.deepEqual([t.width, t.height], [1280, 720]); // portada con estilo
  });

  it('un clip solo vertical también tiene miniatura (de su versión vertical)', async () => {
    const { clip } = await withClip(0, 'vertical');
    const t = await probe(TOOLS, clip.thumbnail!);
    assert.deepEqual([t.width, t.height], [360, 640]);
  });

  it('backfill crea las miniaturas que faltan (clips antiguos)', async () => {
    const { env, clip } = await withClip();
    fs.rmSync(clip.thumbnail!);
    const n = await env.ctx.library.backfillThumbnails();
    assert.equal(n, 1);
    assert.ok(fs.existsSync(env.ctx.store.data.outputs[0].thumbnail!));
  });
});

describe('Biblioteca: nombre', () => {
  it('renombra, recorta espacios y rechaza vacíos o demasiado largos', async () => {
    const { env, clip } = await withClip();
    assert.equal(env.ctx.library.rename(clip.id, '  Nuevo nombre ').title, 'Nuevo nombre');
    assert.throws(() => env.ctx.library.rename(clip.id, '   '), /vacío/);
    assert.throws(() => env.ctx.library.rename(clip.id, 'x'.repeat(121)), /120/);
    assert.throws(() => env.ctx.library.rename('nope', 'a'), /no existe/);
    assert.equal(env.ctx.store.data.outputs[0].title, 'Nuevo nombre');
  });
});

describe('Biblioteca: datos de YouTube', () => {
  function two() {
    const env = makeEnv();
    envs.push(env);
    const base = { durationSec: 5, createdAt: 'x' };
    env.ctx.store.data.outputs.push({ ...base, id: 'l', kind: 'long', title: 'Largo', files: { long: '/x' } }, { ...base, id: 'c', kind: 'clip', title: 'Clip', files: { vertical: '/x' } });
    return env;
  }
  it('guarda nombre, descripción, lista y visibilidad de un vídeo largo (con espacios recortados)', () => {
    const { ctx } = two();
    const o = ctx.library.setMeta('l', { title: ' Nuevo ', description: 'Hola\n\n  ', playlist: '  Road to Master ', visibility: 'public' });
    assert.deepEqual([o.title, o.description, o.playlist, o.visibility], ['Nuevo', 'Hola', 'Road to Master', 'public']);
    const cleared = ctx.library.setMeta('l', { description: '', playlist: '   ' });
    assert.deepEqual([cleared.description, cleared.playlist, cleared.visibility], [undefined, undefined, 'public']);
  });
  it('un campo no enviado no se toca', () => {
    const { ctx } = two();
    ctx.library.setMeta('l', { description: 'D', visibility: 'public' });
    ctx.library.setMeta('l', { playlist: 'P' });
    const o = ctx.store.data.outputs[0];
    assert.deepEqual([o.description, o.playlist, o.visibility, o.title], ['D', 'P', 'public', 'Largo']);
  });
  it('si un campo no es válido no se guarda NINGUNO (ni el nombre)', () => {
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
    ] as [Record<string, unknown>, RegExp][]) {
      assert.throws(() => ctx.library.setMeta('l', meta as never), re, JSON.stringify(meta).slice(0, 60));
    }
    assert.equal(JSON.stringify(ctx.store.data.outputs[0]), before);
  });
  it('los clips admiten nombre (hasta 120), descripción, lista y visibilidad (salen como Shorts)', () => {
    const { ctx } = two();
    assert.equal(ctx.library.setMeta('c', { title: 'x'.repeat(120) }).title.length, 120);
    const c = ctx.library.setMeta('c', { description: 'Mi clip', playlist: 'Shorts', visibility: 'public' });
    assert.deepEqual([c.description, c.playlist, c.visibility], ['Mi clip', 'Shorts', 'public']);
    assert.throws(() => ctx.library.setMeta('c', { description: '<b>' }), /< ni >/);
    assert.throws(() => ctx.library.setMeta('c', { visibility: 'secreto' as never }), /pública o privada/);
    assert.throws(() => ctx.library.setMeta('nope', {}), /no existe/);
  });
  it('lo guardado sobrevive a reabrir el almacén', () => {
    const env = two();
    env.ctx.library.setMeta('l', { description: 'D', playlist: 'P', visibility: 'public' });
    const re = new Store(env.userData, env.outputDir);
    assert.deepEqual([re.data.outputs[0].description, re.data.outputs[0].playlist, re.data.outputs[0].visibility], ['D', 'P', 'public']);
  });
});

describe('Biblioteca: miniatura elegida', () => {
  it('desde un fotograma del vídeo largo: 1280x720 y borra la anterior', async () => {
    const env = makeEnv();
    envs.push(env);
    const vod = addDownloadedVod(env, split);
    const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 4 }] });
    const old = long.thumbnail!;
    const updated = await env.ctx.library.setThumbnailFromFrame(long.id, 1);
    assert.notEqual(updated.thumbnail, old);
    assert.ok(!fs.existsSync(old), 'la miniatura anterior se borra');
    const info = await probe(TOOLS, updated.thumbnail!);
    assert.deepEqual([info.width, info.height], [1280, 720]);
    assert.ok((await env.ctx.library.setThumbnailFromFrame(long.id, 999)).thumbnail, 'un instante pasado el final se ajusta al final');
    assert.throws(() => env.ctx.library.setThumbnailFromFrame(long.id, -1), /Instante/);
  });

  it('desde una imagen del usuario: se convierte a 1280x720; un archivo que no es imagen no cambia nada', async () => {
    const env = makeEnv();
    envs.push(env);
    const vod = addDownloadedVod(env, split);
    const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 4 }] });
    const before = long.thumbnail;
    const png = path.join(env.root, 'mi.png');
    const { execFileSync } = await import('node:child_process');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=800x800', '-frames:v', '1', png]);
    const r = await env.ctx.library.setThumbnailFromImage(long.id, png);
    const info = await probe(TOOLS, r.thumbnail!);
    assert.deepEqual([info.width, info.height], [1280, 720]);
    const current = r.thumbnail;
    const bad = path.join(env.root, 'no-imagen.png');
    fs.writeFileSync(bad, 'esto no es una imagen');
    await assert.rejects(env.ctx.library.setThumbnailFromImage(long.id, bad), /No se pudo leer esa imagen/);
    await assert.rejects(env.ctx.library.setThumbnailFromImage(long.id, path.join(env.root, 'nada.png')), /no existe/);
    assert.equal(env.ctx.store.data.outputs[0].thumbnail, current);
    assert.notEqual(current, before);
    assert.ok(fs.existsSync(current!));
  });
});

describe('Biblioteca: recorte y encuadre de un clip', () => {
  it('cambiar el encuadre vuelve a renderizar las dos versiones: cambia el color del lado, valida y borra lo anterior', async () => {
    const { env, clip } = await withClip(0);
    const old = { ...clip.files };
    assert.equal(dominantColor(old.vertical!, 1), 'red');
    const r = await env.ctx.library.reeditClip(clip.id, { cropX: 1 });
    assert.equal(r.id, clip.id);
    assert.deepEqual(Object.keys(r.files).sort(), ['horizontal', 'vertical']);
    for (const k of ['horizontal', 'vertical'] as const) {
      assert.notEqual(r.files[k], old[k]);
      assert.ok(!fs.existsSync(old[k]!), `${k} anterior borrado`);
    }
    assert.equal(dominantColor(r.files.vertical!, 1), 'blue');
    assert.equal(r.cropX, 1);
    assert.ok(fs.existsSync(r.thumbnail!));
    assert.equal(env.ctx.store.data.outputs.length, 1);
  });

  it('recortar inicio y fin cambia la duración de las dos versiones', async () => {
    const { env, clip } = await withClip();
    const r = await env.ctx.library.reeditClip(clip.id, { start: 3, end: 5 });
    assert.ok(Math.abs(r.durationSec - 2) < 0.6, String(r.durationSec));
    assert.deepEqual([r.start, r.end], [3, 5]);
    for (const f of Object.values(r.files)) assert.ok(Math.abs((await probe(TOOLS, f!)).durationSec - 2) < 0.6);
  });

  it('regenera la versión que faltaba (clip creado solo en vertical)', async () => {
    const { env, clip } = await withClip(0.5, 'vertical');
    assert.deepEqual(Object.keys(clip.files), ['vertical']);
    const r = await env.ctx.library.reeditClip(clip.id, {});
    assert.deepEqual(Object.keys(r.files).sort(), ['horizontal', 'vertical']);
    assert.ok(fs.existsSync(r.files.horizontal!));
  });

  it('un cambio no válido no toca el clip ni deja archivos sueltos', async () => {
    const { env, clip } = await withClip(0.5);
    const snapshot = JSON.stringify(env.ctx.store.data.outputs[0]);
    const count = () => ['vertical', 'horizontal'].map((d) => fs.readdirSync(path.join(env.outputDir, d)).length);
    const before = count();
    await assert.rejects(env.ctx.library.reeditClip(clip.id, { start: 5, end: 3 }), /Clip no válido/);
    await assert.rejects(env.ctx.library.reeditClip(clip.id, { start: 8, end: 13 }), /después del final/);
    await assert.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 2 }), /cropX/);
    assert.equal(JSON.stringify(env.ctx.store.data.outputs[0]), snapshot);
    assert.deepEqual(count(), before);
    for (const f of Object.values(clip.files)) assert.ok(fs.existsSync(f!));
  });

  it('rechaza vídeos largos, clips sin origen, VOD borrado y publicación en curso', async () => {
    const { env, clip, vod } = await withClip();
    const long = await env.ctx.clips.createLong(vod.id, { title: 'L', segments: [{ start: 0, end: 3 }] });
    await assert.rejects(env.ctx.library.reeditClip(long.id, { start: 1 }), /solo se pueden cambiar los subtítulos/);
    env.ctx.store.data.outputs.push({ id: 'viejo', kind: 'clip', title: 'v', files: clip.files, durationSec: 4, createdAt: 'x' });
    await assert.rejects(env.ctx.library.reeditClip('viejo', { cropX: 1 }), /anterior a la Biblioteca/);
    env.ctx.store.data.publications.push({ key: `${clip.id}:youtube`, outputId: clip.id, platform: 'youtube', scheduledAt: 'x', status: 'publishing' });
    await assert.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 1 }), /publicando/);
    env.ctx.store.data.publications.length = 0;
    fs.renameSync(split, `${split}.bak`);
    try {
      await assert.rejects(env.ctx.library.reeditClip(clip.id, { cropX: 1 }), /VOD de origen|No se pudo volver a descargar/); // el directo borrado se intenta recuperar solo (aquí no hay yt-dlp)
    } finally {
      fs.renameSync(`${split}.bak`, split);
    }
  });

  it('las publicaciones del clip se conservan al reeditarlo', async () => {
    const { env, clip } = await withClip();
    env.ctx.pubs.schedule(clip.id, ['youtube'], new Date(Date.now() + 3600_000).toISOString());
    await env.ctx.library.reeditClip(clip.id, { cropX: 0.2 });
    assert.equal(env.ctx.store.data.publications[0].outputId, clip.id);
  });

  it('vista previa del encuadre: fotograma completo del VOD en base64', async () => {
    const { env, clip } = await withClip();
    const p = await env.ctx.library.framingPreview(clip.id);
    assert.match(p.dataUrl, /^data:image\/jpeg;base64,/);
    assert.deepEqual([p.width, p.height], [640, 360]);
    assert.equal(fs.readdirSync(path.join(env.outputDir, 'miniaturas')).some((f) => f.startsWith('preview-')), false, 'no deja temporales');
    const long = await env.ctx.clips.createLong(clip.vodId!, { title: 'L', segments: [{ start: 0, end: 3 }] });
    await assert.rejects(env.ctx.library.framingPreview(long.id), /Solo los clips/);
  });
});

describe('Biblioteca: descargar una versión', () => {
  it('copia la versión elegida donde se indique, añade .mp4 y deja el original intacto', async () => {
    const { env, clip } = await withClip();
    assert.equal(env.ctx.library.exportName(clip.id, 'vertical'), 'clip-vertical.mp4');
    assert.equal(env.ctx.library.exportName(clip.id, 'horizontal'), 'clip-horizontal.mp4');
    const dest = path.join(env.root, 'descargas', 'mi video');
    fs.mkdirSync(path.dirname(dest));
    const saved = await env.ctx.library.exportFile(clip.id, 'vertical', dest);
    assert.equal(saved, `${dest}.mp4`);
    const info = await probe(TOOLS, saved);
    assert.deepEqual([info.width, info.height], [1080, 1920]);
    assert.ok(fs.existsSync(clip.files.vertical!), 'el original sigue en la biblioteca');
    assert.deepEqual(fs.readdirSync(path.dirname(dest)), ['mi video.mp4'], 'sin temporales');
    const h = await env.ctx.library.exportFile(clip.id, 'horizontal', path.join(env.root, 'descargas', 'h.mp4'));
    assert.deepEqual([(await probe(TOOLS, h)).width, (await probe(TOOLS, h)).height], [1920, 1080]);
    // sobrescribir un destino existente (el usuario lo confirmó en el cuadro de guardado)
    fs.writeFileSync(path.join(env.root, 'descargas', 'viejo.mp4'), 'viejo');
    await env.ctx.library.exportFile(clip.id, 'horizontal', path.join(env.root, 'descargas', 'viejo.mp4'));
    assert.ok(fs.statSync(path.join(env.root, 'descargas', 'viejo.mp4')).size > 1000);
  });

  it('los vídeos largos se llaman solo con su título', async () => {
    const { env, vod } = await withClip();
    const long = await env.ctx.clips.createLong(vod.id, { title: 'Resumen Épico', segments: [{ start: 0, end: 3 }] });
    assert.equal(env.ctx.library.exportName(long.id, 'long'), 'resumen-epico.mp4');
  });

  it('errores claros: versión inexistente, ruta relativa, carpeta inexistente, el propio archivo', async () => {
    const { env, clip } = await withClip(0, 'vertical');
    assert.throws(() => env.ctx.library.exportName(clip.id, 'horizontal'), /no tiene versión horizontal/);
    await assert.rejects(env.ctx.library.exportFile(clip.id, 'horizontal', path.join(env.root, 'x.mp4')), /no tiene versión/);
    await assert.rejects(env.ctx.library.exportFile(clip.id, 'vertical', 'relativa/x.mp4'), /no es válida/);
    await assert.rejects(env.ctx.library.exportFile(clip.id, 'vertical', path.join(env.root, 'no-existe', 'x.mp4')), /carpeta de destino no existe/);
    await assert.rejects(env.ctx.library.exportFile(clip.id, 'vertical', clip.files.vertical!), /propio archivo/);
    assert.throws(() => env.ctx.library.exportName('nope', 'vertical'), /no existe/);
    fs.rmSync(clip.files.vertical!);
    assert.throws(() => env.ctx.library.exportName(clip.id, 'vertical'), /no tiene versión vertical/);
  });
});

describe('Biblioteca: programación por red', () => {
  const future = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  function setup() {
    const env = makeEnv();
    envs.push(env);
    env.ctx.store.data.outputs.push({ id: 'o1', kind: 'clip', title: 't', files: { vertical: '/x' }, durationSec: 5, createdAt: 'x' });
    return env;
  }

  it('cada red con su hora; quitar una red la desprograma; lo publicado no se toca', () => {
    const env = setup();
    const { pubs } = env.ctx;
    const r = pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }, { platform: 'tiktok', atIso: future(2) }]);
    assert.equal(r.scheduled.length, 2);
    const list = () => env.ctx.store.data.publications;
    assert.notEqual(list()[0].scheduledAt, list()[1].scheduledAt);
    list().find((p) => p.platform === 'tiktok')!.status = 'published';
    pubs.setSchedule('o1', [{ platform: 'instagram', atIso: future(3) }]); // youtube se quita, tiktok (publicado) se conserva
    assert.deepEqual(list().map((p) => `${p.platform}:${p.status}`).sort(), ['instagram:scheduled', 'tiktok:published']);
    const again = pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: future(5) }, { platform: 'instagram', atIso: future(3) }]);
    assert.deepEqual(again.skipped.map((s) => s.platform), ['tiktok']);
    assert.equal(list().find((p) => p.platform === 'tiktok')!.status, 'published');
  });

  it('validación atómica: si una entrada es mala no cambia nada', () => {
    const env = setup();
    const { pubs } = env.ctx;
    pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }]);
    const before = JSON.stringify(env.ctx.store.data.publications);
    assert.throws(() => pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: future(1) }, { platform: 'instagram', atIso: 'ayer' }]), /no válidas/);
    assert.throws(() => pubs.setSchedule('o1', [{ platform: 'tiktok', atIso: new Date(Date.now() - 3600_000).toISOString() }]), /ya ha pasado/);
    assert.throws(() => pubs.setSchedule('o1', [{ platform: 'facebook' as never, atIso: future(1) }]), /no reconocida/);
    assert.throws(() => pubs.setSchedule('o1', [{ platform: 'youtube', atIso: future(1) }, { platform: 'youtube', atIso: future(2) }]), /repetida/);
    assert.throws(() => pubs.setSchedule('nope', []), /no existe/);
    assert.equal(JSON.stringify(env.ctx.store.data.publications), before);
  });

  it('una hora pasada que no se toca (esperando conexión) se conserva; editar otra red no la rechaza', () => {
    const env = setup();
    env.ctx.store.data.publications.push({
      key: 'o1:youtube', outputId: 'o1', platform: 'youtube',
      scheduledAt: new Date(Date.now() - 3600_000).toISOString(), status: 'scheduled', note: 'En espera: x',
    });
    const same = env.ctx.store.data.publications[0].scheduledAt;
    env.ctx.pubs.setSchedule('o1', [{ platform: 'youtube', atIso: same }, { platform: 'tiktok', atIso: future(1) }]);
    assert.equal(env.ctx.store.data.publications.length, 2);
    assert.equal(env.ctx.store.data.publications[0].note, 'En espera: x');
  });

  it('lista vacía: quita lo pendiente y lo fallido, deja lo publicado y lo que se está publicando', () => {
    const env = setup();
    const mk = (platform: 'youtube' | 'tiktok' | 'instagram', status: 'scheduled' | 'failed' | 'published') =>
      env.ctx.store.data.publications.push({ key: `o1:${platform}`, outputId: 'o1', platform, scheduledAt: future(1), status });
    mk('youtube', 'scheduled'); mk('tiktok', 'failed'); mk('instagram', 'published');
    env.ctx.pubs.setSchedule('o1', []);
    assert.deepEqual(env.ctx.store.data.publications.map((p) => p.platform), ['instagram']);
  });
});

describe('Biblioteca: servir medios al reproductor', () => {
  it('las URL se construyen y se interpretan sin ambigüedades', () => {
    assert.equal(mediaUrl('abc', 'vertical'), 'sc-media://o/abc/vertical');
    assert.equal(mediaUrl('a b', 'thumb', 'x/y'), 'sc-media://o/a%20b/thumb?v=x%2Fy');
    assert.deepEqual(parseMediaUrl('sc-media://o/abc/thumb?v=1'), { outputId: 'abc', part: 'thumb' });
    assert.deepEqual(parseMediaUrl('sc-media://o/abc/horizontal'), { outputId: 'abc', part: 'horizontal' });
    for (const bad of ['http://o/abc/vertical', 'sc-media://x/abc/vertical', 'sc-media://o/abc/otra', 'sc-media://o/abc/video', 'sc-media://o/a/b/vertical', 'sc-media://o//vertical', 'basura', 'sc-media://o/%E0%A4%A/vertical']) {
      assert.equal(parseMediaUrl(bad), null, bad);
    }
  });

  it('solo resuelve archivos registrados; ningún intento de ruta sale de ahí', async () => {
    const { env, clip } = await withClip();
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'vertical')), clip.files.vertical);
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'horizontal')), clip.files.horizontal);
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'thumb')), clip.thumbnail);
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'long')), null, 'un clip no tiene versión long');
    for (const bad of [mediaUrl('../../etc/passwd', 'vertical'), 'sc-media://o/..%2F..%2Fetc%2Fpasswd/vertical', 'sc-media://o/nope/vertical', 'file:///etc/passwd']) {
      assert.equal(resolveMedia(env.ctx, bad), null, bad);
    }
    fs.rmSync(clip.files.vertical!);
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'vertical')), null, 'archivo borrado => 404');
    env.ctx.store.data.outputs[0].thumbnail = undefined;
    assert.equal(resolveMedia(env.ctx, mediaUrl(clip.id, 'thumb')), null);
  });
});

describe('Biblioteca: respuestas con rango (necesarias para saltar en el reproductor)', () => {
  const file = () => {
    const f = path.join(srcRoot, 'rango.bin');
    fs.writeFileSync(f, Buffer.alloc(1000));
    return f;
  };
  it('sin Range envía todo; con Range envía 206 con el tramo exacto', () => {
    const f = file();
    assert.deepEqual([planMediaResponse(f, null).status, planMediaResponse(f, null).end], [200, 999]);
    const r = planMediaResponse(f, 'bytes=100-199');
    assert.deepEqual([r.status, r.start, r.end, r.headers['Content-Range'], r.headers['Content-Length']], [206, 100, 199, 'bytes 100-199/1000', '100']);
    const open = planMediaResponse(f, 'bytes=900-');
    assert.deepEqual([open.start, open.end, open.headers['Content-Length']], [900, 999, '100']);
    const suffix = planMediaResponse(f, 'bytes=-50');
    assert.deepEqual([suffix.start, suffix.end], [950, 999]);
    assert.equal(planMediaResponse(f, 'bytes=0-99999').end, 999);
  });
  it('rangos imposibles dan 416 y los ilegibles se ignoran', () => {
    const f = file();
    assert.equal(planMediaResponse(f, 'bytes=1000-').status, 416);
    assert.equal(planMediaResponse(f, 'bytes=500-100').status, 416);
    assert.equal(planMediaResponse(f, 'bytes=0-1,5-9').status, 200);
    assert.equal(planMediaResponse(f, 'basura').status, 200);
    assert.equal(planMediaResponse(f, 'bytes=-').status, 200);
  });
  it('el tipo de contenido sale de la extensión', () => {
    const mp4 = makeVideo(path.join(srcRoot, 'a.mp4'), { dur: 1 });
    assert.equal(planMediaResponse(mp4, null).headers['Content-Type'], 'video/mp4');
    assert.equal(planMediaResponse(file(), null).headers['Content-Type'], 'application/octet-stream');
  });
});

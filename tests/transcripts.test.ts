import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CHANNELS, type Result, type VodJob } from '../shared/types';
import type { Word } from '../shared/subtitles';
import { parsePlan } from '../shared/plan';
import { PROMPT_EXAMPLE, buildClaudePrompt } from '../shared/claudePrompt';
import { registerIpc, type IpcLike, type IpcPlatform } from '../electron/ipc/register';
import { probe } from '../electron/services/ffmpeg';
import { addDownloadedVod, fakeWhisper, installFakeModel, makeEnv, rmDir, tmpDir, type TestEnv } from './helpers';

const envs: TestEnv[] = [];
afterEach(() => {
  while (envs.length) envs.pop()!.cleanup();
});

let root: string;
let black: string;
before(() => {
  root = tmpDir();
  black = path.join(root, 'black.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=14', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=14', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', black]);
});
after(() => rmDir(root));

const TRANSCRIPT = JSON.stringify({
  words: [
    { text: 'Hola', start: 1, end: 1.4 }, { text: 'a', start: 1.4, end: 1.5 }, { text: 'todos', start: 1.5, end: 2 },
    { text: 'esto', start: 8, end: 8.3 }, { text: 'es', start: 8.3, end: 8.5 }, { text: 'increíble', start: 8.5, end: 9.3 },
  ],
});

function env() {
  const e = makeEnv();
  envs.push(e);
  const vod = addDownloadedVod(e, black);
  return { e, vod };
}

function importTo(e: TestEnv, vodId: string, content = TRANSCRIPT, name = 't.json') {
  const f = path.join(e.root, name);
  fs.writeFileSync(f, content);
  return e.ctx.transcripts.importFile(vodId, f);
}

function brightBottom(file: string, at: number): number {
  const W = 192;
  const H = 108;
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
  let n = 0;
  for (let y = Math.floor(H * 0.7); y < H; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > 150) n++;
  return n / (H * 0.3 * W);
}

describe('transcripciones: importar', () => {
  it('importa, guarda las palabras y anota los datos en el VOD', () => {
    const { e, vod } = env();
    const v = importTo(e, vod.id);
    assert.equal(v.transcript?.words, 6);
    assert.equal(v.transcript?.source, 'import');
    assert.equal(e.ctx.transcripts.words(vod.id).length, 6);
    assert.ok(e.notifier.changes > 0);
  });
  it('sobrevive a reiniciar: se lee de disco', () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    assert.equal(e.ctx.transcripts.words(vod.id)[0].text, 'Hola');
  });
  it('un archivo malo no pisa la transcripción buena', () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    assert.throws(() => importTo(e, vod.id, 'esto no es una transcripción', 'mala.txt'), /Formato no reconocido/);
    assert.equal(e.ctx.transcripts.words(vod.id).length, 6);
    assert.equal(e.ctx.store.data.vods[0].transcript?.words, 6);
  });
  it('errores claros: VOD inexistente, archivo inexistente', () => {
    const { e, vod } = env();
    assert.throws(() => e.ctx.transcripts.importFile('nada', '/x.json'), /VOD no existe/);
    assert.throws(() => e.ctx.transcripts.importFile(vod.id, '/no/existe.json'), /no existe/);
  });
  it('words() devuelve vacío sin transcripción o con el archivo roto', () => {
    const { e, vod } = env();
    assert.deepEqual(e.ctx.transcripts.words(vod.id), []);
    importTo(e, vod.id);
    const dir = path.join(e.userData, 'transcripts');
    fs.writeFileSync(path.join(dir, fs.readdirSync(dir)[0]), '{roto');
    assert.deepEqual(e.ctx.transcripts.words(vod.id), []);
  });
});

describe('transcripciones: Whisper (whisper.cpp)', () => {
  function withWhisper(mode = 'ok') {
    const x = env();
    const log = path.join(x.e.root, 'whisper.log');
    process.env.FAKE_MODE = mode;
    process.env.FAKE_LOG = log;
    x.e.ctx.settings.set({ whisperPath: fakeWhisper(), whisperModel: 'tiny', whisperLanguage: 'es' });
    installFakeModel(x.e, 'tiny');
    return { ...x, log };
  }
  afterEach(() => {
    delete process.env.FAKE_MODE;
    delete process.env.FAKE_LOG;
  });

  it('trocea el audio, llama a whisper-cli con los argumentos esperados y suma el desfase de cada trozo', async () => {
    const { e, vod, log } = withWhisper();
    // el VOD de prueba dura 14 s: con trozos de 5 s salen 3
    const words = await (await import('../electron/services/whisper')).transcribeVideo(
      e.ctx.tools(),
      vod.filePath!,
      { exe: fakeWhisper(), model: path.join(e.userData, 'models', 'ggml-tiny.bin'), language: 'es', chunkSec: 5, threads: 2 },
    );
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[]);
    assert.equal(lines.length, 3);
    assert.match(lines[0][lines[0].indexOf('-f') + 1], /c0\.wav$/);
    assert.deepEqual([lines[0][lines[0].indexOf('-l') + 1], lines[0][lines[0].indexOf('-t') + 1]], ['es', '2']);
    for (const f of ['-oj', '-ml', '-sow', '-pp']) assert.ok(lines[0].includes(f), `falta ${f}`);
    // sin [BLANK_AUDIO] ni (música), con el desfase de cada trozo
    assert.deepEqual(words.map((w) => w.text), ['Hola', 'a', 'todos.', 'trozo0', 'Hola', 'a', 'todos.', 'trozo1', 'Hola', 'a', 'todos.', 'trozo2']);
    assert.equal(words[0].start, 1);
    assert.equal(words[4].start, 6);
    assert.equal(words[8].start, 11);
  });
  it('guarda la transcripción en el VOD y avisa del avance', async () => {
    const { e, vod } = withWhisper();
    const v = await e.ctx.transcripts.transcribe(vod.id);
    assert.equal(v.transcript?.source, 'whisper');
    assert.equal(v.transcript?.words, 4);
    assert.deepEqual(e.ctx.transcripts.words(vod.id).map((w) => w.text), ['Hola', 'a', 'todos.', 'trozo0']);
    const t = e.notifier.tasks.filter((x) => x.kind === 'transcribe');
    assert.ok(t.some((x) => x.status === 'running' && x.progress > 0 && x.progress < 100), 'debe haber avance intermedio');
    assert.equal(t[t.length - 1].status, 'done');
  });
  it('sin idioma configurado usa detección automática', async () => {
    const { e, vod, log } = withWhisper();
    e.ctx.settings.set({ whisperLanguage: '' });
    await e.ctx.transcripts.transcribe(vod.id);
    const args = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]) as string[];
    assert.equal(args[args.indexOf('-l') + 1], 'auto');
  });
  it('sin whisper-cli explica qué hacer', () => {
    const { e, vod } = env();
    assert.throws(() => e.ctx.transcripts.transcribe(vod.id), /No se encuentra Whisper/);
  });
  it('si whisper-cli falla, el error llega, la tarea queda en error y no se guarda nada', async () => {
    const { e, vod } = withWhisper('fail');
    await assert.rejects(() => e.ctx.transcripts.transcribe(vod.id), /código 1[\s\S]*failed to load model/);
    assert.equal(e.ctx.store.data.vods[0].transcript, undefined);
    assert.equal(e.notifier.tasks.filter((x) => x.kind === 'transcribe').pop()?.status, 'error');
  });
  it('con el modelo dañado («unknown tensor», código 3) lo borra, lo vuelve a descargar y transcribe', async () => {
    const http = await import('node:http');
    const srv = http.createServer((_q, res) => res.writeHead(200, { 'content-length': 71_000_000 }).end(Buffer.alloc(71_000_000)));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const e2 = makeEnv({ modelBaseUrl: base });
      const vod = addDownloadedVod(e2, black);
      process.env.FAKE_MODE = 'ok';
      process.env.FAKE_LOG = path.join(e2.root, 'w.log');
      e2.ctx.settings.set({ whisperPath: fakeWhisper(), whisperModel: 'tiny', whisperLanguage: 'es' });
      const bad = installFakeModel(e2, 'tiny');
      fs.writeFileSync(bad, Buffer.concat([Buffer.from('BAD!'), Buffer.alloc(71_000_000)]));
      const v = await e2.ctx.transcripts.transcribe(vod.id);
      assert.equal(v.transcript?.source, 'whisper');
      assert.notEqual(fs.readFileSync(bad).subarray(0, 4).toString('latin1'), 'BAD!', 'el modelo dañado debe haberse sustituido');
      e2.cleanup();
    } finally {
      srv.close();
    }
  });
  it('si el modelo sigue dañado tras descargarlo otra vez, lo explica y sugiere otro modelo', async () => {
    const http = await import('node:http');
    const bad = Buffer.concat([Buffer.from('BAD!'), Buffer.alloc(71_000_000)]);
    const srv = http.createServer((_q, res) => res.writeHead(200, { 'content-length': bad.length }).end(bad));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const e2 = makeEnv({ modelBaseUrl: base });
      const vod = addDownloadedVod(e2, black);
      process.env.FAKE_MODE = 'ok';
      e2.ctx.settings.set({ whisperPath: fakeWhisper(), whisperModel: 'tiny', whisperLanguage: 'es' });
      fs.writeFileSync(installFakeModel(e2, 'tiny'), bad);
      await assert.rejects(() => e2.ctx.transcripts.transcribe(vod.id), /ni tras descargarlo de nuevo[\s\S]*otro modelo/);
      assert.equal(e2.notifier.tasks.filter((t) => t.kind === 'transcribe').pop()?.status, 'error');
      e2.cleanup();
    } finally {
      srv.close();
    }
  });
  it('sin archivo de salida, sin palabras o con JSON roto, lo dice', async () => {
    const a = withWhisper('nofile');
    await assert.rejects(() => a.e.ctx.transcripts.transcribe(a.vod.id), /no generó/);
    const b = withWhisper('empty');
    await assert.rejects(() => b.e.ctx.transcripts.transcribe(b.vod.id), /ninguna palabra/);
    const c = withWhisper('garbage');
    await assert.rejects(() => c.e.ctx.transcripts.transcribe(c.vod.id), /no es JSON válido/);
  });
  it('no deja archivos temporales', async () => {
    const { e, vod } = withWhisper();
    const count = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('streamclips-whisper-')).length;
    const before = count();
    await e.ctx.transcripts.transcribe(vod.id);
    assert.equal(count(), before);
  });
  it('estado: motor, modelo y tamaño', () => {
    const { e } = env();
    assert.deepEqual(e.ctx.transcripts.status(), { engine: false, model: 'small', modelInstalled: false, modelApproxMb: 488 });
    e.ctx.settings.set({ whisperPath: fakeWhisper(), whisperModel: 'tiny' });
    installFakeModel(e, 'tiny');
    assert.deepEqual(e.ctx.transcripts.status(), { engine: true, model: 'tiny', modelInstalled: true, modelApproxMb: 78 });
  });
  it('los ajustes de Whisper se validan', () => {
    const { e } = env();
    assert.throws(() => e.ctx.settings.set({ whisperPath: 'whisper.exe' }), /absoluta/);
    assert.throws(() => e.ctx.settings.set({ whisperModel: 'a b;c' }), /modelo/);
    assert.throws(() => e.ctx.settings.set({ whisperLanguage: 'español' }), /idioma/);
    assert.equal(e.ctx.settings.set({ whisperLanguage: 'EN' }).whisperLanguage, 'en');
    assert.equal(e.ctx.settings.get().whisperModel, 'small');
  });
});

describe('prompt para Claude', () => {
  it('incluye la transcripción con tiempos y el ejemplo de plan', () => {
    const words: Word[] = [{ text: 'Hola', start: 61, end: 62 }];
    const p = buildClaudePrompt('Mi directo', 3600, words);
    assert.match(p, /"Mi directo"/);
    assert.match(p, /Dura 3600 segundos/);
    assert.match(p, /\[01:01\] Hola/);
    assert.match(p, /"cuts"/);
    assert.match(p, /"punch"/);
  });
  it('el plan de ejemplo del prompt es válido para el propio programa', () => {
    const { plan, errors } = parsePlan(JSON.stringify(PROMPT_EXAMPLE), 5000);
    assert.deepEqual(errors, []);
    assert.equal(plan.clips.length, 1);
    assert.ok(plan.long);
  });
  it('sin transcripción da un error útil', () => {
    const { e, vod } = env();
    assert.throws(() => e.ctx.transcripts.claudePrompt(vod.id), /no tiene transcripción/);
    importTo(e, vod.id);
    assert.match(e.ctx.transcripts.claudePrompt(vod.id, 14), /Hola a todos/);
  });
});

describe('clips con cortes, efectos y subtítulos', () => {
  it('un clip con subtítulos sale con texto grabado en las dos versiones y guarda el estilo', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Con subtítulos', subtitles: 'clasico' });
    assert.equal(clip.subtitles, 'clasico');
    assert.ok(clip.files.horizontal && clip.files.vertical);
    assert.ok(brightBottom(clip.files.horizontal, 1.5) > 0.004, 'horizontal sin texto');
    assert.ok(brightBottom(clip.files.vertical, 1.5) > 0.004, 'vertical sin texto');
    assert.ok(brightBottom(clip.files.horizontal, 3.5) < 0.0005, 'texto fuera de su momento');
  });
  it('sin subtítulos (lo habitual) el vídeo sale limpio y sin campo de estilo', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Limpio' });
    assert.equal(clip.subtitles, undefined);
    assert.ok(brightBottom(clip.files.horizontal!, 1.5) < 0.0005);
  });
  it('pedir subtítulos sin transcripción falla sin dejar archivos ni registros', async () => {
    const { e, vod } = env();
    await assert.rejects(() => e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'x', subtitles: 'karaoke' }), /no tiene transcripción/);
    assert.equal(e.ctx.store.data.outputs.length, 0);
    const left = fs.existsSync(path.join(e.outputDir, 'horizontal')) ? fs.readdirSync(path.join(e.outputDir, 'horizontal')) : [];
    assert.deepEqual(left, []);
  });
  it('pedir subtítulos en un tramo sin palabras falla con un mensaje claro', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    await assert.rejects(() => e.ctx.clips.createClip(vod.id, { start: 11, end: 14, title: 'x', subtitles: 'clasico' }), /ninguna palabra en este tramo/);
  });
  it('cortes: la duración final es la de lo conservado y los cortes se guardan', async () => {
    const { e, vod } = env();
    const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 10, title: 'Cortado', cuts: [{ start: 3, end: 6 }] });
    assert.ok(Math.abs(clip.durationSec - 7) < 0.6, String(clip.durationSec));
    assert.deepEqual(clip.cuts, [{ start: 3, end: 6 }]);
  });
  it('cortes + subtítulos: la frase sigue a su audio tras el corte', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    // "esto es increíble" va de 8.0 a 9.3; quitando 2..5 sale 3 s antes (a 5.0..6.3)
    const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 12, title: 'Sync', cuts: [{ start: 2, end: 5 }], subtitles: 'clasico' });
    assert.ok(brightBottom(clip.files.horizontal!, 5.6) > 0.004);
    assert.ok(brightBottom(clip.files.horizontal!, 8.6) < 0.0005, 'no debe quedar en la posición sin recolocar');
  });
  it('efectos válidos se renderizan y se guardan; uno mal puesto se rechaza antes de renderizar', async () => {
    const { e, vod } = env();
    const ok = await e.ctx.clips.createClip(vod.id, { kind: 'vertical', start: 0, end: 8, title: 'Fx', effects: [{ type: 'punch', at: 3 }, { type: 'fadeOut' }] });
    assert.equal(ok.effects?.length, 2);
    await assert.rejects(() => e.ctx.clips.createClip(vod.id, { start: 0, end: 8, title: 'x', effects: [{ type: 'punch', at: 99 }] }), /fuera del clip/);
  });
  it('vídeo largo con subtítulos', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 3 }, { start: 7, end: 11 }], subtitles: 'minimal' });
    assert.equal(long.subtitles, 'minimal');
    assert.ok(brightBottom(long.files.long!, 1.5) > 0.001);
    assert.ok(brightBottom(long.files.long!, 0.5) < 0.0005);
    const info = await probe({ ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', ytdlp: '' }, long.files.long!);
    assert.equal(info.width, 1920);
  });
  it('applyPlan acepta cortes, efectos y subtítulos del JSON de Claude', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const plan = { clips: [{ kind: 'horizontal', start: 0, end: 10, title: 'Plan', cuts: [{ start: 3, end: 6 }], effects: [{ type: 'fadeIn' }], subtitles: 'karaoke' }] };
    const r = await e.ctx.clips.applyPlan(vod.id, JSON.stringify(plan));
    assert.deepEqual(r.errors, []);
    assert.equal(r.created[0].subtitles, 'karaoke');
  });
});

describe('reedición: activar, cambiar y quitar subtítulos', () => {
  it('se activan, cambian de estilo y se quitan; cada paso sustituye a los archivos anteriores', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Reed' });
    const first = { ...clip.files };

    const on = await e.ctx.library.reeditClip(clip.id, { subtitles: 'pop' });
    assert.equal(on.subtitles, 'pop');
    for (const f of Object.values(first)) assert.ok(!fs.existsSync(f!), 'los archivos viejos deben borrarse');
    assert.ok(Object.values(on.files).every((f) => fs.existsSync(f!)));

    const other = await e.ctx.library.reeditClip(clip.id, { subtitles: 'clasico' });
    assert.equal(other.subtitles, 'clasico');
    assert.ok(brightBottom(other.files.horizontal!, 1.5) > 0.004);

    const off = await e.ctx.library.reeditClip(clip.id, { subtitles: null });
    assert.equal(off.subtitles, undefined);
    assert.ok(brightBottom(off.files.horizontal!, 1.5) < 0.0005, 'el texto debe desaparecer');
  });
  it('reeditar sin tocar subtítulos los conserva', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Keep', subtitles: 'clasico' });
    const r = await e.ctx.library.reeditClip(clip.id, { cropX: 0.2 });
    assert.equal(r.subtitles, 'clasico');
    assert.ok(brightBottom(r.files.horizontal!, 1.5) > 0.004);
  });
  it('si no hay transcripción falla y el clip queda como estaba', async () => {
    const { e, vod } = env();
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'Intacto' });
    const files = { ...clip.files };
    await assert.rejects(() => e.ctx.library.reeditClip(clip.id, { subtitles: 'clasico' }), /no tiene transcripción/);
    assert.deepEqual(e.ctx.store.data.outputs[0].files, files);
    assert.ok(Object.values(files).every((f) => fs.existsSync(f!)));
    assert.equal(e.ctx.store.data.outputs[0].subtitles, undefined);
  });
  it('un estilo inventado se rechaza', async () => {
    const { e, vod } = env();
    const clip = await e.ctx.clips.createClip(vod.id, { start: 0, end: 4, title: 'x' });
    await assert.rejects(() => e.ctx.library.reeditClip(clip.id, { subtitles: 'comic' as never }), /no existe/);
  });
  it('al acortar el tramo se descartan los cortes y acercamientos que quedan fuera', async () => {
    const { e, vod } = env();
    const clip = await e.ctx.clips.createClip(vod.id, { kind: 'horizontal', start: 0, end: 12, title: 'Trim', cuts: [{ start: 8, end: 10 }], effects: [{ type: 'punch', at: 11 }, { type: 'fadeIn' }] });
    const r = await e.ctx.library.reeditClip(clip.id, { end: 6 });
    assert.equal(r.cuts, undefined);
    assert.deepEqual(r.effects?.map((x) => x.type), ['fadeIn']);
    assert.ok(Math.abs(r.durationSec - 6) < 0.6);
  });
});

describe('reedición de vídeos largos: subtítulos', () => {
  it('se activan y se quitan montando de nuevo desde los tramos guardados', async () => {
    const { e, vod } = env();
    importTo(e, vod.id);
    const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 3 }, { start: 7, end: 11 }] });
    assert.deepEqual(long.segments, [{ start: 0, end: 3 }, { start: 7, end: 11 }]);
    const old = long.files.long!;
    const on = await e.ctx.library.reeditClip(long.id, { subtitles: 'clasico' });
    assert.equal(on.subtitles, 'clasico');
    assert.ok(!fs.existsSync(old));
    assert.ok(brightBottom(on.files.long!, 1.5) > 0.004);
    const off = await e.ctx.library.reeditClip(long.id, { subtitles: null });
    assert.equal(off.subtitles, undefined);
    assert.ok(brightBottom(off.files.long!, 1.5) < 0.0005);
    assert.ok(Math.abs(off.durationSec - 7) < 1);
  });
  it('rechaza cambiar el tramo, avisa si no hay transcripción y deja todo como estaba', async () => {
    const { e, vod } = env();
    const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 4 }] });
    await assert.rejects(() => e.ctx.library.reeditClip(long.id, { start: 1 }), /solo se pueden cambiar los subtítulos/);
    const file = long.files.long!;
    await assert.rejects(() => e.ctx.library.reeditClip(long.id, { subtitles: 'pop' }), /no tiene transcripción/);
    assert.equal(e.ctx.store.data.outputs[0].files.long, file);
    assert.ok(fs.existsSync(file));
  });
  it('un vídeo antiguo sin tramos guardados da un motivo claro', async () => {
    const { e, vod } = env();
    const long = await e.ctx.clips.createLong(vod.id, { title: 'Largo', segments: [{ start: 0, end: 4 }] });
    delete e.ctx.store.data.outputs[0].segments;
    await assert.rejects(() => e.ctx.library.reeditClip(long.id, { subtitles: 'pop' }), /no guarda de qué tramos sale/);
  });
});

describe('IPC de transcripciones', () => {
  function setup() {
    const { e, vod } = env();
    const handlers = new Map<string, (ev: unknown, ...a: unknown[]) => unknown>();
    const ipc: IpcLike = { handle: (ch, fn) => void handlers.set(ch, fn) };
    const calls = { transcript: null as string | null };
    const platform: IpcPlatform = {
      pickFolder: async () => null,
      pickImage: async () => null,
      pickTranscript: async () => calls.transcript,
      pickSavePath: async () => null,
      showItem: () => undefined,
      openFolder: async () => undefined,
    };
    registerIpc(ipc, e.ctx, platform);
    const call = async <T = unknown>(ch: string, ...a: unknown[]) => (await handlers.get(ch)!({}, ...a)) as Result<T>;
    return { e, vod, call, calls };
  }
  it('importar abre el selector, cancelar devuelve null y un archivo bueno se guarda', async () => {
    const { e, vod, call, calls } = setup();
    const none = await call(CHANNELS.transcriptImport, vod.id);
    assert.ok(none.ok && none.value === null);
    const f = path.join(e.root, 'x.srt');
    fs.writeFileSync(f, '1\n00:00:01,000 --> 00:00:02,000\nhola mundo\n');
    calls.transcript = f;
    const r = await call<VodJob>(CHANNELS.transcriptImport, vod.id);
    assert.ok(r.ok && r.value?.transcript?.words === 2);
    const words = await call<Word[]>(CHANNELS.transcriptGet, vod.id);
    assert.ok(words.ok && words.value.length === 2);
  });
  it('el prompt para Claude incluye la duración real del VOD', async () => {
    const { e, vod, call } = setup();
    importTo(e, vod.id);
    const r = await call<string>(CHANNELS.transcriptPrompt, vod.id);
    assert.ok(r.ok && /Dura 14 segundos/.test(r.value));
  });
  it('valida parámetros y devuelve errores limpios', async () => {
    const { call } = setup();
    const a = await call(CHANNELS.transcriptGet, 5);
    assert.ok(!a.ok && /Parámetro no válido/.test(a.error));
    const b = await call(CHANNELS.transcriptRun, 'nada');
    assert.ok(!b.ok);
  });
});


import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { keptRanges, toOutputTime, totalDuration } from '../shared/timeline';
import {
  SUBTITLE_STYLES,
  activeWordIndex,
  assColor,
  buildAss,
  buildCues,
  captionLayout,
  cueAt,
  wordsForOutput,
  type Word,
} from '../shared/subtitles';
import { parseTranscript, spreadWords, transcriptForClaude } from '../shared/transcript';
import { parsePlan, validateClipSpec, validateLongSpec } from '../shared/plan';
import { assFilter, filterPath, punchFilter, renderClip, renderLong, validateRender, probe } from '../electron/services/ffmpeg';
import { resolveToolPaths } from '../electron/services/tools';
import { makeVideo, rmDir, tmpDir } from './helpers';

const tools = resolveToolPaths('', '');
const FONTS = path.resolve(process.cwd(), 'resources/fonts');

const w = (text: string, start: number, end: number): Word => ({ text, start, end });
const SPEECH: Word[] = [
  w('Hola', 1.0, 1.3), w('chicos,', 1.3, 1.8), w('hoy', 1.9, 2.1), w('vamos', 2.1, 2.5), w('a', 2.5, 2.6),
  w('romper', 2.6, 3.0), w('el', 3.0, 3.1), w('juego.', 3.1, 3.6),
  w('Madre', 6.0, 6.4), w('mía!', 6.4, 6.9),
];

describe('timeline: cortes', () => {
  it('quita los cortes y deja tramos ordenados', () => {
    assert.deepEqual(keptRanges(0, 10, [{ start: 6, end: 8 }, { start: 2, end: 3 }]), [
      { start: 0, end: 2 }, { start: 3, end: 6 }, { start: 8, end: 10 },
    ]);
  });
  it('sin cortes devuelve el tramo entero; un corte que lo cubre todo no deja nada', () => {
    assert.deepEqual(keptRanges(5, 9), [{ start: 5, end: 9 }]);
    assert.deepEqual(keptRanges(5, 9, [{ start: 0, end: 20 }]), []);
  });
  it('ignora los cortes fuera del tramo y fusiona los solapados', () => {
    assert.deepEqual(keptRanges(0, 10, [{ start: 20, end: 30 }, { start: 2, end: 5 }, { start: 4, end: 6 }]), [
      { start: 0, end: 2 }, { start: 6, end: 10 },
    ]);
  });
  it('toOutputTime pasa el tiempo del VOD al del resultado y devuelve null en lo cortado', () => {
    const r = keptRanges(100, 110, [{ start: 102, end: 105 }]);
    assert.equal(totalDuration(r), 7);
    assert.equal(toOutputTime(101, r), 1);
    assert.equal(toOutputTime(106, r), 3);
    assert.equal(toOutputTime(103, r), null);
  });
});

describe('subtítulos: reparto en frases', () => {
  it('corta por fin de frase, pausas y número de palabras', () => {
    const cues = buildCues(SPEECH, SUBTITLE_STYLES.clasico);
    assert.deepEqual(cues.map((c) => c.words.map((x) => x.text).join(' ')), ['Hola chicos, hoy vamos', 'a romper el juego.', 'Madre mía!']);
  });
  it('el estilo Impacto saca dos palabras como mucho', () => {
    const cues = buildCues(SPEECH, SUBTITLE_STYLES.pop);
    assert.ok(cues.every((c) => c.words.length <= 2));
  });
  it('el subtítulo se queda un poco tras la última palabra sin pisar al siguiente', () => {
    const cues = buildCues(SPEECH, SUBTITLE_STYLES.clasico);
    assert.ok(cues[0].end > 1.8 && cues[0].end <= cues[1].start);
    assert.ok(cues[2].end > 6.9 && cues[2].end <= 6.9 + 0.31);
    assert.ok(cues.every((c, i) => i === 0 || c.start >= cues[i - 1].end));
  });
  it('ignora palabras vacías y no se rompe sin palabras', () => {
    assert.deepEqual(buildCues([], SUBTITLE_STYLES.clasico), []);
    assert.equal(buildCues([w('  ', 0, 1)], SUBTITLE_STYLES.clasico).length, 0);
  });
  it('cueAt y activeWordIndex localizan el momento', () => {
    const cues = buildCues(SPEECH, SUBTITLE_STYLES.karaoke);
    const c = cueAt(cues, 2.2)!;
    assert.ok(c.words.some((x) => x.text === 'vamos'));
    assert.equal(c.words[activeWordIndex(c, 2.2)].text, 'vamos');
    assert.equal(cueAt(cues, 5), null);
  });
  it('wordsForOutput descarta lo cortado y recoloca el resto', () => {
    const ranges = keptRanges(1, 7, [{ start: 3.7, end: 5.9 }]);
    const out = wordsForOutput(SPEECH, ranges);
    assert.equal(out.length, SPEECH.length); // ninguna palabra cae en el corte
    assert.ok(out[0].start < 0.2);
    const madre = out.find((x) => x.text === 'Madre')!;
    assert.ok(Math.abs((madre.start + madre.end) / 2 - (2.7 + 0.3)) < 0.01, `Madre en ${madre.start}`);
    const cut = wordsForOutput(SPEECH, keptRanges(1, 7, [{ start: 1.9, end: 3.0 }]));
    assert.ok(!cut.some((x) => x.text === 'vamos'));
  });
});

describe('subtítulos: archivo ASS', () => {
  it('assColor convierte a BGR con transparencia', () => {
    assert.equal(assColor('#FF0000'), '&H000000FF');
    assert.equal(assColor('#00FF00', 0.5), '&H8000FF00');
    assert.throws(() => assColor('rojo'), /no válido/);
  });
  it('captionLayout: vertical con más margen inferior y letra algo mayor', () => {
    const h = captionLayout(SUBTITLE_STYLES.clasico, 1920, 1080);
    const v = captionLayout(SUBTITLE_STYLES.clasico, 1080, 1920);
    assert.ok(v.fontPx > h.fontPx);
    assert.ok(v.marginV > h.marginV);
    assert.equal(captionLayout(SUBTITLE_STYLES.pop, 1080, 1920).marginV, 0);
  });
  it('genera cabecera, estilo y un diálogo por frase', () => {
    const ass = buildAss(SPEECH, SUBTITLE_STYLES.clasico, 1920, 1080);
    assert.match(ass, /PlayResX: 1920/);
    assert.match(ass, /PlayResY: 1080/);
    assert.match(ass, /Style: Default,Inter,/);
    assert.equal(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 3);
    assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:0\d\.\d\d,Default,,0,0,0,,Hola chicos,/);
  });
  it('Karaoke crea un evento por palabra con la activa resaltada', () => {
    const ass = buildAss(SPEECH, SUBTITLE_STYLES.karaoke, 1920, 1080);
    const dlg = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.ok(dlg.length >= SPEECH.length);
    assert.match(dlg[0], /\{\\1c&H0000D4FF\}Hola\{\\1c&H00FFFFFF\} chicos,/);
  });
  it('Impacto pasa a mayúsculas y se centra; Discreto usa caja', () => {
    const pop = buildAss(SPEECH, SUBTITLE_STYLES.pop, 1080, 1920);
    assert.match(pop, /HOLA/);
    assert.match(pop, /,5,\d+,\d+,0,1\n/); // alineación 5 (centro) y margen vertical 0
    const min = buildAss(SPEECH, SUBTITLE_STYLES.minimal, 1920, 1080);
    assert.match(min, /,3,\d+,0,2,/); // BorderStyle 3 = caja
  });
  it('el texto no puede colar código ASS', () => {
    const ass = buildAss([w('{\\an8}hola\\N', 0, 1)], SUBTITLE_STYLES.clasico, 1920, 1080);
    const line = ass.split('\n').find((l) => l.startsWith('Dialogue:'))!;
    assert.ok(!/[{}\\]/.test(line.split(',,').pop()!), line);
  });
});

describe('transcripción: lectura de formatos', () => {
  it('formato propio', () => {
    const t = parseTranscript(JSON.stringify({ words: [{ text: 'b', start: 2, end: 3 }, { text: 'a', start: 1, end: 2 }, { text: 'x', start: 'no' }] }));
    assert.deepEqual(t.map((x) => x.text), ['a', 'b']);
  });
  it('Whisper con palabras', () => {
    const t = parseTranscript(JSON.stringify({ text: 'hola mundo', segments: [{ start: 0, end: 2, text: ' hola mundo', words: [{ word: ' hola', start: 0, end: 1, probability: 0.9 }, { word: ' mundo', start: 1, end: 2 }] }] }));
    assert.deepEqual(t.map((x) => x.text), ['hola', 'mundo']);
  });
  it('Whisper sin palabras reparte el segmento', () => {
    const t = parseTranscript(JSON.stringify({ segments: [{ start: 10, end: 14, text: 'uno dos tres cuatro' }] }));
    assert.equal(t.length, 4);
    assert.equal(t[0].start, 10);
    assert.ok(Math.abs(t[3].end - 14) < 1e-9);
  });
  it('SRT', () => {
    const t = parseTranscript('1\n00:00:01,000 --> 00:00:03,000\nHola a todos\n\n2\n00:01:00,500 --> 00:01:02,000\n<i>Adiós</i>\n');
    assert.deepEqual(t.map((x) => x.text), ['Hola', 'a', 'todos', 'Adiós']);
    assert.equal(t[0].start, 1);
    assert.equal(t[3].start, 60.5);
  });
  it('VTT con cabecera y horas', () => {
    const t = parseTranscript('WEBVTT\n\n01:00:00.000 --> 01:00:01.000 align:start\nlargo directo\n');
    assert.equal(t[0].start, 3600);
  });
  it('ignora la marca de orden de bytes (BOM) de los archivos de Windows', () => {
    assert.equal(parseTranscript('\uFEFF{"words":[{"text":"a","start":0,"end":1}]}').length, 1);
    assert.equal(parseTranscript('\uFEFFWEBVTT\n\n00:00.000 --> 00:01.000\nhola\n').length, 1);
  });
  it('rechaza lo que no sirve con un motivo claro', () => {
    assert.throws(() => parseTranscript(''), /vacío/);
    assert.throws(() => parseTranscript('{no'), /JSON no válido/);
    assert.throws(() => parseTranscript('{"hola":1}'), /No reconozco/);
    assert.throws(() => parseTranscript('texto suelto'), /Formato no reconocido/);
    assert.throws(() => parseTranscript('{"words":[]}'), /ninguna palabra/);
  });
  it('spreadWords respeta los extremos', () => {
    const s = spreadWords('aa bbbb', 0, 6);
    assert.equal(s[0].end, 2);
    assert.equal(s[1].end, 6);
    assert.deepEqual(spreadWords('x', 5, 5), []);
  });
  it('transcriptForClaude agrupa con marcas de tiempo', () => {
    const txt = transcriptForClaude(SPEECH, 3);
    assert.match(txt, /^\[00:01\] Hola chicos, hoy vamos/);
    assert.match(txt, /\[00:06\] Madre mía!/);
  });
});

describe('plan: cortes, efectos y subtítulos', () => {
  const base = { start: 100, end: 130, title: 't' };
  it('acepta cortes y efectos válidos', () => {
    assert.equal(
      validateClipSpec({ ...base, cuts: [{ start: 105, end: 108 }], effects: [{ type: 'punch', at: 115 }, { type: 'fadeIn' }, { type: 'fadeOut', duration: 1 }], subtitles: 'karaoke' }),
      null,
    );
  });
  it('rechaza cortes mal puestos', () => {
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 90, end: 105 }] })!, /fuera del clip/);
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 105, end: 105.05 }] })!, /menos de/);
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 105, end: 110 }, { start: 109, end: 112 }] })!, /solapan/);
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 100.1, end: 129.9 }] })!, /menos de 0.3/);
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 100, end: 129.5 }] })!, /entre cortes|menos de/);
    assert.match(validateClipSpec({ ...base, cuts: 'x' })!, /lista/);
    assert.match(validateClipSpec({ ...base, cuts: Array.from({ length: 41 }, (_, i) => ({ start: 100 + i * 0.5, end: 100.2 + i * 0.5 })) })!, /más de 40/);
  });
  it('rechaza efectos mal puestos', () => {
    assert.match(validateClipSpec({ ...base, effects: [{ type: 'punch', at: 99 }] })!, /fuera del clip/);
    assert.match(validateClipSpec({ ...base, cuts: [{ start: 110, end: 112 }], effects: [{ type: 'punch', at: 111 }] })!, /cortada/);
    assert.match(validateClipSpec({ ...base, effects: [{ type: 'punch', at: 110, zoom: 3 }] })!, /zoom/);
    assert.match(validateClipSpec({ ...base, effects: [{ type: 'punch', at: 110, duration: 10 }] })!, /duration/);
    assert.match(validateClipSpec({ ...base, effects: [{ type: 'brillo' }] })!, /desconocido/);
    assert.match(validateClipSpec({ ...base, effects: [{ type: 'fadeIn' }, { type: 'fadeIn' }] })!, /solo puede haber/);
    assert.match(validateClipSpec({ ...base, effects: 'x' })!, /lista/);
    assert.match(validateClipSpec({ ...base, subtitles: 'comic' })!, /no existe/);
  });
  it('vídeo largo: efectos y subtítulos', () => {
    assert.equal(validateLongSpec({ title: 'x', segments: [{ start: 0, end: 30 }], effects: [{ type: 'fadeOut' }], subtitles: 'clasico' }), null);
    assert.match(validateLongSpec({ title: 'x', segments: [{ start: 0, end: 30 }], effects: [{ type: 'punch', at: 99 }] })!, /fuera del clip/);
    assert.match(validateLongSpec({ title: 'x', segments: [{ start: 0, end: 30 }], subtitles: 'zzz' })!, /no existe/);
  });
  it('parsePlan normaliza valores por defecto y ordena los cortes', () => {
    const { plan, errors } = parsePlan(
      JSON.stringify({ clips: [{ ...base, cuts: [{ start: 120, end: 122 }, { start: 105, end: 106 }], effects: [{ type: 'punch', at: 110 }, { type: 'fadeIn' }], subtitles: 'pop' }] }),
      1000,
    );
    assert.deepEqual(errors, []);
    const c = plan.clips[0];
    assert.deepEqual(c.cuts, [{ start: 105, end: 106 }, { start: 120, end: 122 }]);
    assert.deepEqual(c.effects, [{ type: 'punch', at: 110, duration: 1, zoom: 1.2 }, { type: 'fadeIn', duration: 0.5 }]);
    assert.equal(c.subtitles, 'pop');
  });
  it('un clip sin los campos nuevos queda exactamente como antes', () => {
    const { plan } = parsePlan(JSON.stringify({ clips: [base] }), 1000);
    assert.deepEqual(Object.keys(plan.clips[0]).sort(), ['cropX', 'end', 'kind', 'start', 'title']);
  });
});

describe('empaquetado de las fuentes de los subtítulos', () => {
  it('la fuente existe con su licencia y package.json la copia a los recursos del instalador', () => {
    assert.ok(fs.existsSync(path.join(FONTS, 'Inter-Bold.otf')));
    assert.ok(fs.existsSync(path.join(FONTS, 'Inter-LICENSE.txt')));
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { build: { extraResources: { from: string; to: string }[] } };
    assert.ok(pkg.build.extraResources.some((r) => r.from === 'resources/fonts' && r.to === 'fonts'));
  });
});

describe('ffmpeg: escape de rutas y filtros', () => {
  it('filterPath escapa barras, dos puntos y comillas', () => {
    assert.equal(filterPath('C:\\Users\\a b\\x.ass'), 'C\\:/Users/a b/x.ass');
    assert.equal(filterPath("/tmp/it's.ass"), "/tmp/it'\\\\\\''s.ass");
  });
  it('assFilter incluye la carpeta de fuentes solo si se indica', () => {
    assert.equal(assFilter({ ass: '/a/b.ass' }), "ass='/a/b.ass'");
    assert.equal(assFilter({ ass: '/a/b.ass', fontsDir: '/f' }), "ass='/a/b.ass':fontsdir='/f'");
  });
  it('punchFilter sube, mantiene y baja el zoom', () => {
    const f = punchFilter(1920, 1080, [{ a: 1, dur: 1, zoom: 1.2 }]);
    assert.match(f, /^scale=w='trunc\(1920\*\(1\+0\.200\*clip\(/);
    assert.match(f, /eval=frame,crop=1920:1080$/);
  });
});

/** Fracción de píxeles claros de un fotograma (a baja resolución). */
function brightFraction(file: string, at: number, region?: { y0: number; y1: number }): number {
  const W = 192;
  const H = 108;
  const buf = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'],
    { maxBuffer: 1 << 24 },
  );
  const y0 = Math.floor((region?.y0 ?? 0) * H);
  const y1 = Math.floor((region?.y1 ?? 1) * H);
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) if (buf[y * W + x] > 150) n++;
  return n / ((y1 - y0) * W);
}

function meanLuma(file: string, at: number): number {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  return buf[0];
}

describe('ffmpeg: montaje real (cortes, efectos y subtítulos)', () => {
  let root: string;
  let src: string;
  let black: string;
  before(() => {
    root = tmpDir();
    src = makeVideo(path.join(root, 'src.mp4'), { w: 1920, h: 1080, dur: 20 });
    black = path.join(root, 'black.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', black]);
  });
  after(() => rmDir(root));

  it('los cortes quitan tiempo: la duración es la de lo que se conserva y se valida', async () => {
    for (const kind of ['horizontal', 'vertical'] as const) {
      const out = path.join(root, `cuts-${kind}.mp4`);
      await renderClip(tools, src, { kind, start: 2, end: 14, cuts: [{ start: 5, end: 8 }, { start: 10, end: 11 }] }, out);
      const info = await validateRender(tools, out, kind, 8);
      assert.ok(Math.abs(info.durationSec - 8) < 0.6, `${kind}: ${info.durationSec}`);
      assert.equal(info.hasAudio, true);
    }
  });

  it('el audio también se corta (no queda desfasado)', async () => {
    const out = path.join(root, 'cuts-audio.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 0, end: 10, cuts: [{ start: 3, end: 6 }] }, out);
    const a = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', out]).toString();
    assert.ok(Math.abs(Number(a) - 7) < 0.5, a);
  });

  it('fadeIn parte de negro y fadeOut acaba en negro', async () => {
    const out = path.join(root, 'fade.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 2, end: 8, effects: [{ type: 'fadeIn', duration: 1 }, { type: 'fadeOut', duration: 1 }] }, out);
    const plain = path.join(root, 'nofade.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 2, end: 8 }, plain);
    assert.ok(meanLuma(out, 0) < 10, `inicio ${meanLuma(out, 0)}`);
    assert.ok(meanLuma(plain, 0) > 30);
    assert.ok(meanLuma(out, 3) > 30, 'el centro no se oscurece');
    assert.ok(meanLuma(out, 5.9) < 40, `final ${meanLuma(out, 5.9)}`);
    await validateRender(tools, out, 'horizontal', 6);
  });

  it('punch acerca la imagen en el momento indicado y no antes ni después', async () => {
    const a = path.join(root, 'punch.mp4');
    const b = path.join(root, 'nopunch.mp4');
    const spec = { kind: 'horizontal' as const, start: 0, end: 8 };
    await renderClip(tools, src, { ...spec, effects: [{ type: 'punch', at: 3, duration: 2, zoom: 1.4 }] }, a);
    await renderClip(tools, src, spec, b);
    const diff = (t: number) => {
      const fa = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', a, '-frames:v', '1', '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
      const fb = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', b, '-frames:v', '1', '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
      let d = 0;
      for (let i = 0; i < fa.length; i++) d += Math.abs(fa[i] - fb[i]);
      return d / fa.length;
    };
    assert.ok(diff(0.5) < 2, `antes: ${diff(0.5)}`);
    assert.ok(diff(4) > 8, `en el pico: ${diff(4)}`);
    assert.ok(diff(7) < 2, `después: ${diff(7)}`);
    const info = await validateRender(tools, a, 'horizontal', 8);
    assert.equal(info.width, 1920);
  });

  it('punch también funciona en vertical y con cortes (el efecto cae en el tramo correcto)', async () => {
    const out = path.join(root, 'punch-v.mp4');
    await renderClip(tools, src, { kind: 'vertical', start: 0, end: 12, cuts: [{ start: 2, end: 4 }], effects: [{ type: 'punch', at: 8 }] }, out);
    await validateRender(tools, out, 'vertical', 10);
  });

  it('los subtítulos quedan grabados: hay texto claro durante la frase y nada fuera de ella', async () => {
    const ass = path.join(root, 'sub.ass');
    fs.writeFileSync(ass, buildAss([w('HOLA', 1, 2), w('MUNDO', 2, 3.5)], SUBTITLE_STYLES.clasico, 1920, 1080));
    const out = path.join(root, 'subs.mp4');
    await renderClip(tools, black, { kind: 'horizontal', start: 0, end: 6, subs: { ass, fontsDir: FONTS } }, out);
    await validateRender(tools, out, 'horizontal', 6);
    const bottom = { y0: 0.7, y1: 1 };
    assert.ok(brightFraction(out, 1.5, bottom) > 0.004, `con subtítulo: ${brightFraction(out, 1.5, bottom)}`);
    assert.ok(brightFraction(out, 5, bottom) < 0.0005, 'sin subtítulo a los 5 s');
    assert.ok(brightFraction(out, 1.5, { y0: 0, y1: 0.5 }) < 0.0005, 'el texto no sale arriba');
  });

  it('cada estilo se dibuja: impacto en el centro, vertical con el texto sobre el borde inferior', async () => {
    const ass = path.join(root, 'pop.ass');
    fs.writeFileSync(ass, buildAss([w('GOL', 1, 3)], SUBTITLE_STYLES.pop, 1080, 1920));
    const out = path.join(root, 'pop.mp4');
    await renderClip(tools, black, { kind: 'vertical', start: 0, end: 4, subs: { ass, fontsDir: FONTS } }, out);
    const mid = brightFraction(out, 2, { y0: 0.4, y1: 0.6 });
    assert.ok(mid > 0.004, `centro ${mid}`);
    assert.ok(brightFraction(out, 2, { y0: 0.85, y1: 1 }) < 0.0005);
    for (const id of ['clasico', 'karaoke', 'minimal'] as const) {
      const f = path.join(root, `${id}.ass`);
      fs.writeFileSync(f, buildAss([w('Prueba', 1, 3), w('real', 3, 4)], SUBTITLE_STYLES[id], 1080, 1920));
      const o = path.join(root, `${id}.mp4`);
      await renderClip(tools, black, { kind: 'vertical', start: 0, end: 5, subs: { ass: f, fontsDir: FONTS } }, o);
      assert.ok(brightFraction(o, 2, { y0: 0.6, y1: 1 }) > 0.002, `${id} sin texto`);
    }
  });

  it('subtítulos con cortes: la frase sigue sincronizada tras quitar una parte', async () => {
    const words = wordsForOutput([w('ADIOS', 10, 11)], keptRanges(4, 14, [{ start: 6, end: 9 }]));
    // en el VOD dice "ADIOS" en 10-11; el clip son 4..14 sin 6..9, así que sale hacia el segundo 3-4 del resultado
    assert.ok(Math.abs(words[0].start - 3) < 0.1, `empieza en ${words[0].start}`);
    const ass = path.join(root, 'cut.ass');
    fs.writeFileSync(ass, buildAss(words, SUBTITLE_STYLES.clasico, 1920, 1080));
    const out = path.join(root, 'cut-subs.mp4');
    await renderClip(tools, black, { kind: 'horizontal', start: 4, end: 14, cuts: [{ start: 6, end: 9 }], subs: { ass, fontsDir: FONTS } }, out);
    assert.ok(brightFraction(out, 3.5, { y0: 0.7, y1: 1 }) > 0.002);
    assert.ok(brightFraction(out, 1, { y0: 0.7, y1: 1 }) < 0.0005);
    assert.ok(brightFraction(out, 6.8, { y0: 0.7, y1: 1 }) < 0.0005, 'ya no está en la posición sin recolocar');
  });

  it('rutas con espacios y comillas funcionan en el filtro', async () => {
    const dir = path.join(root, "carpeta con espacios y 'comillas'");
    fs.mkdirSync(dir);
    const ass = path.join(dir, "sub's.ass");
    fs.writeFileSync(ass, buildAss([w('RUTA', 1, 3)], SUBTITLE_STYLES.clasico, 1920, 1080));
    const out = path.join(root, 'ruta.mp4');
    await renderClip(tools, black, { kind: 'horizontal', start: 0, end: 4, subs: { ass, fontsDir: dir } }, out);
    assert.ok(brightFraction(out, 2, { y0: 0.7, y1: 1 }) > 0.002);
  });

  it('vídeo largo con efectos y subtítulos', async () => {
    const ass = path.join(root, 'long.ass');
    fs.writeFileSync(ass, buildAss([w('LARGO', 1, 3)], SUBTITLE_STYLES.clasico, 1920, 1080));
    const out = path.join(root, 'long.mp4');
    await renderLong(tools, black, { title: 'x', segments: [{ start: 0, end: 4 }, { start: 8, end: 12 }], effects: [{ type: 'fadeOut', duration: 1 }] }, out, { ass, fontsDir: FONTS });
    const info = await validateRender(tools, out, 'long', 8, 2);
    assert.ok(info.hasAudio);
    assert.ok(brightFraction(out, 2, { y0: 0.7, y1: 1 }) > 0.002);
    assert.ok((await probe(tools, out)).durationSec > 7);
  });

  it('sin opciones nuevas el render es el de siempre (un solo tramo, sin segunda pasada)', async () => {
    const out = path.join(root, 'plain.mp4');
    await renderClip(tools, src, { kind: 'horizontal', start: 1, end: 5 }, out);
    await validateRender(tools, out, 'horizontal', 4);
  });
});

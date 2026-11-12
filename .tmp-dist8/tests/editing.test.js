"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const timeline_1 = require("../shared/timeline");
const subtitles_1 = require("../shared/subtitles");
const transcript_1 = require("../shared/transcript");
const plan_1 = require("../shared/plan");
const ffmpeg_1 = require("../electron/services/ffmpeg");
const tools_1 = require("../electron/services/tools");
const helpers_1 = require("./helpers");
const tools = (0, tools_1.resolveToolPaths)('', '');
const FONTS = node_path_1.default.resolve(process.cwd(), 'resources/fonts');
const w = (text, start, end) => ({ text, start, end });
const SPEECH = [
    w('Hola', 1.0, 1.3), w('chicos,', 1.3, 1.8), w('hoy', 1.9, 2.1), w('vamos', 2.1, 2.5), w('a', 2.5, 2.6),
    w('romper', 2.6, 3.0), w('el', 3.0, 3.1), w('juego.', 3.1, 3.6),
    w('Madre', 6.0, 6.4), w('mía!', 6.4, 6.9),
];
(0, node_test_1.describe)('timeline: cortes', () => {
    (0, node_test_1.it)('quita los cortes y deja tramos ordenados', () => {
        strict_1.default.deepEqual((0, timeline_1.keptRanges)(0, 10, [{ start: 6, end: 8 }, { start: 2, end: 3 }]), [
            { start: 0, end: 2 }, { start: 3, end: 6 }, { start: 8, end: 10 },
        ]);
    });
    (0, node_test_1.it)('sin cortes devuelve el tramo entero; un corte que lo cubre todo no deja nada', () => {
        strict_1.default.deepEqual((0, timeline_1.keptRanges)(5, 9), [{ start: 5, end: 9 }]);
        strict_1.default.deepEqual((0, timeline_1.keptRanges)(5, 9, [{ start: 0, end: 20 }]), []);
    });
    (0, node_test_1.it)('ignora los cortes fuera del tramo y fusiona los solapados', () => {
        strict_1.default.deepEqual((0, timeline_1.keptRanges)(0, 10, [{ start: 20, end: 30 }, { start: 2, end: 5 }, { start: 4, end: 6 }]), [
            { start: 0, end: 2 }, { start: 6, end: 10 },
        ]);
    });
    (0, node_test_1.it)('toOutputTime pasa el tiempo del VOD al del resultado y devuelve null en lo cortado', () => {
        const r = (0, timeline_1.keptRanges)(100, 110, [{ start: 102, end: 105 }]);
        strict_1.default.equal((0, timeline_1.totalDuration)(r), 7);
        strict_1.default.equal((0, timeline_1.toOutputTime)(101, r), 1);
        strict_1.default.equal((0, timeline_1.toOutputTime)(106, r), 3);
        strict_1.default.equal((0, timeline_1.toOutputTime)(103, r), null);
    });
});
(0, node_test_1.describe)('subtítulos: reparto en frases', () => {
    (0, node_test_1.it)('corta por fin de frase, pausas y número de palabras', () => {
        const cues = (0, subtitles_1.buildCues)(SPEECH, subtitles_1.SUBTITLE_STYLES.clasico);
        strict_1.default.deepEqual(cues.map((c) => c.words.map((x) => x.text).join(' ')), ['Hola chicos, hoy vamos', 'a romper el juego.', 'Madre mía!']);
    });
    (0, node_test_1.it)('el estilo Impacto saca dos palabras como mucho', () => {
        const cues = (0, subtitles_1.buildCues)(SPEECH, subtitles_1.SUBTITLE_STYLES.pop);
        strict_1.default.ok(cues.every((c) => c.words.length <= 2));
    });
    (0, node_test_1.it)('el subtítulo se queda un poco tras la última palabra sin pisar al siguiente', () => {
        const cues = (0, subtitles_1.buildCues)(SPEECH, subtitles_1.SUBTITLE_STYLES.clasico);
        strict_1.default.ok(cues[0].end > 1.8 && cues[0].end <= cues[1].start);
        strict_1.default.ok(cues[2].end > 6.9 && cues[2].end <= 6.9 + 0.31);
        strict_1.default.ok(cues.every((c, i) => i === 0 || c.start >= cues[i - 1].end));
    });
    (0, node_test_1.it)('ignora palabras vacías y no se rompe sin palabras', () => {
        strict_1.default.deepEqual((0, subtitles_1.buildCues)([], subtitles_1.SUBTITLE_STYLES.clasico), []);
        strict_1.default.equal((0, subtitles_1.buildCues)([w('  ', 0, 1)], subtitles_1.SUBTITLE_STYLES.clasico).length, 0);
    });
    (0, node_test_1.it)('cueAt y activeWordIndex localizan el momento', () => {
        const cues = (0, subtitles_1.buildCues)(SPEECH, subtitles_1.SUBTITLE_STYLES.karaoke);
        const c = (0, subtitles_1.cueAt)(cues, 2.2);
        strict_1.default.ok(c.words.some((x) => x.text === 'vamos'));
        strict_1.default.equal(c.words[(0, subtitles_1.activeWordIndex)(c, 2.2)].text, 'vamos');
        strict_1.default.equal((0, subtitles_1.cueAt)(cues, 5), null);
    });
    (0, node_test_1.it)('wordsForOutput descarta lo cortado y recoloca el resto', () => {
        const ranges = (0, timeline_1.keptRanges)(1, 7, [{ start: 3.7, end: 5.9 }]);
        const out = (0, subtitles_1.wordsForOutput)(SPEECH, ranges);
        strict_1.default.equal(out.length, SPEECH.length); // ninguna palabra cae en el corte
        strict_1.default.ok(out[0].start < 0.2);
        const madre = out.find((x) => x.text === 'Madre');
        strict_1.default.ok(Math.abs((madre.start + madre.end) / 2 - (2.7 + 0.3)) < 0.01, `Madre en ${madre.start}`);
        const cut = (0, subtitles_1.wordsForOutput)(SPEECH, (0, timeline_1.keptRanges)(1, 7, [{ start: 1.9, end: 3.0 }]));
        strict_1.default.ok(!cut.some((x) => x.text === 'vamos'));
    });
});
(0, node_test_1.describe)('subtítulos: archivo ASS', () => {
    (0, node_test_1.it)('assColor convierte a BGR con transparencia', () => {
        strict_1.default.equal((0, subtitles_1.assColor)('#FF0000'), '&H000000FF');
        strict_1.default.equal((0, subtitles_1.assColor)('#00FF00', 0.5), '&H8000FF00');
        strict_1.default.throws(() => (0, subtitles_1.assColor)('rojo'), /no válido/);
    });
    (0, node_test_1.it)('captionLayout: vertical con más margen inferior y letra algo mayor', () => {
        const h = (0, subtitles_1.captionLayout)(subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080);
        const v = (0, subtitles_1.captionLayout)(subtitles_1.SUBTITLE_STYLES.clasico, 1080, 1920);
        strict_1.default.ok(v.fontPx > h.fontPx);
        strict_1.default.ok(v.marginV > h.marginV);
        strict_1.default.equal((0, subtitles_1.captionLayout)(subtitles_1.SUBTITLE_STYLES.pop, 1080, 1920).marginV, 0);
    });
    (0, node_test_1.it)('genera cabecera, estilo y un diálogo por frase', () => {
        const ass = (0, subtitles_1.buildAss)(SPEECH, subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080);
        strict_1.default.match(ass, /PlayResX: 1920/);
        strict_1.default.match(ass, /PlayResY: 1080/);
        strict_1.default.match(ass, /Style: Default,Inter,/);
        strict_1.default.equal(ass.split('\n').filter((l) => l.startsWith('Dialogue:')).length, 3);
        strict_1.default.match(ass, /Dialogue: 0,0:00:01\.00,0:00:0\d\.\d\d,Default,,0,0,0,,Hola chicos,/);
    });
    (0, node_test_1.it)('Karaoke crea un evento por palabra con la activa resaltada', () => {
        const ass = (0, subtitles_1.buildAss)(SPEECH, subtitles_1.SUBTITLE_STYLES.karaoke, 1920, 1080);
        const dlg = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
        strict_1.default.ok(dlg.length >= SPEECH.length);
        strict_1.default.match(dlg[0], /\{\\1c&H0000D4FF\}Hola\{\\1c&H00FFFFFF\} chicos,/);
    });
    (0, node_test_1.it)('Impacto pasa a mayúsculas y se centra; Discreto usa caja', () => {
        const pop = (0, subtitles_1.buildAss)(SPEECH, subtitles_1.SUBTITLE_STYLES.pop, 1080, 1920);
        strict_1.default.match(pop, /HOLA/);
        strict_1.default.match(pop, /,5,\d+,\d+,0,1\n/); // alineación 5 (centro) y margen vertical 0
        const min = (0, subtitles_1.buildAss)(SPEECH, subtitles_1.SUBTITLE_STYLES.minimal, 1920, 1080);
        strict_1.default.match(min, /,3,\d+,0,2,/); // BorderStyle 3 = caja
    });
    (0, node_test_1.it)('el texto no puede colar código ASS', () => {
        const ass = (0, subtitles_1.buildAss)([w('{\\an8}hola\\N', 0, 1)], subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080);
        const line = ass.split('\n').find((l) => l.startsWith('Dialogue:'));
        strict_1.default.ok(!/[{}\\]/.test(line.split(',,').pop()), line);
    });
});
(0, node_test_1.describe)('transcripción: lectura de formatos', () => {
    (0, node_test_1.it)('formato propio', () => {
        const t = (0, transcript_1.parseTranscript)(JSON.stringify({ words: [{ text: 'b', start: 2, end: 3 }, { text: 'a', start: 1, end: 2 }, { text: 'x', start: 'no' }] }));
        strict_1.default.deepEqual(t.map((x) => x.text), ['a', 'b']);
    });
    (0, node_test_1.it)('Whisper con palabras', () => {
        const t = (0, transcript_1.parseTranscript)(JSON.stringify({ text: 'hola mundo', segments: [{ start: 0, end: 2, text: ' hola mundo', words: [{ word: ' hola', start: 0, end: 1, probability: 0.9 }, { word: ' mundo', start: 1, end: 2 }] }] }));
        strict_1.default.deepEqual(t.map((x) => x.text), ['hola', 'mundo']);
    });
    (0, node_test_1.it)('Whisper sin palabras reparte el segmento', () => {
        const t = (0, transcript_1.parseTranscript)(JSON.stringify({ segments: [{ start: 10, end: 14, text: 'uno dos tres cuatro' }] }));
        strict_1.default.equal(t.length, 4);
        strict_1.default.equal(t[0].start, 10);
        strict_1.default.ok(Math.abs(t[3].end - 14) < 1e-9);
    });
    (0, node_test_1.it)('SRT', () => {
        const t = (0, transcript_1.parseTranscript)('1\n00:00:01,000 --> 00:00:03,000\nHola a todos\n\n2\n00:01:00,500 --> 00:01:02,000\n<i>Adiós</i>\n');
        strict_1.default.deepEqual(t.map((x) => x.text), ['Hola', 'a', 'todos', 'Adiós']);
        strict_1.default.equal(t[0].start, 1);
        strict_1.default.equal(t[3].start, 60.5);
    });
    (0, node_test_1.it)('VTT con cabecera y horas', () => {
        const t = (0, transcript_1.parseTranscript)('WEBVTT\n\n01:00:00.000 --> 01:00:01.000 align:start\nlargo directo\n');
        strict_1.default.equal(t[0].start, 3600);
    });
    (0, node_test_1.it)('ignora la marca de orden de bytes (BOM) de los archivos de Windows', () => {
        strict_1.default.equal((0, transcript_1.parseTranscript)('\uFEFF{"words":[{"text":"a","start":0,"end":1}]}').length, 1);
        strict_1.default.equal((0, transcript_1.parseTranscript)('\uFEFFWEBVTT\n\n00:00.000 --> 00:01.000\nhola\n').length, 1);
    });
    (0, node_test_1.it)('rechaza lo que no sirve con un motivo claro', () => {
        strict_1.default.throws(() => (0, transcript_1.parseTranscript)(''), /vacío/);
        strict_1.default.throws(() => (0, transcript_1.parseTranscript)('{no'), /JSON no válido/);
        strict_1.default.throws(() => (0, transcript_1.parseTranscript)('{"hola":1}'), /No reconozco/);
        strict_1.default.throws(() => (0, transcript_1.parseTranscript)('texto suelto'), /Formato no reconocido/);
        strict_1.default.throws(() => (0, transcript_1.parseTranscript)('{"words":[]}'), /ninguna palabra/);
    });
    (0, node_test_1.it)('spreadWords respeta los extremos', () => {
        const s = (0, transcript_1.spreadWords)('aa bbbb', 0, 6);
        strict_1.default.equal(s[0].end, 2);
        strict_1.default.equal(s[1].end, 6);
        strict_1.default.deepEqual((0, transcript_1.spreadWords)('x', 5, 5), []);
    });
    (0, node_test_1.it)('transcriptForClaude agrupa con marcas de tiempo', () => {
        const txt = (0, transcript_1.transcriptForClaude)(SPEECH, 3);
        strict_1.default.match(txt, /^\[00:01\] Hola chicos, hoy vamos/);
        strict_1.default.match(txt, /\[00:06\] Madre mía!/);
    });
});
(0, node_test_1.describe)('plan: cortes, efectos y subtítulos', () => {
    const base = { start: 100, end: 130, title: 't' };
    (0, node_test_1.it)('acepta cortes y efectos válidos', () => {
        strict_1.default.equal((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 105, end: 108 }], effects: [{ type: 'punch', at: 115 }, { type: 'fadeIn' }, { type: 'fadeOut', duration: 1 }], subtitles: 'karaoke' }), null);
    });
    (0, node_test_1.it)('rechaza cortes mal puestos', () => {
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 90, end: 105 }] }), /fuera del clip/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 105, end: 105.05 }] }), /menos de/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 105, end: 110 }, { start: 109, end: 112 }] }), /solapan/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 100.1, end: 129.9 }] }), /menos de 0.3/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 100, end: 129.5 }] }), /entre cortes|menos de/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: 'x' }), /lista/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: Array.from({ length: 41 }, (_, i) => ({ start: 100 + i * 0.5, end: 100.2 + i * 0.5 })) }), /más de 40/);
    });
    (0, node_test_1.it)('rechaza efectos mal puestos', () => {
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: [{ type: 'punch', at: 99 }] }), /fuera del clip/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, cuts: [{ start: 110, end: 112 }], effects: [{ type: 'punch', at: 111 }] }), /cortada/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: [{ type: 'punch', at: 110, zoom: 3 }] }), /zoom/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: [{ type: 'punch', at: 110, duration: 10 }] }), /duration/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: [{ type: 'brillo' }] }), /desconocido/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: [{ type: 'fadeIn' }, { type: 'fadeIn' }] }), /solo puede haber/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, effects: 'x' }), /lista/);
        strict_1.default.match((0, plan_1.validateClipSpec)({ ...base, subtitles: 'comic' }), /no existe/);
    });
    (0, node_test_1.it)('vídeo largo: efectos y subtítulos', () => {
        strict_1.default.equal((0, plan_1.validateLongSpec)({ title: 'x', segments: [{ start: 0, end: 30 }], effects: [{ type: 'fadeOut' }], subtitles: 'clasico' }), null);
        strict_1.default.match((0, plan_1.validateLongSpec)({ title: 'x', segments: [{ start: 0, end: 30 }], effects: [{ type: 'punch', at: 99 }] }), /fuera del clip/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ title: 'x', segments: [{ start: 0, end: 30 }], subtitles: 'zzz' }), /no existe/);
    });
    (0, node_test_1.it)('parsePlan normaliza valores por defecto y ordena los cortes', () => {
        const { plan, errors } = (0, plan_1.parsePlan)(JSON.stringify({ clips: [{ ...base, cuts: [{ start: 120, end: 122 }, { start: 105, end: 106 }], effects: [{ type: 'punch', at: 110 }, { type: 'fadeIn' }], subtitles: 'pop' }] }), 1000);
        strict_1.default.deepEqual(errors, []);
        const c = plan.clips[0];
        strict_1.default.deepEqual(c.cuts, [{ start: 105, end: 106 }, { start: 120, end: 122 }]);
        strict_1.default.deepEqual(c.effects, [{ type: 'punch', at: 110, duration: 1, zoom: 1.2 }, { type: 'fadeIn', duration: 0.5 }]);
        strict_1.default.equal(c.subtitles, 'pop');
    });
    (0, node_test_1.it)('un clip sin los campos nuevos queda exactamente como antes', () => {
        const { plan } = (0, plan_1.parsePlan)(JSON.stringify({ clips: [base] }), 1000);
        strict_1.default.deepEqual(Object.keys(plan.clips[0]).sort(), ['cropX', 'end', 'kind', 'start', 'title']);
    });
});
(0, node_test_1.describe)('empaquetado de las fuentes de los subtítulos', () => {
    (0, node_test_1.it)('la fuente existe con su licencia y package.json la copia a los recursos del instalador', () => {
        strict_1.default.ok(node_fs_1.default.existsSync(node_path_1.default.join(FONTS, 'Inter-Bold.otf')));
        strict_1.default.ok(node_fs_1.default.existsSync(node_path_1.default.join(FONTS, 'Inter-LICENSE.txt')));
        const pkg = JSON.parse(node_fs_1.default.readFileSync('package.json', 'utf8'));
        strict_1.default.ok(pkg.build.extraResources.some((r) => r.from === 'resources/fonts' && r.to === 'fonts'));
    });
});
(0, node_test_1.describe)('ffmpeg: escape de rutas y filtros', () => {
    (0, node_test_1.it)('filterPath escapa barras, dos puntos y comillas', () => {
        strict_1.default.equal((0, ffmpeg_1.filterPath)('C:\\Users\\a b\\x.ass'), 'C\\:/Users/a b/x.ass');
        strict_1.default.equal((0, ffmpeg_1.filterPath)("/tmp/it's.ass"), "/tmp/it'\\\\\\''s.ass");
    });
    (0, node_test_1.it)('assFilter incluye la carpeta de fuentes solo si se indica', () => {
        strict_1.default.equal((0, ffmpeg_1.assFilter)({ ass: '/a/b.ass' }), "ass='/a/b.ass'");
        strict_1.default.equal((0, ffmpeg_1.assFilter)({ ass: '/a/b.ass', fontsDir: '/f' }), "ass='/a/b.ass':fontsdir='/f'");
    });
    (0, node_test_1.it)('punchFilter sube, mantiene y baja el zoom', () => {
        const f = (0, ffmpeg_1.punchFilter)(1920, 1080, [{ a: 1, dur: 1, zoom: 1.2 }]);
        strict_1.default.match(f, /^scale=w='trunc\(1920\*\(1\+0\.200\*clip\(/);
        strict_1.default.match(f, /eval=frame,crop=1920:1080$/);
    });
});
/** Fracción de píxeles claros de un fotograma (a baja resolución). */
function brightFraction(file, at, region) {
    const W = 192;
    const H = 108;
    const buf = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 });
    const y0 = Math.floor((region?.y0 ?? 0) * H);
    const y1 = Math.floor((region?.y1 ?? 1) * H);
    let n = 0;
    for (let y = y0; y < y1; y++)
        for (let x = 0; x < W; x++)
            if (buf[y * W + x] > 150)
                n++;
    return n / ((y1 - y0) * W);
}
function meanLuma(file, at) {
    const buf = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=1:1,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
    return buf[0];
}
(0, node_test_1.describe)('ffmpeg: montaje real (cortes, efectos y subtítulos)', () => {
    let root;
    let src;
    let black;
    (0, node_test_1.before)(() => {
        root = (0, helpers_1.tmpDir)();
        src = (0, helpers_1.makeVideo)(node_path_1.default.join(root, 'src.mp4'), { w: 1920, h: 1080, dur: 20 });
        black = node_path_1.default.join(root, 'black.mp4');
        (0, node_child_process_1.execFileSync)('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=1920x1080:r=30:d=20', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', black]);
    });
    (0, node_test_1.after)(() => (0, helpers_1.rmDir)(root));
    (0, node_test_1.it)('los cortes quitan tiempo: la duración es la de lo que se conserva y se valida', async () => {
        for (const kind of ['horizontal', 'vertical']) {
            const out = node_path_1.default.join(root, `cuts-${kind}.mp4`);
            await (0, ffmpeg_1.renderClip)(tools, src, { kind, start: 2, end: 14, cuts: [{ start: 5, end: 8 }, { start: 10, end: 11 }] }, out);
            const info = await (0, ffmpeg_1.validateRender)(tools, out, kind, 8);
            strict_1.default.ok(Math.abs(info.durationSec - 8) < 0.6, `${kind}: ${info.durationSec}`);
            strict_1.default.equal(info.hasAudio, true);
        }
    });
    (0, node_test_1.it)('el audio también se corta (no queda desfasado)', async () => {
        const out = node_path_1.default.join(root, 'cuts-audio.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 0, end: 10, cuts: [{ start: 3, end: 6 }] }, out);
        const a = (0, node_child_process_1.execFileSync)('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'csv=p=0', out]).toString();
        strict_1.default.ok(Math.abs(Number(a) - 7) < 0.5, a);
    });
    (0, node_test_1.it)('fadeIn parte de negro y fadeOut acaba en negro', async () => {
        const out = node_path_1.default.join(root, 'fade.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 2, end: 8, effects: [{ type: 'fadeIn', duration: 1 }, { type: 'fadeOut', duration: 1 }] }, out);
        const plain = node_path_1.default.join(root, 'nofade.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 2, end: 8 }, plain);
        strict_1.default.ok(meanLuma(out, 0) < 10, `inicio ${meanLuma(out, 0)}`);
        strict_1.default.ok(meanLuma(plain, 0) > 30);
        strict_1.default.ok(meanLuma(out, 3) > 30, 'el centro no se oscurece');
        strict_1.default.ok(meanLuma(out, 5.9) < 40, `final ${meanLuma(out, 5.9)}`);
        await (0, ffmpeg_1.validateRender)(tools, out, 'horizontal', 6);
    });
    (0, node_test_1.it)('punch acerca la imagen en el momento indicado y no antes ni después', async () => {
        const a = node_path_1.default.join(root, 'punch.mp4');
        const b = node_path_1.default.join(root, 'nopunch.mp4');
        const spec = { kind: 'horizontal', start: 0, end: 8 };
        await (0, ffmpeg_1.renderClip)(tools, src, { ...spec, effects: [{ type: 'punch', at: 3, duration: 2, zoom: 1.4 }] }, a);
        await (0, ffmpeg_1.renderClip)(tools, src, spec, b);
        const diff = (t) => {
            const fa = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', a, '-frames:v', '1', '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
            const fb = (0, node_child_process_1.execFileSync)('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', b, '-frames:v', '1', '-vf', 'scale=96:54,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
            let d = 0;
            for (let i = 0; i < fa.length; i++)
                d += Math.abs(fa[i] - fb[i]);
            return d / fa.length;
        };
        strict_1.default.ok(diff(0.5) < 2, `antes: ${diff(0.5)}`);
        strict_1.default.ok(diff(4) > 8, `en el pico: ${diff(4)}`);
        strict_1.default.ok(diff(7) < 2, `después: ${diff(7)}`);
        const info = await (0, ffmpeg_1.validateRender)(tools, a, 'horizontal', 8);
        strict_1.default.equal(info.width, 1920);
    });
    (0, node_test_1.it)('punch también funciona en vertical y con cortes (el efecto cae en el tramo correcto)', async () => {
        const out = node_path_1.default.join(root, 'punch-v.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'vertical', start: 0, end: 12, cuts: [{ start: 2, end: 4 }], effects: [{ type: 'punch', at: 8 }] }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'vertical', 10);
    });
    (0, node_test_1.it)('los subtítulos quedan grabados: hay texto claro durante la frase y nada fuera de ella', async () => {
        const ass = node_path_1.default.join(root, 'sub.ass');
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)([w('HOLA', 1, 2), w('MUNDO', 2, 3.5)], subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080));
        const out = node_path_1.default.join(root, 'subs.mp4');
        await (0, ffmpeg_1.renderClip)(tools, black, { kind: 'horizontal', start: 0, end: 6, subs: { ass, fontsDir: FONTS } }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'horizontal', 6);
        const bottom = { y0: 0.7, y1: 1 };
        strict_1.default.ok(brightFraction(out, 1.5, bottom) > 0.004, `con subtítulo: ${brightFraction(out, 1.5, bottom)}`);
        strict_1.default.ok(brightFraction(out, 5, bottom) < 0.0005, 'sin subtítulo a los 5 s');
        strict_1.default.ok(brightFraction(out, 1.5, { y0: 0, y1: 0.5 }) < 0.0005, 'el texto no sale arriba');
    });
    (0, node_test_1.it)('cada estilo se dibuja: impacto en el centro, vertical con el texto sobre el borde inferior', async () => {
        const ass = node_path_1.default.join(root, 'pop.ass');
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)([w('GOL', 1, 3)], subtitles_1.SUBTITLE_STYLES.pop, 1080, 1920));
        const out = node_path_1.default.join(root, 'pop.mp4');
        await (0, ffmpeg_1.renderClip)(tools, black, { kind: 'vertical', start: 0, end: 4, subs: { ass, fontsDir: FONTS } }, out);
        const mid = brightFraction(out, 2, { y0: 0.4, y1: 0.6 });
        strict_1.default.ok(mid > 0.004, `centro ${mid}`);
        strict_1.default.ok(brightFraction(out, 2, { y0: 0.85, y1: 1 }) < 0.0005);
        for (const id of ['clasico', 'karaoke', 'minimal']) {
            const f = node_path_1.default.join(root, `${id}.ass`);
            node_fs_1.default.writeFileSync(f, (0, subtitles_1.buildAss)([w('Prueba', 1, 3), w('real', 3, 4)], subtitles_1.SUBTITLE_STYLES[id], 1080, 1920));
            const o = node_path_1.default.join(root, `${id}.mp4`);
            await (0, ffmpeg_1.renderClip)(tools, black, { kind: 'vertical', start: 0, end: 5, subs: { ass: f, fontsDir: FONTS } }, o);
            strict_1.default.ok(brightFraction(o, 2, { y0: 0.6, y1: 1 }) > 0.002, `${id} sin texto`);
        }
    });
    (0, node_test_1.it)('subtítulos con cortes: la frase sigue sincronizada tras quitar una parte', async () => {
        const words = (0, subtitles_1.wordsForOutput)([w('ADIOS', 10, 11)], (0, timeline_1.keptRanges)(4, 14, [{ start: 6, end: 9 }]));
        // en el VOD dice "ADIOS" en 10-11; el clip son 4..14 sin 6..9, así que sale hacia el segundo 3-4 del resultado
        strict_1.default.ok(Math.abs(words[0].start - 3) < 0.1, `empieza en ${words[0].start}`);
        const ass = node_path_1.default.join(root, 'cut.ass');
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)(words, subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080));
        const out = node_path_1.default.join(root, 'cut-subs.mp4');
        await (0, ffmpeg_1.renderClip)(tools, black, { kind: 'horizontal', start: 4, end: 14, cuts: [{ start: 6, end: 9 }], subs: { ass, fontsDir: FONTS } }, out);
        strict_1.default.ok(brightFraction(out, 3.5, { y0: 0.7, y1: 1 }) > 0.002);
        strict_1.default.ok(brightFraction(out, 1, { y0: 0.7, y1: 1 }) < 0.0005);
        strict_1.default.ok(brightFraction(out, 6.8, { y0: 0.7, y1: 1 }) < 0.0005, 'ya no está en la posición sin recolocar');
    });
    (0, node_test_1.it)('rutas con espacios y comillas funcionan en el filtro', async () => {
        const dir = node_path_1.default.join(root, "carpeta con espacios y 'comillas'");
        node_fs_1.default.mkdirSync(dir);
        const ass = node_path_1.default.join(dir, "sub's.ass");
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)([w('RUTA', 1, 3)], subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080));
        const out = node_path_1.default.join(root, 'ruta.mp4');
        await (0, ffmpeg_1.renderClip)(tools, black, { kind: 'horizontal', start: 0, end: 4, subs: { ass, fontsDir: dir } }, out);
        strict_1.default.ok(brightFraction(out, 2, { y0: 0.7, y1: 1 }) > 0.002);
    });
    (0, node_test_1.it)('vídeo largo con efectos y subtítulos', async () => {
        const ass = node_path_1.default.join(root, 'long.ass');
        node_fs_1.default.writeFileSync(ass, (0, subtitles_1.buildAss)([w('LARGO', 1, 3)], subtitles_1.SUBTITLE_STYLES.clasico, 1920, 1080));
        const out = node_path_1.default.join(root, 'long.mp4');
        await (0, ffmpeg_1.renderLong)(tools, black, { title: 'x', segments: [{ start: 0, end: 4 }, { start: 8, end: 12 }], effects: [{ type: 'fadeOut', duration: 1 }] }, out, { ass, fontsDir: FONTS });
        const info = await (0, ffmpeg_1.validateRender)(tools, out, 'long', 8, 2);
        strict_1.default.ok(info.hasAudio);
        strict_1.default.ok(brightFraction(out, 2, { y0: 0.7, y1: 1 }) > 0.002);
        strict_1.default.ok((await (0, ffmpeg_1.probe)(tools, out)).durationSec > 7);
    });
    (0, node_test_1.it)('sin opciones nuevas el render es el de siempre (un solo tramo, sin segunda pasada)', async () => {
        const out = node_path_1.default.join(root, 'plain.mp4');
        await (0, ffmpeg_1.renderClip)(tools, src, { kind: 'horizontal', start: 1, end: 5 }, out);
        await (0, ffmpeg_1.validateRender)(tools, out, 'horizontal', 4);
    });
});

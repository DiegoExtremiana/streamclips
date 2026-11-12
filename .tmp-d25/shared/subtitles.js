"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayText = exports.cueAt = exports.SUBTITLE_STYLES = exports.isSubtitleStyleId = exports.SUBTITLE_STYLE_IDS = void 0;
exports.buildCues = buildCues;
exports.wordsForOutput = wordsForOutput;
exports.activeWordIndex = activeWordIndex;
exports.captionLayout = captionLayout;
exports.assColor = assColor;
exports.assEscape = assEscape;
exports.buildAss = buildAss;
const timeline_1 = require("./timeline");
exports.SUBTITLE_STYLE_IDS = ['clasico', 'karaoke', 'pop', 'minimal'];
const isSubtitleStyleId = (v) => typeof v === 'string' && exports.SUBTITLE_STYLE_IDS.includes(v);
exports.isSubtitleStyleId = isSubtitleStyleId;
exports.SUBTITLE_STYLES = {
    clasico: {
        id: 'clasico',
        label: 'Clásico',
        description: 'Blanco con contorno negro, frases cortas abajo.',
        fontFamily: 'Inter',
        bold: true,
        size: 0.058,
        color: '#FFFFFF',
        highlight: null,
        outline: '#000000',
        outlineWidth: 0.08,
        box: false,
        uppercase: false,
        position: 'bottom',
        wordsPerCue: 7,
        maxChars: 38,
    },
    karaoke: {
        id: 'karaoke',
        label: 'Karaoke',
        description: 'La palabra que se dice se ilumina en amarillo.',
        fontFamily: 'Inter',
        bold: true,
        size: 0.064,
        color: '#FFFFFF',
        highlight: '#FFD400',
        outline: '#000000',
        outlineWidth: 0.09,
        box: false,
        uppercase: false,
        position: 'bottom',
        wordsPerCue: 5,
        maxChars: 30,
    },
    pop: {
        id: 'pop',
        label: 'Impacto',
        description: 'Una o dos palabras grandes en el centro, en mayúsculas.',
        fontFamily: 'Inter',
        bold: true,
        size: 0.11,
        color: '#FFFFFF',
        highlight: '#35E0A1',
        outline: '#000000',
        outlineWidth: 0.1,
        box: false,
        uppercase: true,
        position: 'center',
        wordsPerCue: 2,
        maxChars: 16,
    },
    minimal: {
        id: 'minimal',
        label: 'Discreto',
        description: 'Texto pequeño sobre una caja translúcida.',
        fontFamily: 'Inter',
        bold: true,
        size: 0.045,
        color: '#FFFFFF',
        highlight: null,
        outline: '#000000',
        outlineWidth: 0.28,
        box: true,
        uppercase: false,
        position: 'bottom',
        wordsPerCue: 8,
        maxChars: 46,
    },
};
const SENTENCE_END = /[.!?…]$/;
const MAX_GAP_SEC = 0.8;
const TAIL_SEC = 0.3;
/** Parte una frase en trozos de tamaño parecido (evita dejar una palabra suelta en el último subtítulo). */
function balancedChunks(sentence, style) {
    const chars = (ws) => ws.reduce((a, x) => a + x.text.length + 1, 0) - 1;
    let n = Math.max(1, Math.ceil(sentence.length / style.wordsPerCue));
    for (;;) {
        const size = Math.ceil(sentence.length / n);
        const chunks = [];
        for (let i = 0; i < sentence.length; i += size)
            chunks.push(sentence.slice(i, i + size));
        if (chunks.every((c) => chars(c) <= style.maxChars || c.length === 1) || n >= sentence.length)
            return chunks;
        n++;
    }
}
/** Reparte las palabras en subtítulos: frases completas, cortadas de forma equilibrada si son largas. */
function buildCues(words, style) {
    const sentences = [];
    let cur = [];
    for (const w of words) {
        if (!w.text.trim())
            continue;
        const prev = cur[cur.length - 1];
        // otro hablante (los dos conocidos) abre un subtítulo nuevo, para no mezclar voces en la misma línea
        const changed = prev !== undefined && prev.spk !== undefined && w.spk !== undefined && prev.spk !== w.spk;
        if (prev && (w.start - prev.end > MAX_GAP_SEC || changed)) {
            sentences.push(cur);
            cur = [];
        }
        cur.push({ text: w.text.trim(), start: w.start, end: Math.max(w.end, w.start + 0.05), ...(w.spk !== undefined ? { spk: w.spk } : {}) });
        if (SENTENCE_END.test(w.text.trim())) {
            sentences.push(cur);
            cur = [];
        }
    }
    if (cur.length)
        sentences.push(cur);
    const cues = sentences
        .flatMap((s) => balancedChunks(s, style))
        .map((ws) => ({ start: ws[0].start, end: ws[ws.length - 1].end, words: ws }));
    // un subtítulo se queda un poco en pantalla tras la última palabra, sin pisar al siguiente
    cues.forEach((c, i) => {
        const next = cues[i + 1];
        const limit = next ? next.start : Infinity;
        c.end = Math.min(c.end + TAIL_SEC, Math.max(c.end, limit));
    });
    return cues;
}
/** Palabras del VOD pasadas al tiempo del vídeo resultante; las que caen en un corte desaparecen. */
function wordsForOutput(words, ranges) {
    const out = [];
    for (const w of words) {
        const mid = (w.start + w.end) / 2;
        const t = (0, timeline_1.toOutputTime)(mid, ranges);
        if (t === null)
            continue;
        const len = Math.max(0.05, w.end - w.start);
        out.push({ text: w.text, start: Math.max(0, t - len / 2), end: t + len / 2, ...(w.spk !== undefined ? { spk: w.spk } : {}) });
    }
    return out;
}
const cueAt = (cues, t) => cues.find((c) => t >= c.start && t < c.end) ?? null;
exports.cueAt = cueAt;
/** Índice de la palabra que suena en el instante t dentro del subtítulo (la última ya empezada). */
function activeWordIndex(cue, t) {
    let idx = 0;
    cue.words.forEach((w, i) => {
        if (t >= w.start)
            idx = i;
    });
    return idx;
}
const displayText = (text, style) => (style.uppercase ? text.toLocaleUpperCase('es') : text);
exports.displayText = displayText;
/** Medidas en píxeles del subtítulo para un vídeo de w×h (las usan el render y la vista previa). */
function captionLayout(style, w, h) {
    const portrait = h > w;
    const fontPx = Math.round(style.size * Math.min(w, h) * (portrait ? 1.15 : 1));
    return {
        fontPx,
        outlinePx: Math.max(1, Math.round(fontPx * style.outlineWidth)),
        marginV: Math.round(h * (style.position === 'bottom' ? (portrait ? 0.2 : 0.07) : 0)),
        marginH: Math.round(w * 0.06),
    };
}
/** #RRGGBB (+ alfa 0..1 de opacidad) -> &HAABBGGRR de ASS. */
function assColor(hex, opacity = 1) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m)
        throw new Error(`Color no válido: ${hex}`);
    const rr = m[1].slice(0, 2);
    const gg = m[1].slice(2, 4);
    const bb = m[1].slice(4, 6);
    const aa = Math.round((1 - opacity) * 255).toString(16).padStart(2, '0');
    return `&H${aa}${bb}${gg}${rr}`.toUpperCase();
}
const assTime = (s) => {
    const cs = Math.max(0, Math.round(s * 100));
    const h = Math.floor(cs / 360000);
    const m = Math.floor((cs % 360000) / 6000);
    const sec = Math.floor((cs % 6000) / 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
/** Texto seguro para ASS: sin llaves ni barras que se interpreten como código. */
function assEscape(t) {
    return t.replace(/[\\{}]/g, '').replace(/\r?\n/g, ' ');
}
/** Archivo ASS (libass lo graba en el vídeo). Las palabras ya vienen en el tiempo del vídeo resultante. */
function buildAss(words, style, w, h, speakerColors) {
    const L = captionLayout(style, w, h);
    const bold = style.bold ? -1 : 0;
    const primary = assColor(style.color);
    const outline = style.box ? assColor(style.outline, 0.6) : assColor(style.outline);
    const lines = [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${w}`,
        `PlayResY: ${h}`,
        'WrapStyle: 0',
        'ScaledBorderAndShadow: yes',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        `Style: Default,${style.fontFamily},${L.fontPx},${primary},${primary},${outline},${assColor('#000000', 0.5)},${bold},0,0,0,100,100,0,0,${style.box ? 3 : 1},${style.box ? Math.round(L.fontPx * 0.28) : L.outlinePx},0,${style.position === 'center' ? 5 : 2},${L.marginH},${L.marginH},${L.marginV},1`,
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    for (const cue of buildCues(words, style)) {
        // con hablantes identificados, cada palabra lleva el color de quien la dice (las de hablante desconocido, el del estilo)
        const base = cue.words.map((x) => (speakerColors && x.spk !== undefined && speakerColors[x.spk] ? assColor(speakerColors[x.spk]) : primary));
        const texts = cue.words.map((x, j) => {
            const t = assEscape((0, exports.displayText)(x.text, style));
            return base[j] === primary ? t : `{\\1c${base[j]}}${t}{\\1c${primary}}`;
        });
        if (!style.highlight) {
            lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Default,,0,0,0,,${texts.join(' ')}`);
            continue;
        }
        // resaltado palabra a palabra: un evento por palabra con la activa de otro color
        cue.words.forEach((word, i) => {
            const from = i === 0 ? cue.start : word.start;
            const to = i === cue.words.length - 1 ? cue.end : cue.words[i + 1].start;
            if (to <= from)
                return;
            const text = texts
                .map((t, j) => (j === i ? `{\\1c${assColor(style.highlight)}}${assEscape((0, exports.displayText)(cue.words[j].text, style))}{\\1c${base[j]}}` : t))
                .join(' ');
            lines.push(`Dialogue: 0,${assTime(from)},${assTime(to)},Default,,0,0,0,,${text}`);
        });
    }
    return `${lines.join('\n')}\n`;
}

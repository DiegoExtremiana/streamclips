"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRANSCRIPT_WORDS = void 0;
exports.spreadWords = spreadWords;
exports.parseTranscript = parseTranscript;
exports.transcriptForClaude = transcriptForClaude;
exports.MAX_TRANSCRIPT_WORDS = 400_000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Reparte el texto de un tramo entre sus palabras en proporción a su longitud. */
function spreadWords(text, start, end) {
    const parts = text.replace(/<[^>]+>/g, '').split(/\s+/).filter(Boolean);
    if (!parts.length || end <= start)
        return [];
    const total = parts.reduce((a, p) => a + p.length, 0);
    let t = start;
    return parts.map((p) => {
        const d = ((end - start) * p.length) / total;
        const w = { text: p, start: t, end: t + d };
        t += d;
        return w;
    });
}
function fromWords(list, textKey) {
    const out = [];
    if (!Array.isArray(list))
        return out;
    for (const w of list) {
        if (!isObj(w))
            continue;
        const text = w[textKey] ?? w.text ?? w.word;
        if (typeof text !== 'string' || !isNum(w.start) || !isNum(w.end))
            continue;
        if (text.trim())
            out.push({ text: text.trim(), start: w.start, end: Math.max(w.end, w.start) });
    }
    return out;
}
function fromJson(raw) {
    if (!isObj(raw))
        throw new Error('El JSON de la transcripción debe ser un objeto.');
    // formato propio: { words: [{ text, start, end }] }
    if (Array.isArray(raw.words))
        return fromWords(raw.words, 'text');
    // salida de Whisper con palabras: { segments: [{ start, end, text, words: [{ word, start, end }] }] }
    if (Array.isArray(raw.segments)) {
        const out = [];
        for (const s of raw.segments) {
            if (!isObj(s))
                continue;
            const w = fromWords(s.words, 'word');
            if (w.length)
                out.push(...w);
            else if (typeof s.text === 'string' && isNum(s.start) && isNum(s.end))
                out.push(...spreadWords(s.text, s.start, s.end));
        }
        return out;
    }
    throw new Error('No reconozco el JSON: espero "words" o "segments".');
}
/** 00:01:02,500 / 01:02.500 / 1:02:03.5 -> segundos */
function clock(s) {
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
    if (!m)
        return null;
    const frac = m[4] ? Number(`0.${m[4]}`) : 0;
    return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}
/** SRT y VTT: cada subtítulo se reparte entre sus palabras (no hay tiempos por palabra). */
function fromCues(text) {
    const out = [];
    const blocks = text.replace(/\r/g, '').split(/\n{2,}/);
    for (const b of blocks) {
        const lines = b.split('\n');
        const i = lines.findIndex((l) => l.includes('-->'));
        if (i < 0)
            continue;
        const [a, rest] = lines[i].split('-->');
        const start = clock(a);
        const end = clock((rest ?? '').trim().split(/\s+/)[0] ?? '');
        if (start === null || end === null)
            continue;
        out.push(...spreadWords(lines.slice(i + 1).join(' '), start, end));
    }
    return out;
}
/** Lee una transcripción en JSON (propio o de Whisper), SRT o VTT. Lanza si no hay ninguna palabra utilizable. */
function parseTranscript(content) {
    const text = content.replace(/^\uFEFF/, '').trim();
    if (!text)
        throw new Error('El archivo está vacío.');
    let words;
    if (text.startsWith('{') || text.startsWith('[')) {
        let raw;
        try {
            raw = JSON.parse(text);
        }
        catch (e) {
            throw new Error(`JSON no válido: ${e.message}`);
        }
        words = fromJson(Array.isArray(raw) ? { words: raw } : raw);
    }
    else if (text.includes('-->')) {
        words = fromCues(text);
    }
    else {
        throw new Error('Formato no reconocido: usa JSON, SRT o VTT.');
    }
    if (!words.length)
        throw new Error('No se encontró ninguna palabra con tiempos en la transcripción.');
    if (words.length > exports.MAX_TRANSCRIPT_WORDS)
        throw new Error('La transcripción es demasiado larga.');
    return words.sort((a, b) => a.start - b.start);
}
const mmss = (t) => {
    const s = Math.floor(t);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
/** Transcripción legible con marcas de tiempo cada pocos segundos, para que Claude la analice. */
function transcriptForClaude(words, windowSec = 6) {
    const lines = [];
    let bucket = [];
    const flush = () => {
        if (bucket.length)
            lines.push(`[${mmss(bucket[0].start)}] ${bucket.map((w) => w.text).join(' ')}`);
        bucket = [];
    };
    for (const w of words) {
        if (bucket.length && w.start - bucket[0].start >= windowSec)
            flush();
        bucket.push(w);
    }
    flush();
    return lines.join('\n');
}

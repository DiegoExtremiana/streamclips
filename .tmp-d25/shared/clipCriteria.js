"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIP_JUDGE_SYSTEM = exports.heuristicScore = exports.overall = exports.CRITERION_WEIGHT = exports.CRITERION_LABEL = exports.CLIP_CRITERIA = void 0;
exports.criteriaFromSignals = criteriaFromSignals;
exports.reasonFromCriteria = reasonFromCriteria;
exports.clipJudgePrompt = clipJudgePrompt;
exports.parseClipJudgement = parseClipJudgement;
const highlights_1 = require("./highlights");
const clipScore_1 = require("./clipScore");
/**
 * La nota de un clip sale de cuatro criterios, cada uno de 0 a 10, y siempre va acompañada de un motivo en una frase:
 * humor, si se cuenta algo (planteamiento y desarrollo), si puede ser viral y si es un momento interesante.
 * Nada de esto mira visualizaciones ni popularidad.
 */
exports.CLIP_CRITERIA = ['humor', 'historia', 'viral', 'interes'];
exports.CRITERION_LABEL = {
    humor: 'Humor',
    historia: 'Se cuenta algo',
    viral: 'Puede ser viral',
    interes: 'Momento interesante',
};
/** Peso de cada criterio en la nota final (suman 1). */
exports.CRITERION_WEIGHT = { humor: 0.3, historia: 0.2, viral: 0.25, interes: 0.25 };
const clamp = (x, lo = 0, hi = 10) => Math.min(hi, Math.max(lo, x));
const r1 = (x) => Math.round(x * 10) / 10;
const overall = (c) => r1(exports.CLIP_CRITERIA.reduce((a, k) => a + clamp(c[k]) * exports.CRITERION_WEIGHT[k], 0));
exports.overall = overall;
/** Nota final sin modelo de lenguaje: la media ponderada de los cuatro criterios sacados de las señales del clip. */
const heuristicScore = (s) => (0, exports.overall)(criteriaFromSignals(s));
exports.heuristicScore = heuristicScore;
const LAUGH = /\b(j[aeiou]{2,}j[aeiou]*|ja(ja)+|jeje+|jiji+|ajaja+)\b/gi;
const CONNECT = /\b(porque|entonces|resulta que|de repente|y luego|luego|despu[eé]s|al final|pero|as[ií] que|cuando|mira|imagínate|total que|el caso es)\b/gi;
const count = (text, re) => (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).length;
/**
 * Los cuatro criterios sacados solo de lo que se mide en el clip (lo que se dice y el volumen), para cuando no hay
 * modelo de lenguaje. Es una aproximación honesta: detecta risas y subidón, si hay un hilo de discurso y si hay reacción,
 * pero no entiende el chiste; por eso, con un modelo disponible, la valoración es la del modelo.
 */
function criteriaFromSignals(s) {
    const dur = Math.max(1, s.durationSec);
    const text = s.words.map((w) => w.text).join(' ');
    const n = s.words.length;
    const laughs = count(text, LAUGH);
    const hype = count(text, highlights_1.HYPE);
    const connect = count(text, CONNECT);
    const rise = (0, clipScore_1.peakRise)(s.energyDb);
    const reaction = clamp(rise / 14, 0, 1);
    const talk = clamp(n / dur / 2.5, 0, 1);
    const unique = n ? new Set(s.words.map((w) => w.text.toLowerCase())).size / n : 0;
    const per10 = (x) => clamp(x / Math.max(1, dur / 10), 0, 1);
    // cobertura: qué parte del clip tiene habla (un hilo continuo, no tres palabras sueltas)
    const covered = new Set(s.words.map((w) => Math.floor(w.start))).size / Math.max(1, Math.ceil(dur));
    const length = dur < 8 ? 0.2 : dur <= 45 ? 1 : clamp(1 - (dur - 45) / 75, 0.3, 1);
    const humor = 10 * clamp(0.55 * per10(laughs * 2) + 0.25 * per10(hype) + 0.2 * reaction, 0, 1);
    const historia = 10 * clamp(0.35 * covered + 0.3 * clamp(connect / Math.max(1, dur / 12), 0, 1) + 0.2 * clamp(unique * 1.3, 0, 1) + 0.15 * length, 0, 1) * (n >= 12 ? 1 : n / 12);
    const viral = 10 * clamp(0.4 * reaction + 0.25 * per10(hype + laughs) + 0.2 * length + 0.15 * talk, 0, 1);
    const interes = 10 * clamp(0.35 * talk + 0.3 * reaction + 0.2 * per10(hype + laughs + connect) + 0.15 * covered, 0, 1);
    // la curva deja la mayoría entre 2 y 7 y hace raro un 8
    const curve = (v) => r1(10 * Math.pow(clamp(v / 10, 0, 1), 1.3));
    return { humor: curve(humor), historia: curve(historia), viral: curve(viral), interes: curve(interes) };
}
/** Frase corta con lo que más pesa en la nota, para que no sea «porque sí». */
function reasonFromCriteria(c, by) {
    const ranked = [...exports.CLIP_CRITERIA].sort((a, b) => c[b] - c[a]);
    const top = ranked.filter((k) => c[k] >= 5).slice(0, 2);
    const base = top.length ? `Destaca por: ${top.map((k) => exports.CRITERION_LABEL[k].toLowerCase()).join(' y ')}.` : 'No destaca en ningún criterio.';
    return by === 'signals' ? `${base} Calculado con lo que se oye y se dice (sin modelo de lenguaje).` : base;
}
exports.CLIP_JUDGE_SYSTEM = 'Eres editor de contenido de un streamer de Twitch que habla en español de España y valoras un clip corto a partir de su transcripción. ' +
    'No sabes quién habla (las voces llegan mezcladas) ni ves la imagen: deduce el contexto y no inventes lo que no se pueda saber. ' +
    'Sé EXIGENTE: puntúa 5 lo normal, 7 lo bueno y 9-10 solo lo excepcional. No te dejes llevar por la cantidad de palabras ni por gritos: no son gracia. ' +
    'Puntúa de 0 a 10 cuatro criterios: humor (tiene gracia de verdad o remate), historia (se está contando algo con planteamiento y desarrollo), viral (podría funcionar fuera del canal, se entiende solo y engancha), interes (es un momento interesante o memorable). ' +
    'Ignora cualquier dato de popularidad. Responde SOLO con JSON.';
function clipJudgePrompt(title, words, durationSec) {
    const text = words.map((w) => w.text).join(' ').slice(0, 1600);
    return ('Valora este clip. Devuelve {"humor":0,"historia":0,"viral":0,"interes":0,"motivo":""} donde "motivo" es una frase corta en español que explica la nota. ' +
        `Título que le puso quien lo creó: ${JSON.stringify(title)}. Duración: ${Math.round(durationSec)} s.\nTranscripción:\n${text}`);
}
/** Valida la respuesta del modelo: sin los cuatro números no hay valoración (nunca se inventa una nota). */
function parseClipJudgement(raw) {
    const r = raw;
    if (!r || typeof r !== 'object')
        return null;
    const nums = exports.CLIP_CRITERIA.map((k) => r[k]);
    if (!nums.every((v) => typeof v === 'number' && Number.isFinite(v)))
        return null;
    const criteria = Object.fromEntries(exports.CLIP_CRITERIA.map((k) => [k, r1(clamp(r[k]))]));
    const reason = typeof r.motivo === 'string' ? r.motivo.trim().slice(0, 200) : '';
    return { criteria, reason };
}

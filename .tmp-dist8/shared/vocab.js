"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyVocabulary = exports.FUZZY_MIN_LEN = exports.FUZZY_MIN = exports.MAX_CORRECTIONS = exports.MAX_TERMS = exports.FUZZY_STRICT = exports.BUILTIN_CORRECTIONS = exports.BUILTIN_TERMS = exports.DEFAULT_TERMS = exports.OWN_TERMS = void 0;
exports.normToken = normToken;
exports.phonetic = phonetic;
exports.editDistance = editDistance;
exports.similarity = similarity;
exports.applyVocabulary = applyVocabulary;
exports.whisperPrompt = whisperPrompt;
exports.parseVocabText = parseVocabText;
exports.formatVocabText = formatVocabText;
exports.cleanVocabulary = cleanVocabulary;
exports.learnCorrections = learnCorrections;
exports.mergeCorrections = mergeCorrections;
const vocabPokemon_1 = require("./vocabPokemon");
/** Las palabras del streamer van primero (son las que se mandan siempre a Whisper); luego la jerga y los Pokémon. */
exports.OWN_TERMS = ['Movidas', 'Marrshall', 'MovidasMarshall', 'Gorens', 'Reaptor'];
exports.DEFAULT_TERMS = exports.OWN_TERMS;
/** Lista incorporada (Pokémon y jerga competitiva): no está en la lista del usuario, se suma siempre al aplicar el vocabulario, así crece con las versiones sin pisar lo suyo. */
exports.BUILTIN_TERMS = [...vocabPokemon_1.COMPETITIVE_TERMS, ...vocabPokemon_1.POKEMON_NAMES];
exports.BUILTIN_CORRECTIONS = vocabPokemon_1.POKEMON_CORRECTIONS.map((c) => ({ ...c, n: 1 }));
/** Parecido mínimo para los términos de la lista de Pokémon y jerga competitiva (más exigente: hay muchos y se parecen a palabras corrientes). */
exports.FUZZY_STRICT = 0.8;
const STRICT = new Set([...vocabPokemon_1.COMPETITIVE_TERMS, ...vocabPokemon_1.POKEMON_NAMES].map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')));
exports.MAX_TERMS = 400;
exports.MAX_CORRECTIONS = 500;
/** Parecido mínimo (0 a 1) para dar por buena una palabra que se parece a un término del vocabulario. */
exports.FUZZY_MIN = 0.72;
exports.FUZZY_MIN_LEN = 6;
const emptyVocabulary = () => ({ terms: [...exports.DEFAULT_TERMS], corrections: [] });
exports.emptyVocabulary = emptyVocabulary;
/** Palabras muy comunes: nunca se corrigen solas por parecido y no se aprenden como corrección. */
const COMMON = new Set(('el la los las un una unos unas de del al y o u e a en con por para que se su sus lo le les mi mis es son fue este esta esto ese esa como pero muy mas ya si no me te nos ' +
    'yo tu el ella ellos nosotros vamos va van voy vas hay ha han he has estoy esta estan eso aqui alli ahi bien mal bueno buena todo todos toda nada algo tambien cuando donde porque ' +
    'pues entonces vale venga ostia joder tio tia gente chat directo vez veces cosa cosas dia dias tengo tiene tienes hacer hace hago').split(' '));
/** Minúsculas, sin tildes ni signos: para comparar palabras. */
function normToken(s) {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]/g, '');
}
/** Aproximación a cómo suena en español (para que «Marshall» y «Marsal» se parezcan). */
function phonetic(s) {
    return normToken(s)
        .replace(/sh/g, 's')
        .replace(/ch/g, 'X')
        .replace(/ll/g, 'y')
        .replace(/rr/g, 'r')
        .replace(/ss/g, 's')
        .replace(/ck/g, 'k')
        .replace(/qu/g, 'k')
        .replace(/c(?=[ei])/g, 's')
        .replace(/z/g, 's')
        .replace(/c/g, 'k')
        .replace(/v/g, 'b')
        .replace(/w/g, 'u')
        .replace(/h/g, '')
        .replace(/X/g, 'ch')
        .replace(/(.)\1+/g, '$1');
}
/** Distancia de edición (con tope: devuelve max+1 si se pasa). */
function editDistance(a, b, max = 99) {
    if (Math.abs(a.length - b.length) > max)
        return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            cur.push(v);
            if (v < rowMin)
                rowMin = v;
        }
        if (rowMin > max)
            return max + 1;
        prev = cur;
    }
    return prev[b.length];
}
function similarity(a, b) {
    const len = Math.max(a.length, b.length);
    if (!len)
        return 1;
    return 1 - editDistance(a, b, len) / len;
}
/** Quita lo que no son letras ni números al principio y al final de una palabra, para devolverlo después. */
function splitPunct(t) {
    const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su.exec(t);
    return { pre: m?.[1] ?? '', core: m?.[2] ?? t, post: m?.[3] ?? '' };
}
const MAX_SPAN = 3;
/**
 * Aplica el vocabulario a unas palabras: primero las correcciones exactas (de una a tres palabras seguidas) y luego
 * las palabras que suenan casi igual que un término largo del vocabulario. Conserva los tiempos y la puntuación.
 */
function applyVocabulary(words, v) {
    if (!words.length)
        return words;
    const exact = new Map();
    // primero las incorporadas, luego las del usuario (que mandan)
    for (const c of [...exports.BUILTIN_CORRECTIONS, ...v.corrections]) {
        const key = c.from.split(/\s+/).map(normToken).filter(Boolean).join(' ');
        if (key && c.to.trim())
            exact.set(key, c.to.trim());
    }
    const fuzzy = [...new Set([...v.terms, ...exports.BUILTIN_TERMS])]
        .map((t) => ({ term: t, code: phonetic(t), min: STRICT.has(normToken(t)) ? exports.FUZZY_STRICT : exports.FUZZY_MIN }))
        .filter((t) => normToken(t.term).length >= exports.FUZZY_MIN_LEN);
    if (!exact.size && !fuzzy.length)
        return words;
    const cores = words.map((w) => splitPunct(w.text));
    const keys = cores.map((c) => normToken(c.core));
    const out = [];
    let changed = false;
    /** El hablante se conserva si las palabras unidas son todas del mismo. */
    const spkOf = (i, n) => {
        const s = words[i].spk;
        for (let k = 1; k < n; k++)
            if (words[i + k].spk !== s)
                return {};
        return s === undefined ? {} : { spk: s };
    };
    for (let i = 0; i < words.length;) {
        let done = false;
        // correcciones exactas, de la frase más larga a la más corta
        for (let n = Math.min(MAX_SPAN, words.length - i); n >= 1 && !done; n--) {
            if (keys.slice(i, i + n).some((k) => !k))
                continue;
            const to = exact.get(keys.slice(i, i + n).join(' '));
            if (to === undefined)
                continue;
            out.push({ text: `${cores[i].pre}${to}${cores[i + n - 1].post}`, start: words[i].start, end: words[i + n - 1].end, ...spkOf(i, n) });
            i += n;
            done = true;
            changed = true;
        }
        if (done)
            continue;
        // parecido con un término largo del vocabulario (una palabra, o dos seguidas pegadas: «movidas marsan»)
        if (fuzzy.length) {
            for (let n = Math.min(2, words.length - i); n >= 1 && !done; n--) {
                const joined = keys.slice(i, i + n).join('');
                if (joined.length < 4 || keys.slice(i, i + n).some((k) => !k))
                    continue;
                if (n === 1 && COMMON.has(joined))
                    continue;
                if (n === 2 && (COMMON.has(keys[i]) || COMMON.has(keys[i + 1])))
                    continue; // «pikachu y» / «y gengar» no son un nombre
                const code = phonetic(joined);
                let best = null;
                for (const f of fuzzy) {
                    if (code[0] !== f.code[0] || Math.abs(code.length - f.code.length) > 3)
                        continue;
                    const s = similarity(code, f.code);
                    if (s >= f.min && (!best || s > best.s))
                        best = { term: f.term, s };
                }
                // si ya está bien escrita, no se toca; si es una palabra corriente del idioma, tampoco
                if (!best || normToken(best.term) === joined)
                    continue;
                out.push({ text: `${cores[i].pre}${best.term}${cores[i + n - 1].post}`, start: words[i].start, end: words[i + n - 1].end, ...spkOf(i, n) });
                i += n;
                done = true;
                changed = true;
            }
        }
        if (!done)
            out.push(words[i++]);
    }
    return changed ? out : words;
}
/** Texto para el prompt inicial de Whisper: ASCII (en Windows los argumentos con tildes llegan mal) y corto. */
function whisperPrompt(v, context = [], extra = []) {
    const ascii = (s) => s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9 .'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    // lo propio del usuario (las primeras de su lista) y lo aprendido van siempre; la jerga y los nombres de Pokémon, solo si el directo va de eso
    const own = v.terms.slice(0, exports.OWN_TERMS.length + 5);
    const terms = [...new Set([...own, ...v.corrections.filter((c) => c.n >= 1 && !exports.BUILTIN_CORRECTIONS.some((d) => d.to === c.to)).map((c) => c.to), ...extra].map(ascii).filter(Boolean))].slice(0, 60);
    const ctx = [...new Set(context.map(ascii).filter((c) => c.length >= 3))].slice(0, 10);
    const parts = [];
    if (ctx.length)
        parts.push(`Directo de Twitch en espanol sobre ${ctx.join(', ')}.`);
    if (terms.length)
        parts.push(`Nombres y palabras: ${terms.join(', ')}.`);
    return parts.join(' ').slice(0, 480);
}
/** «mal => bien» por línea para las correcciones; el resto de líneas son términos. */
function parseVocabText(text, prev = []) {
    const terms = [];
    const corrections = [];
    const seen = new Set();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line)
            continue;
        const m = /^(.+?)\s*(?:=>|->|=)\s*(.+)$/.exec(line);
        if (m) {
            const from = m[1].trim().slice(0, 80);
            const to = m[2].trim().slice(0, 80);
            const key = from.split(/\s+/).map(normToken).join(' ');
            if (from && to && key && !seen.has(`c:${key}`)) {
                seen.add(`c:${key}`);
                corrections.push({ from, to, n: prev.find((c) => c.from.split(/\s+/).map(normToken).join(' ') === key)?.n ?? 1 });
            }
        }
        else {
            const t = line.slice(0, 80);
            const key = normToken(t);
            if (key && !seen.has(`t:${key}`)) {
                seen.add(`t:${key}`);
                terms.push(t);
            }
        }
    }
    return { terms: terms.slice(0, exports.MAX_TERMS), corrections: corrections.slice(0, exports.MAX_CORRECTIONS) };
}
function formatVocabText(v) {
    return [...v.terms, ...v.corrections.map((c) => `${c.from} => ${c.to}`)].join('\n');
}
/** Normaliza lo que llega del disco o de la interfaz. */
function cleanVocabulary(x) {
    const o = (typeof x === 'object' && x !== null ? x : {});
    const terms = Array.isArray(o.terms) ? o.terms.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim().slice(0, 80)) : null;
    const corr = !Array.isArray(o.corrections)
        ? []
        : o.corrections
            .filter((c) => typeof c === 'object' && c !== null && typeof c.from === 'string' && typeof c.to === 'string')
            .map((c) => ({ from: c.from.trim().slice(0, 80), to: c.to.trim().slice(0, 80), n: Number.isFinite(c.n) && c.n > 0 ? Math.min(9999, Math.floor(c.n)) : 1 }))
            .filter((c) => c.from && c.to);
    const seenT = new Set();
    const uniqueTerms = (terms ?? exports.DEFAULT_TERMS).filter((t) => {
        const k = normToken(t);
        if (!k || seenT.has(k))
            return false;
        seenT.add(k);
        return true;
    });
    return { terms: uniqueTerms.slice(0, exports.MAX_TERMS), corrections: corr.slice(0, exports.MAX_CORRECTIONS) };
}
/**
 * Qué ha cambiado el usuario al corregir un texto: pares «lo que salió» → «lo que puso». Alinea por palabras (LCS) y
 * solo apunta los cambios pequeños (1 a 3 palabras de cada lado); ignora los que son palabras corrientes cortas.
 */
function learnCorrections(before, after) {
    const a = before.map(normToken);
    const b = after.map(normToken);
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--)
        for (let j = m - 1; j >= 0; j--)
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0;
    let j = 0;
    let delA = [];
    let addB = [];
    const flush = () => {
        if (delA.length && addB.length && delA.length <= MAX_SPAN && addB.length <= MAX_SPAN) {
            const fromKey = delA.map(normToken).join(' ');
            const bad = !fromKey || fromKey === addB.map(normToken).join(' ') || (delA.length === 1 && (COMMON.has(fromKey) || fromKey.length < 3));
            if (!bad)
                out.push({ from: delA.map((w) => splitPunct(w).core).join(' '), to: addB.map((w) => splitPunct(w).core).join(' ') });
        }
        delA = [];
        addB = [];
    };
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) {
            flush();
            i++;
            j++;
        }
        else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j]))
            addB.push(after[j++]);
        else
            delA.push(before[i++]);
    }
    flush();
    return out.filter((c) => c.from && c.to);
}
/** Suma lo aprendido a las correcciones existentes (si ya estaba, sube el contador y se queda con lo último escrito). */
function mergeCorrections(cur, learned) {
    const out = cur.map((c) => ({ ...c }));
    for (const l of learned) {
        const key = l.from.split(/\s+/).map(normToken).join(' ');
        const hit = out.find((c) => c.from.split(/\s+/).map(normToken).join(' ') === key);
        if (hit) {
            hit.to = l.to;
            hit.n += 1;
        }
        else
            out.push({ from: l.from, to: l.to, n: 1 });
    }
    return out.slice(-exports.MAX_CORRECTIONS);
}

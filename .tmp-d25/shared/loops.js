"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOOP_KEEP = exports.LOOP_MAX_DISTINCT = exports.LOOP_WINDOW = void 0;
exports.dropLoops = dropLoops;
const vocab_1 = require("./vocab");
/**
 * Whisper a veces se queda en bucle y repite la misma frase decenas de veces cuando hay música o ruido («Tentacruel está
 * increíble, tío» ×30). Eso no se dijo, y además dispara las señales de «voz» y «exclamaciones» como si fuera el mejor momento.
 * Se detecta por poca variedad de palabras en una ventana (muchas palabras, pocas distintas) y de cada bucle se conservan las
 * primeras palabras.
 */
exports.LOOP_WINDOW = 24;
/** Máximo de palabras distintas, sobre la ventana, para considerarla un bucle. */
exports.LOOP_MAX_DISTINCT = 7;
/** De cada bucle se conserva este número de palabras. */
exports.LOOP_KEEP = 8;
const LAUGH = /^(?:j+[aeiou]+j*)+$|^(?:ha|ja|je|ji|jo|ju)+$/;
function dropLoops(words) {
    const n = words.length;
    if (n < exports.LOOP_WINDOW)
        return { words, dropped: 0 };
    const keys = words.map((w) => (0, vocab_1.normToken)(w.text));
    const flagged = new Array(n).fill(false);
    const count = new Map();
    let distinct = 0;
    const add = (k, d) => {
        const c = (count.get(k) ?? 0) + d;
        if (c === 0) {
            count.delete(k);
            distinct--;
        }
        else {
            if (!count.has(k))
                distinct++;
            count.set(k, c);
        }
    };
    for (let i = 0; i < n; i++) {
        add(keys[i], 1);
        if (i >= exports.LOOP_WINDOW)
            add(keys[i - exports.LOOP_WINDOW], -1);
        if (i >= exports.LOOP_WINDOW - 1 && distinct <= exports.LOOP_MAX_DISTINCT) {
            const from = i - exports.LOOP_WINDOW + 1;
            // la risa («jajajaja») se repite de verdad: no es un bucle
            if (keys.slice(from, i + 1).filter((k) => LAUGH.test(k)).length < exports.LOOP_WINDOW / 2)
                for (let j = from; j <= i; j++)
                    flagged[j] = true;
        }
    }
    // la ventana arrastra algunas palabras de habla normal en los bordes: de cada bucle se quitan las que no se repiten
    for (let i = 0; i < n;) {
        if (!flagged[i]) {
            i++;
            continue;
        }
        let j = i;
        while (j < n && flagged[j])
            j++;
        const freq = new Map();
        for (let k = i; k < j; k++)
            freq.set(keys[k], (freq.get(keys[k]) ?? 0) + 1);
        let a = i;
        let b = j - 1;
        while (a <= b && (freq.get(keys[a]) ?? 0) < 3)
            flagged[a++] = false;
        while (b >= a && (freq.get(keys[b]) ?? 0) < 3)
            flagged[b--] = false;
        i = j;
    }
    const out = [];
    let run = 0;
    let dropped = 0;
    for (let i = 0; i < n; i++) {
        if (!flagged[i]) {
            run = 0;
            out.push(words[i]);
        }
        else if (++run <= exports.LOOP_KEEP)
            out.push(words[i]);
        else
            dropped++;
    }
    return { words: dropped ? out : words, dropped };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAssetKind = exports.isDocExt = exports.isImageExt = exports.extOf = exports.PHRASE_MAX_CHARS = exports.PHRASE_MAX_WORDS = exports.NAME_MAX = exports.MAX_ASSET_BYTES = exports.DOC_EXT = exports.IMAGE_EXT = exports.KIND_LABEL = exports.ASSET_KINDS = void 0;
exports.cleanAssetName = cleanAssetName;
exports.uniqueName = uniqueName;
exports.guessKind = guessKind;
exports.cleanPhrase = cleanPhrase;
/**
 * Biblioteca de piezas para portadas: PNG recortados (tú sorprendido, un logo), fondos, fotos y documentos de referencia.
 * Cada pieza tiene un nombre que eliges tú (Diego_Sorprendido, Fondo_Ciudad) y el programa compone las portadas con ellas.
 */
exports.ASSET_KINDS = ['imagen', 'fondo', 'foto', 'documento', 'portada'];
exports.KIND_LABEL = {
    imagen: 'Imagen (PNG, recorte)',
    fondo: 'Fondo',
    foto: 'Foto',
    documento: 'Documento',
    portada: 'Portada hecha',
};
exports.IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
exports.DOC_EXT = ['.pdf', '.txt', '.md', '.doc', '.docx', '.odt'];
exports.MAX_ASSET_BYTES = 25 * 1024 * 1024;
exports.NAME_MAX = 40;
/** Máximo de palabras y de letras de la frase de una portada compuesta. */
exports.PHRASE_MAX_WORDS = 4;
exports.PHRASE_MAX_CHARS = 28;
const extOf = (fileName) => {
    const m = /(\.[A-Za-z0-9]{1,5})$/.exec(fileName.trim());
    return m ? m[1].toLowerCase() : '';
};
exports.extOf = extOf;
const isImageExt = (ext) => exports.IMAGE_EXT.includes(ext.toLowerCase());
exports.isImageExt = isImageExt;
const isDocExt = (ext) => exports.DOC_EXT.includes(ext.toLowerCase());
exports.isDocExt = isDocExt;
const isAssetKind = (v) => typeof v === 'string' && exports.ASSET_KINDS.includes(v);
exports.isAssetKind = isAssetKind;
/** Nombre limpio: letras, números, guion y guion bajo (los espacios pasan a guion bajo), sin extensión, hasta 40 caracteres. */
function cleanAssetName(raw) {
    const base = raw.trim().replace(/\.[A-Za-z0-9]{1,5}$/, '');
    const name = base
        .normalize('NFC')
        .replace(/\s+/g, '_')
        .replace(/[^\p{L}\p{N}_-]/gu, '')
        .replace(/_{2,}/g, '_')
        .replace(/^[_-]+|[_-]+$/g, '')
        .slice(0, exports.NAME_MAX);
    return name || 'Sin_nombre';
}
/** Si el nombre ya existe (sin mirar mayúsculas) le añade _2, _3… */
function uniqueName(name, taken) {
    const used = new Set(taken.map((t) => t.toLocaleLowerCase('es')));
    if (!used.has(name.toLocaleLowerCase('es')))
        return name;
    for (let i = 2; i < 1000; i++) {
        const suffix = `_${i}`;
        const cand = `${name.slice(0, exports.NAME_MAX - suffix.length)}${suffix}`;
        if (!used.has(cand.toLocaleLowerCase('es')))
            return cand;
    }
    return `${name.slice(0, exports.NAME_MAX - 5)}_${Date.now() % 10000}`;
}
/** Tipo que se supone al soltar un archivo (se puede cambiar después): por la extensión y por palabras del nombre. */
function guessKind(fileName) {
    const ext = (0, exports.extOf)(fileName);
    if ((0, exports.isDocExt)(ext))
        return 'documento';
    if (/(^|[\s_-])(fondo|background|bg|escenario)([\s_.-]|$)/i.test(fileName))
        return 'fondo';
    if (/(^|[\s_-])(foto|photo|captura)([\s_.-]|$)/i.test(fileName))
        return 'foto';
    return 'imagen';
}
/** Frase de la portada: mayúsculas, sin signos raros, hasta 4 palabras y 28 letras. */
function cleanPhrase(raw) {
    const words = raw
        .replace(/[^\p{L}\p{N}%$€'’.!?¡¿ -]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const out = [];
    for (const w of words) {
        const next = [...out, w].join(' ');
        if (out.length >= exports.PHRASE_MAX_WORDS || next.length > exports.PHRASE_MAX_CHARS)
            break;
        out.push(w);
    }
    return out.join(' ').toLocaleUpperCase('es');
}

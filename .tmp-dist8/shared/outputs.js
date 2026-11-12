"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.primaryRender = primaryRender;
exports.primaryFile = primaryFile;
exports.allFiles = allFiles;
/** Orden de preferencia para mostrar un elemento: el horizontal es la vista principal de un clip. */
const ORDER = ['horizontal', 'vertical', 'long'];
/** Versión principal de un elemento (la que da la miniatura y la que «Mostrar» abre). */
function primaryRender(o) {
    return ORDER.find((k) => Boolean(o.files[k]));
}
function primaryFile(o) {
    const k = primaryRender(o);
    return k ? o.files[k] : undefined;
}
/** Todos los archivos de un elemento. */
function allFiles(o) {
    return ORDER.map((k) => o.files[k]).filter((f) => Boolean(f));
}

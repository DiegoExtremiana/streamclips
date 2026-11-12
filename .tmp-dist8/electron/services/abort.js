"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCancelled = exports.CancelledError = exports.currentAbort = exports.withAbort = void 0;
exports.throwIfCancelled = throwIfCancelled;
const node_async_hooks_1 = require("node:async_hooks");
/**
 * Cancelación de un trabajo largo (análisis de un directo): se abre un «ámbito» con una señal y todo programa externo
 * que se lance dentro (ffmpeg, Whisper…) se detiene si se cancela, sin pasar la señal por cada función.
 */
const scope = new node_async_hooks_1.AsyncLocalStorage();
const withAbort = (signal, fn) => scope.run(signal, fn);
exports.withAbort = withAbort;
const currentAbort = () => scope.getStore();
exports.currentAbort = currentAbort;
class CancelledError extends Error {
    constructor(message = 'Cancelado.') {
        super(message);
        this.name = 'CancelledError';
    }
}
exports.CancelledError = CancelledError;
const isCancelled = (e) => e instanceof CancelledError || e?.name === 'AbortError';
exports.isCancelled = isCancelled;
/** Lanza CancelledError si el ámbito actual ya se ha cancelado. */
function throwIfCancelled() {
    if ((0, exports.currentAbort)()?.aborted)
        throw new CancelledError();
}

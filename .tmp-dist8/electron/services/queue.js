"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SerialQueue = void 0;
/**
 * Cola de trabajos en orden de llegada. Por defecto de uno en uno; con `limit` pueden ir varios a la vez
 * (el límite se consulta cada vez, así que se puede cambiar en caliente).
 */
class SerialQueue {
    limit;
    waiting = [];
    active = 0;
    pending = 0;
    idleWaiters = [];
    constructor(limit = () => 1) {
        this.limit = limit;
    }
    run(fn) {
        this.pending++;
        return new Promise((resolve, reject) => {
            const start = () => {
                // siempre en el siguiente turno: quien encola puede seguir preparando el trabajo antes de que empiece
                Promise.resolve().then(fn).then(resolve, reject).finally(() => {
                    this.active--;
                    this.pending--;
                    this.pump();
                    if (this.pending === 0)
                        for (const w of this.idleWaiters.splice(0))
                            w();
                });
            };
            this.waiting.push(start);
            this.pump();
        });
    }
    pump() {
        const max = Math.max(1, Math.floor(this.limit()) || 1);
        while (this.active < max && this.waiting.length) {
            this.active++;
            this.waiting.shift()();
        }
    }
    get size() {
        return this.pending;
    }
    /** Se resuelve cuando no queda nada en cola ni en marcha. */
    idle() {
        return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
    }
}
exports.SerialQueue = SerialQueue;

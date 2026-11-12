"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Scheduler = void 0;
const publishers_1 = require("./publishers");
/**
 * Regla innegociable: nunca se publica dos veces lo mismo en la misma red.
 *  - La publicación pasa a "publishing" y se guarda en disco ANTES de llamar a la red.
 *  - Si la app se cierra a mitad, al arrancar esas publicaciones se marcan "failed"
 *    (no sabemos si llegaron a publicarse) para revisarlas a mano; nunca se reintentan solas.
 *  - Solo se reintenta automáticamente si la red aún no está conectada (no se llegó a enviar nada).
 *  - Nunca hay dos pasadas a la vez.
 */
class Scheduler {
    store;
    notifier;
    log;
    publishers;
    intervalMs;
    now;
    onPublished;
    timer = null;
    busy = false;
    constructor(store, notifier, log, publishers = publishers_1.defaultPublishers, intervalMs = 30_000, now = Date.now, onPublished) {
        this.store = store;
        this.notifier = notifier;
        this.log = log;
        this.publishers = publishers;
        this.intervalMs = intervalMs;
        this.now = now;
        this.onPublished = onPublished;
    }
    /** Marca como fallidas las publicaciones que se quedaron "publishing" al cerrar la app. */
    recoverInterrupted() {
        let n = 0;
        for (const p of this.store.data.publications) {
            if (p.status === 'publishing') {
                p.status = 'failed';
                p.note = 'Interrumpida al cerrar la app: comprueba en la red si se publicó antes de reprogramar.';
                n++;
            }
        }
        if (n) {
            this.store.save();
            this.notifier.changed();
            this.log.warn(`${n} publicación(es) interrumpida(s) marcadas como fallidas.`);
        }
        return n;
    }
    start() {
        this.recoverInterrupted();
        this.timer = setInterval(() => void this.tick(), this.intervalMs);
        void this.tick();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    async tick() {
        if (this.busy)
            return;
        this.busy = true;
        try {
            const due = this.store.data.publications.filter((p) => p.status === 'scheduled' && !p.cloud && Date.parse(p.scheduledAt) <= this.now());
            for (const pub of due) {
                const output = this.store.data.outputs.find((o) => o.id === pub.outputId);
                if (!output) {
                    pub.status = 'failed';
                    pub.note = 'El vídeo ya no existe.';
                    this.store.save();
                    this.notifier.changed();
                    continue;
                }
                const previousNote = pub.note;
                pub.status = 'publishing';
                pub.note = undefined;
                this.store.save(); // antes de tocar la red
                this.notifier.changed();
                try {
                    await this.publishers[pub.platform].publish(output);
                    pub.status = 'published';
                    this.log.info(`Publicado en ${pub.platform}: ${output.title}`);
                }
                catch (e) {
                    if (e instanceof publishers_1.NotConnectedError) {
                        pub.status = 'scheduled';
                        pub.note = `En espera: ${e.message}`;
                    }
                    else {
                        pub.status = 'failed';
                        pub.note = e.message;
                        this.log.error(`Publicación fallida en ${pub.platform}: ${output.title}`, e);
                    }
                }
                this.store.save();
                if (pub.status === 'published') {
                    try {
                        this.onPublished?.(pub.outputId);
                    }
                    catch (e) {
                        this.log.warn(`Tras publicar: ${e.message}`);
                    }
                }
                // si sigue en espera por el mismo motivo no hace falta refrescar la interfaz en cada pasada
                if (pub.status !== 'scheduled' || pub.note !== previousNote)
                    this.notifier.changed();
            }
        }
        finally {
            this.busy = false;
        }
    }
}
exports.Scheduler = Scheduler;

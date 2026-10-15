import type { Store } from '../services/store';
import type { Logger } from '../services/logger';
import type { Notifier } from './notifier';
import { NotConnectedError, defaultPublishers, type Publishers } from './publishers';

/**
 * Regla innegociable: nunca se publica dos veces lo mismo en la misma red.
 *  - La publicación pasa a "publishing" y se guarda en disco ANTES de llamar a la red.
 *  - Si la app se cierra a mitad, al arrancar esas publicaciones se marcan "failed"
 *    (no sabemos si llegaron a publicarse) para revisarlas a mano; nunca se reintentan solas.
 *  - Solo se reintenta automáticamente si la red aún no está conectada (no se llegó a enviar nada).
 *  - Nunca hay dos pasadas a la vez.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private store: Store,
    private notifier: Notifier,
    private log: Logger,
    private publishers: Publishers = defaultPublishers,
    private intervalMs = 30_000,
    private now: () => number = Date.now,
  ) {}

  /** Marca como fallidas las publicaciones que se quedaron "publishing" al cerrar la app. */
  recoverInterrupted(): number {
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

  start(): void {
    this.recoverInterrupted();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
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
        } catch (e) {
          if (e instanceof NotConnectedError) {
            pub.status = 'scheduled';
            pub.note = `En espera: ${e.message}`;
          } else {
            pub.status = 'failed';
            pub.note = (e as Error).message;
            this.log.error(`Publicación fallida en ${pub.platform}: ${output.title}`, e);
          }
        }
        this.store.save();
        // si sigue en espera por el mismo motivo no hace falta refrescar la interfaz en cada pasada
        if (pub.status !== 'scheduled' || pub.note !== previousNote) this.notifier.changed();
      }
    } finally {
      this.busy = false;
    }
  }
}

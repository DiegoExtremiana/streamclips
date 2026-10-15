/**
 * Cola que ejecuta las tareas de una en una, en orden de llegada.
 * Un fallo en una tarea no bloquea las siguientes.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.tail.then(fn, fn);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      this.pending--;
    });
  }

  get size(): number {
    return this.pending;
  }

  /** Se resuelve cuando no queda nada en cola. */
  async idle(): Promise<void> {
    let seen: Promise<unknown>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }
}

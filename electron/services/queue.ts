/**
 * Cola de trabajos en orden de llegada. Por defecto de uno en uno; con `limit` pueden ir varios a la vez
 * (el límite se consulta cada vez, así que se puede cambiar en caliente).
 */
export class SerialQueue {
  private waiting: (() => void)[] = [];
  private active = 0;
  private pending = 0;
  private idleWaiters: (() => void)[] = [];

  constructor(private limit: () => number = () => 1) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    this.pending++;
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        fn().then(resolve, reject).finally(() => {
          this.active--;
          this.pending--;
          this.pump();
          if (this.pending === 0) for (const w of this.idleWaiters.splice(0)) w();
        });
      };
      this.waiting.push(start);
      this.pump();
    });
  }

  private pump(): void {
    const max = Math.max(1, Math.floor(this.limit()) || 1);
    while (this.active < max && this.waiting.length) this.waiting.shift()!();
  }

  get size(): number {
    return this.pending;
  }

  /** Se resuelve cuando no queda nada en cola ni en marcha. */
  idle(): Promise<void> {
    return this.pending === 0 ? Promise.resolve() : new Promise((r) => this.idleWaiters.push(r));
  }
}

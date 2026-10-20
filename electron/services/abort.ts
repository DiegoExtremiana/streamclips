import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Cancelación de un trabajo largo (análisis de un directo): se abre un «ámbito» con una señal y todo programa externo
 * que se lance dentro (ffmpeg, Whisper…) se detiene si se cancela, sin pasar la señal por cada función.
 */
const scope = new AsyncLocalStorage<AbortSignal>();

export const withAbort = <T>(signal: AbortSignal, fn: () => T): T => scope.run(signal, fn);
export const currentAbort = (): AbortSignal | undefined => scope.getStore();

export class CancelledError extends Error {
  constructor(message = 'Cancelado.') {
    super(message);
    this.name = 'CancelledError';
  }
}

export const isCancelled = (e: unknown): boolean => e instanceof CancelledError || (e as Error | undefined)?.name === 'AbortError';

/** Lanza CancelledError si el ámbito actual ya se ha cancelado. */
export function throwIfCancelled(): void {
  if (currentAbort()?.aborted) throw new CancelledError();
}

/** Lo mínimo que se necesita del proceso y del registro (así se puede probar sin Electron). */
export interface ProcessLike {
  on(event: 'uncaughtException' | 'unhandledRejection', listener: (...args: unknown[]) => void): unknown;
}
export interface ErrorLog {
  error(msg: string, err?: unknown): void;
}

/**
 * Un error inesperado en segundo plano (una red caída a mitad de una subida, un archivo que desaparece…)
 * no debe abrir el cuadro de error de Electron ni dejar la aplicación en un estado raro: se anota en el
 * registro con todo su detalle y la aplicación sigue. `getLog` es perezoso porque los manejadores se
 * instalan antes de que exista el registro.
 */
export function installCrashHandlers(proc: ProcessLike, getLog: () => ErrorLog | undefined): void {
  const report = (what: string) => (err: unknown) => {
    const detail = err instanceof Error ? err : new Error(String(err));
    const text = `${what}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`;
    try {
      const log = getLog();
      if (log) log.error(text);
      else process.stderr.write(`${text}\n`);
    } catch {
      /* nada más que hacer */
    }
  };
  proc.on('uncaughtException', report('Error no controlado'));
  proc.on('unhandledRejection', report('Promesa rechazada sin controlar'));
}

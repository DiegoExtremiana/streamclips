/** Mensaje legible de cualquier error capturado. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

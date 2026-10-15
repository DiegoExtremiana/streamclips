/** Mensaje legible de cualquier error capturado. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type ToastKind = 'ok' | 'warn' | 'bad';
export interface ToastDetail {
  text: string;
  kind: ToastKind;
}
export const TOAST_EVENT = 'streamclips:toast';

/** Aviso breve en una esquina (lo recoge el anfitrión de avisos de App). No hace falta esperar nada. */
export function notify(text: string, kind: ToastKind = 'ok'): void {
  window.dispatchEvent(new CustomEvent<ToastDetail>(TOAST_EVENT, { detail: { text, kind } }));
}

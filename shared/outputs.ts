import type { OutputItem, RenderKind } from './types';

/** Orden de preferencia para mostrar un elemento: el horizontal es la vista principal de un clip. */
const ORDER: RenderKind[] = ['horizontal', 'vertical', 'long'];

/** Versión principal de un elemento (la que da la miniatura y la que «Mostrar» abre). */
export function primaryRender(o: Pick<OutputItem, 'files'>): RenderKind | undefined {
  return ORDER.find((k) => Boolean(o.files[k]));
}

export function primaryFile(o: Pick<OutputItem, 'files'>): string | undefined {
  const k = primaryRender(o);
  return k ? o.files[k] : undefined;
}

/** Todos los archivos de un elemento. */
export function allFiles(o: Pick<OutputItem, 'files'>): string[] {
  return ORDER.map((k) => o.files[k]).filter((f): f is string => Boolean(f));
}

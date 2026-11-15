/**
 * Qué IA hace cada tarea (desde la v0.38.0). Cada tarea tiene una lista de proveedores por orden de preferencia: la
 * primera IA configurada de esa lista es la TITULAR de la tarea y las demás quedan de relevo, en ese orden. Así cada IA
 * tiene sus funciones claras y el trabajo se reparte entre las cuentas gratuitas en vez de cargar una sola.
 * Lo usa el programa para decidir a quién pregunta y Ajustes para enseñar la tabla «Quién hace qué».
 */
export type AiProvider = 'gemini' | 'groq' | 'mistral' | 'openrouter';
export type AiTask = 'vision' | 'judge' | 'story' | 'themes' | 'humor' | 'chief' | 'titles';

export const AI_LABEL: Record<AiProvider, string> = { gemini: 'Gemini', groq: 'Groq', mistral: 'Mistral', openrouter: 'OpenRouter' };

export const AI_TASKS: { id: AiTask; label: string; why: string; order: AiProvider[]; needsVision?: boolean }[] = [
  { id: 'vision', label: 'Mirar la imagen (gestos, muecas, pantallas de espera)', why: 'Solo Gemini y Groq ven imágenes; Gemini admite más por petición.', order: ['gemini', 'groq'], needsVision: true },
  { id: 'judge', label: 'Valorar los momentos y los clips', why: 'Son muchas preguntas cortas: Groq es la más rápida.', order: ['groq', 'gemini', 'mistral', 'openrouter'] },
  { id: 'story', label: 'Editor de historia: estructura del resumen', why: 'Texto largo y la decisión más importante: Gemini.', order: ['gemini', 'mistral', 'groq', 'openrouter'] },
  { id: 'themes', label: 'Editor de temas: vídeos por tema', why: 'Texto largo; va a Mistral si está, para no cargar a Gemini.', order: ['mistral', 'gemini', 'groq', 'openrouter'] },
  { id: 'humor', label: 'Editores de humor y de ritmo: clips y recortes', why: 'Respuestas rápidas y cortas: Groq.', order: ['groq', 'mistral', 'gemini', 'openrouter'] },
  { id: 'chief', label: 'Jefe de edición: revisa el montaje', why: 'Mira fotogramas del montaje, así que necesita ver imágenes.', order: ['gemini', 'groq', 'mistral', 'openrouter'] },
  { id: 'titles', label: 'Títulos, descripciones y música', why: 'Texto corto; va a Mistral si está, para repartir.', order: ['mistral', 'gemini', 'groq', 'openrouter'] },
];

const SEES: AiProvider[] = ['gemini', 'groq'];

/** Las IAs configuradas ordenadas para una tarea: la primera es la titular y el resto, sus relevos. */
export function orderFor(task: AiTask, configured: AiProvider[]): AiProvider[] {
  const t = AI_TASKS.find((x) => x.id === task)!;
  const have = [...new Set(configured)];
  const usable = t.needsVision ? have.filter((p) => SEES.includes(p)) : have;
  return [...t.order.filter((p) => usable.includes(p)), ...usable.filter((p) => !t.order.includes(p))];
}

/** La tabla «Quién hace qué» para las IAs configuradas. */
export function assignments(configured: AiProvider[]): { id: AiTask; label: string; why: string; main: AiProvider | null; backups: AiProvider[] }[] {
  return AI_TASKS.map((t) => {
    const o = orderFor(t.id, configured);
    return { id: t.id, label: t.label, why: t.why, main: o[0] ?? null, backups: o.slice(1) };
  });
}

/** Primer momento con la hora local HH:MM estrictamente posterior a `after` y que no esté en `taken` (ms). */
export function nextSlot(after: Date, hhmm: string, taken: ReadonlySet<number> = new Set()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(after);
  d.setHours(h, m, 0, 0);
  for (let i = 0; i < 800; i++) {
    if (d.getTime() > after.getTime() && !taken.has(d.getTime())) return d;
    d.setDate(d.getDate() + 1);
    d.setHours(h, m, 0, 0); // por si el cambio de hora desplaza la hora
  }
  throw new Error('No se encontró una hora libre.');
}

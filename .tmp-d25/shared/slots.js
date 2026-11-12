"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nextSlot = nextSlot;
exports.nextFreeSlot = nextFreeSlot;
/** Primer momento con la hora local HH:MM estrictamente posterior a `after` y que no esté en `taken` (ms). */
function nextSlot(after, hhmm, taken = new Set()) {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(after);
    d.setHours(h, m, 0, 0);
    for (let i = 0; i < 800; i++) {
        if (d.getTime() > after.getTime() && !taken.has(d.getTime()))
            return d;
        d.setDate(d.getDate() + 1);
        d.setHours(h, m, 0, 0); // por si el cambio de hora desplaza la hora
    }
    throw new Error('No se encontró una hora libre.');
}
/** La primera hora libre posterior a `after` entre varias horas del día (HH:MM). */
function nextFreeSlot(after, times, taken = new Set()) {
    if (!times.length)
        throw new Error('No hay horas de publicación configuradas.');
    let best = null;
    for (const t of times) {
        const d = nextSlot(after, t, taken);
        if (!best || d.getTime() < best.getTime())
            best = d;
    }
    return best;
}

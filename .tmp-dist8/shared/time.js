"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTime = parseTime;
exports.fmtTime = fmtTime;
exports.fmtDate = fmtDate;
exports.toLocalInputValue = toLocalInputValue;
exports.defaultLocalDateTime = defaultLocalDateTime;
exports.localInputToIso = localInputToIso;
/** "90", "1:30" o "1:02:03" -> segundos. Devuelve NaN si no es válido. */
function parseTime(input) {
    const s = input.trim();
    if (!s)
        return NaN;
    const parts = s.split(':');
    if (parts.length > 3)
        return NaN;
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i].trim();
        if (!/^\d+(\.\d+)?$/.test(p))
            return NaN;
        const n = Number(p);
        // minutos y segundos no pueden pasar de 59 cuando hay más de un campo
        if (parts.length > 1 && i > 0 && n >= 60)
            return NaN;
        total = total * 60 + n;
    }
    return total;
}
function fmtTime(sec) {
    const total = Math.max(0, Math.floor(sec));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(h ? 2 : 1, '0');
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
function fmtDate(iso) {
    return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}
const pad = (n) => String(n).padStart(2, '0');
/** Valor para <input type="datetime-local"> (hora local) a partir de un instante. */
function toLocalInputValue(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Por defecto: la próxima hora en punto, en hora local. */
function defaultLocalDateTime(now = Date.now()) {
    const d = new Date(now + 3600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInputValue(d);
}
/** Valor de <input type="datetime-local"> (hora local del usuario) -> ISO UTC. null si no es válido. */
function localInputToIso(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

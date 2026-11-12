"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localDayKey = void 0;
exports.buildAgenda = buildAgenda;
exports.dayLabel = dayLabel;
exports.freePlatforms = freePlatforms;
const pad = (n) => String(n).padStart(2, '0');
const localDayKey = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
exports.localDayKey = localDayKey;
/**
 * Agrupa lo programado por día (hora local) y ordena por hora. Dentro de un día puede haber todas las subidas
 * que se quiera. Lo ya publicado o fallido no entra: es una agenda de lo que está por venir.
 */
function buildAgenda(pubs, outputs) {
    const days = new Map();
    const upcoming = pubs.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
    for (const pub of [...upcoming].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt) || a.key.localeCompare(b.key))) {
        const at = Date.parse(pub.scheduledAt);
        const key = (0, exports.localDayKey)(at);
        const day = days.get(key) ?? { key, at, entries: [] };
        day.entries.push({ pub, title: outputs.find((o) => o.id === pub.outputId)?.title ?? 'Vídeo borrado' });
        days.set(key, day);
    }
    return [...days.values()].sort((a, b) => a.at - b.at);
}
/** Nombre humano de un día: «Hoy», «Mañana» o «jueves 15 de octubre». */
function dayLabel(key, now = Date.now()) {
    const [y, m, d] = key.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date(now);
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const diff = Math.round((date.getTime() - startToday) / 86_400_000);
    if (diff === 0)
        return 'Hoy';
    if (diff === 1)
        return 'Mañana';
    const long = date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    return long;
}
/** Redes en las que un vídeo todavía se puede programar (no está publicado ni publicándose). */
function freePlatforms(outputId, pubs, all) {
    return all.filter((pl) => {
        const p = pubs.find((x) => x.outputId === outputId && x.platform === pl);
        return !p || (p.status !== 'published' && p.status !== 'publishing');
    });
}

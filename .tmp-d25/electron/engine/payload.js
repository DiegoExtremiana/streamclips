"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRIES = exports.ENGINE_STATE_PATH = void 0;
exports.parsePayload = parsePayload;
exports.parseRunState = parseRunState;
exports.ENGINE_STATE_PATH = 'engine/state.json';
exports.MAX_TRIES = 3;
function parsePayload(text) {
    let j;
    try {
        j = JSON.parse(text);
    }
    catch {
        throw new Error('El secreto STREAMCLIPS_ENGINE no es válido. Vuelve a sincronizar el motor desde el programa.');
    }
    if (j.v !== 1 || !j.twitch?.clientId || !j.twitch.clientSecret || !j.twitch.login)
        throw new Error('Falta la conexión con Twitch en el motor. Revisa Ajustes y vuelve a sincronizar.');
    if (!j.cloud?.repo || !j.cloud.token)
        throw new Error('Falta el repositorio privado de la nube en el motor.');
    if (j.autopilot && !j.autopilot.series)
        j.autopilot.series = { name: '', nextDay: 1 };
    if (!j.autopilot || !j.whisper || !j.llm || typeof j.since !== 'string')
        throw new Error('La configuración del motor está incompleta. Vuelve a sincronizar desde el programa.');
    return j;
}
function parseRunState(text) {
    const empty = { v: 1, done: [], tries: {} };
    if (!text)
        return empty;
    try {
        const j = JSON.parse(text);
        return {
            v: 1,
            done: Array.isArray(j.done) ? j.done.filter((x) => typeof x === 'string').slice(-500) : [],
            tries: typeof j.tries === 'object' && j.tries !== null ? Object.fromEntries(Object.entries(j.tries).filter(([, n]) => typeof n === 'number')) : {},
            ...(j.last ? { last: j.last } : {}),
            ...(j.series && typeof j.series.name === 'string' && Number.isInteger(j.series.nextDay) && Number.isInteger(j.series.from) ? { series: { name: j.series.name, nextDay: j.series.nextDay, from: j.series.from } } : {}),
        };
    }
    catch {
        return empty;
    }
}

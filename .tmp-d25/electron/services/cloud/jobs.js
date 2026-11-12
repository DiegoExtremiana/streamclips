"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeJob = exports.releaseTag = exports.jobPath = void 0;
exports.parseJob = parseJob;
const jobPath = (key) => `queue/${key.replace(/[^\w-]/g, '__')}.json`;
exports.jobPath = jobPath;
const releaseTag = (key) => `q-${key.replace(/[^\w-]/g, '-')}`.slice(0, 120);
exports.releaseTag = releaseTag;
function parseJob(text) {
    try {
        const j = JSON.parse(text);
        if (j.v !== 1 || typeof j.key !== 'string' || typeof j.platform !== 'string' || typeof j.scheduledAt !== 'string' || !j.file)
            return null;
        if (!['queued', 'publishing', 'published', 'failed'].includes(String(j.status)))
            return null;
        return j;
    }
    catch {
        return null;
    }
}
/** Texto del trabajo con una clave en cada línea: los cambios se ven bien en el historial de GitHub. */
const serializeJob = (j) => `${JSON.stringify(j, null, 2)}\n`;
exports.serializeJob = serializeJob;

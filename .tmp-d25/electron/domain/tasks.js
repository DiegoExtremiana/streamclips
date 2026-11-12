"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskTracker = void 0;
exports.estimateEta = estimateEta;
const node_crypto_1 = __importDefault(require("node:crypto"));
const KEEP = 40;
/**
 * Tiempo restante a partir del avance: por la velocidad medida desde la primera actualización (así un trabajo que se
 * retoma al 77 % no sale con una cifra absurda) o, mientras no hay avance suficiente, por la duración esperada.
 */
function estimateEta(o) {
    const { now, pct } = o;
    if (pct >= 100)
        return 0;
    if (o.firstAt !== undefined && o.firstPct !== undefined) {
        const dp = pct - o.firstPct;
        const dt = (now - o.firstAt) / 1000;
        if (dp >= 2 && dt >= 20)
            return Math.max(0, ((100 - pct) * dt) / dp);
    }
    if (o.expectedSec && o.expectedSec > 0) {
        return Math.max(0, o.expectedSec * ((100 - pct) / 100));
    }
    return undefined;
}
/** Actividad en segundo plano (descargas, transcripciones, análisis, subidas) visible en el Panel. */
class TaskTracker {
    notifier;
    clock;
    tasks = [];
    constructor(notifier, clock = Date.now) {
        this.notifier = notifier;
        this.clock = clock;
    }
    list() {
        return this.tasks.map((t) => ({ ...t }));
    }
    start(kind, label, ref) {
        const startedMs = this.clock();
        const info = { id: node_crypto_1.default.randomUUID(), kind, label, status: 'running', progress: 0, startedAt: new Date(startedMs).toISOString(), ...(ref ? { ref } : {}) };
        this.tasks.unshift(info);
        this.tasks.length = Math.min(this.tasks.length, KEEP);
        this.notifier.task({ ...info });
        const emit = () => this.notifier.task({ ...info });
        let first;
        let expectedSec;
        const eta = () => {
            const s = estimateEta({ now: this.clock(), firstAt: first?.at, firstPct: first?.pct, pct: info.progress, startedAt: startedMs, expectedSec });
            info.etaAt = s === undefined ? undefined : new Date(this.clock() + s * 1000).toISOString();
        };
        return {
            info,
            update: (progress, detail) => {
                info.progress = Math.max(0, Math.min(100, Math.round(progress)));
                first ??= { at: this.clock(), pct: info.progress };
                if (detail !== undefined)
                    info.detail = detail;
                eta();
                emit();
            },
            estimate: (totalSec) => {
                expectedSec = totalSec;
                eta();
                emit();
            },
            done: (detail) => {
                info.status = 'done';
                info.progress = 100;
                info.etaAt = undefined;
                if (detail !== undefined)
                    info.detail = detail;
                info.endedAt = new Date(this.clock()).toISOString();
                emit();
            },
            fail: (error) => {
                info.status = 'error';
                info.etaAt = undefined;
                info.error = error;
                info.endedAt = new Date(this.clock()).toISOString();
                emit();
            },
        };
    }
}
exports.TaskTracker = TaskTracker;

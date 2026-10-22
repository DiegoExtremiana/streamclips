import crypto from 'node:crypto';
import type { TaskInfo, TaskKind } from '../../shared/types';
import type { Notifier } from './notifier';

export interface TaskHandle {
  readonly info: TaskInfo;
  update(progress: number, detail?: string): void;
  /** Duración total que se espera (segundos), para estimar el tiempo restante antes de tener avance medido. */
  estimate(totalSec: number): void;
  done(detail?: string): void;
  fail(error: string): void;
}

const KEEP = 40;

/**
 * Tiempo restante a partir del avance: por la velocidad medida desde la primera actualización (así un trabajo que se
 * retoma al 77 % no sale con una cifra absurda) o, mientras no hay avance suficiente, por la duración esperada.
 */
export function estimateEta(o: { now: number; firstAt?: number; firstPct?: number; pct: number; startedAt: number; expectedSec?: number }): number | undefined {
  const { now, pct } = o;
  if (pct >= 100) return 0;
  if (o.firstAt !== undefined && o.firstPct !== undefined) {
    const dp = pct - o.firstPct;
    const dt = (now - o.firstAt) / 1000;
    if (dp >= 2 && dt >= 20) return Math.max(0, ((100 - pct) * dt) / dp);
  }
  if (o.expectedSec && o.expectedSec > 0) {
    return Math.max(0, o.expectedSec * ((100 - pct) / 100));
  }
  return undefined;
}

/** Actividad en segundo plano (descargas, transcripciones, análisis, subidas) visible en el Panel. */
export class TaskTracker {
  private tasks: TaskInfo[] = [];

  constructor(private notifier: Notifier, private clock: () => number = Date.now) {}

  list(): TaskInfo[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  start(kind: TaskKind, label: string, ref?: string): TaskHandle {
    const startedMs = this.clock();
    const info: TaskInfo = { id: crypto.randomUUID(), kind, label, status: 'running', progress: 0, startedAt: new Date(startedMs).toISOString(), ...(ref ? { ref } : {}) };
    this.tasks.unshift(info);
    this.tasks.length = Math.min(this.tasks.length, KEEP);
    this.notifier.task({ ...info });
    const emit = () => this.notifier.task({ ...info });
    let first: { at: number; pct: number } | undefined;
    let expectedSec: number | undefined;
    const eta = () => {
      const s = estimateEta({ now: this.clock(), firstAt: first?.at, firstPct: first?.pct, pct: info.progress, startedAt: startedMs, expectedSec });
      info.etaAt = s === undefined ? undefined : new Date(this.clock() + s * 1000).toISOString();
    };
    return {
      info,
      update: (progress, detail) => {
        info.progress = Math.max(0, Math.min(100, Math.round(progress)));
        first ??= { at: this.clock(), pct: info.progress };
        if (detail !== undefined) info.detail = detail;
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
        if (detail !== undefined) info.detail = detail;
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

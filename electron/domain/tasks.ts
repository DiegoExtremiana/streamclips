import crypto from 'node:crypto';
import type { TaskInfo, TaskKind } from '../../shared/types';
import type { Notifier } from './notifier';

export interface TaskHandle {
  readonly info: TaskInfo;
  update(progress: number, detail?: string): void;
  done(detail?: string): void;
  fail(error: string): void;
}

const KEEP = 40;

/** Actividad en segundo plano (descargas, transcripciones, análisis, subidas) visible en el Panel. */
export class TaskTracker {
  private tasks: TaskInfo[] = [];

  constructor(private notifier: Notifier) {}

  list(): TaskInfo[] {
    return this.tasks.map((t) => ({ ...t }));
  }

  start(kind: TaskKind, label: string): TaskHandle {
    const info: TaskInfo = { id: crypto.randomUUID(), kind, label, status: 'running', progress: 0, startedAt: new Date().toISOString() };
    this.tasks.unshift(info);
    this.tasks.length = Math.min(this.tasks.length, KEEP);
    this.notifier.task({ ...info });
    const emit = () => this.notifier.task({ ...info });
    return {
      info,
      update: (progress, detail) => {
        info.progress = Math.max(0, Math.min(100, Math.round(progress)));
        if (detail !== undefined) info.detail = detail;
        emit();
      },
      done: (detail) => {
        info.status = 'done';
        info.progress = 100;
        if (detail !== undefined) info.detail = detail;
        info.endedAt = new Date().toISOString();
        emit();
      },
      fail: (error) => {
        info.status = 'error';
        info.error = error;
        info.endedAt = new Date().toISOString();
        emit();
      },
    };
  }
}

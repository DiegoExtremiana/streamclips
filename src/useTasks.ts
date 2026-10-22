import { useEffect, useState } from 'react';
import type { TaskInfo } from '../shared/types';

/** Tiempo como H:MM:SS (p. ej. 1:05:09). */
export function fmtEta(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Segundos que faltan hasta `etaAt`, o null si todavía no hay estimación. */
export function remainingSec(t: Pick<TaskInfo, 'etaAt'> | undefined, now: number): number | null {
  if (!t?.etaAt) return null;
  const at = Date.parse(t.etaAt);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : null;
}

/** La actividad en segundo plano, al día. */
export function useTasks(): TaskInfo[] {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  useEffect(() => {
    window.api.listTasks().then(setTasks).catch(() => undefined);
    return window.api.onTaskUpdate((t) => setTasks((prev) => [t, ...prev.filter((x) => x.id !== t.id)].slice(0, 40)));
  }, []);
  return tasks;
}

/** Hora actual que se refresca cada segundo mientras `active` (para que la cuenta atrás avance sola). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** La tarea de análisis en marcha de un VOD, si la hay. */
export function analysisTask(tasks: TaskInfo[], vodId: string): TaskInfo | undefined {
  return tasks.find((x) => x.kind === 'analyze' && x.ref === vodId && x.status === 'running');
}

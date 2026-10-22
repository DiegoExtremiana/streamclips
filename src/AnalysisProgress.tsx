import type { TaskInfo } from '../shared/types';
import { fmtEta, remainingSec } from './useTasks';

/** «Tiempo estimado: H:MM:SS» y, debajo, la barra de progreso del análisis. */
export default function AnalysisProgress(props: { task: TaskInfo; now: number }) {
  const { task, now } = props;
  const s = remainingSec(task, now);
  return (
    <div style={{ marginTop: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" aria-live="off">Tiempo estimado: {s === null ? 'calculando…' : fmtEta(s)}</span>
        <span className="muted small">{task.progress}%</span>
      </div>
      <div className="progress" role="progressbar" aria-label="Progreso del análisis" aria-valuenow={task.progress} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${task.progress}%` }} />
      </div>
      {task.detail && <div className="muted small">{task.detail}</div>}
    </div>
  );
}

import type { Block } from '../../shared/schedulePlan';
import { hhmm, monthGrid } from '../../shared/schedulePlan';
import { IconPlus } from '../icons';
import type { DragApi } from './drag';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const SHORT = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' } as const;
const MAX_CHIPS = 3;

const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Calendario del mes: arrastra una subida a otro día y conserva su hora. */
export default function CalendarView(props: {
  year: number;
  month0: number;
  blocks: Block[];
  todayKey: string;
  drag: DragApi;
  onAdd: (dayKey: string) => void;
  onOpenDay: (dayKey: string) => void;
}) {
  const weeks = monthGrid(props.year, props.month0);
  const { drag } = props;
  return (
    <div className="calendar" role="group" aria-label="Calendario">
      <div className="cal-head">{WEEKDAYS.map((d) => <div key={d}>{d}</div>)}</div>
      {weeks.map((week) => (
        <div key={week[0]} className="cal-week">
          {week.map((day) => {
            const inMonth = Number(day.slice(5, 7)) - 1 === props.month0;
            const mine = props.blocks.filter((b) => keyOf(b.at) === day);
            const isOver = drag.hover?.dayKey === day;
            return (
              <div
                key={day}
                className={`cal-cell ${inMonth ? '' : 'out'} ${day === props.todayKey ? 'today' : ''} ${day < props.todayKey ? 'past' : ''} ${isOver ? 'over' : ''}`}
                data-cell-day={day}
                data-testid={`cal-${day}`}
              >
                <div className="cal-num">
                  <span>{Number(day.slice(8))}</span>
                  {day >= props.todayKey && (
                    <button className="cal-add" aria-label={`Añadir subida el ${Number(day.slice(8))}/${day.slice(5, 7)}`} title="Añadir subida" onClick={() => props.onAdd(day)}><IconPlus size={14} /></button>
                  )}
                </div>
                {mine.slice(0, MAX_CHIPS).map((b) => (
                  <div
                    key={b.id}
                    className={`cal-chip ${b.kind === 'long' ? 'video' : ''} ${b.locked ? 'locked' : ''} ${drag.dragging?.kind === 'block' && drag.dragging.block.id === b.id ? 'ghosted' : ''}`}
                    data-testid={`calblock-${b.title}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${b.title}, ${hhmm(b.at)}, ${b.platforms.map((p) => SHORT[p]).join(' ')}`}
                    title={`${b.title}\n${hhmm(b.at)} · ${b.platforms.join(', ')}`}
                    onPointerDown={(e) => (b.locked ? undefined : drag.start(e, { kind: 'block', block: b }, `${b.title} · ${hhmm(b.at)}`))}
                    onClick={(e) => {
                      if (e.detail === 0) drag.onActivate({ kind: 'block', block: b });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        drag.onActivate({ kind: 'block', block: b });
                      }
                    }}
                  >
                    <span className="mono">{hhmm(b.at)}</span> <span className="cal-title">{b.title}</span>
                  </div>
                ))}
                {mine.length > MAX_CHIPS && (
                  <button className="cal-more" onClick={() => props.onOpenDay(day)}>+{mine.length - MAX_CHIPS} más</button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

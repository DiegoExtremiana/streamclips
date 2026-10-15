import { useEffect, useRef, useState } from 'react';
import type { Block } from '../../shared/schedulePlan';
import { hhmm, layoutLanes, minutesOfDay } from '../../shared/schedulePlan';
import { dayLabel } from '../../shared/agenda';
import type { DragApi } from './drag';

const CHIP_PX = 168;
const LANE_PX = 34;
const SHORT = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' } as const;
const HOURS = [0, 3, 6, 9, 12, 15, 18, 21];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(Math.max(300, el.clientWidth));
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Línea de tiempo: una franja de 24 horas por cada día. Cada subida es un bloque en su hora; se arrastra a la
 * derecha o a la izquierda para cambiar la hora (de 15 en 15 minutos) y arriba o abajo para cambiar de día.
 */
export default function Timeline(props: { days: string[]; blocks: Block[]; now: number; drag: DragApi; todayKey: string }) {
  const [axisRef, trackW] = useWidth();
  const widthMin = (CHIP_PX / trackW) * 1440;
  const { drag } = props;
  return (
    <div className="timeline" role="group" aria-label="Línea de tiempo">
      <div className="tl-row tl-head">
        <div className="tl-label" />
        <div className="tl-axis" ref={axisRef}>
          {HOURS.map((h) => (
            <span key={h} className="tl-tick" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>
          ))}
        </div>
      </div>
      {props.days.map((day) => {
        const mine = props.blocks.filter((b) => {
          const d = new Date(b.at);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === day;
        });
        const { lanes, count } = layoutLanes(mine.map((b) => ({ id: b.id, at: b.at })), widthMin);
        const over = drag.hover?.dayKey === day && drag.hover.minutes !== undefined ? drag.hover.minutes : null;
        const isToday = day === props.todayKey;
        return (
          <div key={day} className={`tl-row ${isToday ? 'today' : ''}`} data-testid={`tl-row-${day}`}>
            <div className="tl-label">
              <strong>{dayLabel(day, props.now)}</strong>
              <span className="muted small">{day.slice(8)}/{day.slice(5, 7)}</span>
            </div>
            <div className={`tl-track ${over !== null ? 'over' : ''}`} data-track-day={day} style={{ height: count * LANE_PX + 10 }}>
              {HOURS.map((h) => <span key={h} className="tl-grid" style={{ left: `${(h / 24) * 100}%` }} />)}
              {isToday && <span className="tl-now" style={{ left: `${(minutesOfDay(props.now) / 1440) * 100}%` }} title="Ahora" />}
              {over !== null && (
                <span className="tl-marker" style={{ left: `${(over / 1440) * 100}%` }}>
                  <span>{String(Math.floor(over / 60)).padStart(2, '0')}:{String(over % 60).padStart(2, '0')}</span>
                </span>
              )}
              {mine.map((b) => {
                const left = (minutesOfDay(b.at) / 1440) * 100;
                const dragged = drag.dragging?.kind === 'block' && drag.dragging.block.id === b.id;
                return (
                  <div
                    key={b.id}
                    className={`tl-chip ${b.kind === 'long' ? 'video' : ''} ${b.locked ? 'locked' : ''} ${dragged ? 'ghosted' : ''}`}
                    data-testid={`block-${b.title}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${b.title}, ${hhmm(b.at)}, ${b.platforms.map((p) => SHORT[p]).join(' ')}${b.locked ? ', publicándose' : ''}`}
                    title={`${b.title}\n${hhmm(b.at)} · ${b.platforms.join(', ')}${b.note ? `\n${b.note}` : ''}`}
                    style={{ left: `min(${left}%, calc(100% - ${CHIP_PX}px))`, top: 5 + (lanes.get(b.id) ?? 0) * LANE_PX, width: CHIP_PX }}
                    onPointerDown={(e) => (b.locked ? undefined : drag.start(e, { kind: 'block', block: b }, `${b.title} · ${hhmm(b.at)}`))}
                    onClick={(e) => {
                      // el ratón ya lo gestiona el arrastre; esto es para teclado (Intro / espacio)
                      if (e.detail === 0) drag.onActivate({ kind: 'block', block: b });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        drag.onActivate({ kind: 'block', block: b });
                      }
                    }}
                  >
                    <span className="mono tl-time">{hhmm(b.at)}</span>
                    {b.kind === 'long' && <span className="tl-kind">Vídeo</span>}
                    <span className="tl-name">{b.title}</span>
                    <span className="tl-nets">{b.platforms.map((p) => SHORT[p]).join(' ')}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

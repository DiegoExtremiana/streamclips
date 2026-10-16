import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtTenths, fromFraction, moveHandle, timelineWindow, toFraction, type TrimRange } from '../../shared/trim';

/**
 * Línea de tiempo del recorte, al estilo del editor de clips de Twitch: el clip va marcado en morado con dos agarres
 * que se arrastran, y alrededor se ve un poco del directo para poder alargarlo. La barra blanca es el punto de reproducción.
 */
export default function ClipTimeline(props: {
  range: TrimRange;
  vodDuration: number | null;
  /** Instante del directo que se está reproduciendo (null si no hay reproductor). */
  playhead: number | null;
  onChange: (r: TrimRange) => void;
  /** El usuario pincha en la línea: segundo del directo. */
  onSeek: (vodTime: number) => void;
  /** Mientras se arrastra un agarre: segundo del directo que marca (para ver ese fotograma). */
  onScrub?: (vodTime: number) => void;
  disabled?: boolean;
}) {
  const { range, vodDuration, disabled } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);
  const scrubbing = useRef(false);
  // la ventana se calcula al abrir (y no se mueve mientras se arrastra, para que los agarres no «huyan»)
  const win = useRef<TrimRange>(timelineWindow(range, vodDuration));
  if (range.start < win.current.start || range.end > win.current.end) win.current = timelineWindow(range, vodDuration);
  const w = win.current;

  const timeAt = (clientX: number): number => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r || !r.width) return range.start;
    return fromFraction((clientX - r.left) / r.width, w);
  };
  const down = (which: 'start' | 'end') => (e: PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!dragging.current) return;
    const next = moveHandle(dragging.current, timeAt(e.clientX), range, vodDuration);
    props.onChange(next);
    props.onScrub?.(next[dragging.current]);
  };
  const up = (e: PointerEvent) => {
    dragging.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ya soltado */
    }
  };
  const key = (which: 'start' | 'end') => (e: KeyboardEvent) => {
    if (disabled) return;
    const step = e.shiftKey ? 5 : 0.5;
    const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
    if (!dir) return;
    e.preventDefault();
    props.onChange(moveHandle(which, range[which] + dir * step, range, vodDuration));
  };

  const a = toFraction(range.start, w) * 100;
  const b = toFraction(range.end, w) * 100;
  const ph = props.playhead === null ? null : toFraction(props.playhead, w) * 100;

  return (
    <div className="ctl" data-testid="clip-timeline">
      <div
        ref={trackRef}
        className="ctl-track"
        // mantener el clic y mover: el punto de reproducción va con el ratón
        onPointerDown={(e) => {
          if (disabled || dragging.current) return;
          scrubbing.current = true;
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* sin captura */
          }
          props.onSeek(Math.min(range.end, Math.max(range.start, timeAt(e.clientX))));
        }}
        onPointerMove={(e) => {
          if (scrubbing.current) props.onSeek(Math.min(range.end, Math.max(range.start, timeAt(e.clientX))));
        }}
        onPointerUp={() => { scrubbing.current = false; }}
        onPointerCancel={() => { scrubbing.current = false; }}
      >
        <div className="ctl-dim" style={{ left: 0, width: `${a}%` }} />
        <div className="ctl-sel" style={{ left: `${a}%`, width: `${Math.max(0, b - a)}%` }} />
        <div className="ctl-dim" style={{ left: `${b}%`, right: 0 }} />
        {ph !== null && ph >= a && ph <= b && <div className="ctl-head" style={{ left: `${ph}%` }} data-testid="clip-playhead" />}
        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            className={`ctl-grip ${which}`}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={which === 'start' ? 'Inicio del clip' : 'Fin del clip'}
            aria-valuemin={which === 'start' ? Math.max(0, range.end - 180) : range.start + 1}
            aria-valuemax={which === 'start' ? range.end - 1 : (vodDuration ?? range.end + 180)}
            aria-valuenow={range[which]}
            aria-valuetext={fmtTenths(range[which])}
            data-testid={`grip-${which}`}
            style={{ left: `${which === 'start' ? a : b}%` }}
            onPointerDown={down(which)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={up}
            onKeyDown={key(which)}
          >
            <span className="gripdots" aria-hidden="true" />
          </div>
        ))}
      </div>
      <div className="ctl-labels muted small">
        <span>{fmtTenths(w.start)}</span>
        <span aria-live="polite"><strong>{fmtTenths(range.end - range.start)} s</strong> de clip · {fmtTenths(range.start)} – {fmtTenths(range.end)}</span>
        <span>{fmtTenths(w.end)}</span>
      </div>
    </div>
  );
}

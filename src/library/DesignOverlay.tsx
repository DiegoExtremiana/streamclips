import { useCallback, useEffect, useRef, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type RefObject } from 'react';
import type { FramingPreview } from '../../shared/types';
import { moveSrc, resizeFromCorner, resizeSrc, type Rect, type VerticalLayout } from '../../shared/layout';
import { COMPOSITION_H, COMPOSITION_W, drawComposition } from './VerticalEditor';

export const WINDOW_COLORS = ['#ff4fa3', '#22d3ee', '#facc15'];

export interface DesignState {
  framing: FramingPreview;
  layout: VerticalLayout;
  onChange: (l: VerticalLayout) => void;
}

type Drag = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; src: Rect };

/**
 * Las ventanas del diseño vertical dibujadas encima de la versión horizontal (que sigue reproduciéndose):
 * se arrastran para moverlas y la esquina cambia su tamaño. Lo que queda dentro de cada recuadro es lo que se verá en vertical.
 */
export function WindowsOverlay({ design, selected, onSelect }: { design: DesignState; selected: number; onSelect: (i: number) => void }) {
  const { framing, layout, onChange } = design;
  const aspect = framing.width / framing.height;
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sel = Math.min(selected, layout.windows.length - 1);

  const setWindow = useCallback(
    (i: number, src: Rect) => {
      const cur = layoutRef.current;
      onChange({ ...cur, windows: cur.windows.map((w, k) => (k === i ? { ...w, src } : w)) });
    },
    [onChange],
  );
  const norm = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const start = (e: RPointerEvent, index: number, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    const p = norm(e);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onSelect(index);
    dragRef.current = { index, mode, startX: p.x, startY: p.y, src: layoutRef.current.windows[index].src };
  };
  const move = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d || e.buttons !== 1) return;
    const p = norm(e);
    if (!p) return;
    const dst = layoutRef.current.windows[d.index].dst;
    if (d.mode === 'move') setWindow(d.index, moveSrc(d.src, p.x - d.startX, p.y - d.startY));
    else setWindow(d.index, resizeFromCorner(d.src, dst, p.x, p.y, aspect));
  };
  const end = () => {
    dragRef.current = null;
  };
  const key = (e: RKeyboardEvent, i: number) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const w = layout.windows[i];
    const go = (dx: number, dy: number) => {
      e.preventDefault();
      setWindow(i, moveSrc(w.src, dx, dy));
    };
    if (e.key === 'ArrowLeft') go(-step, 0);
    else if (e.key === 'ArrowRight') go(step, 0);
    else if (e.key === 'ArrowUp') go(0, -step);
    else if (e.key === 'ArrowDown') go(0, step);
    else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setWindow(i, resizeSrc(w.src, w.dst, w.src.h + step, aspect));
    } else if (e.key === '-') {
      e.preventDefault();
      setWindow(i, resizeSrc(w.src, w.dst, w.src.h - step, aspect));
    }
  };

  return (
    <div ref={boxRef} className="dov" data-testid="design-overlay">
      {layout.windows.map((w, i) => (
        <div
          key={i}
          className={`vwin ${sel === i ? 'sel' : ''}`}
          data-testid={`vwin-${i}`}
          role="button"
          tabIndex={0}
          aria-label={`Ventana ${i + 1}: arrastra para mover, esquina para el tamaño`}
          style={{ left: `${w.src.x * 100}%`, top: `${w.src.y * 100}%`, width: `${w.src.w * 100}%`, height: `${w.src.h * 100}%`, borderColor: WINDOW_COLORS[i], background: `${WINDOW_COLORS[i]}22` }}
          onPointerDown={(e) => start(e, i, 'move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onFocus={() => onSelect(i)}
          onKeyDown={(e) => key(e, i)}
        >
          <span className="vbadge" style={{ background: WINDOW_COLORS[i] }}>{i + 1}</span>
          <span className="vhandle" data-testid={`vwin-${i}-resize`} style={{ background: WINDOW_COLORS[i] }} onPointerDown={(e) => start(e, i, 'resize')} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
        </div>
      ))}
    </div>
  );
}

/** La versión vertical tal como quedará, dibujada en directo con el vídeo horizontal que se está reproduciendo. */
export function LivePreview({ design, video, selected, onSelect }: { design: DesignState; video: RefObject<HTMLVideoElement>; selected: number; onSelect: (i: number) => void }) {
  const { framing, layout } = design;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sel = Math.min(selected, layout.windows.length - 1);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const v = video.current;
        const img = imgRef.current;
        if (v && v.readyState >= 2 && v.videoWidth > 0) drawComposition(ctx, v, v.videoWidth, v.videoHeight, layoutRef.current);
        else if (img && img.complete && img.naturalWidth > 0) drawComposition(ctx, img, img.naturalWidth, img.naturalHeight, layoutRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return (
    <div className="vpreview" data-testid="vpreview">
      <canvas ref={canvasRef} width={COMPOSITION_W} height={COMPOSITION_H} aria-label="Vista previa del vídeo vertical" />
      <img ref={imgRef} src={framing.dataUrl} alt="" aria-hidden="true" style={{ display: 'none' }} />
      {layout.windows.map((w, i) => (
        <button
          key={i}
          type="button"
          className={`vzone ${sel === i ? 'sel' : ''}`}
          aria-label={`Seleccionar ventana ${i + 1}`}
          style={{ left: `${w.dst.x * 100}%`, top: `${w.dst.y * 100}%`, width: `${w.dst.w * 100}%`, height: `${w.dst.h * 100}%`, borderColor: WINDOW_COLORS[i] }}
          onClick={() => onSelect(i)}
        >
          <span className="vbadge" style={{ background: WINDOW_COLORS[i] }}>{i + 1}</span>
        </button>
      ))}
    </div>
  );
}

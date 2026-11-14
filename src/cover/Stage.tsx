import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { COVER_H, COVER_W, hit, type Design, type Layer } from '../../shared/coverDesign';
import { drawDesign, textBox, type ImageMap } from './render';

type Drag = { kind: 'move' | 'scale' | 'rotate'; id: string; p0: { x: number; y: number }; l0: Layer; d0: number; a0: number; began: boolean };

/**
 * El lienzo de la portada: dibuja el diseño y deja elegir, mover, escalar y girar capas con el ratón
 * (o moverlas con las flechas). El marco de selección es una capa de HTML encima del lienzo.
 */
export default function Stage(props: {
  design: Design;
  images: ImageMap;
  /** Cambia cuando se cargan imágenes o tipografías, para volver a dibujar. */
  version: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Se llama una vez al empezar un gesto (para poder deshacerlo entero). */
  onBegin: () => void;
  onPatch: (id: string, patch: (l: Layer) => Layer) => void;
  onDelete: (id: string) => void;
}) {
  const { design, selectedId } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawDesign(ctx, design, props.images);
  }, [design, props.images, props.version]);

  const ctx2d = () => canvas.current?.getContext('2d') ?? null;
  const boxOf = (l: Layer): { w: number; h: number } => {
    if (l.type !== 'text') return { w: l.w, h: l.h };
    const c = ctx2d();
    return c ? textBox(c, l) : { w: l.size * l.text.length * 0.55, h: l.size * 1.2 };
  };
  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * COVER_W) / r.width, y: ((e.clientY - r.top) * COVER_H) / r.height };
  };
  const sel = design.layers.find((l) => l.id === selectedId && l.visible) ?? null;

  const down = (e: PointerEvent) => {
    const p = toCanvas(e);
    const handle = (e.target as HTMLElement).dataset.handle as 'scale' | 'rotate' | undefined;
    let target: Layer | null = null;
    if (handle && sel) target = sel;
    else {
      for (let i = design.layers.length - 1; i >= 0; i--) {
        const l = design.layers[i];
        if (l.visible && !l.locked && hit(l, p.x, p.y, l.type === 'text' ? boxOf(l) : undefined)) {
          target = l;
          break;
        }
      }
    }
    if (!target) {
      props.onSelect(null);
      return;
    }
    props.onSelect(target.id);
    if (target.locked) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      kind: handle ?? 'move', id: target.id, p0: p, l0: target, began: false,
      d0: Math.max(1, Math.hypot(p.x - target.x, p.y - target.y)), a0: Math.atan2(p.y - target.y, p.x - target.x),
    };
  };
  const move = (e: PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = toCanvas(e);
    if (!g.began) {
      if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < 2) return;
      g.began = true;
      props.onBegin();
    }
    const l0 = g.l0;
    if (g.kind === 'move') {
      props.onPatch(g.id, (l) => ({ ...l, x: Math.round(l0.x + p.x - g.p0.x), y: Math.round(l0.y + p.y - g.p0.y) }));
    } else if (g.kind === 'scale') {
      const k = Math.min(8, Math.max(0.05, Math.hypot(p.x - l0.x, p.y - l0.y) / g.d0));
      props.onPatch(g.id, (l) => {
        if (l.type === 'text' && l0.type === 'text') return { ...l, size: Math.round(Math.min(600, Math.max(8, l0.size * k))), strokeWidth: Math.round(l0.strokeWidth * k) };
        if (l.type !== 'text' && l0.type !== 'text') return { ...l, w: Math.round(Math.max(8, l0.w * k)), h: Math.round(Math.max(8, l0.h * k)) };
        return l;
      });
    } else {
      let deg = l0.rotation + ((Math.atan2(p.y - l0.y, p.x - l0.x) - g.a0) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      props.onPatch(g.id, (l) => ({ ...l, rotation: Math.round(deg * 10) / 10 }));
    }
  };
  const up = (e: PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ya soltado */
    }
  };
  const key = (e: KeyboardEvent) => {
    if (!sel || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      props.onDelete(sel.id);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    props.onBegin();
    props.onPatch(sel.id, (l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
  };

  const box = sel ? boxOf(sel) : null;
  return (
    <div className="cvs-wrap" tabIndex={0} onKeyDown={key} data-testid="cover-stage" aria-label="Lienzo de la portada (flechas para mover la capa elegida, Supr para borrarla)">
      <div className="cvs-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <canvas ref={canvas} width={COVER_W} height={COVER_H} className="cvs-canvas" />
        {sel && box && (
          <div
            className="cvs-sel"
            style={{
              left: `${(sel.x / COVER_W) * 100}%`, top: `${(sel.y / COVER_H) * 100}%`, width: `${(box.w / COVER_W) * 100}%`, height: `${(box.h / COVER_H) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${sel.rotation}deg)`,
            }}
          >
            {!sel.locked && (
              <>
                {['nw', 'ne', 'sw', 'se'].map((c) => <span key={c} className={`cvs-h ${c}`} data-handle="scale" title="Arrastra para cambiar el tamaño" />)}
                <span className="cvs-rot" data-handle="rotate" title="Arrastra para girar (Mayús = de 15 en 15°)" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

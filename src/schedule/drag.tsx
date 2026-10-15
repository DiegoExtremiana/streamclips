import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { OutputItem } from '../../shared/types';
import type { Block } from '../../shared/schedulePlan';
import { snapMinutes } from '../../shared/schedulePlan';

export type DragPayload = { kind: 'block'; block: Block } | { kind: 'video'; output: OutputItem };
/** Dónde se ha soltado: un día y, en la línea de tiempo, unos minutos. */
export interface DropTarget {
  dayKey: string;
  /** Solo en la línea de tiempo (ya ajustado a 15 min). */
  minutes?: number;
}
export interface Ghost {
  x: number;
  y: number;
  label: string;
}

const THRESHOLD = 5;

/**
 * Arrastrar y soltar con el puntero (ratón, lápiz o táctil), sin depender del arrastre nativo del navegador:
 * da la posición exacta en la línea de tiempo y funciona igual en todas las vistas. Un clic sin mover llama
 * a `onClick`. Los destinos se marcan en el HTML: `data-track-day` (franja de un día en la línea de tiempo)
 * y `data-cell-day` (casilla del calendario). Escape cancela.
 */
export function useDragDrop(handlers: {
  onClick: (p: DragPayload) => void;
  onDrop: (p: DragPayload, t: DropTarget) => void;
}) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [hover, setHover] = useState<DropTarget | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => () => cleanup.current?.(), []);

  const targetAt = (x: number, y: number, grab: number): DropTarget | null => {
    for (const el of document.elementsFromPoint(x, y)) {
      const track = (el as HTMLElement).dataset?.trackDay;
      if (track) {
        const r = el.getBoundingClientRect();
        // la hora es la del borde izquierdo del bloque, no la del puntero: se descuenta dónde se agarró
        const frac = Math.min(1, Math.max(0, (x - grab - r.left) / r.width));
        return { dayKey: track, minutes: snapMinutes(frac * 1440) };
      }
      const cell = (el as HTMLElement).dataset?.cellDay;
      if (cell) return { dayKey: cell };
    }
    return null;
  };

  const start = useCallback((e: RPointerEvent, payload: DragPayload, label: string) => {
    if (e.button !== 0 || cleanup.current) return;
    // dónde se agarró el bloque (desde su borde izquierdo); un vídeo de la bandeja no tiene: manda el puntero
    const grab = payload.kind === 'block' ? Math.max(0, e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left) : 0;
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let last: DropTarget | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
      if (!moved) {
        moved = true;
        document.body.classList.add('dragging');
        setDragging(payload);
      }
      setGhost({ x: ev.clientX, y: ev.clientY, label });
      last = targetAt(ev.clientX, ev.clientY, grab);
      setHover(last);
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      document.body.classList.remove('dragging');
      cleanup.current = null;
      setGhost(null);
      setHover(null);
      setDragging(null);
      if (!commit) return;
      if (!moved) h.current.onClick(payload);
      else if (last) h.current.onDrop(payload, last);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        end(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    cleanup.current = () => end(false);
  }, []);

  /** Para el teclado: abrir un bloque sin arrastrar. */
  const onActivate = useCallback((p: DragPayload) => h.current.onClick(p), []);

  return { start, ghost, hover, dragging, onActivate };
}

export type DragApi = ReturnType<typeof useDragDrop>;

/** Chip que sigue al puntero mientras se arrastra. */
export function GhostChip({ ghost }: { ghost: Ghost | null }) {
  if (!ghost) return null;
  return (
    <div className="ghostchip" style={{ left: ghost.x + 12, top: ghost.y + 12 }} aria-hidden="true">
      {ghost.label}
    </div>
  );
}

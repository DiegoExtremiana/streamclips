import { useEffect, useRef, type ReactNode } from 'react';
import { IconClose } from '../icons';

/** Ventana modal accesible: Escape y clic fuera la cierran, el foco entra en ella y vuelve a donde estaba. */
export function Modal(props: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => e.stopPropagation()}>
      <div ref={ref} className={`modal ${props.wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={props.title} tabIndex={-1}>
        <div className="modal-head">
          <h2>{props.title}</h2>
          <button className="btn ghost small" aria-label="Cerrar" onClick={onClose}><IconClose /></button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Menú contextual (clic derecho, tecla de menú o botón de opciones). */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const left = Math.min(props.x, window.innerWidth - 240);
  const top = Math.min(props.y, window.innerHeight - 40 * props.items.length - 16);
  return (
    <div ref={ref} className="ctxmenu" role="menu" style={{ left, top }}>
      {props.items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

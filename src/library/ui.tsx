import { useEffect, useRef, type ReactNode } from 'react';
import { IconChevron, IconChevronLeft, IconClose } from '../icons';

/** Ventana modal accesible: Escape y clic fuera la cierran, el foco entra en ella y vuelve a donde estaba. */
/** Flechas de la cabecera para pasar al elemento anterior o siguiente (con el teclado lo gestiona quien abre la ventana). */
export interface ModalNav { onPrev?: () => void; onNext?: () => void; prevLabel: string; nextLabel: string }

export function Modal(props: { title: string; onClose: () => void; wide?: boolean | 'mid'; children: ReactNode; nav?: ModalNav; /** Entra deslizándose desde ese lado. */ enter?: 'left' | 'right'; /** Copia de la ventana que sale deslizándose hacia ese lado: sin foco ni teclas. */ leave?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  const leaving = !!props.leave;
  useEffect(() => {
    if (leaving) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
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
  }, [onClose, leaving]);
  const slide = props.leave ? ` leave-${props.leave}` : props.enter ? ` enter-${props.enter}` : '';
  return (
    <div className={`backdrop${leaving ? ' ghost' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => e.stopPropagation()} aria-hidden={leaving || undefined}>
      <div ref={ref} className={`modal ${props.wide === 'mid' ? 'mid' : props.wide ? 'wide' : ''}${slide}`} role={leaving ? undefined : 'dialog'} aria-modal={leaving ? undefined : 'true'} aria-label={props.title} tabIndex={-1}>
        <div className="modal-head">
          {props.nav && (
            <div className="modal-nav">
              <button className="btn ghost small" aria-label={props.nav.prevLabel} title={`${props.nav.prevLabel} (flecha izquierda)`} disabled={!props.nav.onPrev} onClick={props.nav.onPrev} data-testid="modal-prev"><IconChevronLeft /></button>
              <button className="btn ghost small" aria-label={props.nav.nextLabel} title={`${props.nav.nextLabel} (flecha derecha)`} disabled={!props.nav.onNext} onClick={props.nav.onNext} data-testid="modal-next"><IconChevron /></button>
            </div>
          )}
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

/** Sección de una ventana: título en mayúsculas con flecha; se pliega y se despliega (abierta por defecto) para ordenar fichas largas. */
export function Fold(props: { label: string; title: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <section aria-label={props.label}>
      <details className="fold" open={props.open ?? true}>
        <summary><h3>{props.title}</h3><IconChevron size={14} /></summary>
        <div className="fold-body">{props.children}</div>
      </details>
    </section>
  );
}

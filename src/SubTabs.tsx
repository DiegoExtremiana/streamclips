import { useState, type ReactNode } from 'react';

export interface SubTab {
  id: string;
  label: string;
  /** Aviso pequeño junto al nombre (p. ej. cuántos hay). */
  badge?: string | number;
  hint?: string;
}

/** Lee la última sección elegida (si se puede) para que la pantalla se abra donde se dejó. */
export function useSubTab(storageKey: string, ids: string[]): [string, (id: string) => void] {
  const [id, setId] = useState(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v && ids.includes(v) ? v : ids[0];
    } catch {
      return ids[0];
    }
  });
  const set = (v: string) => {
    setId(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* sin almacenamiento */
    }
  };
  return [id, set];
}

/**
 * Secciones de una pantalla como pestañas visibles arriba (en vez de una lista larga de tarjetas):
 * se ve de un vistazo qué hay y se llega con un clic. Flechas izquierda/derecha para moverse.
 */
export function SubTabs(props: { label: string; tabs: SubTab[]; value: string; onChange: (id: string) => void; children?: ReactNode }) {
  const { tabs, value } = props;
  const current = tabs.find((t) => t.id === value) ?? tabs[0];
  return (
    <div className="subtabs-wrap">
      <div
        className="subtabs"
        role="tablist"
        aria-label={props.label}
        onKeyDown={(e) => {
          const i = tabs.findIndex((t) => t.id === current.id);
          const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : -1;
          if (n < 0) return;
          e.preventDefault();
          props.onChange(tabs[n].id);
          (e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[n])?.focus();
        }}
      >
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === current.id} tabIndex={t.id === current.id ? 0 : -1} className={`subtab ${t.id === current.id ? 'active' : ''}`} onClick={() => props.onChange(t.id)}>
            {t.label}
            {t.badge !== undefined && t.badge !== '' && <span className="subtab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      {current.hint && <div className="muted small subtab-hint">{current.hint}</div>}
      {props.children}
    </div>
  );
}

/**
 * Secciones de una pantalla larga como lista vertical a la izquierda (cada una con su explicación debajo del nombre)
 * y el contenido de la elegida a la derecha. Flechas arriba/abajo para moverse.
 */
export function SideNav(props: { label: string; tabs: SubTab[]; value: string; onChange: (id: string) => void; children?: ReactNode }) {
  const { tabs, value } = props;
  const current = tabs.find((t) => t.id === value) ?? tabs[0];
  return (
    <div className="sidenav-layout">
      <div
        className="sidenav"
        role="tablist"
        aria-orientation="vertical"
        aria-label={props.label}
        onKeyDown={(e) => {
          const i = tabs.findIndex((t) => t.id === current.id);
          const n = e.key === 'ArrowDown' ? (i + 1) % tabs.length : e.key === 'ArrowUp' ? (i + tabs.length - 1) % tabs.length : -1;
          if (n < 0) return;
          e.preventDefault();
          props.onChange(tabs[n].id);
          (e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[n])?.focus();
        }}
      >
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === current.id} tabIndex={t.id === current.id ? 0 : -1} aria-label={t.label} title={t.hint} className={`sidetab ${t.id === current.id ? 'active' : ''}`} onClick={() => props.onChange(t.id)}>
            <span className="sidetab-name">{t.label}</span>
            {t.hint && <span className="sidetab-hint">{t.hint}</span>}
          </button>
        ))}
      </div>
      <div className="sidenav-body stack">{props.children}</div>
    </div>
  );
}

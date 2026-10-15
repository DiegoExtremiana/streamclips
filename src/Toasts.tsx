import { useEffect, useState } from 'react';
import { IconAlert, IconCheck, IconClose } from './icons';
import { TOAST_EVENT, type ToastDetail } from './lib';

interface Toast extends ToastDetail {
  id: number;
}
const MAX = 4;

/** Avisos breves en la esquina: desaparecen solos (los de error tardan más) y se pueden cerrar. */
export default function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const timers = new Set<number>();
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail;
      const id = ++n;
      setList((cur) => [...cur.slice(-(MAX - 1)), { ...d, id }]);
      const t = window.setTimeout(() => setList((cur) => cur.filter((x) => x.id !== id)), d.kind === 'ok' ? 5000 : 11000);
      timers.add(t);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' ? <IconCheck /> : <IconAlert />}
          <span>{t.text}</span>
          <button aria-label="Cerrar aviso" onClick={() => setList((cur) => cur.filter((x) => x.id !== t.id))}><IconClose size={14} /></button>
        </div>
      ))}
    </div>
  );
}

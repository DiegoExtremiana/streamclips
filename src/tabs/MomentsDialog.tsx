import { useCallback, useEffect, useState } from 'react';
import type { MomentRow, MomentsView } from '../../shared/types';
import { Modal } from '../library/ui';
import { errMsg } from '../lib';

const KIND: Record<string, string> = { gracia: 'Gracia', fail: 'Fail', reaccion: 'Reacción', discusion: 'Discusión', historia: 'Historia', epico: 'Épico', otro: 'Otro' };

export const clock = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/** «1:02:03», «12:30» o «750» a segundos; null si no se entiende. */
export function parseClock(v: string): number | null {
  const p = v.trim().split(':');
  if (p.length > 3 || p.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  return p.reduce((a, x) => a * 60 + Number(x), 0);
}

function Row(props: { vodId: string; r: MomentRow; onChange: (v: MomentsView) => void; onError: (m: string) => void }) {
  const { r, vodId } = props;
  const [a, setA] = useState(clock(r.start));
  const [b, setB] = useState(clock(r.end));
  useEffect(() => {
    setA(clock(r.start));
    setB(clock(r.end));
  }, [r.start, r.end]);
  const run = async (f: () => Promise<MomentsView>) => {
    try {
      props.onChange(await f());
    } catch (e) {
      props.onError(errMsg(e));
    }
  };
  const apply = () => {
    const s = parseClock(a);
    const e = parseClock(b);
    if (s === null || e === null) return props.onError('Escribe los tiempos como minutos:segundos (por ejemplo 12:30).');
    if (s === r.start && e === r.end) return;
    void run(() => window.api.trimMoment(vodId, r.key, s, e));
  };
  const state = r.excluded ? 'Descartado' : r.chosen ? 'Elegido' : r.pinned ? 'Fijado' : 'No elegido';
  return (
    <li className="moment" style={{ opacity: r.excluded ? 0.55 : 1, borderTop: '1px solid var(--line)', padding: '10px 0' }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ minWidth: 38 }} title="Nota de entretenimiento, de 0 a 10">{r.total.toFixed(1)}</strong>
        <span className={`badge ${r.chosen && !r.excluded ? 'ok' : ''}`}>{state}</span>
        <span className="badge">{r.manual ? 'Tuyo' : KIND[r.kind] ?? r.kind}</span>
        {r.belowFloor && !r.pinned && !r.manual && <span className="badge warn" title="No llega a la nota mínima; solo entra si lo fijas.">Bajo la nota mínima</span>}
        {r.edited && <span className="badge">Recortado por ti</span>}
        {r.title && <span>{r.title}</span>}
      </div>
      {r.reason && <div className="muted small" style={{ marginTop: 4 }}>{r.reason}</div>}
      {r.text && <div className="small" style={{ marginTop: 4, maxHeight: 62, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{r.text}</div>}
      <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <label className="small muted" htmlFor={`ms-${r.key}`}>Desde</label>
        <input id={`ms-${r.key}`} type="text" value={a} onChange={(e) => setA(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 76 }} />
        <label className="small muted" htmlFor={`me-${r.key}`}>hasta</label>
        <input id={`me-${r.key}`} type="text" value={b} onChange={(e) => setB(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 76 }} />
        <span className="muted small">({Math.round(r.end - r.start)} s)</span>
        <span style={{ flex: 1 }} />
        {r.excluded ? (
          <button className="btn ghost small" onClick={() => void run(() => window.api.setMomentState(vodId, r.key, 'reset'))}>Quitar descarte</button>
        ) : (
          <>
            {!r.chosen && !r.pinned && <button className="btn small" title="Entra en la próxima generación aunque no llegue a la nota mínima." onClick={() => void run(() => window.api.setMomentState(vodId, r.key, 'include'))}>Incluir</button>}
            {r.pinned && <button className="btn ghost small" onClick={() => void run(() => window.api.setMomentState(vodId, r.key, 'reset'))}>Dejar de fijar</button>}
            <button className="btn ghost small" onClick={() => void run(() => window.api.setMomentState(vodId, r.key, 'exclude'))}>Descartar</button>
          </>
        )}
        {r.manual && <button className="btn ghost small" onClick={() => void run(() => window.api.removeMoment(vodId, r.key))}>Quitar</button>}
      </div>
    </li>
  );
}

/**
 * Revisión de los momentos que eligió el piloto en un directo: nota, tipo, motivo y lo que se dice; permite descartar, incluir
 * uno que no llegó, ajustar dónde empieza y acaba y añadir un tramo propio. Los cambios se guardan aparte y se aplican al
 * «Volver a analizar», que reutiliza la transcripción y las valoraciones: no vuelve a pagar nada.
 */
export default function MomentsDialog(props: { vodId: string; title: string; onClose: () => void; onRegenerate: () => Promise<void> }) {
  const [view, setView] = useState<MomentsView | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setView(await window.api.getMoments(props.vodId));
    } catch (e) {
      setMsg(errMsg(e));
    }
  }, [props.vodId]);
  useEffect(() => {
    void load();
  }, [load]);
  const onChange = (v: MomentsView) => {
    setMsg(null);
    setView(v);
  };
  const add = async () => {
    const s = parseClock(from);
    const e = parseClock(to);
    if (s === null || e === null) return setMsg('Escribe los tiempos como minutos:segundos (por ejemplo 12:30).');
    try {
      onChange(await window.api.addMoment(props.vodId, s, e, name));
      setFrom('');
      setTo('');
      setName('');
    } catch (err) {
      setMsg(errMsg(err));
    }
  };
  const regenerate = async () => {
    setBusy(true);
    try {
      await props.onRegenerate();
      props.onClose();
    } catch (e) {
      setMsg(errMsg(e));
      setBusy(false);
    }
  };
  return (
    <Modal title={`Momentos · ${props.title}`} onClose={props.onClose} wide>
      {!view ? (
        <p className="muted">{msg ?? 'Cargando…'}</p>
      ) : !view.available ? (
        <p className="muted">Este directo no tiene una selección guardada. Analízalo con la selección inteligente activada (hace falta una clave gratuita de Gemini o Groq en Ajustes) y aquí podrás revisar cada momento.</p>
      ) : (
        <>
          <p className="muted small">
            Nota mínima actual: {view.quality?.toFixed(1)}/10. Descarta lo que no te guste, incluye lo que se quedó fuera o ajusta dónde empieza y acaba cada momento; después pulsa «Aplicar y regenerar».
            No se vuelve a transcribir ni a preguntar al modelo.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: '52vh', overflow: 'auto' }}>
            {view.rows.map((r) => (
              <Row key={r.key} vodId={props.vodId} r={r} onChange={onChange} onError={setMsg} />
            ))}
          </ul>
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <strong className="small">Añadir un tramo</strong>
            <input type="text" aria-label="Inicio del tramo" placeholder="Desde 12:30" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 120 }} />
            <input type="text" aria-label="Final del tramo" placeholder="Hasta 13:10" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 120 }} />
            <input type="text" aria-label="Nombre del tramo" placeholder="Nombre (opcional)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ width: 170 }} />
            <button className="btn small" disabled={!from.trim() || !to.trim()} onClick={() => void add()}>Añadir</button>
          </div>
        </>
      )}
      {msg && view && <p role="alert" className="small" style={{ color: 'var(--danger, #ff6b6b)' }}>{msg}</p>}
      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
        {view?.available && view.pending && (
          <button className="btn ghost" onClick={() => void window.api.clearMomentEdits(props.vodId).then(onChange).catch((e) => setMsg(errMsg(e)))}>Deshacer mis cambios</button>
        )}
        {view?.available && (
          <button className="btn" disabled={busy || !view.pending} title={view.pending ? 'Vuelve a generar los vídeos con tus cambios; sustituye los pendientes de revisión.' : 'Haz algún cambio primero.'} onClick={() => void regenerate()}>
            Aplicar y regenerar
          </button>
        )}
        <button className="btn ghost" onClick={props.onClose}>Cerrar</button>
      </div>
    </Modal>
  );
}

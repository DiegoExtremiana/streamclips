import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../shared/types';
import { fmtDate } from '../../shared/time';
import { errMsg } from '../lib';

export function useUpdateStatus(): UpdateStatus | null {
  const [s, setS] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    window.api.updateStatus().then(setS).catch(() => undefined);
    return window.api.onUpdate(setS);
  }, []);
  return s;
}

export default function UpdatesCard() {
  const s = useUpdateStatus();
  const [err, setErr] = useState('');
  if (!s) return null;
  const label: Record<UpdateStatus['status'], string> = {
    unsupported: 'Solo en el programa instalado',
    idle: 'Al día',
    checking: 'Buscando…',
    downloading: `Descargando ${s.version ?? ''} ${s.progress ?? 0}%`,
    ready: `Versión ${s.version ?? ''} lista`,
    error: 'No se pudo comprobar',
  };
  return (
    <section className="card" aria-label="Actualizaciones">
      <h2>Actualizaciones</h2>
      <div className="row" style={{ gap: 10 }}>
        <span className="muted">Versión {s.currentVersion}</span>
        <span className={`badge ${s.status === 'ready' ? 'ok' : s.status === 'error' ? 'bad' : ''}`}>{label[s.status]}</span>
      </div>
      <div className="muted small" style={{ marginTop: 6 }}>
        El programa busca versiones nuevas cada hora, las descarga solo y se reinicia para instalarlas cuando no hay nada en marcha
        (descargas, montajes, publicaciones ni directo). Si lo cierras antes, se instalan al cerrarlo.
        {s.lastCheck ? ` Última comprobación: ${fmtDate(s.lastCheck)}.` : ''}
      </div>
      {(s.error || err) && <div className="msg bad" role="alert">{s.error ?? err}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn ghost" disabled={s.status === 'unsupported' || s.status === 'checking' || s.status === 'downloading'} onClick={() => void window.api.updateCheck().catch((e) => setErr(errMsg(e)))}>Buscar ahora</button>
        {s.status === 'ready' && <button className="btn" onClick={() => void window.api.updateInstall().catch((e) => setErr(errMsg(e)))}>Instalar y reiniciar ahora</button>}
      </div>
    </section>
  );
}

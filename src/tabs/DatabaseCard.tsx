import { useCallback, useEffect, useState } from 'react';
import { errMsg } from '../lib';

type Info = { dir: string; tables: { name: string; file: string; rows: number; about: string }[] };

/** Base de datos de StreamClips: tablas (CSV) con todo lo que maneja el programa, conectadas por identificadores. */
export default function DatabaseCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    window.api.databaseInfo().then((i) => { setInfo(i); setError(''); }).catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const sep = info?.dir.includes('\\') ? '\\' : '/';
  return (
    <section className="card" aria-label="Base de datos">
      <h2>Base de datos</h2>
      <div className="muted small">
        Todo lo que maneja el programa, ordenado en tablas que se abren con Excel o cualquier hoja de cálculo. Se actualizan solas cada minuto y se conectan entre sí
        por identificadores (un directo → sus vídeos → sus publicaciones). Son una copia: para trabajar con ellas, cópialas a otro sitio.
      </div>
      {error && <div className="msg bad" role="alert">{error}</div>}
      {info && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" onClick={() => void window.api.openPath(info.dir).catch(() => undefined)}>Abrir la carpeta</button>
            <button className="btn ghost small" onClick={load}>Actualizar ahora</button>
          </div>
          <div className="list" data-testid="db-tables">
            {info.tables.map((t) => (
              <div key={t.name} className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                  <b>{t.name}</b> <span className="badge">{t.rows} filas</span>
                  <div className="muted small">{t.about}</div>
                </div>
                <button className="btn ghost small" onClick={() => void window.api.openPath(`${info.dir}${sep}${t.file}`).catch(() => undefined)}>Abrir</button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

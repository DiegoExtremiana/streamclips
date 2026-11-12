import { useEffect, useState } from 'react';
import { MIN_DECISIONS } from '../../shared/preferences';
import { errMsg } from '../lib';

type View = Awaited<ReturnType<typeof window.api.getPrefs>>;
const KIND: Record<string, string> = { gracia: 'Gracia', fail: 'Fail', reaccion: 'Reacción', discusion: 'Discusión', historia: 'Historia', epico: 'Épico' };

/**
 * Lo que el programa ha aprendido de tus decisiones en «Revisar momentos». Es un ajuste pequeño de la nota por tipo de momento
 * (como mucho 1,5 puntos), solo se aplica cuando hay varias decisiones del mismo tipo, y aquí lo ves, lo apagas o lo borras.
 */
export default function PrefsCard() {
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function act(f: () => Promise<View>) {
    try {
      setV(await f());
      setMsg(null);
    } catch (e) {
      setMsg(errMsg(e));
    }
  }
  useEffect(() => {
    void act(() => window.api.getPrefs());
  }, []);
  return (
    <section className="card" aria-label="Preferencias aprendidas">
      <h2>Preferencias aprendidas</h2>
      <div className="muted small">
        Cuando descartas un momento que el piloto había elegido, o incluyes uno que se quedó fuera, el programa lo anota por tipo (gracia, fail, reacción…). Con {MIN_DECISIONS} decisiones o más de un tipo, sube o baja un poco la nota de ese tipo en los próximos análisis. Nunca decide solo: el ajuste es de como mucho 1,5 puntos.
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={v?.enabled ?? true} onChange={(e) => void act(() => window.api.setPrefsEnabled(e.target.checked))} /> Aplicar lo aprendido en los próximos análisis
      </label>
      {v && v.kinds.length === 0 ? (
        <div className="muted small">Todavía no hay nada aprendido. Se irá llenando cuando uses «Revisar momentos» en el Panel.</div>
      ) : (
        <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
          {v?.kinds.map((k) => (
            <li key={k.kind} className="small">
              <strong>{KIND[k.kind] ?? k.kind}</strong>: {k.bias > 0 ? '+' : ''}
              {k.bias} puntos ({k.count} decisión{k.count === 1 ? '' : 'es'}) {k.active ? '· se aplica' : `· aún no (faltan ${Math.max(1, MIN_DECISIONS - k.count)})`}
            </li>
          ))}
        </ul>
      )}
      {v && v.kinds.length > 0 && (
        <button className="btn ghost small" onClick={() => void act(() => window.api.resetPrefs())}>Borrar lo aprendido</button>
      )}
      {msg && <div className="msg bad" role="alert">{msg}</div>}
    </section>
  );
}

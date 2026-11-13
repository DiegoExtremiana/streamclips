import { useCallback, useEffect, useState } from 'react';
import { formatBytes, type StorageReport } from '../../shared/storage';

/** Cuánto espacio ocupa cada cosa y un botón para liberar lo que ya no hace falta (directos aprovechados y temporales). */
export default function StorageCard() {
  const [r, setR] = useState<StorageReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => window.api.storageReport().then(setR).catch(() => undefined), []);
  useEffect(() => {
    void load();
  }, [load]);

  async function free() {
    setBusy(true);
    setMsg(null);
    try {
      const f = await window.api.freeStorage();
      setMsg({ ok: true, text: `Liberados ${formatBytes(f.freedBytes)}${f.vods ? ` (${f.vods} directo${f.vods === 1 ? '' : 's'} ya aprovechado${f.vods === 1 ? '' : 's'})` : ''}. Tus vídeos, clips y transcripciones siguen donde estaban.` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Espacio en disco">
      <h2>Espacio en disco</h2>
      {!r ? (
        <p className="muted small">Calculando…</p>
      ) : (
        <>
          <ul className="storage-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {r.items.map((i) => (
              <li key={i.id} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '4px 0' }}>
                <span>
                  {i.label}
                  <span className="muted small" style={{ display: 'block' }}>{i.note}</span>
                </span>
                <b>{formatBytes(i.bytes)}</b>
              </li>
            ))}
          </ul>
          <div className="muted small" style={{ marginTop: 6 }}>Total: {formatBytes(r.total)}. Se pueden liberar {formatBytes(r.reclaimableBytes)}{r.reclaimableVods ? ` (${r.reclaimableVods} directo${r.reclaimableVods === 1 ? '' : 's'} completo${r.reclaimableVods === 1 ? '' : 's'} del que ya salieron clips o vídeos)` : ''}.</div>
          {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy || r.reclaimableBytes === 0} onClick={() => void free()}>Liberar espacio</button>
          </div>
        </>
      )}
    </section>
  );
}

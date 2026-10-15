import { useCallback, useEffect, useState } from 'react';
import type { TwitchClip } from '../../shared/types';
import { fmtDate, fmtTime } from '../../shared/time';
import { errMsg } from '../lib';

const REFRESH_MS = 60_000;

/** Clips del canal de Twitch: se actualizan solos mientras esta pestaña está abierta; tú eliges cuáles pasan a la Biblioteca. */
export default function TwitchClips({ onChanged }: { onChanged: () => Promise<void> }) {
  const [clips, setClips] = useState<TwitchClip[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClips(await window.api.channelClips());
      setError('');
    } catch (e) {
      setError(`${errMsg(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function importClip(id: string) {
    setBusy(id);
    try {
      await window.api.channelImportClip(id);
      await onChanged();
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-label="Clips de tu canal de Twitch">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Clips de tu canal de Twitch</h2>
        <button className="btn ghost small" onClick={() => void load()}>Actualizar</button>
      </div>
      <div className="muted small">
        Se actualiza solo cada minuto. Elige los que quieras: se descargan y quedan en la Biblioteca en vertical y horizontal.
      </div>
      {error && <div className="msg bad" role="alert">{error} (revisa la pestaña Conexiones)</div>}
      {clips && clips.length === 0 && !error && <div className="muted" style={{ marginTop: 8 }}>Tu canal no tiene clips todavía.</div>}
      <div className="list">
        {clips?.map((c) => (
          <div key={c.id} className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="title-ellipsis">{c.title}</div>
              <div className="muted small">
                {fmtDate(c.createdAt)} · {fmtTime(Math.round(c.durationSec))} · {c.views} visualizaciones · por {c.creator}
              </div>
            </div>
            <button className="btn small" disabled={c.imported || busy === c.id} onClick={() => void importClip(c.id)}>
              {c.imported ? 'En la Biblioteca' : busy === c.id ? 'Añadiendo…' : 'Añadir a la Biblioteca'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

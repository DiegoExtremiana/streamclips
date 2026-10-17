import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import { errMsg } from '../lib';
import NetworksCard from './NetworksCard';

export default function ConnectionsTab() {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [login, setLogin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        setClientId(s.twitch.clientId);
        setClientSecret(s.twitch.clientSecret);
        setLogin(s.twitch.login);
      })
      .catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);

  async function save() {
    const s = await window.api.setSettings({ twitch: { clientId, clientSecret, login } });
    setLogin(s.twitch.login);
    setClientSecret(s.twitch.clientSecret);
  }

  async function saveOnly() {
    setMsg(null);
    try {
      await save();
      setMsg({ ok: true, text: 'Guardado.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      await save();
      const r = await window.api.twitchTest();
      setMsg({ ok: r.ok, text: r.message });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <section className="card">
        <div className="row" style={{ gap: 10 }}>
          <h2>Twitch</h2>
          <span className={`badge ${clientId && login ? 'ok' : 'warn'}`}>{clientId && login ? 'Configurado' : 'Sin configurar'}</span>
        </div>
        <div className="muted small">
          Crea una aplicación gratuita en dev.twitch.tv (consola de desarrollador) y copia aquí su Client ID y su Client Secret.
          Solo se usa para leer tus VODs públicos.
        </div>
        <div className="field">
          <label htmlFor="tw-login">Nombre de tu canal</label>
          <input id="tw-login" type="text" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="don_diegons" />
        </div>
        <div className="field">
          <label htmlFor="tw-id">Client ID</label>
          <input id="tw-id" type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="tw-secret">Client Secret</label>
          <input
            id="tw-secret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            onFocus={() => clientSecret === MASKED_SECRET && setClientSecret('')}
            autoComplete="off"
          />
        </div>
        <div className="row">
          <button className="btn ghost" onClick={() => void saveOnly()}>Guardar</button>
          <button className="btn" disabled={busy} onClick={() => void test()}>Guardar y probar conexión</button>
        </div>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
      </section>

      <NetworksCard />
    </div>
  );
}

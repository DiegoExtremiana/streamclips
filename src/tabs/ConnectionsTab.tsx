import KeyGuide, { TWITCH_STEPS } from '../library/KeyGuide';
import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import { errMsg } from '../lib';
import NetworksCard from './NetworksCard';
import PanelTab from './PanelTab';
import type { OutputItem, Publication, VodJob } from '../../shared/types';
import type { TabId } from '../App';
import { SideNav, useSubTab } from '../SubTabs';

const SECTIONS = [
  { id: 'estado', label: 'Estado y primeros pasos', hint: 'Cómo está tu canal y qué falta para que todo funcione solo.' },
  { id: 'twitch', label: 'Twitch', hint: 'Tu canal y la aplicación gratuita de Twitch con la que el programa lee tus directos y clips.' },
  { id: 'redes', label: 'Redes sociales', hint: 'YouTube, TikTok e Instagram: conecta las cuentas donde se publica.' },
];

export default function ConnectionsTab(props: { vods: VodJob[]; outputs: OutputItem[]; pubs: Publication[]; onChanged: () => Promise<void>; onNavigate: (tab: TabId) => void }) {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [login, setLogin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useSubTab('streamclips.connections.sec', SECTIONS.map((x) => x.id));

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
    <SideNav label="Conexiones" tabs={SECTIONS} value={sub} onChange={setSub}>
      {sub === 'estado' && <div className="grid">
      <PanelTab vods={props.vods} outputs={props.outputs} pubs={props.pubs} onChanged={props.onChanged} onNavigate={props.onNavigate} part="status" />
      <PanelTab vods={props.vods} outputs={props.outputs} pubs={props.pubs} onChanged={props.onChanged} onNavigate={props.onNavigate} part="guide" />
      </div>}
      {sub === 'twitch' && <div className="grid">
      <section className="card">
        <div className="row" style={{ gap: 10 }}>
          <h2>Twitch</h2>
          <span className={`badge ${clientId && login ? 'ok' : 'warn'}`}>{clientId && login ? 'Configurado' : 'Sin configurar'}</span>
        </div>
        <div className="muted small">
          Crea una aplicación gratuita en dev.twitch.tv (consola de desarrollador) y copia aquí su Client ID y su Client Secret.
          Solo se usa para leer tus VODs públicos.
        </div>
        <KeyGuide title="Cómo conseguir el Client ID y el Client Secret, paso a paso" steps={TWITCH_STEPS} testId="twitch-howto" />
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
      </div>}
      {sub === 'redes' && <div className="grid"><NetworksCard /></div>}
    </SideNav>
  );
}

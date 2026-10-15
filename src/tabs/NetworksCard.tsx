import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import type { ConnectionInfo, Platform } from '../../shared/types';
import { errMsg } from '../lib';

const INFO: Record<Platform, { name: string; redirect: string; steps: string[]; idLabel: string }> = {
  youtube: {
    name: 'YouTube',
    redirect: 'http://127.0.0.1:53682/callback',
    idLabel: 'ID de cliente',
    steps: [
      'Entra en console.cloud.google.com y crea un proyecto (gratis).',
      'En «APIs y servicios» activa «YouTube Data API v3».',
      'Pantalla de consentimiento OAuth: tipo «Externo», añade tu correo como usuario de prueba y, al terminar, pulsa «Publicar la aplicación» (si se queda en «Pruebas», Google caduca la conexión a los 7 días).',
      'Credenciales > Crear credenciales > ID de cliente de OAuth > tipo «Aplicación de escritorio». Copia el ID y el secreto aquí.',
    ],
  },
  tiktok: {
    name: 'TikTok',
    redirect: 'http://127.0.0.1:53683/callback',
    idLabel: 'Client key',
    steps: [
      'Entra en developers.tiktok.com, crea una app y añade los productos «Login Kit» y «Content Posting API».',
      `Pon como URI de redirección la dirección de abajo. Si TikTok no acepta una dirección http, esta conexión no podrá completarse: dímelo y buscamos otra vía.`,
      'Copia la Client key y el Client secret aquí.',
    ],
  },
  instagram: {
    name: 'Instagram',
    redirect: 'http://127.0.0.1:53684/callback',
    idLabel: 'ID de la app',
    steps: [
      'Tu Instagram debe ser una cuenta profesional (Business o Creador) enlazada a una página de Facebook.',
      'Entra en developers.facebook.com, crea una app de tipo «Empresa» y añade «Inicio de sesión con Facebook» y la API de Instagram.',
      'En «Inicio de sesión con Facebook > Configuración» añade la dirección de abajo como URI de redireccionamiento OAuth válido.',
      'Mientras la app esté en modo desarrollo funciona con tus propias cuentas, sin revisión de Meta. Copia el ID de la app y la clave secreta aquí.',
    ],
  },
};

export default function NetworksCard() {
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [open, setOpen] = useState<Platform | null>(null);
  const [form, setForm] = useState<Record<string, { id: string; secret: string }>>({});
  const [busy, setBusy] = useState<Platform | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    window.api.listConnections().then(setConns).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);

  const f = (p: Platform) => form[p] ?? { id: '', secret: '' };
  const set = (p: Platform, v: Partial<{ id: string; secret: string }>) => setForm({ ...form, [p]: { ...f(p), ...v } });

  async function run(p: Platform, fn: () => Promise<ConnectionInfo[]>, ok: string) {
    setBusy(p);
    setMsg(null);
    try {
      setConns(await fn());
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  async function connect(p: Platform) {
    const v = form[p];
    await run(
      p,
      async () => {
        if (v && (v.id || v.secret)) await window.api.setConnectionApp(p, v.id, v.secret || MASKED_SECRET);
        return window.api.connectPlatform(p);
      },
      `${INFO[p].name} conectado.`,
    );
  }

  return (
    <section className="card" aria-label="Redes sociales">
      <h2>Redes sociales</h2>
      <div className="muted small">
        Cada red necesita una «app» tuya (gratuita) para poder publicar en tu nombre. Se guarda cifrada en tu PC; el programa nunca ve tu contraseña.
      </div>
      <div className="list">
        {conns.map((c) => (
          <div key={c.platform}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{INFO[c.platform].name}</strong>
              <div className="row" style={{ gap: 8 }}>
                {c.connected ? <span className="badge ok">Conectado{c.account ? `: ${c.account}` : ''}</span> : <span className="badge warn">{c.hasCredentials ? 'Falta autorizar' : 'Sin configurar'}</span>}
                <button className="btn ghost small" onClick={() => setOpen(open === c.platform ? null : c.platform)}>{open === c.platform ? 'Cerrar' : c.connected ? 'Gestionar' : 'Configurar'}</button>
              </div>
            </div>
            <div className="muted small">{c.caveat}</div>
            {open === c.platform && (
              <div style={{ marginTop: 10 }}>
                <ol className="small muted" style={{ paddingLeft: 18 }}>
                  {INFO[c.platform].steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
                <div className="field">
                  <label>Dirección de redirección que debes registrar</label>
                  <input type="text" readOnly value={INFO[c.platform].redirect} onFocus={(e) => e.currentTarget.select()} />
                </div>
                <div className="field">
                  <label htmlFor={`${c.platform}-id`}>{INFO[c.platform].idLabel}</label>
                  <input id={`${c.platform}-id`} type="text" autoComplete="off" placeholder={c.hasCredentials ? '(ya guardado)' : ''} value={f(c.platform).id} onChange={(e) => set(c.platform, { id: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor={`${c.platform}-secret`}>Secreto</label>
                  <input id={`${c.platform}-secret`} type="password" autoComplete="off" placeholder={c.hasCredentials ? '(ya guardado)' : ''} value={f(c.platform).secret} onChange={(e) => set(c.platform, { secret: e.target.value })} />
                </div>
                <div className="row">
                  <button className="btn" disabled={busy !== null || (!c.hasCredentials && !(f(c.platform).id && f(c.platform).secret))} onClick={() => void connect(c.platform)}>
                    {busy === c.platform ? 'Esperando al navegador…' : c.connected ? 'Volver a autorizar' : 'Guardar y conectar'}
                  </button>
                  {busy === c.platform && <button className="btn ghost" onClick={() => void window.api.cancelConnect()}>Cancelar</button>}
                  {c.connected && <button className="btn ghost" disabled={busy !== null} onClick={() => void run(c.platform, () => window.api.disconnectPlatform(c.platform), `${INFO[c.platform].name} desconectado.`)}>Desconectar</button>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
    </section>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import type { ConnectionInfo, ConnectionProbe, Platform } from '../../shared/types';
import { errMsg } from '../lib';
import KeyGuide from '../library/KeyGuide';
import { IconAlert, IconCheck } from '../icons';

interface NetworkInfo {
  name: string;
  redirect: string;
  idLabel: string;
  secretLabel: string;
  steps: ReactNode[];
  /** Lo que conviene saber antes de empezar (tiempo, requisitos). */
  before: ReactNode;
}

/**
 * Instrucciones paso a paso, comprobadas contra la documentación de cada red (noviembre de 2026). Cada red necesita una
 * «app» tuya, gratuita: es la forma que tienen de dejar que un programa publique en tu nombre sin conocer tu contraseña.
 */
const INFO: Record<Platform, NetworkInfo> = {
  youtube: {
    name: 'YouTube',
    redirect: 'http://127.0.0.1:53682/callback',
    idLabel: 'ID de cliente',
    secretLabel: 'Secreto de cliente',
    before: <>Unos 10 minutos. Hace falta la cuenta de Google de tu canal. No hay que pagar nada ni pedir revisión a Google.</>,
    steps: [
      <>Entra en <code>console.cloud.google.com</code> con la cuenta de Google de tu canal. Arriba, en el selector de proyectos, pulsa <strong>Proyecto nuevo</strong>, ponle de nombre <em>StreamClips</em> y créalo (espera a que aparezca seleccionado).</>,
      <>Menú › <strong>APIs y servicios › Biblioteca</strong>. Busca <em>YouTube Data API v3</em>, ábrela y pulsa <strong>Habilitar</strong>.</>,
      <>Menú › <strong>APIs y servicios › Pantalla de consentimiento de OAuth</strong> (ahora se llama <em>Google Auth Platform</em>). Pulsa <strong>Empezar</strong>: nombre de la app <em>StreamClips</em>, tu correo de asistencia; público <strong>Externo</strong>; tu correo de contacto; acepta y pulsa <strong>Crear</strong>.</>,
      <>En <strong>Público</strong> (Audience) pulsa <strong>Publicar la aplicación</strong> y confirma. Es importante: si se queda «En pruebas», Google corta la conexión cada 7 días. No hace falta enviar nada a verificación: al conectar, Google avisará de que la app no está verificada; pulsa <em>Configuración avanzada</em> › <em>Ir a StreamClips (no seguro)</em>. Es tu propia app.</>,
      <>Menú › <strong>APIs y servicios › Credenciales › Crear credenciales › ID de cliente de OAuth</strong>. Tipo de aplicación: <strong>Aplicación de escritorio</strong>. Nombre: <em>StreamClips</em>. Pulsa <strong>Crear</strong>.</>,
      <>En la ventana que sale, copia el <strong>ID de cliente</strong> (termina en <code>.apps.googleusercontent.com</code>) y el <strong>Secreto de cliente</strong>, y pégalos aquí abajo. Pulsa <strong>Comprobar las claves</strong> y después <strong>Guardar y conectar</strong>: se abre el navegador, eliges la cuenta del canal y aceptas <strong>todas</strong> las casillas.</>,
      <>Al volver, pulsa <strong>Probar la conexión</strong>. Debe salir tu canal y el permiso para subir vídeos.</>,
    ],
  },
  tiktok: {
    name: 'TikTok',
    redirect: 'http://127.0.0.1:53683/callback',
    idLabel: 'Client key',
    secretLabel: 'Client secret',
    before: <>Unos 15 minutos. TikTok exige un enlace a unas condiciones de uso y a una política de privacidad (vale cualquier página tuya) y, hasta que revise tu app, lo que se publique sale <strong>privado</strong> (solo lo ves tú). Para publicar en público hay que enviar la app a revisión; es gratis pero tarda días.</>,
    steps: [
      <>Entra en <code>developers.tiktok.com</code> con tu cuenta de TikTok y pulsa <strong>Manage apps › Connect an app</strong>. Nombre <em>StreamClips</em>, categoría <em>Entertainment</em>, descripción breve (p. ej. «Publica mis clips de Twitch»), y los enlaces de <em>Terms of Service</em> y <em>Privacy Policy</em>.</>,
      <>En <strong>Platforms</strong> añade <strong>Desktop</strong>.</>,
      <>En <strong>Add products</strong> añade <strong>Login Kit</strong> y, en su configuración, pega como <em>Redirect URI</em> la dirección de abajo, exactamente igual.</>,
      <>Añade también <strong>Content Posting API</strong> y activa <strong>Direct Post</strong>. En <strong>Scopes</strong> deben quedar <code>user.info.basic</code>, <code>video.upload</code> y <code>video.publish</code>.</>,
      <>Arriba del todo, en <strong>Credentials</strong>, copia la <strong>Client key</strong> y el <strong>Client secret</strong> y pégalos aquí abajo. Pulsa <strong>Comprobar las claves</strong>.</>,
      <>Mientras la app no esté revisada, solo funciona en <strong>Sandbox</strong>: en la pestaña <em>Sandbox</em> crea uno, añade tu cuenta de TikTok en <strong>Target users</strong> y usa la Client key del sandbox (empieza por <code>sbaw</code>). Si al conectar sale «non_sandbox_target», es que falta este paso.</>,
      <>Pulsa <strong>Guardar y conectar</strong>, autoriza en el navegador con tu cuenta de TikTok y, al volver, <strong>Probar la conexión</strong>: te dirá si la cuenta puede publicar en público o solo en privado.</>,
      <>Cuando quieras publicar en público, en developers.tiktok.com pulsa <strong>Submit for review</strong> (hace falta un vídeo corto enseñando cómo publica el programa). Al aprobarla, cambia aquí la Client key por la de producción y vuelve a conectar.</>,
    ],
  },
  instagram: {
    name: 'Instagram',
    redirect: 'http://localhost:53684/callback',
    idLabel: 'ID de la app',
    secretLabel: 'Clave secreta de la app',
    before: <>Unos 15 minutos. Tu cuenta de Instagram tiene que ser <strong>profesional</strong> (Creador o Empresa) y estar <strong>enlazada a una página de Facebook</strong> tuya. Con la app en modo desarrollo publica con tus propias cuentas sin revisión de Meta. Solo clips (Reels).</>,
    steps: [
      <>En la app de Instagram: <em>Configuración › Tipo de cuenta y herramientas › Cambiar a cuenta profesional</em> (Creador). Después, en <em>Configuración › Centro de cuentas › Cuentas</em>, añade tu página de Facebook (si no tienes, créala en facebook.com › Páginas).</>,
      <>Entra en <code>developers.facebook.com</code> con tu cuenta de Facebook y pulsa <strong>Mis apps › Crear app</strong>. Nombre <em>StreamClips</em>. En caso de uso elige <strong>Otro</strong> y en tipo <strong>Empresa</strong>. Crea la app (si pide una cuenta comercial, pulsa «omitir» o elige la tuya).</>,
      <>En el panel de la app, añade el producto <strong>Inicio de sesión con Facebook para empresas</strong> (o «Inicio de sesión con Facebook»). En su <strong>Configuración</strong>, en <em>URI de redireccionamiento de OAuth válidos</em>, pega la dirección de abajo y guarda.</>,
      <>Añade también el producto <strong>API de Instagram</strong> (Instagram Graph API). No hace falta configurar nada más.</>,
      <>Menú izquierdo › <strong>Configuración de la app › Básica</strong>: copia el <strong>Identificador de la app</strong> y la <strong>Clave secreta de la app</strong> (pulsa <em>Mostrar</em>) y pégalos aquí abajo. Pulsa <strong>Comprobar las claves</strong>.</>,
      <>Pulsa <strong>Guardar y conectar</strong>. En el navegador entra con tu Facebook, elige <strong>tu página</strong> y <strong>tu cuenta de Instagram</strong> y acepta todos los permisos. La app puede quedarse en modo desarrollo: así funciona solo con tus cuentas y sin revisión.</>,
      <>Al volver, pulsa <strong>Probar la conexión</strong>: debe salir tu cuenta de Instagram enlazada a tu página y los permisos concedidos. Meta caduca esta conexión a los 60 días si no se usa; el programa la renueva solo mientras lo abras de vez en cuando.</>,
    ],
  },
};

function ProbeResult({ r }: { r: ConnectionProbe }) {
  return (
    <div className="probe" data-testid={`${r.platform}-probe`}>
      {r.checks.map((c, i) => (
        <div key={i} className={`probe-row ${c.ok ? 'ok' : 'bad'}`}>
          <span className="probe-icon" aria-hidden="true">{c.ok ? <IconCheck /> : <IconAlert />}</span>
          <span><strong>{c.label}:</strong> {c.detail}</span>
        </div>
      ))}
    </div>
  );
}

export default function NetworksCard() {
  const [conns, setConns] = useState<ConnectionInfo[]>([]);
  const [open, setOpen] = useState<Platform | null>(null);
  const [form, setForm] = useState<Record<string, { id: string; secret: string }>>({});
  const [busy, setBusy] = useState<{ p: Platform; what: 'check' | 'connect' | 'probe' | 'disconnect' } | null>(null);
  const [msg, setMsg] = useState<{ p: Platform; ok: boolean; text: string } | null>(null);
  const [probes, setProbes] = useState<Partial<Record<Platform, ConnectionProbe>>>({});

  useEffect(() => {
    window.api.listConnections().then(setConns).catch((e) => setMsg({ p: 'youtube', ok: false, text: errMsg(e) }));
  }, []);

  const f = (p: Platform) => form[p] ?? { id: '', secret: '' };
  const set = (p: Platform, v: Partial<{ id: string; secret: string }>) => setForm({ ...form, [p]: { ...f(p), ...v } });
  const typed = (p: Platform) => Boolean(f(p).id || f(p).secret);

  async function saveKeys(p: Platform) {
    const v = form[p];
    if (v && (v.id || v.secret)) setConns(await window.api.setConnectionApp(p, v.id, v.secret || MASKED_SECRET));
  }

  async function run(p: Platform, what: 'check' | 'connect' | 'probe' | 'disconnect', fn: () => Promise<string>) {
    setBusy({ p, what });
    setMsg(null);
    try {
      setMsg({ p, ok: true, text: await fn() });
    } catch (e) {
      setMsg({ p, ok: false, text: errMsg(e) });
    } finally {
      setBusy(null);
    }
  }

  const check = (p: Platform) => run(p, 'check', async () => {
    await saveKeys(p);
    await window.api.checkPlatformApp(p);
    return `${INFO[p].name}: las claves de la app son correctas. Ya puedes pulsar «Guardar y conectar».`;
  });
  const connect = (p: Platform) => run(p, 'connect', async () => {
    await saveKeys(p);
    setConns(await window.api.connectPlatform(p));
    setForm({ ...form, [p]: { id: '', secret: '' } });
    const r = await window.api.probePlatform(p).catch(() => null);
    if (r) setProbes((x) => ({ ...x, [p]: r }));
    return `${INFO[p].name} conectado${r?.account ? ` (${r.account})` : ''}.`;
  });
  const probe = (p: Platform) => run(p, 'probe', async () => {
    const r = await window.api.probePlatform(p);
    setProbes((x) => ({ ...x, [p]: r }));
    setConns(await window.api.listConnections());
    const bad = r.checks.filter((c) => !c.ok).length;
    return bad ? `${INFO[p].name}: la conexión funciona, pero hay ${bad} aviso(s) abajo.` : `${INFO[p].name}: todo en orden.`;
  });
  const disconnect = (p: Platform) => run(p, 'disconnect', async () => {
    setConns(await window.api.disconnectPlatform(p));
    setProbes((x) => ({ ...x, [p]: undefined }));
    return `${INFO[p].name} desconectado.`;
  });

  return (
    <section className="card" aria-label="Redes sociales">
      <h2>Redes sociales</h2>
      <div className="muted small">
        Cada red necesita una «app» tuya, gratuita, para poder publicar en tu nombre. Sus claves se guardan cifradas en tu PC; el programa nunca ve tu contraseña.
        En cada red: sigue los pasos, <strong>Comprobar las claves</strong>, <strong>Guardar y conectar</strong> y, al volver del navegador, <strong>Probar la conexión</strong>.
      </div>
      <div className="list">
        {conns.map((c) => {
          const p = c.platform;
          const info = INFO[p];
          const b = busy?.p === p ? busy.what : null;
          const isOpen = open === p;
          const pr = probes[p];
          return (
            <div key={p} data-testid={`network-${p}`}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{info.name}</strong>
                <div className="row" style={{ gap: 8 }}>
                  {c.connected ? <span className="badge ok">Conectado{c.account ? `: ${c.account}` : ''}</span> : <span className="badge warn">{c.hasCredentials ? 'Falta autorizar' : 'Sin configurar'}</span>}
                  <button className="btn ghost small" onClick={() => setOpen(isOpen ? null : p)}>{isOpen ? 'Cerrar' : c.connected ? 'Gestionar' : 'Configurar'}</button>
                </div>
              </div>
              <div className="muted small">{c.caveat}</div>
              {isOpen && (
                <div style={{ marginTop: 10 }}>
                  <div className="muted small" style={{ marginBottom: 6 }}>{info.before}</div>
                  <KeyGuide title={`Cómo conectar ${info.name}, paso a paso`} steps={info.steps} testId={`${p}-howto`} />
                  <div className="field">
                    <label htmlFor={`${p}-redirect`}>Dirección de redirección que debes registrar en la app (cópiala tal cual)</label>
                    <input id={`${p}-redirect`} type="text" readOnly value={info.redirect} onFocus={(e) => e.currentTarget.select()} />
                  </div>
                  <div className="field">
                    <label htmlFor={`${p}-id`}>{info.idLabel}</label>
                    <input id={`${p}-id`} type="text" autoComplete="off" placeholder={c.hasCredentials ? '(ya guardado)' : ''} value={f(p).id} onChange={(e) => set(p, { id: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`${p}-secret`}>{info.secretLabel}</label>
                    <input id={`${p}-secret`} type="password" autoComplete="off" placeholder={c.hasCredentials ? '(ya guardado)' : ''} value={f(p).secret} onChange={(e) => set(p, { secret: e.target.value })} />
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap' }}>
                    <button className="btn ghost" disabled={busy !== null || (!c.hasCredentials && !(f(p).id && f(p).secret))} onClick={() => void check(p)} data-testid={`${p}-check`}>
                      {b === 'check' ? 'Comprobando…' : 'Comprobar las claves'}
                    </button>
                    <button className="btn" disabled={busy !== null || (!c.hasCredentials && !(f(p).id && f(p).secret))} onClick={() => void connect(p)} data-testid={`${p}-connect`}>
                      {b === 'connect' ? 'Esperando al navegador…' : c.connected && !typed(p) ? 'Volver a autorizar' : 'Guardar y conectar'}
                    </button>
                    {b === 'connect' && <button className="btn ghost" onClick={() => void window.api.cancelConnect()}>Cancelar</button>}
                    {c.connected && <button className="btn ghost" disabled={busy !== null} onClick={() => void probe(p)} data-testid={`${p}-probe-btn`}>{b === 'probe' ? 'Probando…' : 'Probar la conexión'}</button>}
                    {c.connected && <button className="btn ghost" disabled={busy !== null} onClick={() => void disconnect(p)}>Desconectar</button>}
                  </div>
                  {msg?.p === p && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
                  {pr && <ProbeResult r={pr} />}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {msg && open !== msg.p && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import type { EngineStatus } from '../../shared/types';
import { fmtDate } from '../../shared/time';
import { errMsg } from '../lib';
import { DEFAULT_ENGINE_REPO, ENGINE_REPO_NAME, newRepoUrl, newTokenUrl } from '../../shared/github';

/** Editar de noche con el PC apagado: el motor corre en GitHub Actions. */
export default function EngineCard() {
  const [s, setS] = useState<EngineStatus | null>(null);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [twitchOk, setTwitchOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const load = () => window.api.engineStatus().then((x) => { setS(x); setRepo((r) => r || x.repo || DEFAULT_ENGINE_REPO); if (x.hasToken) setToken((t) => t || MASKED_SECRET); }).catch(() => undefined);
    window.api.getSettings().then((x) => setTwitchOk(Boolean(x.twitch.clientId && x.twitch.clientSecret && x.twitch.login))).catch(() => undefined);
    void load();
    return window.api.onDataChanged(() => void load());
  }, []);

  async function run(fn: () => Promise<EngineStatus>, ok: string) {
    setBusy(true);
    setMsg(null);
    try {
      setS(await fn());
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Editar de noche con el PC apagado">
      <h2>Editar de noche con el PC apagado</h2>
      <div className="muted small">
        Al terminar tu directo (normalmente sobre las 21:30), GitHub descarga el VOD, lo transcribe en castellano, lo edita durante la noche y deja los vídeos y los clips
        programados en tu repositorio privado de la nube. Tu ordenador y el programa pueden estar apagados: por la mañana abres el programa y ves todo en
        Programación, listo para cambiarlo.
      </div>
      {!s?.enabled && (
        <>
          {!s?.cloudReady && <div className="msg bad" role="note">Primero activa «Publicar con el PC apagado» (justo encima): ahí es donde el motor deja los vídeos listos.</div>}
          <ol className="small muted" style={{ paddingLeft: 18 }}>
            <li>Twitch (id, secreto y canal) rellenado en Conexiones: {twitchOk === null ? 'comprobando…' : twitchOk ? 'hecho.' : <strong>falta.</strong>}</li>
            <li>El repositorio <strong>público</strong> «{ENGINE_REPO_NAME}» (vacío). Es público para que los minutos de GitHub Actions sean gratis e ilimitados; solo contendrá código: tus vídeos y tus claves no. Si aún no lo has creado: <a href={newRepoUrl(ENGINE_REPO_NAME, 'public')} target="_blank" rel="noreferrer">crearlo en GitHub</a>.</li>
            <li>Un token con acceso también a ese repositorio: <a href={newTokenUrl('StreamClips motor')} target="_blank" rel="noreferrer">crear uno nuevo</a> con los permisos ya marcados (marca «{ENGINE_REPO_NAME}» y «streamclips-nube» en «Only select repositories»), o añade este repositorio al token que ya usas en la nube.</li>
            <li>Pega el token aquí abajo y pulsa «Activar». El nombre del repositorio ya está puesto.</li>
          </ol>
          <div className="field">
            <label htmlFor="en-repo">Repositorio público (usuario/nombre)</label>
            <input id="en-repo" type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="diego/streamclips-motor" />
          </div>
          <div className="field">
            <label htmlFor="en-token">Token de GitHub</label>
            <input id="en-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onFocus={() => token === MASKED_SECRET && setToken('')} />
          </div>
        </>
      )}
      <div className="row" style={{ gap: 10 }}>
        {s?.enabled ? <span className="badge ok">Activo</span> : <span className="badge warn">Desactivado</span>}
        {s?.enabled && <span className="muted small">{s.repo} · configuración subida {s.lastSync ? fmtDate(s.lastSync) : 'nunca'}{s.since ? ` · vigila desde ${fmtDate(s.since)}` : ''}</span>}
      </div>
      {s?.enabled && s.last && (
        <div className="muted small">Última edición: {fmtDate(s.last.at)} · {s.last.processed} directo(s) editado(s){s.last.pending ? `, ${s.last.pending} pendiente(s)` : ''}{s.last.note ? ` · ${s.last.note}` : ''}</div>
      )}
      {s?.error && <div className="msg bad" role="alert">{s.error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        {!s?.enabled && (
          <button className="btn" disabled={busy || !repo.trim() || !token || !s?.cloudReady} onClick={() => void run(() => window.api.engineSetup(repo, token), 'Motor nocturno activado.')}>
            {busy ? 'Instalando…' : 'Activar'}
          </button>
        )}
        {s?.enabled && <button className="btn ghost" disabled={busy} onClick={() => void run(() => window.api.engineSync(), 'Configuración al día.')}>Actualizar configuración</button>}
        {s?.enabled && <button className="btn ghost" disabled={busy} onClick={() => void run(() => window.api.engineDisable(), 'Motor nocturno desactivado.')}>Desactivar</button>}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
      <div className="muted small" style={{ marginTop: 10 }}>
        Límites: cada ejecución de GitHub dura como mucho 6 horas (si el directo es larguísimo se deja sin transcribir para llegar a tiempo); GitHub puede retrasar
        unos minutos las ejecuciones programadas y las desactiva si el repositorio pasa 60 días sin actividad (el motor deja una marca cada mes);
        Twitch puede rechazar descargas desde los servidores de GitHub. Los directos anteriores a la activación no se tocan.
        Lo que se crea en la nube se puede cambiar (nombre, descripción, hora, quitar redes), pero no se puede volver a añadir una red que se quitó.
      </div>
    </section>
  );
}

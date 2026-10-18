import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import type { CloudStatus } from '../../shared/types';
import { fmtDate } from '../../shared/time';
import { errMsg } from '../lib';
import { CLOUD_REPO_NAME, DEFAULT_CLOUD_REPO, newRepoUrl, newTokenUrl } from '../../shared/github';

export default function CloudCard() {
  const [s, setS] = useState<CloudStatus | null>(null);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const load = () => window.api.cloudStatus().then((x) => { setS(x); setRepo((r) => r || x.repo || DEFAULT_CLOUD_REPO); if (x.hasToken) setToken((t) => t || MASKED_SECRET); }).catch(() => undefined);
    void load();
    const off = window.api.onDataChanged(() => void load());
    return off;
  }, []);

  async function run(fn: () => Promise<CloudStatus>, ok: string) {
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
    <section className="card" aria-label="Publicar con el PC apagado">
      <h2>Publicar con el PC apagado</h2>
      <div className="muted small">
        Lo que programes se sube a un repositorio <strong>privado</strong> de tu GitHub y GitHub (gratis) lo publica a su hora, aunque tu PC esté apagado.
        Al publicarse se borra la copia de la nube; la tuya sigue en tu PC. Solo publica en las redes que hayas conectado.
      </div>
      {!s?.enabled && (
        <ol className="small muted" style={{ paddingLeft: 18 }}>
          <li>El repositorio <strong>privado</strong> «{CLOUD_REPO_NAME}» (vacío). Si aún no lo has creado: <a href={newRepoUrl(CLOUD_REPO_NAME, 'private')} target="_blank" rel="noreferrer">crearlo en GitHub</a> (ya sale con el nombre y «Private» puestos; solo pulsa «Create repository»).</li>
          <li><a href={newTokenUrl('StreamClips nube')} target="_blank" rel="noreferrer">Crear el token en GitHub</a> (sale con los permisos ya marcados: Contents, Workflows, Secrets y Actions en «Read and write»). En «Repository access» elige «Only select repositories» y marca solo «{CLOUD_REPO_NAME}»; pulsa «Generate token» y copia el token.</li>
          <li>Pega el token aquí abajo y pulsa «Activar». El nombre del repositorio ya está puesto.</li>
        </ol>
      )}
      <div className="field">
        <label htmlFor="cl-repo">Repositorio (usuario/nombre)</label>
        <input id="cl-repo" type="text" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="diego/streamclips-nube" disabled={s?.enabled} />
      </div>
      {!s?.enabled && (
        <div className="field">
          <label htmlFor="cl-token">Token de GitHub</label>
          <input id="cl-token" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} onFocus={() => token === MASKED_SECRET && setToken('')} />
        </div>
      )}
      <div className="row" style={{ gap: 10 }}>
        {s?.enabled ? <span className="badge ok">Activo</span> : <span className="badge warn">Desactivado</span>}
        {s?.enabled && <span className="muted small">{s.queued} en la nube · {s.lastSync ? `última sincronización ${fmtDate(s.lastSync)}` : 'sin sincronizar'}</span>}
      </div>
      {s?.error && <div className="msg bad" role="alert">{s.error}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        {!s?.enabled && (
          <button className="btn" disabled={busy || !repo.trim() || !token} onClick={() => void run(() => window.api.cloudSetup(repo, token), 'Modo nube activado.')}>
            {busy ? 'Configurando…' : 'Activar'}
          </button>
        )}
        {s?.enabled && <button className="btn ghost" disabled={busy} onClick={() => void run(() => window.api.cloudSync(), 'Sincronizado.')}>Sincronizar ahora</button>}
        {s?.enabled && <button className="btn ghost" disabled={busy} onClick={() => void run(() => window.api.cloudDisable(), 'Modo nube desactivado; se ha borrado lo subido.')}>Desactivar</button>}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
      <div className="muted small" style={{ marginTop: 10 }}>
        Límites del plan gratuito de GitHub: unos 2.000 minutos de Actions al mes en repositorios privados y 2 GB como máximo por vídeo. GitHub puede
        retrasar unos minutos la hora exacta. Las claves de tus redes se guardan cifradas como secreto del repositorio.
      </div>
    </section>
  );
}

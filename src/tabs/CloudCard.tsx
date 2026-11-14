import { useEffect, useState } from 'react';
import { MASKED_SECRET } from '../../shared/types';
import type { CloudStatus, CloudTestResult, Platform } from '../../shared/types';
import { IconAlert, IconCheck } from '../icons';
import { fmtDate } from '../../shared/time';
import { errMsg } from '../lib';
import { CLOUD_REPO_NAME, DEFAULT_CLOUD_REPO, newRepoUrl, newTokenUrl } from '../../shared/github';

export default function CloudCard() {
  const [s, setS] = useState<CloudStatus | null>(null);
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<CloudTestResult | null>(null);
  const [testing, setTesting] = useState(false);

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

  async function runTest() {
    setTesting(true);
    setMsg(null);
    setTest(null);
    try {
      const r = await window.api.cloudTest();
      setTest(r);
      const n = Object.values(r.networks);
      const okN = n.filter((x) => x.ok).length;
      setMsg({ ok: okN === n.length && !r.missing.length, text: n.length ? `La nube respondió en ${r.tookSec} s: ${okN} de ${n.length} redes en orden.` : `La nube respondió en ${r.tookSec} s, pero no tiene ninguna red: conecta tus redes en Conexiones y repite la prueba.` });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setTesting(false);
    }
  }
  const NAME: Record<Platform, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };

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
        {s?.enabled && <button className="btn ghost" disabled={busy || testing} onClick={() => void runTest()} data-testid="cloud-test">{testing ? 'Probando en GitHub (hasta 5 min)…' : 'Probar la nube'}</button>}
        {s?.enabled && <button className="btn ghost" disabled={busy} onClick={() => void run(() => window.api.cloudDisable(), 'Modo nube desactivado; se ha borrado lo subido.')}>Desactivar</button>}
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
      {test && (
        <div className="probe" data-testid="cloud-test-result">
          <div className="muted small">Ejecución real en GitHub Actions ({fmtDate(test.at)}), sin publicar nada: las claves llegaron a la nube y desde allí se habló con cada red.</div>
          {(Object.keys(test.networks) as Platform[]).map((p) => {
            const r = test.networks[p]!;
            return (
              <div key={p} className={`probe-row ${r.ok ? 'ok' : 'bad'}`}>
                <span className="probe-icon" aria-hidden="true">{r.ok ? <IconCheck /> : <IconAlert />}</span>
                <span><strong>{NAME[p]}:</strong> {r.ok ? `${r.probe.account}${r.probe.canPublishPublic === false ? ' (solo puede publicar en privado)' : ''}` : r.error}</span>
              </div>
            );
          })}
          {test.missing.map((p) => (
            <div key={p} className="probe-row bad">
              <span className="probe-icon" aria-hidden="true"><IconAlert /></span>
              <span><strong>{NAME[p]}:</strong> está conectada en el PC pero no ha llegado a la nube. Vuelve a conectarla en Conexiones (hace falta la clave de renovación) y repite la prueba.</span>
            </div>
          ))}
        </div>
      )}
      <div className="muted small" style={{ marginTop: 10 }}>
        Si la prueba sale bien, lo que programes se publicará a su hora aunque el PC esté apagado. Límites del plan gratuito de GitHub: unos 2.000 minutos de Actions al mes en repositorios privados y 2 GB como máximo por vídeo. GitHub puede
        retrasar unos minutos la hora exacta. Las claves de tus redes se guardan cifradas como secreto del repositorio.
      </div>
    </section>
  );
}

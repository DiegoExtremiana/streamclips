import { useCallback, useEffect, useState } from 'react';
import type { ChannelStatus, OutputItem, Publication, VodJob } from '../../shared/types';
import { fmtDate } from '../../shared/time';
import { analysisTask, fmtEta, remainingSec, useNow, useTasks } from '../useTasks';
import AnalysisProgress from '../AnalysisProgress';
import { errMsg } from '../lib';
import type { TabId } from '../App';
import GuideCard from './GuideCard';

const VOD_STATUS: Record<VodJob['status'], { label: string; cls: string }> = {
  queued: { label: 'En cola', cls: 'warn' },
  downloading: { label: 'Descargando', cls: 'warn' },
  downloaded: { label: 'Descargado', cls: 'ok' },
  error: { label: 'Error', cls: 'bad' },
};
const AUTO_STATUS: Record<NonNullable<VodJob['autopilot']>['status'], { label: string; cls: string }> = {
  waiting: { label: 'Piloto: en cola', cls: 'warn' },
  transcribing: { label: 'Piloto: transcribiendo', cls: 'warn' },
  analyzing: { label: 'Piloto: analizando', cls: 'warn' },
  rendering: { label: 'Piloto: montando', cls: 'warn' },
  paused: { label: 'Piloto: en pausa', cls: 'warn' },
  done: { label: 'Piloto: listo', cls: 'ok' },
  skipped: { label: 'Piloto: sin momentos', cls: 'warn' },
  error: { label: 'Piloto: error', cls: 'bad' },
};

export default function PanelTab(props: { vods: VodJob[]; outputs: OutputItem[]; pubs: Publication[]; onChanged: () => Promise<void>; onNavigate: (tab: TabId) => void; part: 'status' | 'guide' | 'bottom' }) {
  const { vods, onChanged } = props;
  const [channel, setChannel] = useState<ChannelStatus | null>(null);
  const tasks = useTasks();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    window.api.channelStatus().then(setChannel).catch((e) => setError(errMsg(e)));
    const offC = window.api.onChannelUpdate(setChannel);
    return () => {
      offC();
    };
  }, []);

  const act = useCallback(
    async (key: string, fn: () => Promise<unknown>) => {
      setBusy(key);
      setError('');
      try {
        await fn();
        await onChanged();
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const visibleVods = vods.filter((v) => v.origin !== 'clip');
  const running = tasks.filter((t) => t.status === 'running');
  const now = useNow(running.length > 0);
  const recent = tasks.filter((t) => t.status !== 'running').slice(0, 5);

  return (
    <div className="grid">
      {props.part === 'status' && (
      <section className="card statusbar" aria-label="Tu canal">
        <div className="row" style={{ gap: 12 }}>
          <h2>Tu canal</h2>
          {!channel && <span className="muted">Cargando…</span>}
          {channel?.configured && (channel.stream?.live ? <span className="badge ok">En directo</span> : <span className="badge">Sin directo</span>)}
          {channel?.stream?.live && <span className="muted small title-ellipsis" style={{ maxWidth: 380 }}>{channel.stream.title} · {channel.stream.game} · {channel.stream.viewers} espectadores</span>}
          <span className="grow" />
          {channel?.configured && (
            <label className="row" style={{ gap: 7 }}>
              <input type="checkbox" checked={channel.autoImport} onChange={(e) => void act('auto', () => window.api.setAutoImport(e.target.checked).then(setChannel))} />
              <span>Recoger mis directos y preparar vídeos solo</span>
            </label>
          )}
          <button className="btn ghost small" onClick={() => void act('refresh', () => window.api.channelRefresh().then(setChannel))} disabled={busy === 'refresh'}>
            Comprobar ahora
          </button>
        </div>
        {channel && !channel.configured && (
          <div className="msg warn">Falta conectar tu canal de Twitch (pestaña Conexiones). Sin eso el programa no puede enterarse de tus directos.</div>
        )}
        {channel?.configured && (
          <div className="muted small">
            {channel.lastCheck ? `Última comprobación: ${fmtDate(channel.lastCheck)}.` : 'Aún no se ha comprobado.'} Se vigila cada minuto.
            {channel.lastImported ? ` Último directo recogido: ${channel.lastImported.title}.` : ''}
          </div>
        )}
        {channel?.error && <div className="msg bad" role="alert">{channel.error}</div>}
        {props.part === 'status' && error && <div className="msg bad" role="alert">{error}</div>}
      </section>
      )}

      {props.part === 'guide' && <GuideCard onNavigate={props.onNavigate} refreshKey={props.outputs.length + props.pubs.length} />}

      {props.part === 'bottom' && (
      <section className="card" aria-label="Actividad">
        <h2>Actividad</h2>
        {running.length === 0 && recent.length === 0 && <div className="muted">Sin actividad por ahora.</div>}
        <div className="list">
          {running.map((t) => (
            <div key={t.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="title-ellipsis">{t.label}</div>
                <span className="muted small">{remainingSec(t, now) !== null ? `Tiempo estimado: ${fmtEta(remainingSec(t, now)!)} · ` : ''}{t.progress}%</span>
              </div>
              <div className="progress" role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${t.progress}%` }} />
              </div>
              {t.detail && <div className="muted small">{t.detail}</div>}
            </div>
          ))}
          {recent.map((t) => (
            <div key={t.id} className="row" style={{ justifyContent: 'space-between' }}>
              <div className="title-ellipsis">{t.label}</div>
              <span className={`badge ${t.status === 'done' ? 'ok' : 'bad'}`} title={t.error ?? t.detail}>{t.status === 'done' ? 'Hecho' : 'Error'}</span>
            </div>
          ))}
        </div>
      </section>
      )}

      {props.part === 'bottom' && (
      <section className="card" aria-label="Directos recogidos">
        <h2>Directos recogidos</h2>
        {visibleVods.length === 0 && <div className="muted">Todavía no hay ninguno. El programa recogerá el próximo directo en cuanto termine.</div>}
        <div className="list">
          {visibleVods.map((v) => (
            <div key={v.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="title-ellipsis">{v.title || v.url}</div>
                <div className="row" style={{ gap: 6 }}>
                  {v.autopilot && <span className={`badge ${AUTO_STATUS[v.autopilot.status].cls}`} title={v.autopilot.note}>{AUTO_STATUS[v.autopilot.status].label}</span>}
                  <span className={`badge ${VOD_STATUS[v.status].cls}`}>{VOD_STATUS[v.status].label}</span>
                </div>
              </div>
              {v.status === 'downloading' && (
                <div className="progress" role="progressbar" aria-valuenow={Math.round(v.progress)} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${v.progress}%` }} />
                </div>
              )}
              {v.status === 'error' && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{v.error}</div>}
              {['transcribing', 'analyzing', 'rendering'].includes(v.autopilot?.status ?? '') && analysisTask(tasks, v.id) && <AnalysisProgress task={analysisTask(tasks, v.id)!} now={now} />}
              {v.autopilot?.note && v.autopilot.status !== 'waiting' && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{v.autopilot.note}</div>}
              {v.status === 'downloaded' && (
                <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                  {['waiting', 'transcribing', 'analyzing', 'rendering'].includes(v.autopilot?.status ?? '') && (
                    <button className="btn ghost small" disabled={busy === `ps${v.id}`} title="Detiene el análisis conservando lo ya transcrito; se retoma con «Reanudar», aunque cierres el programa." onClick={() => void act(`ps${v.id}`, () => window.api.pauseAutopilot(v.id))}>Pausar</button>
                  )}
                  {['waiting', 'transcribing', 'analyzing', 'rendering'].includes(v.autopilot?.status ?? '') && (
                    <button className="btn ghost small" disabled={busy === `cx${v.id}`} onClick={() => void act(`cx${v.id}`, () => window.api.cancelAutopilot(v.id))}>Cancelar análisis</button>
                  )}
                  {v.autopilot?.status === 'paused' && (
                    <button className="btn small" disabled={busy === `ap${v.id}`} onClick={() => void act(`ap${v.id}`, () => window.api.runAutopilot(v.id))}>Reanudar</button>
                  )}
                  <button
                    className="btn ghost small"
                    disabled={busy === `ap${v.id}`}
                    title={v.autopilot ? 'Vuelve a analizar el directo (si había un análisis en marcha, se cancela). Sustituye los vídeos pendientes de revisión que sacó antes.' : undefined}
                    onClick={() => void act(`ap${v.id}`, () => window.api.runAutopilot(v.id))}
                  >
                    {v.autopilot ? 'Volver a analizar' : 'Analizar ahora'}
                  </button>
                  {v.filePath && <button className="btn ghost small" onClick={() => void window.api.openPath(v.filePath!).catch(() => undefined)}>Mostrar en carpeta</button>}
                  {v.filePath && v.origin !== 'clip' && v.autopilot?.status === 'done' && (
                    <button className="btn ghost small" title="Borra el directo completo del disco; se conservan los vídeos, los clips y sus transcripciones." disabled={busy === `dc${v.id}`} onClick={() => void act(`dc${v.id}`, () => window.api.discardVod(v.id))}>Liberar espacio</button>
                  )}
                  {v.cleaned && <span className="badge ok" title="Se vuelve a descargar solo si hace falta (por ejemplo, para recortar un clip).">Directo borrado · {(v.cleaned.freedBytes / 1024 ** 3).toFixed(1)} GB liberados</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        <details style={{ marginTop: 16 }}>
          <summary className="muted">Añadir un VOD a mano</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="text"
              aria-label="URL del VOD"
              placeholder="https://www.twitch.tv/videos/123456789"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && url.trim() && void act('add', async () => { await window.api.addVod(url.trim()); setUrl(''); })}
            />
            <button className="btn" disabled={!url.trim()} onClick={() => void act('add', async () => { await window.api.addVod(url.trim()); setUrl(''); })}>Descargar</button>
          </div>
        </details>
        {props.part === 'bottom' && error && <div className="msg bad" role="alert">{error}</div>}
      </section>
      )}
    </div>
  );
}

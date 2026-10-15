import { useCallback, useEffect, useState } from 'react';
import type { ChannelStatus, OutputItem, Publication, TaskInfo, VodJob } from '../../shared/types';
import { fmtDate, fmtTime } from '../../shared/time';
import { mediaUrl } from '../../shared/media';
import { primaryFile } from '../../shared/outputs';
import { errMsg } from '../lib';

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
  done: { label: 'Piloto: listo', cls: 'ok' },
  skipped: { label: 'Piloto: sin momentos', cls: 'warn' },
  error: { label: 'Piloto: error', cls: 'bad' },
};
const ROLE_LABEL = { summary: 'Resumen', main: 'Vídeo principal', clip: 'Clip' } as const;
const PLATFORM_LABEL = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' } as const;

export default function PanelTab(props: { vods: VodJob[]; outputs: OutputItem[]; pubs: Publication[]; onChanged: () => Promise<void> }) {
  const { vods, outputs, pubs, onChanged } = props;
  const [channel, setChannel] = useState<ChannelStatus | null>(null);
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [url, setUrl] = useState('');

  useEffect(() => {
    window.api.channelStatus().then(setChannel).catch((e) => setError(errMsg(e)));
    window.api.listTasks().then(setTasks).catch(() => undefined);
    const offC = window.api.onChannelUpdate(setChannel);
    const offT = window.api.onTaskUpdate((t) =>
      setTasks((prev) => [t, ...prev.filter((x) => x.id !== t.id)].slice(0, 12)),
    );
    return () => {
      offC();
      offT();
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
        setConfirmDel(null);
      }
    },
    [onChanged],
  );

  const pending = outputs.filter((o) => o.auto?.review === 'pending');
  const upcoming = pubs.filter((p) => p.status === 'scheduled' || p.status === 'publishing').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 8);
  const title = (id: string) => outputs.find((o) => o.id === id)?.title ?? 'Vídeo borrado';
  const visibleVods = vods.filter((v) => v.origin !== 'clip');
  const running = tasks.filter((t) => t.status === 'running');
  const recent = tasks.filter((t) => t.status !== 'running').slice(0, 5);

  return (
    <div className="grid">
      <section className="card" aria-label="Tu canal">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Tu canal</h2>
          <button className="btn ghost small" onClick={() => void act('refresh', () => window.api.channelRefresh().then(setChannel))} disabled={busy === 'refresh'}>
            Comprobar ahora
          </button>
        </div>
        {!channel && <div className="muted">Cargando…</div>}
        {channel && !channel.configured && (
          <div className="msg warn">Falta conectar tu canal de Twitch (pestaña Conexiones). Sin eso el programa no puede enterarse de tus directos.</div>
        )}
        {channel?.configured && (
          <>
            <div className="row" style={{ gap: 10 }}>
              {channel.stream?.live ? <span className="badge ok">En directo</span> : <span className="badge">Sin directo</span>}
              {channel.stream?.live && (
                <span className="muted">
                  {channel.stream.title} · {channel.stream.game} · {channel.stream.viewers} espectadores
                </span>
              )}
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {channel.lastCheck ? `Última comprobación: ${fmtDate(channel.lastCheck)}.` : 'Aún no se ha comprobado.'} Se vigila cada minuto.
            </div>
            {channel.error && <div className="msg bad" role="alert">{channel.error}</div>}
            <label className="row" style={{ gap: 8, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={channel.autoImport}
                onChange={(e) => void act('auto', () => window.api.setAutoImport(e.target.checked).then(setChannel))}
              />
              Cuando termine un directo, recoger su VOD y preparar vídeos automáticamente
            </label>
            {channel.lastImported && (
              <div className="muted small" style={{ marginTop: 6 }}>Último directo recogido: {channel.lastImported.title}.</div>
            )}
          </>
        )}
        {error && <div className="msg bad" role="alert">{error}</div>}
      </section>

      <section className="card" aria-label="Pendientes de tu visto bueno">
        <h2>Pendientes de tu visto bueno</h2>
        {pending.length === 0 && <div className="muted">No hay nada esperando. Cuando termine tu próximo directo, aquí aparecerán el resumen, el vídeo principal y los clips propuestos.</div>}
        <div className="list">
          {pending.map((o) => {
            const file = primaryFile(o);
            return (
              <div key={o.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  {o.thumbnail && <img alt="" src={mediaUrl(o.id, 'thumb', o.thumbnail)} style={{ width: 96, height: 54, objectFit: 'cover', borderRadius: 6 }} />}
                  <div style={{ minWidth: 0 }}>
                    <div className="title-ellipsis">{o.title}</div>
                    <div className="muted small">{ROLE_LABEL[o.auto!.role]} · {fmtTime(Math.round(o.durationSec))}</div>
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {file && <button className="btn ghost small" onClick={() => void window.api.openPath(file).catch(() => undefined)}>Ver</button>}
                  <button className="btn small" disabled={busy === o.id} onClick={() => void act(o.id, () => window.api.approveOutput(o.id))}>Aprobar y programar</button>
                  {confirmDel === o.id ? (
                    <button className="btn danger small" onClick={() => void act(o.id, () => window.api.deleteOutput(o.id))}>¿Seguro? Borrar</button>
                  ) : (
                    <button className="btn ghost small" onClick={() => setConfirmDel(o.id)}>Rechazar</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" aria-label="Actividad">
        <h2>Actividad</h2>
        {running.length === 0 && recent.length === 0 && <div className="muted">Sin actividad por ahora.</div>}
        <div className="list">
          {running.map((t) => (
            <div key={t.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="title-ellipsis">{t.label}</div>
                <span className="muted small">{t.progress}%</span>
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

      <section className="card" aria-label="Próximas publicaciones">
        <h2>Próximas publicaciones</h2>
        {upcoming.length === 0 && <div className="muted">No hay publicaciones programadas.</div>}
        <div className="list">
          {upcoming.map((p) => (
            <div key={p.key} className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="title-ellipsis">{title(p.outputId)}</div>
                <div className="muted small">{PLATFORM_LABEL[p.platform]} · {fmtDate(p.scheduledAt)}{p.note ? ` · ${p.note}` : ''}</div>
              </div>
              <span className={`badge ${p.status === 'publishing' ? 'warn' : ''}`}>{p.status === 'publishing' ? 'Publicando' : 'Programado'}</span>
            </div>
          ))}
        </div>
      </section>

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
              {v.autopilot?.note && v.autopilot.status !== 'waiting' && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{v.autopilot.note}</div>}
              {v.status === 'downloaded' && (
                <div className="row" style={{ gap: 6, marginTop: 6 }}>
                  <button
                    className="btn ghost small"
                    disabled={busy === `ap${v.id}` || ['waiting', 'transcribing', 'analyzing', 'rendering'].includes(v.autopilot?.status ?? '')}
                    onClick={() => void act(`ap${v.id}`, () => window.api.runAutopilot(v.id))}
                  >
                    {v.autopilot ? 'Volver a analizar' : 'Analizar ahora'}
                  </button>
                  {v.filePath && <button className="btn ghost small" onClick={() => void window.api.openPath(v.filePath!).catch(() => undefined)}>Mostrar en carpeta</button>}
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
      </section>
    </div>
  );
}

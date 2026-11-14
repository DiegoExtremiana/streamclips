import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChannelStatus, TwitchVod, VodJob } from '../../shared/types';
import { fmtDate, fmtTime } from '../../shared/time';
import { errMsg, notify } from '../lib';
import { analysisTask, useNow, useTasks } from '../useTasks';
import AnalysisProgress from '../AnalysisProgress';
import { IconFilm } from '../icons';

const REFRESH_MS = 60_000;
/** Twitch crea el VOD del directo en curso unos minutos antes de su hora de inicio. */
const LIVE_SLACK_MS = 5 * 60_000;
const WORKING = ['waiting', 'transcribing', 'analyzing', 'rendering'];

type Phase = 'live' | 'interrupted' | 'paused' | 'new' | 'queued' | 'downloading' | 'ready' | 'working' | 'done' | 'skipped' | 'failed';

/** En qué punto está un directo de Twitch dentro del programa, a partir de su VOD descargado (si lo hay). */
export function broadcastPhase(v: TwitchVod, job: VodJob | undefined, live: ChannelStatus['stream'] | undefined, now = Date.now()): { phase: Phase; label: string; cls: string } {
  if (live?.live && live.startedAt && Date.parse(v.createdAt) >= Date.parse(live.startedAt) - LIVE_SLACK_MS && now - Date.parse(v.createdAt) < 48 * 3600_000) {
    return { phase: 'live', label: 'En curso', cls: 'bad' };
  }
  if (!job) return { phase: 'new', label: 'Sin analizar', cls: '' };
  if (job.status === 'queued') return { phase: 'queued', label: 'En cola de descarga', cls: 'warn' };
  if (job.status === 'downloading') return { phase: 'downloading', label: `Descargando ${Math.round(job.progress)}%`, cls: 'warn' };
  // un cierre del programa a mitad de la descarga no es un fallo: queda pendiente y se retoma con un botón
  if (job.status === 'error') return /interrumpi/i.test(job.error ?? '') ? { phase: 'interrupted', label: 'Pendiente', cls: 'warn' } : { phase: 'failed', label: 'Error de descarga', cls: 'bad' };
  const a = job.autopilot;
  if (!a) return { phase: 'ready', label: 'Descargado', cls: 'ok' };
  if (WORKING.includes(a.status)) return { phase: 'working', label: a.status === 'transcribing' ? 'Transcribiendo' : a.status === 'analyzing' ? 'Analizando' : a.status === 'rendering' ? 'Montando' : 'En cola', cls: 'warn' };
  if (a.status === 'paused') return { phase: 'paused', label: 'En pausa', cls: 'warn' };
  if (a.status === 'done') return { phase: 'done', label: job.cleaned ? 'Analizado · directo borrado' : 'Analizado', cls: 'ok' };
  if (a.status === 'skipped') return { phase: 'skipped', label: 'Sin momentos', cls: 'warn' };
  return { phase: 'failed', label: 'Error al analizar', cls: 'bad' };
}

/** El VOD descargado que corresponde a un directo de Twitch (por id o por dirección). */
export function jobFor(v: TwitchVod, vods: VodJob[]): VodJob | undefined {
  const mine = vods.filter((j) => j.twitchId === v.id || j.url === v.url);
  return mine.find((j) => j.status !== 'error') ?? mine[0];
}

type Filter = 'todos' | 'porhacer' | 'hechos';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'porhacer', label: 'Por hacer' },
  { id: 'hechos', label: 'Analizados' },
];
/** Orden de la lista: primero lo que pasa ahora (directo, en curso), luego lo pendiente y al final lo ya hecho. */
const RANK: Record<Phase, number> = { live: 0, working: 1, downloading: 1, queued: 1, paused: 2, interrupted: 2, failed: 2, new: 3, ready: 3, done: 4, skipped: 4 };
const isDone = (ph: Phase) => ph === 'done' || ph === 'skipped';

/**
 * Directos de tu canal: tus directos de Twitch leídos en directo (cada minuto) en una cuadrícula, con el estado de
 * cada uno en el programa y un botón para analizarlos cuando quieras.
 */
export default function BroadcastsCard(props: { vods: VodJob[]; onChanged: () => Promise<void> }) {
  const { vods, onChanged } = props;
  const tasks = useTasks();
  const now = useNow(tasks.some((t) => t.kind === 'analyze' && t.status === 'running'));
  const [list, setList] = useState<TwitchVod[] | null>(null);
  const [channel, setChannel] = useState<ChannelStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, l] = await Promise.all([window.api.channelRefresh(), window.api.twitchVods()]);
      setChannel(c);
      setList(l);
      setError('');
      setCheckedAt(Date.now());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), REFRESH_MS);
    const off = window.api.onChannelUpdate(setChannel);
    return () => {
      window.clearInterval(t);
      off();
    };
  }, [load]);

  const [filter, setFilter] = useState<Filter>('todos');
  const all = useMemo(
    () =>
      (list ?? [])
        .map((v) => {
          const job = jobFor(v, vods);
          return { v, job, p: broadcastPhase(v, job, channel?.stream) };
        })
        .sort((a, b) => RANK[a.p.phase] - RANK[b.p.phase] || b.v.createdAt.localeCompare(a.v.createdAt)),
    [list, vods, channel],
  );
  const counts: Record<Filter, number> = { todos: all.length, porhacer: all.filter((r) => !isDone(r.p.phase)).length, hechos: all.filter((r) => isDone(r.p.phase)).length };
  const rows = all.filter((r) => filter === 'todos' || (filter === 'hechos') === isDone(r.p.phase));

  async function analyze(v: TwitchVod) {
    setBusy(v.id);
    try {
      await window.api.channelAnalyze(v.id);
      await onChanged();
      notify(`«${v.title}»: se descarga y el piloto automático lo analiza en cuanto esté listo.`);
    } catch (e) {
      notify(errMsg(e), 'bad');
    } finally {
      setBusy(null);
    }
  }

  const live = channel?.stream;
  return (
    <section className="card" aria-label="Directos de tu canal">
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <div className="row" style={{ gap: 10 }}>
          <h2>Directos de tu canal</h2>
          {channel?.configured && (live?.live ? <span className="badge bad">En directo</span> : <span className="badge">Sin directo</span>)}
        </div>
        <div className="row" style={{ gap: 10 }}>
          {checkedAt && <span className="muted small">Leído de Twitch a las {new Date(checkedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}; se actualiza solo cada minuto.</span>}
          <button className="btn ghost small" onClick={() => void load()} disabled={loading}>{loading ? 'Comprobando…' : 'Comprobar ahora'}</button>
        </div>
      </div>
      {live?.live && (
        <div className="livebar" role="status">
          <span className="badge bad">En directo</span>
          <span className="title-ellipsis"><b>{live.title}</b> · {live.game} · {live.viewers} espectadores</span>
          <span className="muted small">Podrás analizarlo en cuanto termine.</span>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Filtrar directos">
          {FILTERS.map((f) => (
            <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} {counts[f.id]}
            </button>
          ))}
        </div>
      )}
      {error && <div className="msg bad" role="alert">{error}</div>}
      {!error && list && rows.length === 0 && <div className="muted">Twitch no devuelve directos guardados de tu canal (comprueba que tengas activada la opción de guardar emisiones anteriores).</div>}
      {!list && !error && <div className="muted">Leyendo tus directos de Twitch…</div>}
      {list && list.length > 0 && rows.length === 0 && <div className="muted">No hay directos en este filtro.</div>}
      <div className="bgrid">
        {rows.map(({ v, job, p }) => {
          const working = p.phase === 'queued' || p.phase === 'downloading' || p.phase === 'working';
          const again = p.phase === 'done' || p.phase === 'skipped' || p.phase === 'failed' || p.phase === 'ready';
          return (
            <div key={v.id} className="bcard" data-testid={`bc-${v.id}`}>
              <div className="tilethumb">
                {v.thumbnail ? <img src={v.thumbnail} alt="" draggable={false} /> : <IconFilm size={22} />}
                <span className="tiledur">{fmtTime(v.durationSec)}</span>
              </div>
              <div className="tiletitle" title={v.title}>{v.title || 'Directo sin título'}</div>
              <div className="muted small">{fmtDate(v.createdAt)}{typeof v.views === 'number' ? ` · ${v.views} visualizaciones` : ''}</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className={`badge ${p.cls}`} title={job?.error ?? job?.autopilot?.note}>{p.label}</span>
                {job?.chapters && job.chapters.length > 1 && <span className="muted small">{new Set(job.chapters.map((c) => c.title)).size} categorías</span>}
              </div>
              {p.phase === 'working' && job && analysisTask(tasks, job.id) && <AnalysisProgress task={analysisTask(tasks, job.id)!} now={now} />}
              {p.phase === 'failed' && (job?.error || job?.autopilot?.note) && <div className="muted small" style={{ whiteSpace: 'pre-wrap' }}>{(job.error ?? job.autopilot?.note ?? '').slice(0, 160)}</div>}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <button
                  className={`btn small ${again ? 'ghost' : ''}`}
                  disabled={p.phase === 'live' || busy === v.id || p.phase === 'queued' || p.phase === 'downloading'}
                  title={p.phase === 'live' ? 'Todavía está en directo' : working ? 'Cancela el análisis en marcha y empieza de nuevo' : again ? 'Vuelve a analizarlo; sustituye los vídeos pendientes de revisión que sacó antes' : undefined}
                  onClick={() => void analyze(v)}
                >
                  {p.phase === 'live' ? 'En directo…' : p.phase === 'paused' || p.phase === 'interrupted' ? 'Reanudar' : working ? 'Reiniciar análisis' : again ? 'Volver a analizar' : 'Analizar'}
                </button>
                {p.phase === 'working' && job && <button className="btn ghost small" onClick={() => void window.api.pauseAutopilot(job.id).then(onChanged).catch((e) => notify(errMsg(e), 'bad'))}>Pausar</button>}
                {p.phase === 'working' && job && <button className="btn ghost small" onClick={() => void window.api.cancelAutopilot(job.id).then(onChanged).catch((e) => notify(errMsg(e), 'bad'))}>Cancelar</button>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

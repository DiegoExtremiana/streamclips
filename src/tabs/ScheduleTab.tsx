import { useEffect, useMemo, useState } from 'react';
import type { OutputItem, Publication, VodJob } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { dayLabel, localDayKey } from '../../shared/agenda';
import { fmtTime } from '../../shared/time';
import { addDays, atFromDayMinutes, daysFrom, defaultWhenForDay, groupBlocks, hhmm, moveToDay, unscheduledOutputs, validateMove, type Block } from '../../shared/schedulePlan';
import { errMsg, notify } from '../lib';
import type { TabId } from '../App';
import { IconCalendar, IconChevron, IconFilm } from '../icons';
import ScheduleDialog from '../library/ScheduleDialog';
import BlockDialog from '../schedule/BlockDialog';
import CalendarView from '../schedule/CalendarView';
import Timeline from '../schedule/Timeline';
import { GhostChip, useDragDrop, type DragPayload, type DropTarget } from '../schedule/drag';
import PanelTab from './PanelTab';

type View = 'timeline' | 'calendar';
const VIEW_KEY = 'streamclips.schedule.view';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'timeline';
  } catch {
    return 'timeline';
  }
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS_SHOWN = 7;

type Dialog = { type: 'add'; outputId?: string; defaultWhen?: string } | { type: 'block'; block: Block };

/**
 * Programación: tus próximas subidas en una línea de tiempo y en un calendario. Se arrastran para cambiar el día
 * y la hora; los vídeos sin programar se arrastran desde la bandeja hasta el día y la hora que quieras.
 */
export default function ScheduleTab(props: {
  vods: VodJob[];
  outputs: OutputItem[];
  pubs: Publication[];
  onChanged: () => Promise<void>;
  onNavigate: (tab: TabId) => void;
  onOpenVideo: (outputId: string) => void;
}) {
  const { outputs, pubs } = props;
  const [view, setViewState] = useState<View>(readView);
  const [now, setNow] = useState(Date.now());
  const todayKey = localDayKey(now);
  const [anchor, setAnchor] = useState(todayKey);
  const [month, setMonth] = useState(() => ({ year: new Date().getFullYear(), month0: new Date().getMonth() }));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [slots, setSlots] = useState<string[]>([]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    window.api
      .getSettings()
      .then((s) => alive && setSlots([...new Set(Object.values(s.autopilot.slots))]))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sin almacenamiento */
    }
  };

  const blocks = useMemo(() => groupBlocks(pubs, outputs), [pubs, outputs]);
  const tray = useMemo(() => unscheduledOutputs(outputs, pubs), [outputs, pubs]);
  const failed = pubs.filter((p) => p.status === 'failed');

  async function moveBlock(b: Block, t: DropTarget) {
    const newAt = t.minutes !== undefined ? atFromDayMinutes(t.dayKey, t.minutes) : moveToDay(b.at, t.dayKey);
    if (newAt === b.at) return;
    const bad = validateMove(newAt, Date.now());
    if (bad) return notify(bad, 'warn');
    try {
      const r = await window.api.schedule(b.outputId, b.platforms, new Date(newAt).toISOString());
      await props.onChanged();
      notify(`«${b.title}» movida a ${dayLabel(t.dayKey, Date.now()).toLowerCase()} a las ${hhmm(newAt)}.`);
      if (r.warnings?.length) notify(r.warnings.join(' '), 'warn');
      if (r.skipped.length) notify(r.skipped.map((s) => `${s.platform}: ${s.reason}`).join('. '), 'warn');
    } catch (e) {
      notify(errMsg(e), 'bad');
      await props.onChanged();
    }
  }

  const drag = useDragDrop({
    onClick: (p: DragPayload) => setDialog(p.kind === 'block' ? { type: 'block', block: p.block } : { type: 'add', outputId: p.output.id }),
    onDrop: (p: DragPayload, t: DropTarget) => {
      if (p.kind === 'block') void moveBlock(p.block, t);
      else {
        const when = t.minutes !== undefined ? `${t.dayKey}T${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}` : defaultWhenForDay(t.dayKey, Date.now(), slots);
        setDialog({ type: 'add', outputId: p.output.id, defaultWhen: when });
      }
    },
  });

  const days = daysFrom(atFromDayMinutes(anchor, 12 * 60), DAYS_SHOWN);
  const rangeLabel = `${dayLabel(days[0], now)} – ${dayLabel(days[DAYS_SHOWN - 1], now)}`;
  const shiftMonth = (d: number) => setMonth((m) => {
    const x = new Date(m.year, m.month0 + d, 1);
    return { year: x.getFullYear(), month0: x.getMonth() };
  });
  const goToday = () => {
    setAnchor(todayKey);
    setMonth({ year: new Date().getFullYear(), month0: new Date().getMonth() });
  };

  return (
    <div className="stack">
      <PanelTab vods={props.vods} outputs={outputs} pubs={pubs} onChanged={props.onChanged} onNavigate={props.onNavigate} part="top" />

      <div className="sched">
        <section className="card" aria-label="Próximas subidas">
          <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
            <h2>Próximas subidas</h2>
            <div className="row">
              <div className="seg" role="tablist" aria-label="Vista">
                <button role="tab" aria-selected={view === 'timeline'} className={`segbtn ${view === 'timeline' ? 'active' : ''}`} onClick={() => setView('timeline')}>Línea de tiempo</button>
                <button role="tab" aria-selected={view === 'calendar'} className={`segbtn ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>Calendario</button>
              </div>
              <button className="btn small" onClick={() => setDialog({ type: 'add' })}><IconCalendar /> Añadir subida</button>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn ghost small iconflip" aria-label={view === 'timeline' ? 'Semana anterior' : 'Mes anterior'} onClick={() => (view === 'timeline' ? setAnchor(addDays(anchor, -DAYS_SHOWN)) : shiftMonth(-1))}><IconChevron /></button>
              <button className="btn ghost small" onClick={goToday}>Hoy</button>
              <button className="btn ghost small" aria-label={view === 'timeline' ? 'Semana siguiente' : 'Mes siguiente'} onClick={() => (view === 'timeline' ? setAnchor(addDays(anchor, DAYS_SHOWN)) : shiftMonth(1))}><IconChevron /></button>
              <strong className="cap1" style={{ marginLeft: 8 }} aria-live="polite">{view === 'timeline' ? rangeLabel : `${MONTHS[month.month0]} de ${month.year}`}</strong>
            </div>
            <span className="muted small">Arrastra una subida para cambiar su {view === 'timeline' ? 'día y su hora' : 'día'}.</span>
          </div>

          {failed.length > 0 && (
            <div className="msg bad" role="alert">
              {failed.map((p) => (
                <div key={p.key} className="row" style={{ justifyContent: 'space-between' }}>
                  <span><strong>{outputs.find((o) => o.id === p.outputId)?.title ?? 'Vídeo borrado'}</strong> · {p.platform} falló: {p.note ?? 'sin detalle'}</span>
                  <button className="btn ghost small" onClick={() => void window.api.cancelPublication(p.key).then(props.onChanged)}>Descartar</button>
                </div>
              ))}
            </div>
          )}

          {view === 'timeline' ? (
            <Timeline days={days} blocks={blocks} now={now} drag={drag} todayKey={todayKey} />
          ) : (
            <CalendarView
              year={month.year}
              month0={month.month0}
              blocks={blocks}
              todayKey={todayKey}
              drag={drag}
              onAdd={(day) => setDialog({ type: 'add', defaultWhen: defaultWhenForDay(day, Date.now(), slots) })}
              onOpenDay={(day) => {
                setAnchor(day);
                setView('timeline');
              }}
            />
          )}
          {blocks.length === 0 && <div className="muted small">Todavía no hay subidas programadas. Arrastra un vídeo de la bandeja «Sin programar» a un día, o pulsa «Añadir subida».</div>}
        </section>

        <aside className="card tray" aria-label="Sin programar">
          <h2>Sin programar</h2>
          <div className="muted small">Vídeos listos que aún no tienen subida. Arrástralos al día y la hora que quieras, o púlsalos.</div>
          {tray.length === 0 && <div className="muted small">Todos tus vídeos ya tienen subida.</div>}
          <div className="traylist">
            {tray.map((o) => (
              <div
                key={o.id}
                className={`trayitem ${drag.dragging?.kind === 'video' && drag.dragging.output.id === o.id ? 'ghosted' : ''}`}
                role="button"
                tabIndex={0}
                data-testid={`tray-${o.title}`}
                aria-label={`${o.title}: programar subida`}
                onPointerDown={(e) => drag.start(e, { kind: 'video', output: o }, o.title)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    drag.onActivate({ kind: 'video', output: o });
                  }
                }}
              >
                <div className="traythumb">
                  {o.thumbnail ? <img src={mediaUrl(o.id, 'thumb', o.thumbnail)} alt="" draggable={false} /> : <IconFilm size={20} />}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="title-ellipsis" style={{ maxWidth: 150, fontWeight: 600 }}>{o.title}</div>
                  <div className="muted small">{o.kind === 'long' ? 'Vídeo' : 'Clip'} · {fmtTime(o.durationSec)}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <details className="adv" style={{ marginTop: 4 }}>
        <summary>Directos recogidos y actividad</summary>
        <div className="adv-body">
          <PanelTab vods={props.vods} outputs={outputs} pubs={pubs} onChanged={props.onChanged} onNavigate={props.onNavigate} part="bottom" />
        </div>
      </details>

      <GhostChip ghost={drag.ghost} />
      {dialog?.type === 'add' && <ScheduleDialog outputs={outputs} pubs={pubs} outputId={dialog.outputId} defaultWhen={dialog.defaultWhen} onChanged={props.onChanged} onClose={() => setDialog(null)} />}
      {dialog?.type === 'block' && <BlockDialog block={dialog.block} onChanged={props.onChanged} onClose={() => setDialog(null)} onOpenVideo={props.onOpenVideo} />}
    </div>
  );
}

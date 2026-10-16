import { useState } from 'react';
import type { OutputItem, Platform, Publication } from '../../shared/types';
import { platformsFor } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { dayLabel } from '../../shared/agenda';
import { atFromDayMinutes, entriesForBlockEdit, hhmm, validateMove, type Block } from '../../shared/schedulePlan';
import { errMsg, notify } from '../lib';
import { IconChevron, IconFilm, IconPlus, IconTrash } from '../icons';
import { PLATFORMS } from '../library/ItemModal';

const toMinutes = (t: string): number | null => {
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Una fila: una subida (un vídeo a una hora, con sus redes). Se cambia la hora y las redes ahí mismo; al pulsar el título se abre todo. */
function Row(props: { block: Block; output: OutputItem | undefined; pubs: Publication[]; dayKey: string; onChanged: () => Promise<void>; onOpen: (outputId: string) => void }) {
  const { block: b, output: o } = props;
  const [time, setTime] = useState(hhmm(b.at));
  const [platforms, setPlatforms] = useState<Platform[]>(b.platforms);
  const [busy, setBusy] = useState(false);
  const allowed = platformsFor(b.kind);
  const dirty = time !== hhmm(b.at) || platforms.length !== b.platforms.length || platforms.some((p) => !b.platforms.includes(p));

  async function save() {
    const min = toMinutes(time);
    if (min === null) return notify('La hora debe ser HH:MM.', 'warn');
    if (!platforms.length) return notify('Elige al menos una red (o quita la subida).', 'warn');
    const at = atFromDayMinutes(props.dayKey, min);
    const bad = validateMove(at, Date.now());
    if (bad) return notify(bad, 'warn');
    setBusy(true);
    try {
      const r = await window.api.setSchedule(b.outputId, entriesForBlockEdit(b, props.pubs, { at, platforms }));
      await props.onChanged();
      notify(r.warnings?.length ? `«${b.title}» guardada. Aviso: ${r.warnings.join(' ')}` : `«${b.title}» guardada.`, r.warnings?.length ? 'warn' : 'ok');
      if (r.skipped.length) notify(r.skipped.map((s) => `${s.platform}: ${s.reason}`).join('. '), 'warn');
    } catch (e) {
      notify(errMsg(e), 'bad');
      await props.onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      for (const k of b.keys) await window.api.cancelPublication(k);
      await props.onChanged();
      notify(`«${b.title}» ya no está programada.`);
    } catch (e) {
      notify(errMsg(e), 'bad');
      setBusy(false);
    }
  }

  return (
    <div className={`dayrow ${b.kind === 'long' ? 'video' : 'clip'}`} data-testid={`dayrow-${b.title}`}>
      <button type="button" className="dayrow-main" onClick={() => props.onOpen(b.outputId)} aria-label={`Abrir ${b.title}`} title="Ver y editar todas sus características">
        <span className="traythumb">{o?.thumbnail ? <img src={mediaUrl(o.id, 'thumb', o.thumbnail)} alt="" draggable={false} /> : <IconFilm size={20} />}</span>
        <span style={{ minWidth: 0, textAlign: 'left' }}>
          <span className="title-ellipsis" style={{ display: 'block', fontWeight: 600 }}>{b.title}</span>
          <span className="muted small">{b.kind === 'long' ? 'Vídeo' : 'Clip'}{b.note ? ` · ${b.note}` : ''}</span>
        </span>
      </button>
      <div className="dayrow-ctl">
        <label className="visually-hidden" htmlFor={`dt-${b.id}`}>Hora de {b.title}</label>
        <input id={`dt-${b.id}`} type="time" value={time} disabled={b.locked || busy} onChange={(e) => setTime(e.target.value)} />
        <div className="row" style={{ gap: 10 }} role="group" aria-label={`Redes de ${b.title}`}>
          {PLATFORMS.map((p) => (
            <label key={p.id} className="row" style={{ gap: 4, opacity: allowed.includes(p.id) ? 1 : 0.4 }} title={allowed.includes(p.id) ? undefined : 'Los vídeos solo se publican en YouTube'}>
              <input
                type="checkbox"
                disabled={!allowed.includes(p.id) || b.locked || busy}
                checked={platforms.includes(p.id)}
                onChange={(e) => setPlatforms(e.target.checked ? [...platforms, p.id] : platforms.filter((x) => x !== p.id))}
              />
              {p.label}
            </label>
          ))}
        </div>
        <button className="btn small" disabled={!dirty || busy || b.locked} onClick={() => void save()}>Guardar</button>
        <button className="btn ghost small danger-text" disabled={busy || b.locked} aria-label={`Quitar ${b.title} de la programación`} title="Quitar de la programación" onClick={() => void remove()}><IconTrash /></button>
      </div>
    </div>
  );
}

/**
 * El plan de un día: una sección para los vídeos (solo YouTube) y otra para los clips (todas las redes),
 * con la hora y las redes de cada subida. Se cambia ahí mismo, o se abre el vídeo para editar todo lo demás.
 */
export default function DayView(props: {
  dayKey: string;
  now: number;
  blocks: Block[];
  outputs: OutputItem[];
  pubs: Publication[];
  videoTimes: string[];
  clipTimes: string[];
  onBack: () => void;
  onShift: (days: number) => void;
  onAdd: (dayKey: string, hhmm?: string) => void;
  onOpen: (outputId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { dayKey } = props;
  const day = props.blocks.filter((b) => {
    const d = new Date(b.at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === dayKey;
  });
  const videos = day.filter((b) => b.kind === 'long');
  const clips = day.filter((b) => b.kind !== 'long');
  const past = atFromDayMinutes(dayKey, 24 * 60 - 1) < props.now;

  /** Horas habituales de ese día que aún no tienen subida ni han pasado. */
  const freeSlots = (times: string[], mine: Block[]) =>
    times.filter((t) => {
      const min = toMinutes(t);
      return min !== null && atFromDayMinutes(dayKey, min) > props.now && !mine.some((b) => hhmm(b.at) === t);
    });

  const section = (title: string, hint: string, list: Block[], times: string[], testid: string) => (
    <section className="card daysec" aria-label={title} data-testid={testid}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{title} <span className="muted small">({list.length})</span></h2>
        {!past && <button className="btn ghost small" onClick={() => props.onAdd(dayKey)}><IconPlus size={14} /> Añadir</button>}
      </div>
      <div className="muted small">{hint}</div>
      {list.length === 0 && <div className="muted small">Nada programado este día.</div>}
      <div className="daylist">
        {list.map((b) => (
          <Row key={`${b.id}:${b.keys.join(',')}`} block={b} output={props.outputs.find((o) => o.id === b.outputId)} pubs={props.pubs} dayKey={dayKey} onChanged={props.onChanged} onOpen={props.onOpen} />
        ))}
      </div>
      {!past && freeSlots(times, list).length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted small">Huecos libres:</span>
          {freeSlots(times, list).map((t) => (
            <button key={t} className="btn ghost small" onClick={() => props.onAdd(dayKey, t)}>{t}</button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="dayview stack" data-testid="dayview">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost small" onClick={props.onBack}>‹ Calendario</button>
          <button className="btn ghost small" aria-label="Día anterior" onClick={() => props.onShift(-1)}><span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><IconChevron /></span></button>
          <button className="btn ghost small" aria-label="Día siguiente" onClick={() => props.onShift(1)}><IconChevron /></button>
          <strong className="cap1" style={{ marginLeft: 8 }} aria-live="polite">{dayLabel(dayKey, props.now)}</strong>
        </div>
        <span className="muted small">{videos.length} vídeo(s) · {clips.length} clip(s)</span>
      </div>
      {section('Vídeos', 'Solo se publican en YouTube. Cambia la hora o quita la subida; pulsa el título para editar todo (nombre, descripción, lista…).', videos, props.videoTimes, 'day-videos')}
      {section('Clips', 'Se publican en YouTube Shorts, TikTok e Instagram. Elige en qué redes sale cada uno y a qué hora.', clips, props.clipTimes, 'day-clips')}
    </div>
  );
}

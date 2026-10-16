import { useEffect, useMemo, useState } from 'react';
import type { OutputItem, Platform, Publication, Settings } from '../../shared/types';
import { platformsFor, VIDEO_ONLY_YOUTUBE } from '../../shared/types';
import { buildAgenda, dayLabel, freePlatforms, localDayKey } from '../../shared/agenda';
import { defaultLocalDateTime, localInputToIso, toLocalInputValue } from '../../shared/time';
import { errMsg, notify } from '../lib';
import { PLATFORMS } from './ItemModal';
import { Modal } from './ui';

/**
 * Añadir una subida: un vídeo, las redes y una hora. Se puede repetir tantas veces como se quiera, también el mismo día
 * («Guardar y añadir otra»). Debajo se ve lo que ya hay ese día para no pisarse.
 */
export default function ScheduleDialog(props: {
  outputs: OutputItem[];
  pubs: Publication[];
  /** Si se indica, el vídeo viene fijado (se abrió desde su ficha). */
  outputId?: string;
  /** Hora inicial (AAAA-MM-DDTHH:MM, local), p. ej. donde se soltó el vídeo. */
  defaultWhen?: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const { outputs, pubs } = props;
  const candidates = useMemo(() => outputs.filter((o) => freePlatforms(o.id, pubs, platformsFor(o.kind)).length > 0), [outputs, pubs]);
  const [outputId, setOutputId] = useState(props.outputId ?? candidates[0]?.id ?? '');
  const [when, setWhen] = useState(props.defaultWhen ?? defaultLocalDateTime());
  const [chosen, setChosen] = useState<Set<Platform>>(new Set());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [note, setNote] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [connected, setConnected] = useState<Platform[]>([]);

  useEffect(() => {
    let alive = true;
    window.api
      .getSettings()
      .then((s: Settings) => {
        if (alive) setSlots([...new Set([...s.autopilot.videoTimes, ...s.autopilot.clipTimes])].sort());
      })
      .catch(() => undefined);
    window.api
      .listConnections()
      .then((c) => {
        if (alive) setConnected(c.filter((x) => x.connected).map((x) => x.platform));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const kind = outputs.find((o) => o.id === outputId)?.kind ?? 'clip';
  const allowed = platformsFor(kind);
  const free = outputId ? freePlatforms(outputId, pubs, allowed) : [];
  // al elegir vídeo se marcan las redes que tienes conectadas y donde aún no está programado; tú decides el resto
  useEffect(() => {
    setChosen(new Set(outputId ? freePlatforms(outputId, pubs, allowed).filter((p) => connected.includes(p) && !pubs.some((x) => x.outputId === outputId && x.platform === p)) : []));
    // solo cuando cambia el vídeo o llegan las conexiones: no pisar la elección del usuario cuando llegan otros datos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputId, connected]);

  const iso = localInputToIso(when);
  const dayKey = iso ? localDayKey(Date.parse(iso)) : null;
  const sameDay = dayKey ? (buildAgenda(pubs, outputs).find((d) => d.key === dayKey)?.entries ?? []) : [];

  const preset = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    setWhen(toLocalInputValue(d));
  };

  async function submit(again: boolean) {
    setErr('');
    if (!outputId) return setErr('Elige un vídeo.');
    if (!chosen.size) return setErr('Elige al menos una red social.');
    if (!iso) return setErr('Fecha y hora no válidas.');
    setBusy(true);
    try {
      const r = await window.api.schedule(outputId, [...chosen], iso);
      await props.onChanged();
      const title = outputs.find((o) => o.id === outputId)?.title ?? 'Vídeo';
      const problems = [
        ...r.skipped.map((x) => `${x.platform}: ${x.reason}`),
        ...(r.warnings ?? []),
      ];
      if (again) {
        // la ventana sigue abierta: todo se explica dentro de ella, sin avisos encima del botón
        setNote(problems.join(' '));
        if (r.scheduled.length) setAdded((n) => n + 1);
        const next = candidates.find((o) => o.id !== outputId && freePlatforms(o.id, pubs, platformsFor(o.kind)).length > 0);
        setOutputId(next?.id ?? '');
      } else {
        if (r.scheduled.length) notify(`Subida programada: «${title}» (${r.scheduled.length === 1 ? '1 red' : `${r.scheduled.length} redes`}).`, 'ok');
        if (problems.length) notify(problems.join(' '), 'warn');
        props.onClose();
      }
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const noVideos = !props.outputId && candidates.length === 0;

  return (
    <Modal title="Añadir subida" onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <div className="muted small">
          Puedes añadir todas las subidas que quieras, también varias el mismo día. Cada vídeo se publica una sola vez en cada red.
        </div>
        {noVideos ? (
          <div className="msg">No hay vídeos disponibles: todos están ya publicados o aún no has creado ninguno.</div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="sd-video">Vídeo</label>
              {props.outputId ? (
                <div id="sd-video" className="title-ellipsis" style={{ fontWeight: 600 }}>{outputs.find((o) => o.id === props.outputId)?.title}</div>
              ) : (
                <select id="sd-video" value={outputId} onChange={(e) => setOutputId(e.target.value)} autoFocus>
                  {!outputId && <option value="">Elige un vídeo…</option>}
                  {candidates.map((o) => (
                    <option key={o.id} value={o.id}>{o.kind === 'long' ? 'Vídeo' : 'Clip'} · {o.title}</option>
                  ))}
                </select>
              )}
            </div>
            <fieldset className="kinds">
              <legend className="muted small">Dónde</legend>
              <div className="row">
                {PLATFORMS.filter((x) => allowed.includes(x.id)).map(({ id, label }) => (
                  <label key={id} className="check">
                    <input
                      type="checkbox"
                      checked={chosen.has(id)}
                      disabled={!free.includes(id)}
                      onChange={(e) =>
                        setChosen((cur) => {
                          const n = new Set(cur);
                          if (e.target.checked) n.add(id);
                          else n.delete(id);
                          return n;
                        })
                      }
                    />{' '}
                    {label}
                  </label>
                ))}
              </div>
              {kind === 'long' && <div className="muted small">{VIDEO_ONLY_YOUTUBE}</div>}
              {outputId && free.length < allowed.length && <div className="muted small">Las redes en gris ya tienen este vídeo publicado o publicándose.</div>}
            </fieldset>
            <div className="field">
              <label htmlFor="sd-when">Fecha y hora</label>
              <input id="sd-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              {slots.length > 0 && (
                <div className="row" style={{ gap: 6 }} aria-label="Horas habituales">
                  {slots.map((h) => (
                    <button key={h} type="button" className="chip" onClick={() => preset(h)}>{h}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="dayplan" aria-live="polite">
              <div className="muted small" style={{ marginBottom: 4 }}>{dayKey ? `${dayLabel(dayKey)}: ${sameDay.length ? `ya hay ${sameDay.length} subida(s)` : 'todavía no hay nada programado'}` : ' '}</div>
              {sameDay.map((e) => (
                <div key={e.pub.key} className="small row" style={{ gap: 8 }}>
                  <span className="mono">{new Date(e.pub.scheduledAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="badge">{PLATFORMS.find((p) => p.id === e.pub.platform)?.label}</span>
                  <span className="title-ellipsis" style={{ maxWidth: 260 }}>{e.title}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {added > 0 && <div className="msg ok small" role="status">{added} subida(s) añadida(s) en esta sesión.</div>}
        {note && <div className="msg warn small" role="status">{note}</div>}
        {err && <div className="msg bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={props.onClose}>{added ? 'Hecho' : 'Cancelar'}</button>
          {!props.outputId && !noVideos && <button type="button" className="btn ghost" disabled={busy} onClick={() => void submit(true)}>Guardar y añadir otra</button>}
          <button type="submit" className="btn" disabled={busy || noVideos}>Programar</button>
        </div>
      </form>
    </Modal>
  );
}

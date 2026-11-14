import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipFormat, VodJob } from '../../shared/types';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS, isSubtitleStyleId, type SubtitleStyleId } from '../../shared/subtitles';
import { fmtTime, parseTime } from '../../shared/time';
import { fmtTenths, type TrimRange } from '../../shared/trim';
import { vodMediaUrl } from '../../shared/media';
import type { VodChatMessage } from '../../shared/vodChat';
import ClipTimeline from '../library/ClipTimeline';
import { errMsg, notify } from '../lib';
import { Modal } from '../library/ui';

const PLAN_EXAMPLE = `{
  "clips": [
    { "start": 125, "end": 168, "title": "Momento épico",
      "cuts": [ { "start": 140, "end": 144.5 } ],
      "effects": [ { "type": "punch", "at": 152 }, { "type": "fadeOut" } ] },
    { "kind": "horizontal", "start": 300, "end": 340, "title": "Solo horizontal" }
  ],
  "long": {
    "title": "Resumen del directo",
    "segments": [ { "start": 60, "end": 400 }, { "start": 900, "end": 1500 } ]
  }
}`;

/**
 * Ventana para cortar a mano un clip (o aplicar un plan de edición) de un directo ya descargado.
 * Se abre desde «Directos y actividad»: con el botón de un directo, o con «Cortar un clip…» eligiendo el VOD.
 */
export default function CutClipDialog(props: { vods: VodJob[]; initialVodId?: string; onChanged: () => Promise<void>; onOpenLibrary: () => void; onClose: () => void }) {
  const ready = props.vods.filter((v) => v.status === 'downloaded' && v.origin !== 'clip');
  const [vodId, setVodId] = useState(props.initialVodId ?? '');
  const selected = ready.some((v) => v.id === vodId) ? vodId : (ready[0]?.id ?? '');
  const [kind, setKind] = useState<ClipFormat>('both');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [title, setTitle] = useState('');
  const [cropX, setCropX] = useState<number | null>(null);
  const [subs, setSubs] = useState<SubtitleStyleId | ''>('');
  const [planJson, setPlanJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // reproductor del directo completo (si el archivo sigue en el disco)
  const vod = ready.find((v) => v.id === selected);
  const playable = !!vod?.filePath && !vod.cleaned;
  const vref = useRef<HTMLVideoElement>(null);
  const until = useRef<number | null>(null);
  const [now, setNow] = useState(0);
  const [dur, setDur] = useState(vod?.durationSec ?? 0);
  const [playing, setPlaying] = useState(false);
  const [playErr, setPlayErr] = useState('');
  useEffect(() => {
    setNow(0);
    setDur(vod?.durationSec ?? 0);
    setPlaying(false);
    setPlayErr('');
    until.current = null;
  }, [selected, vod?.durationSec]);

  const seek = (t: number) => {
    const v = vref.current;
    const c = Math.max(0, Math.min(dur || t, t));
    if (v) v.currentTime = c;
    setNow(c);
  };
  const toggle = () => {
    const v = vref.current;
    if (!v) return;
    until.current = null;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const s0 = parseTime(start);
  const e0 = parseTime(end);
  const range: TrimRange | null = !Number.isNaN(s0) && !Number.isNaN(e0) && e0 > s0 ? { start: s0, end: e0 } : null;
  const setRange = (r: TrimRange) => {
    setStart(fmtTenths(r.start));
    setEnd(fmtTenths(r.end));
  };
  const markStart = () => {
    setStart(fmtTenths(now));
    if (!range || now >= e0) setEnd(fmtTenths(Math.min(dur || now + 30, now + 30)));
  };
  const markEnd = () => {
    setEnd(fmtTenths(now));
    if (Number.isNaN(s0) || now <= s0) setStart(fmtTenths(Math.max(0, now - 30)));
  };
  const previewClip = () => {
    const v = vref.current;
    if (!v || !range) return;
    v.currentTime = range.start;
    until.current = range.end;
    void v.play().catch(() => undefined);
  };

  async function guarded(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      const created = /^0 vídeo/.test(text) ? false : true; // «0 vídeo(s) creados» no es un éxito
      setMsg({ ok: created, text });
      notify(text.split('\n')[0], created ? 'ok' : 'warn');
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
      await props.onChanged();
    }
  }

  const createClip = () =>
    guarded(async () => {
      const s = parseTime(start);
      const e = parseTime(end);
      if (Number.isNaN(s) || Number.isNaN(e)) throw new Error('Escribe inicio y fin como 90, 1:30 o 1:02:03.');
      // sin título, se pone uno provisional a partir de lo que se dice en el tramo
      let name = title.trim();
      if (!name) name = (await window.api.suggestTitle(selected, s, e).catch(() => null))?.title ?? 'Clip';
      await window.api.createClip(selected, { kind, start: s, end: e, title: name, ...(cropX !== null ? { cropX } : {}), ...(subs ? { subtitles: subs } : {}) });
      return 'Clip creado y validado.';
    });

  const applyPlan = () =>
    guarded(async () => {
      const r = await window.api.applyPlan(selected, planJson);
      const extra = r.errors.length ? `\nAvisos:\n- ${r.errors.join('\n- ')}` : '';
      return `${r.created.length} vídeo(s) creados y validados.${extra}`;
    });

  return (
    <Modal title="Cortar un clip" onClose={props.onClose} wide={playable ? true : 'mid'}>
      {ready.length === 0 ? (
        <div className="muted">Aún no hay ningún directo descargado. Pulsa «Analizar» en uno de la lista y, cuando se descargue, podrás cortar clips de él.</div>
      ) : (
        <div className={playable ? 'cutlayout' : undefined}>
        <div className="cutform">
          <div className="field">
            <label htmlFor="vod-select">Directo</label>
            <select id="vod-select" value={selected} onChange={(e) => setVodId(e.target.value)}>
              {ready.map((v) => (
                <option key={v.id} value={v.id}>{v.title || v.url}</option>
              ))}
            </select>
          </div>

          {playable && vod && (
            <div className="cutplayer" data-testid="cut-player">
              <video
                ref={vref}
                src={vodMediaUrl(selected, vod.filePath)}
                preload="metadata"
                onClick={toggle}
                onLoadedMetadata={(e) => setDur(e.currentTarget.duration || vod.durationSec || 0)}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  setNow(t);
                  if (until.current !== null && t >= until.current) {
                    e.currentTarget.pause();
                    until.current = null;
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setPlayErr('El vídeo del directo no se puede reproducir aquí; puedes escribir los tiempos a mano.')}
              />
              {playErr && <div className="msg bad" role="alert">{playErr}</div>}
              <input type="range" className="cutseek" aria-label="Moverse por el directo" min={0} max={Math.max(1, Math.floor(dur))} step={1} value={Math.floor(now)} onChange={(e) => seek(Number(e.target.value))} />
              <div className="row cutctl">
                <button className="btn ghost small" onClick={() => seek(now - 10)} title="Atrás 10 segundos">−10 s</button>
                <button className="btn small" onClick={toggle} data-testid="cut-play">{playing ? 'Pausa' : 'Reproducir'}</button>
                <button className="btn ghost small" onClick={() => seek(now + 10)} title="Adelante 10 segundos">+10 s</button>
                <span className="muted small cuttime">{fmtTime(now)} / {fmtTime(dur)}</span>
              </div>
            </div>
          )}

          <div className="cutstep">
            <span className="cutnum">1</span>
            <div className="grow">
              <h3>¿Qué momento?</h3>
              <div className="muted small">{playable ? 'Ve al momento en el directo y pulsa «Empezar aquí» y «Acabar aquí», o escribe los minutos (por ejemplo 1:30 y 2:10).' : 'Escribe el minuto donde empieza y donde acaba (por ejemplo 1:30 y 2:10).'}</div>
              <div className="row">
                <input type="text" aria-label="Inicio" placeholder="Inicio (1:30)" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 130 }} />
                <input type="text" aria-label="Fin" placeholder="Fin (2:10)" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 130 }} />
                {playable && <button className="btn ghost small" onClick={markStart} data-testid="cut-mark-start">Empezar aquí</button>}
                {playable && <button className="btn ghost small" onClick={markEnd} data-testid="cut-mark-end">Acabar aquí</button>}
                {playable && <button className="btn small" disabled={!range} onClick={previewClip} data-testid="cut-preview">Ver el clip</button>}
              </div>
              {playable && range && (
                <ClipTimeline range={range} vodDuration={dur || null} playhead={now} onChange={setRange} onSeek={seek} onScrub={seek} />
              )}
            </div>
          </div>

          <div className="cutstep">
            <span className="cutnum">2</span>
            <div className="grow">
              <h3>¿Cómo quieres que salga?</h3>
              <div className="row">
                <select aria-label="Formato" value={kind} onChange={(e) => setKind(e.target.value as ClipFormat)} style={{ width: 260 }}>
                  <option value="both">Vertical y horizontal</option>
                  <option value="vertical">Solo vertical 1080×1920</option>
                  <option value="horizontal">Solo horizontal 1920×1080</option>
                </select>
                <select aria-label="Subtítulos" value={subs} onChange={(e) => setSubs(isSubtitleStyleId(e.target.value) ? e.target.value : '')} style={{ width: 220 }}>
                  <option value="">Sin subtítulos</option>
                  {SUBTITLE_STYLE_IDS.map((id) => <option key={id} value={id}>{SUBTITLE_STYLES[id].label}</option>)}
                </select>
              </div>
              <div className="muted small">Los subtítulos necesitan la transcripción del directo; también podrás cambiarlos después en la Biblioteca.</div>
              {kind !== 'horizontal' && (
                <div className="field">
                  <label htmlFor="clip-crop">Recorte vertical</label>
                  <input id="clip-crop" type="range" min={0} max={1} step={0.05} value={cropX ?? 0.5} onChange={(e) => setCropX(Number(e.target.value))} />
                  <div className="muted small">
                    {cropX === null
                      ? 'Sin tocar: dos ventanas, la cámara arriba y la pantalla debajo. Mueve la barra para usar una sola columna.'
                      : 'Una sola columna del vídeo, en la posición elegida.'}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="cutstep">
            <span className="cutnum">3</span>
            <div className="grow">
              <h3>Título</h3>
              <input id="clip-title" type="text" aria-label="Título" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Vacío = un título provisional según lo que se dice" />
            </div>
          </div>

          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button className="btn" disabled={busy} onClick={() => void createClip()}>Crear clip</button>
            <button className="btn ghost small" onClick={props.onOpenLibrary}>Ver en la Biblioteca</button>
          </div>

          <details className="adv">
            <summary>Avanzado: transcripción y plan de edición de Claude</summary>
            <div className="adv-body">
              <h3 style={{ marginTop: 14 }}>Transcripción del directo</h3>
              <TranscriptBlock vod={ready.find((v) => v.id === selected)} onChanged={props.onChanged} />

              <h3 style={{ marginTop: 14 }}>Aplicar plan de edición (JSON)</h3>
              <div className="muted small">
                Pega aquí las decisiones de Claude: clips (con cortes y animaciones) y vídeo largo de una sola vez. Para que Claude entienda el directo,
                copia antes la petición con la transcripción y pégasela.
              </div>
              <textarea aria-label="Plan de edición" placeholder={PLAN_EXAMPLE} value={planJson} onChange={(e) => setPlanJson(e.target.value)} />
              <button className="btn" disabled={busy || !planJson.trim()} onClick={() => void applyPlan()}>Aplicar plan</button>
            </div>
          </details>
        </div>
        {playable && vod && <VodChat vodId={selected} time={now} duration={dur} />}
        </div>
      )}
      {busy && <div className="msg" role="status">Renderizando… puede tardar unos minutos.</div>}
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>}
    </Modal>
  );
}

function TranscriptBlock({ vod, onChanged }: { vod?: VodJob; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!vod) return null;
  const t = vod.transcript;

  async function act(fn: () => Promise<string | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
      await onChanged();
    }
  }

  return (
    <div data-testid="transcript-block">
      <div className="muted small" data-testid="transcript-status">
        {t ? `Transcripción: ${t.words} palabras (${t.source === 'whisper' ? 'hecha con Whisper' : 'importada'}${t.partial ? ', solo de los tramos de tus clips y vídeos' : ''}).` : 'Este VOD aún no tiene transcripción.'}
      </div>
      <div className="row">
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const r = await window.api.importTranscript(vod.id);
              return r ? `Transcripción importada (${r.transcript?.words ?? 0} palabras).` : null;
            })
          }
        >
          Importar transcripción…
        </button>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const r = await window.api.transcribeVod(vod.id);
              return `Transcripción hecha (${r.transcript?.words ?? 0} palabras).`;
            })
          }
        >
          Transcribir con Whisper
        </button>
        <button
          className="btn small"
          disabled={busy || !t}
          onClick={() =>
            void act(async () => {
              await navigator.clipboard.writeText(await window.api.claudePrompt(vod.id));
              return 'Petición copiada: pégasela a Claude y pega aquí su respuesta (el JSON).';
            })
          }
        >
          Copiar petición para Claude
        </button>
      </div>
      {busy && <div className="muted small" role="status">Trabajando… transcribir un directo largo puede tardar bastante.</div>}
      {msg && <div className={`msg small ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
    </div>
  );
}

/** Chat del directo en el momento que se está viendo (si Twitch todavía lo guarda). */
function VodChat({ vodId, time, duration }: { vodId: string; time: number; duration: number }) {
  const [msgs, setMsgs] = useState<VodChatMessage[]>([]);
  const [cov, setCov] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const endAt = useRef(Infinity);

  const fetchFrom = useCallback(
    async (from: number, replace: boolean) => {
      if (inflight.current) return;
      inflight.current = true;
      setLoading(true);
      try {
        const p = await window.api.vodChat(vodId, from);
        if (!p.ok) {
          setError(p.error ?? 'No se pudo leer el chat.');
          return;
        }
        setError('');
        setMsgs((old) => {
          const base = replace ? [] : old;
          const seen = new Set(base.map((m) => `${m.t}|${m.user}|${m.text}`));
          const add = p.messages.filter((m) => !seen.has(`${m.t}|${m.user}|${m.text}`));
          return [...base, ...add].sort((a, b) => a.t - b.t).slice(-3000);
        });
        setCov((c) => (replace || !c ? { from, to: p.to } : { from: Math.min(c.from, from), to: Math.max(c.to, p.to) }));
        endAt.current = p.end ? p.to : Infinity;
      } finally {
        inflight.current = false;
        setLoading(false);
      }
    },
    [vodId],
  );

  useEffect(() => {
    setMsgs([]);
    setCov(null);
    setError('');
    endAt.current = Infinity;
  }, [vodId]);

  useEffect(() => {
    if (error) return;
    const needStart = !cov || time < cov.from || time > cov.to + 120;
    if (needStart) void fetchFrom(Math.max(0, time - 45), true);
    else if (cov && time + 20 > cov.to && cov.to < endAt.current && cov.to < duration) void fetchFrom(cov.to, false);
  }, [time, cov, error, duration, fetchFrom]);

  const shown = useMemo(() => msgs.filter((m) => m.t <= time && m.t >= time - 90).slice(-60), [msgs, time]);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <aside className="cutchat" aria-label="Chat del directo" data-testid="vod-chat">
      <h3>Chat en este momento <span className="muted small">{fmtTime(time)}</span></h3>
      {error ? (
        <div className="muted small" role="status">{error}</div>
      ) : (
        <div className="chatbox" ref={box}>
          {shown.length === 0 && <div className="muted small">{loading ? 'Leyendo el chat…' : 'Nadie escribió en el último minuto y medio.'}</div>}
          {shown.map((m, i) => (
            <div key={`${m.t}-${i}`} className="chatline">
              <span className="chattime">{fmtTime(m.t)}</span> <b style={m.color ? { color: m.color } : undefined}>{m.user}</b>: {m.text}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

import { useState } from 'react';
import type { ClipFormat, OutputItem, Platform, Publication, VodJob } from '../../shared/types';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS, isSubtitleStyleId, type SubtitleStyleId } from '../../shared/subtitles';
import { defaultLocalDateTime, fmtDate, fmtTime, localInputToIso, parseTime } from '../../shared/time';
import { primaryFile } from '../../shared/outputs';
import { errMsg } from '../lib';
import TwitchClips from './TwitchClips';

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];
const PLATFORM_LABEL = Object.fromEntries(PLATFORMS.map((p) => [p.id, p.label])) as Record<Platform, string>;
const KIND_LABEL = { clip: 'Clip', long: 'Vídeo largo' } as const;
const PUB_STATUS = {
  scheduled: { label: 'Programado', cls: 'warn' },
  publishing: { label: 'Publicando', cls: 'warn' },
  published: { label: 'Publicado', cls: 'ok' },
  failed: { label: 'Fallido', cls: 'bad' },
} as const;

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

export default function ClipsTab(props: {
  vods: VodJob[];
  outputs: OutputItem[];
  pubs: Publication[];
  onChanged: () => Promise<void>;
}) {
  const ready = props.vods.filter((v) => v.status === 'downloaded' && v.origin !== 'clip');
  const [vodId, setVodId] = useState('');
  const selected = ready.some((v) => v.id === vodId) ? vodId : (ready[0]?.id ?? '');

  const [kind, setKind] = useState<ClipFormat>('both');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [title, setTitle] = useState('');
  const [cropX, setCropX] = useState(0.5);
  const [subs, setSubs] = useState<SubtitleStyleId | ''>('');
  const [planJson, setPlanJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function guarded(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
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
      await window.api.createClip(selected, { kind, start: s, end: e, title: title.trim() || 'Clip', cropX, ...(subs ? { subtitles: subs } : {}) });
      return 'Clip creado y validado.';
    });

  const applyPlan = () =>
    guarded(async () => {
      const r = await window.api.applyPlan(selected, planJson);
      const extra = r.errors.length ? `\nAvisos:\n- ${r.errors.join('\n- ')}` : '';
      return `${r.created.length} vídeo(s) creados y validados.${extra}`;
    });

  return (
    <div className="grid">
      <TwitchClips onChanged={props.onChanged} />
      <section className="card">
        <h2>Crear clips</h2>
        {ready.length === 0 ? (
          <div className="muted">Aún no hay ningún VOD descargado. Cuando termine tu próximo directo, el programa lo recogerá solo (o añade uno a mano en el Panel).</div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="vod-select">VOD de origen</label>
              <select id="vod-select" value={selected} onChange={(e) => setVodId(e.target.value)}>
                {ready.map((v) => (
                  <option key={v.id} value={v.id}>{v.title || v.url}</option>
                ))}
              </select>
            </div>

            <h3 style={{ marginTop: 16 }}>Clip manual</h3>
            <div className="row">
              <select aria-label="Formato" value={kind} onChange={(e) => setKind(e.target.value as ClipFormat)} style={{ width: 260 }}>
                <option value="both">Vertical y horizontal</option>
                <option value="vertical">Solo vertical 1080×1920</option>
                <option value="horizontal">Solo horizontal 1920×1080</option>
              </select>
              <input type="text" aria-label="Inicio" placeholder="Inicio (1:30)" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 120 }} />
              <input type="text" aria-label="Fin" placeholder="Fin (2:10)" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 120 }} />
            </div>
            <div className="field">
              <label htmlFor="clip-title">Título</label>
              <input id="clip-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
            </div>
            {kind !== 'horizontal' && (
              <div className="field">
                <label htmlFor="clip-crop">Posición del recorte vertical (de izquierda a derecha)</label>
                <input id="clip-crop" type="range" min={0} max={1} step={0.05} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} />
              </div>
            )}
            <div className="field">
              <label htmlFor="clip-subs">Subtítulos</label>
              <select id="clip-subs" value={subs} onChange={(e) => setSubs(isSubtitleStyleId(e.target.value) ? e.target.value : '')} style={{ width: 260 }}>
                <option value="">Sin subtítulos</option>
                {SUBTITLE_STYLE_IDS.map((id) => <option key={id} value={id}>{SUBTITLE_STYLES[id].label}</option>)}
              </select>
              <span className="muted small">Necesitan la transcripción del VOD. Después podrás cambiarlos viendo el resultado en la Biblioteca.</span>
            </div>
            <button className="btn" disabled={busy} onClick={() => void createClip()}>Crear clip</button>

            <h3 style={{ marginTop: 20 }}>Transcripción del VOD</h3>
            <TranscriptBlock vod={ready.find((v) => v.id === selected)} onChanged={props.onChanged} />

            <h3 style={{ marginTop: 20 }}>Aplicar plan de edición (JSON)</h3>
            <div className="muted small">
              Pega aquí las decisiones de Claude: clips (con cortes y animaciones) y vídeo largo de una sola vez. Para que Claude entienda el directo,
              copia antes la petición con la transcripción y pégasela.
            </div>
            <textarea aria-label="Plan de edición" placeholder={PLAN_EXAMPLE} value={planJson} onChange={(e) => setPlanJson(e.target.value)} />
            <button className="btn" disabled={busy || !planJson.trim()} onClick={() => void applyPlan()}>Aplicar plan</button>
          </>
        )}
        {busy && <div className="msg" role="status">Renderizando… puede tardar unos minutos.</div>}
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>}
      </section>

      <section className="card">
        <h2>Vídeos listos</h2>
        {props.outputs.length === 0 && <div className="muted">Aún no hay vídeos. Los clips aparecen aquí cuando el render se valida.</div>}
        <div className="list">
          {props.outputs.map((o) => (
            <OutputRow key={o.id} output={o} pubs={props.pubs.filter((p) => p.outputId === o.id)} onChanged={props.onChanged} />
          ))}
        </div>
      </section>
    </div>
  );
}

function OutputRow({ output, pubs, onChanged }: { output: OutputItem; pubs: Publication[]; onChanged: () => Promise<void> }) {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [when, setWhen] = useState(defaultLocalDateTime());
  const [info, setInfo] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (p: Platform) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  async function schedule() {
    setInfo(null);
    const iso = localInputToIso(when);
    if (!iso) {
      setInfo({ ok: false, text: 'Fecha y hora no válidas.' });
      return;
    }
    try {
      const r = await window.api.schedule(output.id, platforms, iso);
      setPlatforms([]);
      if (r.skipped.length) {
        setInfo({ ok: false, text: r.skipped.map((s) => `${PLATFORM_LABEL[s.platform]}: ${s.reason}`).join('. ') });
      }
      await onChanged();
    } catch (e) {
      setInfo({ ok: false, text: errMsg(e) });
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="title-ellipsis">{output.title}</div>
          <div className="muted small">
            <span className="badge">{KIND_LABEL[output.kind]}</span> {fmtTime(output.durationSec)} · {fmtDate(output.createdAt)}
          </div>
        </div>
        <button className="btn ghost small" onClick={() => void window.api.openPath(primaryFile(output) ?? '').catch(() => undefined)}>Mostrar</button>
      </div>

      {pubs.map((p) => (
        <div key={p.key} className="row small" style={{ marginTop: 6 }}>
          <span className={`badge ${PUB_STATUS[p.status].cls}`}>{PUB_STATUS[p.status].label}</span>
          <span>{PLATFORM_LABEL[p.platform]} · {fmtDate(p.scheduledAt)}</span>
          {(p.status === 'scheduled' || p.status === 'failed') && (
            <button className="btn ghost small" onClick={() => void window.api.cancelPublication(p.key).then(onChanged)}>Quitar</button>
          )}
          {p.note && <span className="muted">{p.note}</span>}
        </div>
      ))}

      <div className="row" style={{ marginTop: 8 }}>
        {PLATFORMS.map((p) => (
          <label key={p.id} className="check small">
            <input type="checkbox" checked={platforms.includes(p.id)} onChange={() => toggle(p.id)} /> {p.label}
          </label>
        ))}
        <input type="datetime-local" aria-label="Fecha y hora de publicación" value={when} onChange={(e) => setWhen(e.target.value)} style={{ width: 200 }} />
        <button className="btn small" disabled={!platforms.length} onClick={() => void schedule()}>Programar</button>
      </div>
      {info && <div className={`msg small ${info.ok ? 'ok' : 'bad'}`} role="alert">{info.text}</div>}
    </div>
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
        {t ? `Transcripción: ${t.words} palabras (${t.source === 'whisper' ? 'hecha con Whisper' : 'importada'}).` : 'Este VOD aún no tiene transcripción.'}
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

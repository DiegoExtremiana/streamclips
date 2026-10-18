import { useState } from 'react';
import type { ClipFormat, OutputItem, Publication, VodJob } from '../../shared/types';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS, isSubtitleStyleId, type SubtitleStyleId } from '../../shared/subtitles';
import { fmtDate, fmtTime, parseTime } from '../../shared/time';
import { errMsg, notify } from '../lib';
import type { TabId } from '../App';
import ScheduleDialog from '../library/ScheduleDialog';
import { IconCalendar } from '../icons';
import TwitchClips from './TwitchClips';
import PanelTab from './PanelTab';
import { SubTabs, useSubTab } from '../SubTabs';

const KIND_LABEL = { clip: 'Clip', long: 'Vídeo largo' } as const;
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
  onNavigate: (tab: TabId) => void;
}) {
  const [sub, setSub] = useSubTab('streamclips.clips.sub', ['canal', 'crear', 'directos']);
  const [scheduling, setScheduling] = useState<string | null>(null);
  const ready = props.vods.filter((v) => v.status === 'downloaded' && v.origin !== 'clip');
  const [vodId, setVodId] = useState('');
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
    <div className="stack">
      <SubTabs
        label="Clips y publicación"
        value={sub}
        onChange={setSub}
        tabs={[
          { id: 'canal', label: 'Clips de tu canal', hint: 'Los clips que la gente (o tú) ha creado en Twitch: míralos y elige cuáles llevar a la Biblioteca.' },
          { id: 'crear', label: 'Crear desde un VOD', hint: 'Corta tus propios clips y vídeos de un directo ya descargado. Los que se creen aparecen en la Biblioteca.' },
          { id: 'directos', label: 'Directos y actividad', hint: 'Los directos que el programa ha recogido, lo que está haciendo ahora y cómo añadir un VOD a mano.' },
        ]}
      />
      {sub === 'directos' && <PanelTab vods={props.vods} outputs={props.outputs} pubs={props.pubs} onChanged={props.onChanged} onNavigate={props.onNavigate} part="bottom" />}
      {sub === 'canal' && <TwitchClips vods={props.vods} outputs={props.outputs} onChanged={props.onChanged} />}
      {sub === 'crear' && (
    <div className="grid">
      <section className="card">
        <h2>Crear un clip a mano</h2>
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
            <div className="muted small">Escribe el minuto donde empieza y donde acaba el momento (por ejemplo 1:30 y 2:10). Se crean a la vez la versión vertical y la horizontal.</div>
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
              <input id="clip-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Vacío = un título provisional según lo que se dice" />
            </div>
            {kind !== 'horizontal' && (
              <div className="field">
                <label htmlFor="clip-crop">Recorte vertical</label>
                <input id="clip-crop" type="range" min={0} max={1} step={0.05} value={cropX ?? 0.5} onChange={(e) => setCropX(Number(e.target.value))} />
                <div className="muted small">
                  {cropX === null
                    ? 'Sin tocar: dos ventanas, la cámara del streamer arriba y la pantalla debajo (se retoca después en la biblioteca). Mueve la barra para usar una sola columna.'
                    : 'Una sola columna del vídeo, en la posición elegida.'}
                </div>
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

            <details className="adv" style={{ marginTop: 20 }}>
              <summary>Avanzado: transcripción y plan de edición de Claude</summary>
              <div className="adv-body">
            <h3 style={{ marginTop: 14 }}>Transcripción del VOD</h3>
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
          </>
        )}
        {busy && <div className="msg" role="status">Renderizando… puede tardar unos minutos.</div>}
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>}
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Recién creados</h2>
          <button className="btn ghost small" onClick={() => props.onNavigate('biblioteca')}>Abrir la Biblioteca</button>
        </div>
        {props.outputs.length === 0 && <div className="muted">Aún no hay vídeos creados. Aparecen aquí en cuanto se validan.</div>}
        <div className="list">
          {props.outputs.slice(0, 6).map((o) => {
            const mine = props.pubs.filter((p) => p.outputId === o.id && p.status === 'scheduled').length;
            return (
              <div key={o.id} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="title-ellipsis">{o.title}</div>
                  <div className="muted small">
                    <span className="badge">{KIND_LABEL[o.kind]}</span> {fmtTime(o.durationSec)} · {fmtDate(o.createdAt)}{mine ? ` · ${mine} subida(s) programada(s)` : ''}
                  </div>
                </div>
                <button className="btn ghost small" aria-label={`Programar subida de ${o.title}`} onClick={() => setScheduling(o.id)}><IconCalendar /> Programar</button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
      )}
      {scheduling && <ScheduleDialog outputs={props.outputs} pubs={props.pubs} outputId={scheduling} onChanged={props.onChanged} onClose={() => setScheduling(null)} />}
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

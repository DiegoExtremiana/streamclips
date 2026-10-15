import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { platformsFor, VIDEO_ONLY_YOUTUBE } from '../../shared/types';
import type { FramingPreview, OutputItem, Platform, Publication, RenderKind, Visibility } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { defaultLocalDateTime, fmtDate, fmtTime, localInputToIso, parseTime, toLocalInputValue } from '../../shared/time';
import { errMsg } from '../lib';
import { YT_DESC_MAX, YT_PLAYLIST_MAX, YT_TITLE_MAX, youtubeProblems } from '../../shared/youtube';
import { IconDownload, IconTrash } from '../icons';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS, wordsForOutput, type SubtitleStyleId, type Word } from '../../shared/subtitles';
import { keptRanges } from '../../shared/timeline';
import Captions, { SampleCaptions } from './Captions';
import Player from './Player';
import { Modal } from './ui';

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];
export const PUB_STATUS = {
  scheduled: { label: 'Programado', cls: 'warn' },
  publishing: { label: 'Publicando', cls: 'warn' },
  published: { label: 'Publicado', cls: 'ok' },
  failed: { label: 'Fallido', cls: 'bad' },
} as const;

type Msg = { ok: boolean; text: string } | null;

const SUBTITLES_HELP: Record<SubtitleStyleId, string> = {
  clasico: 'Blanco con contorno, abajo.',
  karaoke: 'La palabra que suena se ilumina.',
  pop: 'Pocas palabras, grandes, al centro.',
  minimal: 'Pequeño sobre caja translúcida.',
};

function Notice({ msg }: { msg: Msg }) {
  return msg ? <div className={`msg small ${msg.ok ? 'ok' : 'bad'}`} role="alert" style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div> : null;
}

export default function ItemModal(props: {
  output: OutputItem;
  pubs: Publication[];
  /** Listas usadas ya en otros vídeos, para sugerirlas. */
  playlists: string[];
  onChanged: () => Promise<void>;
  onClose: () => void;
  /** Pide confirmación y elimina el vídeo (lo gestiona la Biblioteca). */
  onDelete: () => void;
}) {
  const { output: o } = props;
  const videoRef = useRef<HTMLVideoElement>(null); // vídeo largo, o versión horizontal de un clip
  const verticalRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<HTMLVideoElement | null>(null); // el reproductor que se ha usado en último lugar
  const isClip = o.kind === 'clip';
  const ownPlatforms = PLATFORMS.filter((p) => platformsFor(o.kind).includes(p.id));
  const canReedit = isClip && o.vodId !== undefined && o.start !== undefined && o.end !== undefined;

  // ---- nombre
  const [title, setTitle] = useState(o.title);
  const [nameMsg, setNameMsg] = useState<Msg>(null);
  async function saveName() {
    setNameMsg(null);
    try {
      await window.api.renameOutput(o.id, title);
      await props.onChanged();
      setNameMsg({ ok: true, text: 'Nombre guardado.' });
    } catch (e) {
      setNameMsg({ ok: false, text: errMsg(e) });
    }
  }

  // ---- datos de YouTube (vídeos largos)
  const [description, setDescription] = useState(o.description ?? '');
  const [playlist, setPlaylist] = useState(o.playlist ?? '');
  const [visibility, setVisibility] = useState<Visibility>(o.visibility ?? 'private');
  const [ytMsg, setYtMsg] = useState<Msg>(null);
  async function saveYoutube() {
    setYtMsg(null);
    try {
      await window.api.updateOutputMeta(o.id, { title, description, playlist, visibility });
      await props.onChanged();
      setYtMsg({ ok: true, text: 'Datos guardados.' });
    } catch (e) {
      setYtMsg({ ok: false, text: errMsg(e) });
    }
  }
  const ytProblems = youtubeProblems({ title, description, playlist });

  // ---- miniatura (vídeos largos)
  const [thumbMsg, setThumbMsg] = useState<Msg>(null);
  async function thumbFromFrame() {
    setThumbMsg(null);
    try {
      await window.api.setThumbnailFromFrame(o.id, videoRef.current?.currentTime ?? 0);
      await props.onChanged();
      setThumbMsg({ ok: true, text: 'Miniatura actualizada con el fotograma actual.' });
    } catch (e) {
      setThumbMsg({ ok: false, text: errMsg(e) });
    }
  }
  async function thumbFromImage() {
    setThumbMsg(null);
    try {
      const r = await window.api.setThumbnailFromImage(o.id);
      if (r) {
        await props.onChanged();
        setThumbMsg({ ok: true, text: 'Miniatura actualizada con tu imagen.' });
      }
    } catch (e) {
      setThumbMsg({ ok: false, text: errMsg(e) });
    }
  }

  // ---- recorte y encuadre (clips)
  const [start, setStart] = useState(o.start === undefined ? '' : fmtTime(o.start));
  const [end, setEnd] = useState(o.end === undefined ? '' : fmtTime(o.end));
  const [cropX, setCropX] = useState(o.cropX ?? 0.5);
  const [framing, setFraming] = useState<FramingPreview | null>(null);
  const [editMsg, setEditMsg] = useState<Msg>(null);
  const [rendering, setRendering] = useState(false);
  const dragRef = useRef<HTMLDivElement>(null);

  async function showFraming() {
    setEditMsg(null);
    try {
      setFraming(await window.api.framingPreview(o.id));
    } catch (e) {
      setEditMsg({ ok: false, text: errMsg(e) });
    }
  }
  const cropFromPointer = (e: RPointerEvent) => {
    const box = dragRef.current?.getBoundingClientRect();
    if (!box || !framing) return;
    const frac = (framing.height * 9) / 16 / framing.width; // ancho del recuadro / ancho del fotograma
    const overlay = box.width * Math.min(1, frac);
    const free = box.width - overlay;
    if (free <= 0) return;
    setCropX(Math.min(1, Math.max(0, (e.clientX - box.left - overlay / 2) / free)));
  };

  async function applyEdit() {
    const s = parseTime(start);
    const e = parseTime(end);
    if (Number.isNaN(s) || Number.isNaN(e)) {
      setEditMsg({ ok: false, text: 'Escribe inicio y fin como 90, 1:30 o 1:02:03.' });
      return;
    }
    setRendering(true);
    setEditMsg(null);
    try {
      await window.api.reeditClip(o.id, { start: s, end: e, cropX });
      await props.onChanged();
      setEditMsg({ ok: true, text: 'Clip renderizado de nuevo y validado.' });
    } catch (err) {
      setEditMsg({ ok: false, text: errMsg(err) });
    } finally {
      setRendering(false);
    }
  }
  const pointToTime = (which: 'start' | 'end') => {
    if (o.start === undefined) return;
    const t = o.start + ((activeRef.current ?? videoRef.current)?.currentTime ?? 0);
    (which === 'start' ? setStart : setEnd)(fmtTime(Math.round(t * 10) / 10));
  };

  // ---- descargar una versión
  const [dlMsg, setDlMsg] = useState<Msg>(null);
  async function download(version: RenderKind) {
    setDlMsg(null);
    try {
      const dest = await window.api.exportOutput(o.id, version);
      if (dest) setDlMsg({ ok: true, text: `Guardado en ${dest}` });
    } catch (e) {
      setDlMsg({ ok: false, text: errMsg(e) });
    }
  }
  async function regenerate() {
    setRendering(true);
    setDlMsg(null);
    try {
      await window.api.reeditClip(o.id, {});
      await props.onChanged();
    } catch (e) {
      setDlMsg({ ok: false, text: errMsg(e) });
    } finally {
      setRendering(false);
    }
  }

  // ---- subtítulos
  const canSubtitle = o.vodId !== undefined && (isClip ? o.start !== undefined && o.end !== undefined : Boolean(o.segments?.length));
  const burned = o.subtitles !== undefined;
  const [subsOn, setSubsOn] = useState(burned);
  const [subsStyle, setSubsStyle] = useState<SubtitleStyleId>(o.subtitles ?? 'clasico');
  const [words, setWords] = useState<Word[]>([]);
  const [wordsLoaded, setWordsLoaded] = useState(false);
  const [subsMsg, setSubsMsg] = useState<Msg>(null);
  const [subsBusy, setSubsBusy] = useState(false);
  async function loadWords() {
    if (!o.vodId) return;
    try {
      setWords(await window.api.getTranscript(o.vodId));
    } catch {
      setWords([]);
    } finally {
      setWordsLoaded(true);
    }
  }
  useEffect(() => {
    void loadWords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.vodId]);
  const ranges = useMemo(
    () => (isClip ? keptRanges(o.start ?? 0, o.end ?? 0, o.cuts) : (o.segments ?? [])),
    [isClip, o.start, o.end, o.cuts, o.segments],
  );
  const outWords = useMemo(() => wordsForOutput(words, ranges), [words, ranges]);
  const hasWords = words.length > 0;
  /** La vista previa sobre el vídeo solo es posible si el archivo no lleva ya los subtítulos grabados. */
  const liveOverlay = subsOn && !burned && hasWords;
  const subsChanged = subsOn !== burned || (subsOn && subsStyle !== o.subtitles);
  async function subsImport() {
    if (!o.vodId) return;
    setSubsMsg(null);
    try {
      const r = await window.api.importTranscript(o.vodId);
      if (r) {
        await loadWords();
        await props.onChanged();
        setSubsMsg({ ok: true, text: `Transcripción importada (${r.transcript?.words ?? 0} palabras).` });
      }
    } catch (e) {
      setSubsMsg({ ok: false, text: errMsg(e) });
    }
  }
  async function subsTranscribe() {
    if (!o.vodId) return;
    setSubsMsg(null);
    setSubsBusy(true);
    try {
      const r = await window.api.transcribeVod(o.vodId);
      await loadWords();
      await props.onChanged();
      setSubsMsg({ ok: true, text: `Transcripción hecha (${r.transcript?.words ?? 0} palabras).` });
    } catch (e) {
      setSubsMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSubsBusy(false);
    }
  }
  async function subsApply() {
    setSubsMsg(null);
    setSubsBusy(true);
    try {
      await window.api.reeditClip(o.id, { subtitles: subsOn ? subsStyle : null });
      await props.onChanged();
      setSubsMsg({ ok: true, text: subsOn ? 'Subtítulos grabados en el vídeo.' : 'Subtítulos quitados.' });
    } catch (e) {
      setSubsMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSubsBusy(false);
    }
  }
  const captionsFor = (ref: typeof videoRef, size: { w: number; h: number }) =>
    liveOverlay ? <Captions videoRef={ref} words={outWords} style={SUBTITLE_STYLES[subsStyle]} renderSize={size} /> : undefined;

  // ---- programación
  const pubOf = (p: Platform) => props.pubs.find((x) => x.platform === p);
  const [edits, setEdits] = useState<Partial<Record<Platform, { on: boolean; when: string }>>>({});
  const [schedMsg, setSchedMsg] = useState<Msg>(null);
  const rowState = (p: Platform) => {
    const pub = pubOf(p);
    const locked = pub?.status === 'published' || pub?.status === 'publishing';
    const base = { on: Boolean(pub), when: pub ? toLocalInputValue(new Date(pub.scheduledAt)) : defaultLocalDateTime() };
    return { pub, locked, ...base, ...edits[p] };
  };
  const patchRow = (p: Platform, patch: { on?: boolean; when?: string }) =>
    setEdits((cur) => ({ ...cur, [p]: { on: rowState(p).on, when: rowState(p).when, ...patch } }));

  async function saveSchedule() {
    setSchedMsg(null);
    const entries: { platform: Platform; atIso: string }[] = [];
    for (const { id } of ownPlatforms) {
      const r = rowState(id);
      if (r.locked || !r.on) continue;
      const iso = localInputToIso(r.when);
      if (!iso) {
        setSchedMsg({ ok: false, text: 'Fecha y hora no válidas.' });
        return;
      }
      entries.push({ platform: id, atIso: iso });
    }
    try {
      const r = await window.api.setSchedule(o.id, entries);
      setEdits({});
      await props.onChanged();
      setSchedMsg(
        r.skipped.length
          ? { ok: false, text: r.skipped.map((s) => `${s.platform}: ${s.reason}`).join('. ') }
          : { ok: true, text: `${entries.length ? 'Programación guardada.' : 'No hay nada programado.'}${r.warnings?.length ? `\nAviso: ${r.warnings.join(' ')}` : ''}` },
      );
    } catch (e) {
      setSchedMsg({ ok: false, text: errMsg(e) });
    }
  }

  // El reproductor se detiene al cerrar la ventana (el elemento desaparece) y se recarga si el archivo cambia.
  const frac = framing ? Math.min(1, (framing.height * 9) / 16 / framing.width) : 1;

  return (
    <Modal title={o.title} onClose={props.onClose} wide>
      <div className={`itemgrid ${isClip ? 'clipgrid' : ''}`}>
        <div className="playercol">
          {isClip ? (
            <div className="versions">
              {(['horizontal', 'vertical'] as const).map((v) => {
                const file = o.files[v];
                const label = v === 'vertical' ? 'Vertical 1080×1920' : 'Horizontal 1920×1080';
                return (
                  <div key={v} className={`version ${v}`} data-testid={`version-${v}`}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="small muted">{label}</span>
                      {file && (
                        <button className="btn ghost small" aria-label={`Descargar versión ${v}`} onClick={() => void download(v)}>
                          <IconDownload size={14} /> Descargar
                        </button>
                      )}
                    </div>
                    {file ? (
                      <Player
                        videoRef={v === 'vertical' ? verticalRef : videoRef}
                        vertical={v === 'vertical'}
                        label={`Reproductor ${v}`}
                        onActivate={(el) => (activeRef.current = el)}
                        src={mediaUrl(o.id, v, file)}
                        poster={v === 'horizontal' && o.thumbnail ? mediaUrl(o.id, 'thumb', o.thumbnail) : undefined}
                        overlay={captionsFor(v === 'vertical' ? verticalRef : videoRef, v === 'vertical' ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 })}
                      />
                    ) : (
                      <div className="missing">
                        <span className="muted small">Esta versión no está disponible.</span>
                        {canReedit && <button className="btn small" disabled={rendering} onClick={() => void regenerate()}>Generar versión {v}</button>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">Horizontal 1920×1080</span>
                <button className="btn ghost small" aria-label="Descargar vídeo" onClick={() => void download('long')}>
                  <IconDownload size={14} /> Descargar
                </button>
              </div>
              <Player
                videoRef={videoRef}
                label="Reproductor"
                src={mediaUrl(o.id, 'long', o.files.long ?? '')}
                poster={o.thumbnail ? mediaUrl(o.id, 'thumb', o.thumbnail) : undefined}
                overlay={captionsFor(videoRef, { w: 1920, h: 1080 })}
              />
            </>
          )}
          <div className="muted small">
            <span className="badge">{isClip ? 'Clip' : 'Vídeo largo'}</span> {fmtTime(o.durationSec)} · {fmtDate(o.createdAt)}
          </div>
          <Notice msg={dlMsg} />
          {o.kind === 'long' && (
            <section aria-label="Miniatura">
              <h3>Miniatura</h3>
              {o.thumbnail && <img className="thumbpreview" alt="Miniatura actual" src={mediaUrl(o.id, 'thumb', o.thumbnail)} />}
              <div className="row">
                <button className="btn small" onClick={() => void thumbFromFrame()}>Usar el fotograma actual del vídeo</button>
                <button className="btn ghost small" onClick={() => void thumbFromImage()}>Elegir una imagen…</button>
              </div>
              <Notice msg={thumbMsg} />
            </section>
          )}
        </div>

        <div className="formcol">
          {o.kind === 'long' ? (
            <section aria-label="Datos de YouTube">
              <h3>Datos de YouTube</h3>
              <form
                className="ytform"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveYoutube();
                }}
              >
                <div className="field">
                  <label htmlFor="yt-title">Nombre</label>
                  <input id="yt-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                  <span className="muted small">{title.length} / {YT_TITLE_MAX}</span>
                </div>
                <div className="field">
                  <label htmlFor="yt-desc">Descripción</label>
                  <textarea id="yt-desc" value={description} onChange={(e) => setDescription(e.target.value)} style={{ minHeight: 110, fontFamily: 'inherit', fontSize: 13 }} />
                  <span className="muted small">{description.length} / {YT_DESC_MAX}</span>
                </div>
                <div className="field">
                  <label htmlFor="yt-playlist">Lista de reproducción (opcional)</label>
                  <input id="yt-playlist" type="text" list="yt-playlists" value={playlist} maxLength={YT_PLAYLIST_MAX} placeholder="Sin lista" onChange={(e) => setPlaylist(e.target.value)} />
                  <datalist id="yt-playlists">
                    {props.playlists.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <fieldset className="kinds">
                  <legend className="muted small">Visibilidad</legend>
                  <label className="check"><input type="radio" name="vis" checked={visibility === 'private'} onChange={() => setVisibility('private')} /> Privado (solo tú lo ves)</label>
                  <label className="check"><input type="radio" name="vis" checked={visibility === 'public'} onChange={() => setVisibility('public')} /> Público (cualquiera lo puede ver)</label>
                </fieldset>
                {ytProblems.map((p) => <div key={p} className="msg small bad" role="note">{p}</div>)}
                <div className="row">
                  <button type="submit" className="btn small">Guardar datos</button>
                </div>
              </form>
              <Notice msg={ytMsg} />
            </section>
          ) : (
                      <section aria-label="Nombre">
            <h3>Nombre</h3>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
            >
              <input type="text" aria-label="Nombre del vídeo" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn small" disabled={!title.trim() || title === o.title}>Guardar nombre</button>
            </form>
            <Notice msg={nameMsg} />
          </section>
          )}

          {o.kind !== 'long' && (
            <section aria-label="Recorte y encuadre">
              <h3>Encuadre y recorte</h3>
              {!canReedit ? (
                <div className="muted small">Este clip es anterior a la Biblioteca y no guarda de qué parte del VOD sale, así que no se puede reeditar.</div>
              ) : (
                <>
                  <div className="row">
                    <label className="small muted" htmlFor="ed-start">Inicio</label>
                    <input id="ed-start" type="text" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 90 }} />
                    <button className="btn ghost small" onClick={() => pointToTime('start')}>= punto actual</button>
                    <label className="small muted" htmlFor="ed-end">Fin</label>
                    <input id="ed-end" type="text" value={end} onChange={(e) => setEnd(e.target.value)} style={{ width: 90 }} />
                    <button className="btn ghost small" onClick={() => pointToTime('end')}>= punto actual</button>
                  </div>
                  <div className="muted small">Tiempos del VOD original. «= punto actual» usa el instante que muestra el reproductor.</div>
                  {isClip && (
                    <>
                      <div className="row">
                        <label className="small muted" htmlFor="ed-crop">Encuadre (de izquierda a derecha)</label>
                        <input id="ed-crop" type="range" min={0} max={1} step={0.01} value={cropX} onChange={(e) => setCropX(Number(e.target.value))} style={{ flex: 1 }} />
                        {!framing && <button className="btn ghost small" onClick={() => void showFraming()}>Ver sobre el fotograma</button>}
                      </div>
                      {framing && (
                        <div
                          ref={dragRef}
                          className="framing"
                          data-testid="framing"
                          style={{ aspectRatio: `${framing.width} / ${framing.height}` }}
                          onPointerDown={(e) => {
                            e.currentTarget.setPointerCapture(e.pointerId);
                            cropFromPointer(e);
                          }}
                          onPointerMove={(e) => e.buttons === 1 && cropFromPointer(e)}
                        >
                          <img src={framing.dataUrl} alt="Fotograma del VOD" draggable={false} />
                          <div className="crop" data-testid="crop-window" style={{ width: `${frac * 100}%`, left: `${(1 - frac) * cropX * 100}%` }} />
                        </div>
                      )}
                    </>
                  )}
                  <div className="row">
                    <button className="btn small" disabled={rendering} onClick={() => void applyEdit()}>Aplicar y renderizar de nuevo</button>
                    {rendering && <span className="muted small" role="status">Renderizando…</span>}
                  </div>
                </>
              )}
              <Notice msg={editMsg} />
            </section>
          )}

          <section aria-label="Subtítulos">
            <h3>Subtítulos</h3>
            {!canSubtitle ? (
              <div className="muted small">Este vídeo no guarda de qué parte del VOD sale, así que no se le pueden añadir subtítulos.</div>
            ) : (
              <>
                <label className="switch">
                  <input type="checkbox" role="switch" aria-label="Poner subtítulos" checked={subsOn} onChange={(e) => setSubsOn(e.target.checked)} />
                  Poner subtítulos en todo el vídeo
                </label>
                {!subsOn && <div className="muted small">Desactivados. Al activarlos podrás elegir el estilo y verlo sobre el vídeo en directo.</div>}
                {subsOn && (
                  <>
                    <div className="stylegrid" role="radiogroup" aria-label="Estilo de subtítulos">
                      {SUBTITLE_STYLE_IDS.map((id) => (
                        <button key={id} type="button" role="radio" aria-checked={subsStyle === id} className="styleopt" data-testid={`style-${id}`} onClick={() => setSubsStyle(id)}>
                          <strong>{SUBTITLE_STYLES[id].label}</strong>
                          <span>{SUBTITLES_HELP[id]}</span>
                        </button>
                      ))}
                    </div>
                    <SampleCaptions style={SUBTITLE_STYLES[subsStyle]} />
                    {burned && (
                      <div className="muted small">
                        Este vídeo ya lleva los subtítulos «{SUBTITLE_STYLES[o.subtitles!].label}» grabados, así que aquí no se puede superponer otra vista previa: compara con el ejemplo de arriba y pulsa «Aplicar» para volver a montarlo.
                      </div>
                    )}
                    {liveOverlay && <div className="muted small">La vista previa sobre el vídeo usa el mismo reparto de frases y medidas que el resultado final.</div>}
                    {wordsLoaded && !hasWords && (
                      <div className="msg small warn" role="note">
                        Este VOD no tiene transcripción, y sin ella no hay nada que subtitular. Impórtala (JSON, SRT o VTT) o transcríbela con Whisper si lo has configurado en Ajustes.
                      </div>
                    )}
                    {hasWords && outWords.length === 0 && <div className="msg small warn" role="note">La transcripción no tiene ninguna palabra dentro de este tramo.</div>}
                    <div className="row">
                      <button type="button" className="btn ghost small" onClick={() => void subsImport()}>{hasWords ? 'Cambiar transcripción…' : 'Importar transcripción…'}</button>
                      <button type="button" className="btn ghost small" disabled={subsBusy} onClick={() => void subsTranscribe()}>Transcribir con Whisper</button>
                    </div>
                  </>
                )}
                <div className="row">
                  <button type="button" className="btn small" disabled={subsBusy || !subsChanged || (subsOn && outWords.length === 0)} onClick={() => void subsApply()}>
                    {subsOn ? 'Aplicar subtítulos' : 'Quitar subtítulos'}
                  </button>
                  {subsBusy && <span className="muted small" role="status">Trabajando… puede tardar varios minutos.</span>}
                </div>
              </>
            )}
            <Notice msg={subsMsg} />
          </section>

          <section aria-label="Publicación">
            <h3>Cuándo se sube y dónde</h3>
            {o.kind === 'long' && <div className="muted small">{VIDEO_ONLY_YOUTUBE}</div>}
            {ownPlatforms.map(({ id, label }) => {
              const r = rowState(id);
              return (
                <div key={id} className="row pubrow" data-testid={`pub-${id}`}>
                  <label className="check" style={{ width: 110 }}>
                    <input type="checkbox" checked={r.on} disabled={r.locked} onChange={(e) => patchRow(id, { on: e.target.checked })} /> {label}
                  </label>
                  <input type="datetime-local" aria-label={`Fecha y hora en ${label}`} value={r.when} disabled={r.locked || !r.on} onChange={(e) => patchRow(id, { when: e.target.value })} style={{ width: 200 }} />
                  {r.pub && <span className={`badge ${PUB_STATUS[r.pub.status].cls}`}>{PUB_STATUS[r.pub.status].label}</span>}
                  {r.pub?.note && <span className="muted small">{r.pub.note}</span>}
                </div>
              );
            })}
            <div className="row">
              <button className="btn small" onClick={() => void saveSchedule()}>Guardar programación</button>
            </div>
            <div className="muted small">Desmarcar una red quita su programación pendiente. Lo ya publicado no se puede cambiar.</div>
            <Notice msg={schedMsg} />
          </section>

          <section aria-label="Eliminar">
            <h3>Eliminar</h3>
            <div className="muted small">Borra este vídeo del disco con todas sus versiones. El VOD de origen no se toca. Te pediremos confirmación.</div>
            <div className="row"><button className="btn danger small" onClick={props.onDelete}><IconTrash /> Eliminar este vídeo…</button></div>
          </section>
        </div>
      </div>
    </Modal>
  );
}

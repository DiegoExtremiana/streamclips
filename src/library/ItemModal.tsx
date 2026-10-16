import { useEffect, useMemo, useRef, useState } from 'react';
import { platformsFor, VIDEO_ONLY_YOUTUBE } from '../../shared/types';
import type { FramingPreview, OutputItem, Platform, Publication, RenderKind, Visibility, WhisperStatus } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { defaultLocalDateTime, fmtDate, fmtTime, localInputToIso, toLocalInputValue } from '../../shared/time';
import { errMsg } from '../lib';
import { YT_DESC_MAX, YT_PLAYLIST_MAX, YT_TITLE_MAX, youtubeProblems } from '../../shared/youtube';
import { IconDownload, IconTrash } from '../icons';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS, wordsForOutput, type SubtitleStyleId, type Word } from '../../shared/subtitles';
import { keptRanges } from '../../shared/timeline';
import { round1, type TrimRange } from '../../shared/trim';
import Captions, { SampleCaptions } from './Captions';
import Player from './Player';
import ClipStudio from './ClipStudio';
import { PlatformSwitch } from './PlatformSwitch';
import VerticalEditor from './VerticalEditor';
import { layoutFromCropX, normalizeLayout, type VerticalLayout } from '../../shared/layout';
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
  const isClip = o.kind === 'clip';
  const ownPlatforms = PLATFORMS.filter((p) => platformsFor(o.kind).includes(p.id));
  const canReedit = isClip && o.vodId !== undefined && o.start !== undefined && o.end !== undefined;

  const [title, setTitle] = useState(o.title);

  // ---- nombre, descripción y visibilidad (vídeos y clips)
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
  const [titleBusy, setTitleBusy] = useState(false);
  async function suggestTitle() {
    if (!o.vodId || o.start === undefined || o.end === undefined) return;
    setTitleBusy(true);
    setYtMsg(null);
    try {
      const r = await window.api.suggestTitle(o.vodId, o.start, o.end);
      if (r) setTitle(r.title.slice(0, YT_TITLE_MAX));
      else setYtMsg({ ok: false, text: 'No hay transcripción de este tramo, así que no se sabe de qué se habla. Transcribe el directo (en Subtítulos) y vuelve a probar.' });
    } catch (e) {
      setYtMsg({ ok: false, text: errMsg(e) });
    } finally {
      setTitleBusy(false);
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
  const [range, setRange] = useState<TrimRange>({ start: o.start ?? 0, end: o.end ?? 0 });
  const [vodDuration, setVodDuration] = useState<number | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  useEffect(() => {
    if (!canReedit) return;
    let alive = true;
    window.api.clipContext(o.id).then((c) => alive && setVodDuration(c.vodDurationSec)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [o.id, canReedit]);
  // si el clip se vuelve a renderizar con otro recorte, la línea sigue lo guardado
  useEffect(() => {
    if (o.start !== undefined && o.end !== undefined) setRange({ start: o.start, end: o.end });
  }, [o.start, o.end]);
  const [framing, setFraming] = useState<FramingPreview | null>(null);
  const [layoutDraft, setLayoutDraft] = useState<VerticalLayout | null>(null);
  const [editMsg, setEditMsg] = useState<Msg>(null);
  const [rendering, setRendering] = useState(false);

  // el fotograma se carga al abrir la pestaña Vertical (hace falta para colocar las ventanas)
  useEffect(() => {
    if (!designOpen || !canReedit || framing) return;
    let alive = true;
    window.api
      .framingPreview(o.id)
      .then((f) => alive && setFraming(f))
      .catch((e) => alive && setEditMsg({ ok: false, text: errMsg(e) }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designOpen, o.id]);
  // lo guardado (la composición, o el encuadre simple de antes como una sola ventana) y el borrador que se edita
  const savedLayout = useMemo(() => (framing ? (o.layout ?? layoutFromCropX(o.cropX ?? 0.5, framing.width / framing.height)) : null), [framing, o.layout, o.cropX]);
  useEffect(() => {
    if (savedLayout) setLayoutDraft(savedLayout);
  }, [savedLayout]);
  const layoutDirty = Boolean(layoutDraft && savedLayout && JSON.stringify(normalizeLayout(layoutDraft)) !== JSON.stringify(normalizeLayout(savedLayout)));

  async function applyEdit() {
    const dirtyRange = o.start === undefined || o.end === undefined || Math.abs(range.start - o.start) > 0.04 || Math.abs(range.end - o.end) > 0.04;
    setRendering(true);
    setEditMsg(null);
    try {
      await window.api.reeditClip(o.id, {
        ...(dirtyRange ? { start: round1(range.start), end: round1(range.end) } : {}),
        ...(layoutDirty && layoutDraft ? { layout: normalizeLayout(layoutDraft) } : {}),
      });
      await props.onChanged();
      setEditMsg({ ok: true, text: 'Clip renderizado de nuevo y validado.' });
    } catch (err) {
      setEditMsg({ ok: false, text: errMsg(err) });
    } finally {
      setRendering(false);
    }
  }

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
  const [whisper, setWhisper] = useState<WhisperStatus | null>(null);
  useEffect(() => {
    if (canSubtitle) void window.api.whisperStatus().then(setWhisper).catch(() => undefined);
  }, [canSubtitle]);
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
  /** Un solo paso: transcribe el directo (si hace falta, descargando antes el modelo) y graba los subtítulos. */
  async function subsGenerate() {
    if (!o.vodId) return;
    setSubsMsg(null);
    setSubsBusy(true);
    try {
      if (!hasWords) {
        await window.api.transcribeVod(o.vodId);
        await loadWords();
      }
      await window.api.reeditClip(o.id, { subtitles: subsStyle });
      await props.onChanged();
      setSubsMsg({ ok: true, text: 'Subtítulos grabados en el vídeo.' });
    } catch (e) {
      setSubsMsg({ ok: false, text: errMsg(e) });
    } finally {
      setSubsBusy(false);
      void window.api.whisperStatus().then(setWhisper).catch(() => undefined);
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

  return (
    <Modal title={o.title} onClose={props.onClose} wide>
      {isClip && !o.remote && (
        <ClipStudio
          output={o}
          hRef={videoRef}
          vRef={verticalRef}
          hSrc={o.files.horizontal ? mediaUrl(o.id, 'horizontal', o.files.horizontal) : undefined}
          vSrc={o.files.vertical ? mediaUrl(o.id, 'vertical', o.files.vertical) : undefined}
          poster={o.thumbnail ? mediaUrl(o.id, 'thumb', o.thumbnail) : undefined}
          hOverlay={captionsFor(videoRef, { w: 1920, h: 1080 })}
          vOverlay={captionsFor(verticalRef, { w: 1080, h: 1920 })}
          range={range}
          onRange={setRange}
          vodDuration={vodDuration}
          canReedit={canReedit}
          rendering={rendering}
          designOpen={designOpen}
          onToggleDesign={() => setDesignOpen((x) => !x)}
          onApply={() => void applyEdit()}
          onDownload={(v) => void download(v)}
          onRegenerate={() => void regenerate()}
          notice={!designOpen ? <Notice msg={editMsg} /> : undefined}
        />
      )}
      {isClip && !o.remote && designOpen && (
        <section className="vsection" aria-label="Composición vertical">
          <h3>Diseño de la versión vertical</h3>
          {!canReedit ? (
            <div className="muted small">Este clip es anterior a la Biblioteca y no guarda de qué parte del VOD sale, así que no se puede recomponer.</div>
          ) : !framing || !layoutDraft ? (
            <div className="muted small" role="status">{editMsg && !editMsg.ok ? editMsg.text : 'Cargando el fotograma…'}</div>
          ) : (
            <>
              <VerticalEditor
                framing={framing}
                videoUrl={o.files.horizontal ? mediaUrl(o.id, 'horizontal', o.files.horizontal) : undefined}
                sharedVideo={o.files.horizontal ? videoRef : undefined}
                layout={layoutDraft}
                onChange={setLayoutDraft}
              />
              <div className="row">
                <button className="btn small" disabled={rendering || !layoutDirty} onClick={() => void applyEdit()}>Guardar composición</button>
                <button className="btn ghost small" disabled={rendering || !layoutDirty} onClick={() => savedLayout && setLayoutDraft(savedLayout)}>Descartar cambios</button>
                {layoutDirty && !rendering && <span className="muted small">Hay cambios sin guardar.</span>}
                {rendering && <span className="muted small" role="status">Renderizando…</span>}
              </div>
              <Notice msg={editMsg} />
            </>
          )}
        </section>
      )}
      <div className={`itemgrid ${isClip ? 'clipgrid' : ''}`}>
        <div className="playercol">
          {o.remote ? (
            <div className="msg small" role="note">
              Este vídeo está en la nube (lo creó el motor nocturno), así que aquí no hay vista previa ni edición de imagen. Puedes cambiar su nombre, descripción, redes y hora; se aplican en la nube.
            </div>
          ) : (
            <>
          {isClip ? null : (
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
            </>
          )}
        </div>

        <div className="formcol">
          {(
            <section aria-label="Datos de la publicación">
              <h3>{o.kind === 'long' ? 'Datos de YouTube' : 'Datos de la publicación'}</h3>
              <form
                className="ytform"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveYoutube();
                }}
              >
                <div className="field">
                  <label htmlFor="yt-title">Nombre</label>
                  <div className="row" style={{ gap: 8 }}>
                    <input id="yt-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
                    {o.vodId && o.start !== undefined && o.end !== undefined && !o.remote && (
                      <button type="button" className="btn ghost small" disabled={titleBusy} onClick={() => void suggestTitle()} title="Pone un título según lo que se dice en este tramo">
                        {titleBusy ? 'Pensando…' : 'Sugerir título'}
                      </button>
                    )}
                  </div>
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
          )}

          {!o.remote && (
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
                      <div className="msg small warn" role="note" data-testid="subs-needs-transcript">
                        <strong>Este directo todavía no está transcrito.</strong> Para poner subtítulos hace falta saber qué se dice.{' '}
                        {whisper?.engine === false
                          ? 'En esta instalación no se encuentra Whisper (el motor de transcripción): importa una transcripción (JSON, SRT o VTT) o indica la ruta de whisper-cli en Ajustes.'
                          : whisper && !whisper.modelInstalled
                            ? `Se transcribirá aquí mismo, en tu ordenador y gratis. La primera vez descarga el modelo «${whisper.model}» (${whisper.modelApproxMb} MB) y puede tardar; después ya queda guardado.`
                            : 'Se transcribirá aquí mismo, en tu ordenador y gratis. Puede tardar varios minutos en un directo largo.'}
                      </div>
                    )}
                    {hasWords && outWords.length === 0 && <div className="msg small warn" role="note">La transcripción no tiene ninguna palabra dentro de este tramo.</div>}
                    <div className="row">
                      <button type="button" className="btn ghost small" onClick={() => void subsImport()}>{hasWords ? 'Cambiar transcripción…' : 'Importar transcripción…'}</button>
                      <button type="button" className="btn ghost small" disabled={subsBusy || whisper?.engine === false} onClick={() => void subsTranscribe()}>Solo transcribir</button>
                    </div>
                  </>
                )}
                <div className="row">
                  {subsOn && wordsLoaded && !hasWords ? (
                    <button type="button" className="btn small" data-testid="subs-generate" disabled={subsBusy || whisper?.engine === false} onClick={() => void subsGenerate()}>
                      Transcribir y poner subtítulos
                    </button>
                  ) : (
                    <button type="button" className="btn small" disabled={subsBusy || !subsChanged || (subsOn && outWords.length === 0)} onClick={() => void subsApply()}>
                      {subsOn ? 'Aplicar subtítulos' : 'Quitar subtítulos'}
                    </button>
                  )}
                  {subsBusy && <span className="muted small" role="status">Trabajando… puede tardar varios minutos.</span>}
                </div>
              </>
            )}
            <Notice msg={subsMsg} />
          </section>
          )}

          <section aria-label="Publicación">
            <h3>Cuándo se sube y dónde</h3>
            {o.kind === 'long' && <div className="muted small">{VIDEO_ONLY_YOUTUBE}</div>}
            {ownPlatforms.map(({ id, label }) => {
              const r = rowState(id);
              return (
                <div key={id} className="row pubrow" data-testid={`pub-${id}`}>
                  <span style={{ width: 150 }}><PlatformSwitch id={id} label={label} checked={r.on} disabled={r.locked} onChange={(on) => patchRow(id, { on })} /></span>
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

import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { OutputItem, RenderKind } from '../../shared/types';
import { fmtTenths, round1, type TrimRange } from '../../shared/trim';
import { parseTime } from '../../shared/time';
import { IconCrop, IconDownload, IconMute, IconPause, IconPlay, IconRestart, IconVolume } from '../icons';
import ClipTimeline from './ClipTimeline';
import Player from './Player';
import { LivePreview, WindowsOverlay, type DesignState } from './DesignOverlay';

/**
 * Editor de clips al estilo del de Twitch: la versión horizontal y la vertical lado a lado, una sola barra de reproducción
 * para las dos (con sonido), y debajo la línea de tiempo con el recorte morado para arrastrar.
 */
export default function ClipStudio(props: {
  output: OutputItem;
  hRef: RefObject<HTMLVideoElement>;
  vRef: RefObject<HTMLVideoElement>;
  hSrc?: string;
  vSrc?: string;
  poster?: string;
  hOverlay?: ReactNode;
  vOverlay?: ReactNode;
  range: TrimRange;
  onRange: (r: TrimRange) => void;
  vodDuration: number | null;
  canReedit: boolean;
  rendering: boolean;
  designOpen: boolean;
  /** Con el diseño abierto: las ventanas se dibujan sobre la versión horizontal y la vertical se compone en directo. */
  design?: DesignState | null;
  onToggleDesign: () => void;
  onApply: () => void;
  onDownload: (v: RenderKind) => void;
  onRegenerate: () => void;
  notice?: ReactNode;
}) {
  const { output: o, hRef, vRef } = props;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [text, setText] = useState({ start: fmtTenths(props.range.start), end: fmtTenths(props.range.end) });
  const [hint, setHint] = useState<string | null>(null);
  const [selWin, setSelWin] = useState(0);
  const designing = Boolean(props.designOpen && props.design);

  // los campos de texto siguen a los agarres de la línea
  useEffect(() => {
    setText({ start: fmtTenths(props.range.start), end: fmtTenths(props.range.end) });
  }, [props.range.start, props.range.end]);

  const dirty = o.start !== undefined && o.end !== undefined && (Math.abs(props.range.start - o.start) > 0.04 || Math.abs(props.range.end - o.end) > 0.04);

  // un solo reproductor manda (el horizontal, con sonido); la vertical lo sigue
  useEffect(() => {
    const h = hRef.current;
    if (!h) return;
    const v = () => vRef.current;
    const sync = () => {
      setPlaying(!h.paused && !h.ended);
      setTime(h.currentTime);
      setDuration(Number.isFinite(h.duration) ? h.duration : 0);
      setMuted(h.muted);
    };
    const follow = () => {
      const x = v();
      if (x && Math.abs(x.currentTime - h.currentTime) > 0.25) x.currentTime = h.currentTime;
    };
    const onPlay = () => void v()?.play().catch(() => undefined);
    const onPause = () => v()?.pause();
    const onSeeked = () => {
      const x = v();
      if (x) x.currentTime = h.currentTime;
    };
    const evs = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'volumechange'];
    evs.forEach((e) => h.addEventListener(e, sync));
    h.addEventListener('timeupdate', follow);
    h.addEventListener('play', onPlay);
    h.addEventListener('pause', onPause);
    h.addEventListener('seeked', onSeeked);
    sync();
    return () => {
      evs.forEach((e) => h.removeEventListener(e, sync));
      h.removeEventListener('timeupdate', follow);
      h.removeEventListener('play', onPlay);
      h.removeEventListener('pause', onPause);
      h.removeEventListener('seeked', onSeeked);
    };
  }, [hRef, vRef, props.hSrc]);

  const toggle = () => {
    const h = hRef.current;
    if (!h) return;
    if (h.paused) void h.play().catch(() => undefined);
    else h.pause();
  };
  const seek = (t: number) => {
    const h = hRef.current;
    if (h) h.currentTime = Math.max(0, Math.min(t, h.duration || t));
  };

  const setField = (which: 'start' | 'end', value: string) => {
    setText((t) => ({ ...t, [which]: value }));
    const n = parseTime(value);
    if (Number.isNaN(n)) return;
    const { start, end } = props.range;
    const next = which === 'start' ? { start: round1(n), end } : { start, end: round1(n) };
    if (next.end - next.start >= 1 && next.end - next.start <= 180 && next.start >= 0 && (!props.vodDuration || next.end <= props.vodDuration)) props.onRange(next);
  };

  const missing = (v: 'horizontal' | 'vertical') => (
    <div className="missing">
      <span className="muted small">Esta versión no está disponible.</span>
      {props.canReedit && <button className="btn small" disabled={props.rendering} onClick={props.onRegenerate}>Generar versión {v}</button>}
    </div>
  );

  return (
    <section className={`studio ${designing ? 'designing' : ''}`} aria-label="Editar clip" data-testid="clip-studio">
      <div className="studio-views">
        <div className="studio-col h" data-testid="version-horizontal">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong className="small">Versión horizontal</strong>
            {props.hSrc && <button className="btn ghost small" aria-label="Descargar versión horizontal" onClick={() => props.onDownload('horizontal')}><IconDownload size={14} /> Descargar</button>}
          </div>
          {props.hSrc ? (
            <Player videoRef={hRef} bare label="Reproductor horizontal" src={props.hSrc} poster={props.poster} overlay={<>{props.hOverlay}{designing && props.design && <WindowsOverlay design={props.design} selected={selWin} onSelect={setSelWin} />}</>} />
          ) : missing('horizontal')}
        </div>
        <div className="studio-col v" data-testid="version-vertical">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong className="small">Versión vertical</strong>
            {props.vSrc && <button className="btn ghost small" aria-label="Descargar versión vertical" onClick={() => props.onDownload('vertical')}><IconDownload size={14} /> Descargar</button>}
          </div>
          {designing && props.design ? (
            <div className="playerbox vertical"><LivePreview design={props.design} video={hRef} selected={selWin} onSelect={setSelWin} /></div>
          ) : props.vSrc ? (
            <Player videoRef={vRef} bare silent vertical label="Reproductor vertical" src={props.vSrc} overlay={props.vOverlay} />
          ) : missing('vertical')}
          <button type="button" className="btn ghost studio-design" aria-expanded={props.designOpen} disabled={!props.canReedit} onClick={props.onToggleDesign} title={props.canReedit ? undefined : 'Este clip no guarda de qué parte del VOD sale'}>
            <IconCrop size={16} /> {props.designOpen ? 'Ocultar el diseño' : 'Editar diseño'}
          </button>
        </div>
      </div>

      {props.hSrc && (
        <div className="studio-bar" role="group" aria-label="Reproducción">
          <button className="iconbtn" aria-label="Volver al inicio" title="Volver al inicio" onClick={() => { seek(0); void hRef.current?.play().catch(() => undefined); }}><IconRestart /></button>
          <button className="iconbtn" aria-label={playing ? 'Pausa' : 'Reproducir'} title={playing ? 'Pausa' : 'Reproducir'} data-testid="studio-play" onClick={toggle}>{playing ? <IconPause /> : <IconPlay />}</button>
          <button className="iconbtn" aria-label={muted ? 'Activar sonido' : 'Silenciar'} title={muted ? 'Activar sonido' : 'Silenciar'} data-testid="studio-mute" onClick={() => { if (hRef.current) hRef.current.muted = !hRef.current.muted; }}>
            {muted ? <IconMute /> : <IconVolume />}
          </button>
          <input type="range" aria-label="Posición del vídeo" min={0} max={duration || 0} step={0.05} value={Math.min(time, duration || 0)} onChange={(e) => seek(Number(e.target.value))} style={{ flex: 1 }} />
          <span className="small muted time" aria-label="Tiempo">{fmtTenths(time)} / {fmtTenths(duration)}</span>
        </div>
      )}

      {props.canReedit && (
        <div className="studio-trim">
          <ClipTimeline
            range={props.range}
            vodDuration={props.vodDuration}
            playhead={o.start !== undefined && props.hSrc ? o.start + time : null}
            disabled={props.rendering}
            onChange={props.onRange}
            onSeek={(t) => {
              if (o.start !== undefined && o.end !== undefined && t >= o.start && t <= o.end) {
                setHint(null);
                seek(t - o.start);
              } else setHint('Esa parte aún no está en el vídeo: aplica el recorte para verla.');
            }}
            onScrub={(t) => {
              // al arrastrar un agarre se ve el fotograma de ese punto (hasta donde llega lo ya renderizado)
              if (o.start !== undefined && o.end !== undefined) seek(Math.min(o.end, Math.max(o.start, t)) - o.start);
            }}
          />
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="small muted" htmlFor="ed-start">Inicio</label>
            <input id="ed-start" type="text" value={text.start} onChange={(e) => setField('start', e.target.value)} style={{ width: 90 }} />
            <label className="small muted" htmlFor="ed-end">Fin</label>
            <input id="ed-end" type="text" value={text.end} onChange={(e) => setField('end', e.target.value)} style={{ width: 90 }} />
            <button className="btn small" disabled={props.rendering || !dirty} onClick={props.onApply}>Aplicar recorte</button>
            {dirty && !props.rendering && <span className="muted small">Hay un recorte sin aplicar: el vídeo de arriba se actualiza al aplicarlo.</span>}
            {props.rendering && <span className="muted small" role="status">Renderizando…</span>}
          </div>
          {hint && <div className="muted small" role="status">{hint}</div>}
        </div>
      )}
      {!props.canReedit && <div className="muted small">Este clip es anterior a la Biblioteca y no guarda de qué parte del VOD sale, así que no se puede recortar ni recomponer.</div>}
      {props.notice}
    </section>
  );
}

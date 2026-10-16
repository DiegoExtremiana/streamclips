import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import type { FramingPreview } from '../../shared/types';
import {
  applyPresetKeeping, defaultPreset, layoutFromPreset, moveSrc, presetsFor, resizeFromCorner, resizeSrc,
  OUT_H, OUT_W, type Rect, type VerticalLayout,
} from '../../shared/layout';
import { fmtTime } from '../../shared/time';
import { IconMute, IconPause, IconPlay, IconVolume } from '../icons';

const COLORS = ['#ff4fa3', '#22d3ee', '#facc15'];
const PREVIEW_W = 270;
const PREVIEW_H = 480;

/** Dibuja en el lienzo lo mismo que hará ffmpeg: cada ventana llena su hueco sin deformar (escala hasta cubrir y recorta el sobrante). */
export function drawComposition(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number, layout: VerticalLayout) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
  for (const w of layout.windows) {
    const dx = w.dst.x * PREVIEW_W, dy = w.dst.y * PREVIEW_H, dw = w.dst.w * PREVIEW_W, dh = w.dst.h * PREVIEW_H;
    let sx = w.src.x * sw, sy = w.src.y * sh, cw = w.src.w * sw, ch = w.src.h * sh;
    const srcAspect = cw / ch, dstAspect = dw / dh;
    if (srcAspect > dstAspect) {
      const nw = ch * dstAspect;
      sx += (cw - nw) / 2;
      cw = nw;
    } else {
      const nh = cw / dstAspect;
      sy += (ch - nh) / 2;
      ch = nh;
    }
    ctx.drawImage(source, sx, sy, cw, ch, dx, dy, dw, dh);
  }
}

type Drag = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; src: Rect };

/**
 * Editor de la composición vertical: eliges 1, 2 o 3 ventanas y una disposición, y arrastras los recuadros sobre el
 * fotograma (o el vídeo, que se puede reproducir) mientras la vista previa vertical se actualiza al instante.
 */
export default function VerticalEditor(props: {
  framing: FramingPreview;
  /** Versión horizontal del clip para ver el movimiento; solo si es 16:9 como el fotograma. */
  videoUrl?: string;
  layout: VerticalLayout;
  onChange: (l: VerticalLayout) => void;
}) {
  const { framing, layout, onChange } = props;
  const aspect = framing.width / framing.height;
  const useVideo = Boolean(props.videoUrl) && Math.abs(aspect - 16 / 9) < 0.03;
  const count = layout.windows.length;
  const [selected, setSelected] = useState(0);
  const sel = Math.min(selected, count - 1);
  const boxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoOk, setVideoOk] = useState(false);
  const [muted, setMuted] = useState(false); // el sonido va activado: se edita escuchando lo que se dice

  // vista previa en vivo: se redibuja siempre (es muy barato) con el fotograma o con el vídeo si está listo
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const c = canvasRef.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const v = videoRef.current;
        const img = imgRef.current;
        if (useVideo && v && v.readyState >= 2 && v.videoWidth > 0) drawComposition(ctx, v, v.videoWidth, v.videoHeight, layoutRef.current);
        else if (img && img.complete && img.naturalWidth > 0) drawComposition(ctx, img, img.naturalWidth, img.naturalHeight, layoutRef.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [useVideo]);

  const setWindow = useCallback(
    (i: number, src: Rect) => {
      const cur = layoutRef.current;
      onChange({ ...cur, windows: cur.windows.map((w, k) => (k === i ? { ...w, src } : w)) });
    },
    [onChange],
  );

  const pointerNorm = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return null;
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, w: r.width, h: r.height };
  };

  const startDrag = (e: RPointerEvent, index: number, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    const p = pointerNorm(e);
    if (!p) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(index);
    dragRef.current = { index, mode, startX: p.x, startY: p.y, src: layoutRef.current.windows[index].src };
  };
  const onMove = (e: RPointerEvent) => {
    const d = dragRef.current;
    if (!d || e.buttons !== 1) return;
    const p = pointerNorm(e);
    if (!p) return;
    const dst = layoutRef.current.windows[d.index].dst;
    if (d.mode === 'move') setWindow(d.index, moveSrc(d.src, p.x - d.startX, p.y - d.startY));
    else setWindow(d.index, resizeFromCorner(d.src, dst, p.x, p.y, aspect));
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  const onKey = (e: RKeyboardEvent, i: number) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const w = layout.windows[i];
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      setWindow(i, moveSrc(w.src, dx, dy));
    };
    if (e.key === 'ArrowLeft') move(-step, 0);
    else if (e.key === 'ArrowRight') move(step, 0);
    else if (e.key === 'ArrowUp') move(0, -step);
    else if (e.key === 'ArrowDown') move(0, step);
    else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setWindow(i, resizeSrc(w.src, w.dst, w.src.h + step, aspect));
    } else if (e.key === '-') {
      e.preventDefault();
      setWindow(i, resizeSrc(w.src, w.dst, w.src.h - step, aspect));
    }
  };

  const setCount = (n: number) => {
    if (n === count) return;
    onChange(layoutFromPreset(defaultPreset(n), aspect));
    setSelected(0);
  };
  const presets = useMemo(() => presetsFor(count), [count]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  return (
    <div className="veditor" data-testid="vertical-editor">
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <div className="seg" role="group" aria-label="Número de ventanas">
          {[1, 2, 3].map((n) => (
            <button key={n} type="button" aria-pressed={count === n} className={`segbtn ${count === n ? 'active' : ''}`} onClick={() => setCount(n)}>
              {n === 1 ? '1 ventana' : `${n} ventanas`}
            </button>
          ))}
        </div>
        {presets.length > 1 && (
          <div className="row" style={{ gap: 6 }} role="group" aria-label="Disposición">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`presetbtn ${layout.preset === p.id ? 'active' : ''}`}
                aria-pressed={layout.preset === p.id}
                title={p.label}
                onClick={() => onChange(applyPresetKeeping(layout, p, aspect))}
              >
                <svg viewBox="0 0 18 32" width="18" height="32" aria-hidden="true">
                  {p.dst.map((d, i) => (
                    <rect key={i} x={d.x * 18 + 0.5} y={d.y * 32 + 0.5} width={d.w * 18 - 1} height={d.h * 32 - 1} rx="1.5" fill="none" stroke={COLORS[i]} strokeWidth="1.5" />
                  ))}
                </svg>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="btn ghost small" onClick={() => onChange(layoutFromPreset(presets.find((p) => p.id === layout.preset) ?? defaultPreset(count), aspect))}>
          Restablecer posiciones
        </button>
      </div>

      <div className="vmain">
        <div className="vsourcecol">
          <div className="muted small">Arrastra cada recuadro sobre el vídeo; la esquina cambia su tamaño. Con el teclado: flechas para mover, + y − para el tamaño.</div>
          <div ref={boxRef} className="vsource" data-testid="vsource" style={{ aspectRatio: `${framing.width} / ${framing.height}` }}>
            {useVideo && (
              <video
                ref={videoRef}
                src={props.videoUrl}
                muted={muted}
                playsInline
                preload="auto"
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration || 0);
                  setVideoOk(true);
                }}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setVideoOk(false)}
                style={{ opacity: videoOk ? 1 : 0 }}
              />
            )}
            <img ref={imgRef} src={framing.dataUrl} alt="Fotograma del vídeo" draggable={false} style={{ opacity: useVideo && videoOk ? 0 : 1 }} />
            {layout.windows.map((w, i) => (
              <div
                key={i}
                className={`vwin ${sel === i ? 'sel' : ''}`}
                data-testid={`vwin-${i}`}
                role="button"
                tabIndex={0}
                aria-label={`Ventana ${i + 1}: arrastra para mover, esquina para el tamaño`}
                style={{ left: `${w.src.x * 100}%`, top: `${w.src.y * 100}%`, width: `${w.src.w * 100}%`, height: `${w.src.h * 100}%`, borderColor: COLORS[i], background: `${COLORS[i]}22` }}
                onPointerDown={(e) => startDrag(e, i, 'move')}
                onPointerMove={onMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onFocus={() => setSelected(i)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span className="vbadge" style={{ background: COLORS[i] }}>{i + 1}</span>
                <span
                  className="vhandle"
                  data-testid={`vwin-${i}-resize`}
                  style={{ background: COLORS[i] }}
                  onPointerDown={(e) => startDrag(e, i, 'resize')}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </div>
            ))}
          </div>
          {useVideo && videoOk && (
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn ghost small" aria-label={playing ? 'Pausar' : 'Reproducir'} onClick={togglePlay}>
                {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
              </button>
              <input
                type="range"
                aria-label="Posición del vídeo"
                min={0}
                max={Math.max(0.1, duration)}
                step={0.05}
                value={Math.min(time, duration || 0)}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = Number(e.target.value);
                  setTime(Number(e.target.value));
                }}
                style={{ flex: 1 }}
              />
              <span className="mono small muted">{fmtTime(Math.round(time))}</span>
              <button type="button" className="btn ghost small" aria-label={muted ? 'Activar sonido' : 'Silenciar'} title={muted ? 'Activar sonido' : 'Silenciar'} onClick={() => setMuted(!muted)}>
                {muted ? <IconMute size={14} /> : <IconVolume size={14} />}
              </button>
            </div>
          )}
        </div>

        <div className="vprevcol">
          <div className="muted small">Así quedará ({OUT_W}×{OUT_H})</div>
          <div className="vpreview" data-testid="vpreview">
            <canvas ref={canvasRef} width={PREVIEW_W} height={PREVIEW_H} aria-label="Vista previa del vídeo vertical" />
            {layout.windows.map((w, i) => (
              <button
                key={i}
                type="button"
                className={`vzone ${sel === i ? 'sel' : ''}`}
                aria-label={`Seleccionar ventana ${i + 1}`}
                style={{ left: `${w.dst.x * 100}%`, top: `${w.dst.y * 100}%`, width: `${w.dst.w * 100}%`, height: `${w.dst.h * 100}%`, borderColor: COLORS[i] }}
                onClick={() => setSelected(i)}
              >
                <span className="vbadge" style={{ background: COLORS[i] }}>{i + 1}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

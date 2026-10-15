import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from 'react';
import { activeWordIndex, buildCues, captionLayout, cueAt, displayText, type Cue, type SubtitleStyle, type Word } from '../../shared/subtitles';

/** Zona que ocupa realmente la imagen dentro del elemento <video> (object-fit: contain). */
function contentRect(v: HTMLVideoElement): { left: number; top: number; width: number; height: number } | null {
  const bw = v.clientWidth;
  const bh = v.clientHeight;
  if (!bw || !bh || !v.videoWidth || !v.videoHeight) return null;
  const scale = Math.min(bw / v.videoWidth, bh / v.videoHeight);
  const width = v.videoWidth * scale;
  const height = v.videoHeight * scale;
  return { left: (bw - width) / 2, top: (bh - height) / 2, width, height };
}

/**
 * Vista previa de los subtítulos sobre el reproductor, con las mismas medidas y el mismo reparto
 * de frases que el render final. Las palabras llegan ya en el tiempo del vídeo resultante.
 */
export default function Captions(props: { videoRef: RefObject<HTMLVideoElement>; words: Word[]; style: SubtitleStyle; renderSize: { w: number; h: number } }) {
  const { videoRef, style } = props;
  const [time, setTime] = useState(0);
  const [rect, setRect] = useState<ReturnType<typeof contentRect>>(null);
  const cues = useMemo(() => buildCues(props.words, style), [props.words, style]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const measure = () => setRect(contentRect(v));
    const tick = () => {
      setTime(v.currentTime);
      if (!v.paused && !v.ended) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onSeek = () => setTime(v.currentTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('seeked', onSeek);
    v.addEventListener('timeupdate', onSeek);
    v.addEventListener('loadedmetadata', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(v);
    measure();
    onSeek();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('seeked', onSeek);
      v.removeEventListener('timeupdate', onSeek);
      v.removeEventListener('loadedmetadata', measure);
      ro.disconnect();
    };
  }, [videoRef]);

  if (!rect) return null;
  const cue = cueAt(cues, time);
  const k = rect.width / props.renderSize.w; // píxeles de pantalla por píxel del vídeo final

  return (
    <div className="captions" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} data-testid="caption-layer" aria-hidden="true">
      {cue && <CaptionLine cue={cue} time={time} style={style} k={k} renderSize={props.renderSize} />}
    </div>
  );
}

/** Un subtítulo colocado dentro de un contenedor posicionado, a escala k (píxeles de pantalla por píxel del vídeo). */
export function CaptionLine(props: { cue: Cue; time: number; style: SubtitleStyle; k: number; renderSize: { w: number; h: number } }) {
  const { cue, style, k } = props;
  const L = captionLayout(style, props.renderSize.w, props.renderSize.h);
  const active = activeWordIndex(cue, props.time);
  const textStyle: CSSProperties = {
    fontFamily: `${style.fontFamily}, 'Inter Variable', sans-serif`,
    fontWeight: style.bold ? 800 : 500,
    fontSize: L.fontPx * k,
    lineHeight: 1.18,
    color: style.color,
    textAlign: 'center',
    maxWidth: '100%',
    ...(style.box
      ? { background: 'rgba(0,0,0,0.6)', padding: `${L.fontPx * 0.12 * k}px ${L.fontPx * 0.28 * k}px`, borderRadius: 4 }
      : { WebkitTextStroke: `${L.outlinePx * k * 2}px ${style.outline}`, paintOrder: 'stroke fill' as CSSProperties['paintOrder'] }),
  };
  const place: CSSProperties =
    style.position === 'center'
      ? { top: '50%', transform: 'translateY(-50%)' }
      : { bottom: L.marginV * k };

  return (
    <div className="caption-line" style={{ ...place, padding: `0 ${L.marginH * k}px` }}>
      <span style={textStyle} data-testid="caption-text">
        {cue.words.map((w, i) => (
          <span key={`${w.start}-${i}`} style={style.highlight && i === active ? { color: style.highlight } : undefined} data-active={i === active ? 'true' : undefined}>
            {i > 0 ? ' ' : ''}
            {displayText(w.text, style)}
          </span>
        ))}
      </span>
    </div>
  );
}

const SAMPLE_WORDS: Word[] = 'Así se verán tus subtítulos en el vídeo'.split(' ').map((text, i) => ({ text, start: i * 0.45, end: i * 0.45 + 0.45 }));

/** Ejemplo animado del estilo (horizontal y vertical) para compararlos sin depender de que haya vídeo. */
export function SampleCaptions({ style }: { style: SubtitleStyle }) {
  const cues = useMemo(() => buildCues(SAMPLE_WORDS, style), [style]);
  const total = SAMPLE_WORDS.length * 0.45;
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setT((x) => (x + 0.15) % total), 150);
    return () => window.clearInterval(id);
  }, [total]);
  const cue = cueAt(cues, t) ?? cues[0];
  const boxes = [
    { name: 'Horizontal', size: { w: 1920, h: 1080 }, width: 300 },
    { name: 'Vertical', size: { w: 1080, h: 1920 }, width: 118 },
  ];
  return (
    <div className="samples" data-testid="caption-sample">
      {boxes.map((b) => (
        <div key={b.name} className="samplebox" style={{ width: b.width, aspectRatio: `${b.size.w} / ${b.size.h}` }} title={b.name}>
          {cue && <CaptionLine cue={cue} time={cue === cues[0] && t < cue.start ? cue.start : t} style={style} k={b.width / b.size.w} renderSize={b.size} />}
        </div>
      ))}
    </div>
  );
}

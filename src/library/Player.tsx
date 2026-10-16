import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { fmtTime } from '../../shared/time';
import { IconMute, IconPause, IconPlay, IconRestart, IconVolume } from '../icons';

/** Reproductor con controles propios (iconos de reproducir/pausa, reinicio, posición y sonido). */
export default function Player(props: { videoRef: RefObject<HTMLVideoElement>; src: string; poster?: string; vertical?: boolean; label?: string; onActivate?: (el: HTMLVideoElement) => void; overlay?: ReactNode; /** Sin barra de controles (los maneja quien lo use). */ bare?: boolean; /** Sin sonido (p. ej. la versión que va en paralelo a otra). */ silent?: boolean }) {
  const { videoRef } = props;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      setPlaying(!v.paused && !v.ended);
      setTime(v.currentTime);
      setDuration(Number.isFinite(v.duration) ? v.duration : 0);
      setMuted(v.muted);
    };
    const events = ['play', 'pause', 'ended', 'timeupdate', 'seeked', 'loadedmetadata', 'durationchange', 'volumechange'];
    events.forEach((e) => v.addEventListener(e, sync));
    const activate = () => props.onActivate?.(v);
    ['play', 'seeked'].forEach((e) => v.addEventListener(e, activate));
    // algunos motores no pintan el primer fotograma hasta que se mueve un poco la posición: sin esto el vídeo se ve negro
    const firstFrame = () => {
      setFailed(null);
      if (v.paused && v.currentTime === 0) v.currentTime = 0.001;
    };
    const onError = () => {
      const code = v.error?.code;
      const why = code === 3 ? 'el archivo no se puede decodificar' : code === 4 ? 'el formato no es compatible o el archivo no está' : code === 2 ? 'falló la lectura del archivo' : 'no se pudo cargar';
      setFailed(`${why} (código ${code ?? '?'})`);
    };
    v.addEventListener('loadeddata', firstFrame);
    v.addEventListener('error', onError);
    setFailed(null);
    sync();
    return () => {
      v.removeEventListener('loadeddata', firstFrame);
      v.removeEventListener('error', onError);
      events.forEach((e) => v.removeEventListener(e, sync));
      ['play', 'seeked'].forEach((e) => v.removeEventListener(e, activate));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, props.src]);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };
  const restart = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  };

  return (
    <div className={`playerbox ${props.vertical ? 'vertical' : ''}`}>
      <div className="stage">
        <video ref={videoRef} className="player" data-testid={props.label ? `player-${props.label}` : 'player'} aria-label={props.label} preload="auto" src={props.src} poster={props.poster} onClick={toggle} muted={props.silent} playsInline />
        {props.overlay}
        {failed && (
          <div className="player-error" role="alert" data-testid="player-error">
            <span>No se puede reproducir: {failed}.</span>
            <button className="btn small" onClick={() => { setFailed(null); videoRef.current?.load(); }}>Reintentar</button>
          </div>
        )}
      </div>
      {!props.bare && <div className="controls">
        <button className="iconbtn" aria-label="Volver al inicio" title="Volver al inicio" onClick={restart}><IconRestart /></button>
        <button className="iconbtn" aria-label={playing ? 'Pausa' : 'Reproducir'} title={playing ? 'Pausa' : 'Reproducir'} onClick={toggle}>
          {playing ? <IconPause /> : <IconPlay />}
        </button>
        <input
          type="range"
          aria-label="Posición del vídeo"
          min={0}
          max={duration || 0}
          step={0.05}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            if (videoRef.current) videoRef.current.currentTime = Number(e.target.value);
          }}
        />
        <span className="small muted time" aria-label="Tiempo">{fmtTime(time)} / {fmtTime(duration)}</span>
        <button
          className="iconbtn"
          aria-label={muted ? 'Activar sonido' : 'Silenciar'}
          title={muted ? 'Activar sonido' : 'Silenciar'}
          onClick={() => {
            if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
          }}
        >
          {muted ? <IconMute /> : <IconVolume />}
        </button>
      </div>}
    </div>
  );
}

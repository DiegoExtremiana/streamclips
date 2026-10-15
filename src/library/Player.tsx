import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { fmtTime } from '../../shared/time';
import { IconMute, IconPause, IconPlay, IconRestart, IconVolume } from '../icons';

/** Reproductor con controles propios (iconos de reproducir/pausa, reinicio, posición y sonido). */
export default function Player(props: { videoRef: RefObject<HTMLVideoElement>; src: string; poster?: string; vertical?: boolean; label?: string; onActivate?: (el: HTMLVideoElement) => void; overlay?: ReactNode }) {
  const { videoRef } = props;
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);

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
    sync();
    return () => {
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
        <video ref={videoRef} className="player" data-testid={props.label ? `player-${props.label}` : 'player'} aria-label={props.label} preload="metadata" src={props.src} poster={props.poster} onClick={toggle} />
        {props.overlay}
      </div>
      <div className="controls">
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
      </div>
    </div>
  );
}

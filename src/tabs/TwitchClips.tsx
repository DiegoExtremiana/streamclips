import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OutputItem, TwitchClip, VodJob } from '../../shared/types';
import { fmtDate, fmtTime } from '../../shared/time';
import { clipLibraryState, filterClips, type ClipLibraryState } from '../../shared/twitchClips';
import { errMsg } from '../lib';
import { IconPlus, IconSearch } from '../icons';
import { Modal } from '../library/ui';

const REFRESH_MS = 60_000;

const STATE_LABEL: Record<ClipLibraryState, string> = { library: 'En la Biblioteca', preparing: 'Preparando…', none: 'No está en la Biblioteca' };

/** Vista previa de un clip de Twitch sin descargarlo: se pide la dirección directa del vídeo y se reproduce aquí. */
function ClipPreview({ clip, state, busy, onAdd, onClose }: { clip: TwitchClip; state: ClipLibraryState; busy: boolean; onAdd: () => void; onClose: () => void }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    window.api.channelClipStream(clip.id).then((u) => alive && setSrc(u)).catch((e) => alive && setError(errMsg(e)));
    return () => { alive = false; };
  }, [clip.id]);
  return (
    <Modal title={clip.title} wide onClose={onClose}>
      <div className="clipprev" data-testid="clip-preview">
        {error ? (
          <div className="msg bad" role="alert">{error}</div>
        ) : src ? (
          <video className="player" data-testid="clip-preview-video" src={src} controls autoPlay playsInline />
        ) : (
          <div className="muted" role="status" style={{ padding: 30, textAlign: 'center' }}>Cargando el clip desde Twitch…</div>
        )}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <div className="muted small">{fmtDate(clip.createdAt)} · {fmtTime(Math.round(clip.durationSec))} · {clip.views} visualizaciones · por {clip.creator}</div>
          <button className="btn small" disabled={state !== 'none' || busy} onClick={onAdd}>
            {state === 'none' ? (busy ? 'Añadiendo…' : 'Añadir a la Biblioteca') : STATE_LABEL[state]}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Clips del canal de Twitch: del más reciente al más antiguo, en cuadrícula, con búsqueda por nombre.
 * Se actualizan solos y el estado «en la Biblioteca» se comprueba contra lo que hay ahora mismo.
 * Se pueden ver aquí sin descargarlos; tú eliges cuáles pasan a la Biblioteca.
 */
export default function TwitchClips({ vods, outputs, onChanged }: { vods: VodJob[]; outputs: OutputItem[]; onChanged: () => Promise<void> }) {
  const [clips, setClips] = useState<TwitchClip[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setClips(await window.api.channelClips());
      setError('');
    } catch (e) {
      setError(`${errMsg(e)}`);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const shown = useMemo(() => filterClips(clips ?? [], query), [clips, query]);
  const stateOf = (c: TwitchClip) => clipLibraryState(c.id, vods, outputs);
  const current = clips?.find((c) => c.id === open) ?? null;

  async function importClip(id: string) {
    setBusy(id);
    try {
      await window.api.channelImportClip(id);
      await onChanged();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card" aria-label="Clips de tu canal de Twitch">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Clips de tu canal de Twitch</h2>
        <div className="row" style={{ gap: 6 }}>
          {searching && (
            <input
              type="search"
              autoFocus
              aria-label="Buscar clips por nombre"
              placeholder="Buscar por nombre…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); setSearching(false); } }}
              style={{ width: 220 }}
            />
          )}
          <button className="btn ghost small" aria-label="Buscar clips" aria-pressed={searching} title="Buscar por nombre" onClick={() => { if (searching) setQuery(''); setSearching(!searching); }}><IconSearch /></button>
          <button className="btn ghost small" onClick={() => void load()}>Actualizar</button>
        </div>
      </div>
      <div className="muted small">
        Del más reciente al más antiguo. Pulsa un clip para verlo aquí sin descargarlo; con «Añadir» se descarga y queda en la Biblioteca en vertical y horizontal.
        {clips ? ` ${query.trim() ? `${shown.length} de ${clips.length}` : clips.length} clip(s).` : ''}
      </div>
      {error && <div className="msg bad" role="alert">{error} (revisa la pestaña Conexiones)</div>}
      {clips && clips.length === 0 && !error && <div className="muted" style={{ marginTop: 8 }}>Tu canal no tiene clips todavía.</div>}
      {clips && clips.length > 0 && shown.length === 0 && <div className="muted" style={{ marginTop: 8 }}>Ningún clip se llama así.</div>}
      <div className="tiles twclips" data-testid="twitch-clips">
        {shown.map((c) => {
          const st = stateOf(c);
          return (
            <div key={c.id} className="tile twclip" data-testid={`twclip-${c.id}`} data-state={st} role="button" tabIndex={0} aria-label={`Ver ${c.title}`}
              onClick={() => setOpen(c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(c.id); } }}>
              <div className="twthumb">
                {c.thumbnail ? <img src={c.thumbnail} alt="" draggable={false} loading="lazy" /> : null}
                <span className="twdur">{fmtTime(Math.round(c.durationSec))}</span>
              </div>
              <div className="tile-title title-ellipsis" title={c.title}>{c.title}</div>
              <div className="muted small" style={{ padding: '0 3px' }}>{fmtDate(c.createdAt)} · {c.views} vis.</div>
              <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                <span className={`badge twstate ${st}`} data-testid={`twstate-${c.id}`}>{STATE_LABEL[st]}</span>
                {st === 'none' && (
                  <button className="btn small" disabled={busy === c.id} aria-label={`Añadir ${c.title} a la Biblioteca`} title="Añadir a la Biblioteca"
                    onClick={(e) => { e.stopPropagation(); void importClip(c.id); }}><IconPlus size={14} /> {busy === c.id ? '…' : 'Añadir'}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {current && <ClipPreview clip={current} state={stateOf(current)} busy={busy === current.id} onAdd={() => void importClip(current.id)} onClose={() => setOpen(null)} />}
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OutputItem, TwitchClip, VodJob } from '../../shared/types';
import { fmtDate, fmtTime } from '../../shared/time';
import { clipLibraryState, filterClips, type ClipLibraryState } from '../../shared/twitchClips';

import { errMsg } from '../lib';
import { IconPlus, IconSearch } from '../icons';
import { Modal } from '../library/ui';

const REFRESH_MS = 60_000;
const LOADING_MS = 3_000; // mientras se lee el historial se vuelve a preguntar enseguida

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

const PAGE = 60;
type Show = 'all' | 'new' | 'library';

/**
 * Clips del canal de Twitch: todos, del más reciente al más antiguo, en cuadrícula, con búsqueda por nombre y filtro
 * por si están ya en la Biblioteca. Se actualizan solos y ese estado se comprueba contra lo que hay ahora mismo.
 * Se pueden ver aquí sin descargarlos; tú eliges cuáles pasan a la Biblioteca.
 */
export default function TwitchClips({ vods, outputs, onChanged }: { vods: VodJob[]; outputs: OutputItem[]; onChanged: () => Promise<void> }) {
  const [clips, setClips] = useState<TwitchClip[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(false);
  const [warning, setWarning] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<Show>('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const r = await window.api.channelClips(force);
      setClips(r.clips);
      setHistory(r.loading);
      setWarning(r.warning);
      setError('');
    } catch (e) {
      setError(`${errMsg(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), history ? LOADING_MS : REFRESH_MS);
    return () => clearInterval(t);
  }, [load, history]);

  const stateOf = (c: TwitchClip) => clipLibraryState(c.id, vods, outputs);
  const counts = useMemo(() => {
    const all = clips ?? [];
    const inLib = all.filter((c) => clipLibraryState(c.id, vods, outputs) !== 'none').length;
    return { all: all.length, library: inLib, fresh: all.length - inLib };
  }, [clips, vods, outputs]);
  const matching = useMemo(() => {
    const byName = filterClips(clips ?? [], query);
    return byName.filter((c) => show === 'all' || (show === 'library') === (clipLibraryState(c.id, vods, outputs) !== 'none'));
  }, [clips, query, show, vods, outputs]);
  const shown = matching.slice(0, limit);
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
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h2>Clips de tu canal de Twitch</h2>
        <button className="btn ghost small" disabled={loading} onClick={() => void load(true)} title="Vuelve a pedir todos los clips a Twitch">{loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      <div className="muted small">
        Todos los clips de tu canal, del más reciente al más antiguo. Pulsa uno para verlo aquí sin descargarlo; «Añadir» lo descarga y lo deja en la Biblioteca en vertical y horizontal.
      </div>
      <div className="row twtools" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="searchbox">
          <IconSearch size={16} />
          <input type="search" aria-label="Buscar clips por nombre" placeholder="Buscar por nombre…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
        </label>
        <div className="seg" role="group" aria-label="Qué clips mostrar">
          <button type="button" aria-pressed={show === 'all'} className={`segbtn ${show === 'all' ? 'active' : ''}`} onClick={() => { setShow('all'); setLimit(PAGE); }}>Todos ({counts.all})</button>
          <button type="button" aria-pressed={show === 'new'} className={`segbtn ${show === 'new' ? 'active' : ''}`} onClick={() => { setShow('new'); setLimit(PAGE); }}>Sin añadir ({counts.fresh})</button>
          <button type="button" aria-pressed={show === 'library'} className={`segbtn ${show === 'library' ? 'active' : ''}`} onClick={() => { setShow('library'); setLimit(PAGE); }}>En la Biblioteca ({counts.library})</button>
        </div>
      </div>
      {history && clips && <div className="muted small" role="status" style={{ marginTop: 6 }}>Leyendo el resto del historial de tu canal… ya puedes ver y usar los clips que han salido.</div>}
      {warning && <div className="msg warn" role="status">{warning}</div>}
      {error && <div className="msg bad" role="alert">{error} (revisa la pestaña Conexiones)</div>}
      {!clips && !error && <div className="muted" role="status">Cargando los clips de tu canal (la primera vez puede tardar unos segundos)…</div>}
      {clips && clips.length === 0 && !error && <div className="muted" style={{ marginTop: 8 }}>Tu canal no tiene clips todavía.</div>}
      {clips && clips.length > 0 && matching.length === 0 && <div className="muted" style={{ marginTop: 8 }}>{query.trim() ? 'Ningún clip se llama así.' : 'No hay clips en esta lista.'}</div>}
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
      {matching.length > shown.length && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn ghost" onClick={() => setLimit(limit + PAGE)}>Mostrar más ({matching.length - shown.length} restantes)</button>
        </div>
      )}
      {current && <ClipPreview clip={current} state={stateOf(current)} busy={busy === current.id} onAdd={() => void importClip(current.id)} onClose={() => setOpen(null)} />}
    </section>
  );
}

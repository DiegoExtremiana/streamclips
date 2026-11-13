import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClipsResult, OutputItem, TwitchClip, VodJob } from '../../shared/types';

type ClipsResultScoring = NonNullable<ClipsResult['scoring']>;
import { fmtDate, fmtTime } from '../../shared/time';
import { clipLibraryState, defaultDir, filterClips, type ClipLibraryState, type ClipSort, type SortDir } from '../../shared/twitchClips';
import { CLIP_CRITERIA, CRITERION_LABEL, POINTS_LABEL, RUBRIC } from '../../shared/clipCriteria';

import { errMsg } from '../lib';
import { IconPlus, IconSearch, IconSortAsc, IconSortDesc } from '../icons';
import { Modal } from '../library/ui';
import { EDITABLE, type EditableScores } from '../../shared/clipFeedback';

const REFRESH_MS = 60_000;
const SCORING_MS = 15_000; // mientras se valoran clips se vuelve a preguntar para que vayan saliendo las notas
const LOADING_MS = 3_000; // mientras se lee el historial se vuelve a preguntar enseguida

const fmtScore = (n: number) => n.toFixed(1).replace('.', ',');

const PROVIDER_NAME: Record<string, string> = { gemini: 'Gemini', groq: 'Groq' };
/** «Gemini · gemini-3.5-flash-lite · 13/11/2026»: quién examinó el clip y cuándo. */
function stampText(w: NonNullable<TwitchClip['scoredWith']>): string {
  const when = w.at ? ` · ${new Date(w.at).toLocaleDateString('es-ES')}` : '';
  return `${PROVIDER_NAME[w.provider] ?? w.provider} · ${w.model}${w.vision ? ' (con imagen)' : ''}${when}`;
}

/** Los cuatro criterios de la nota como barras, con el motivo y cómo se calculó. */
function Criteria({ clip, compact }: { clip: TwitchClip; compact?: boolean }) {
  const cr = clip.criteria;
  if (!cr) return null;
  const by = clip.scoredBy === 'user' ? 'Corregido por ti.' : clip.scoredBy === 'model' ? 'Valorado por la IA.' : '';
  return (
    <div className={`crit${compact ? ' compact' : ''}`} data-testid={`crit-${clip.id}`} title={`${clip.reason ?? ''} ${by}`.trim()}>
      {CLIP_CRITERIA.map((k) => (
        <div key={k} className="crit-row">
          <span className="crit-name">{CRITERION_LABEL[k]}</span>
          <span className="crit-bar" role="img" aria-label={`${CRITERION_LABEL[k]}: ${fmtScore(cr[k])} de 10`}><i style={{ width: `${Math.min(100, cr[k] * 10)}%` }} /></span>
          <span className="crit-val">{fmtScore(cr[k])}</span>
        </div>
      ))}
      {cr.viral >= 8 && <div className="badge ok" data-testid={`viral-${clip.id}`} style={{ alignSelf: 'flex-start' }}>Puede ser viral</div>}
      {!compact && clip.reason && <div className="crit-reason">{clip.reason}</div>}
      {!compact && <div className="muted small" data-testid={`stamp-${clip.id}`}>{by}{clip.scoredWith ? ` Examinado con ${stampText(clip.scoredWith)}.` : ''}</div>}
      {!compact && clip.items && (
        <details className="crit-why" data-testid={`why-${clip.id}`}>
          <summary>Ver por qué, pregunta a pregunta</summary>
          {CLIP_CRITERIA.map((k) => (
            <div key={k} className="crit-group">
              <div className="crit-group-title">{CRITERION_LABEL[k]}: {fmtScore(cr[k])} de 10</div>
              {RUBRIC[k].map((it) => (
                <div key={it.key} className="crit-q">
                  <span className={`crit-pts p${clip.items?.[`${k}.${it.key}`] ?? 0}`}>{POINTS_LABEL[clip.items?.[`${k}.${it.key}`] ?? 0]}</span>
                  <span>{it.label}</span>
                </div>
              ))}
              {clip.evidence?.[k] && <div className="crit-proof muted small">Prueba: «{clip.evidence[k]}»</div>}
            </div>
          ))}
          <div className="muted small">«Puede ser viral» mezcla estas preguntas (75 %) con lo medido en el clip (25 %): duración adecuada, que se hable pronto y el pico de volumen.</div>
        </details>
      )}
    </div>
  );
}

const STATE_LABEL: Record<ClipLibraryState, string> = { library: 'En la Biblioteca', preparing: 'Preparando…', none: 'No está en la Biblioteca' };

/** Vista previa de un clip de Twitch sin descargarlo: se pide la dirección directa del vídeo y se reproduce aquí. */
/** «No estoy de acuerdo»: se mueven humor, «se cuenta algo» y momento interesante; «Puede ser viral» lo valora solo la IA. La IA aprende de estas correcciones. */
function Disagree({ clip, onDone }: { clip: TwitchClip; onDone: () => void }) {
  const cr = clip.criteria!;
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<EditableScores>({ humor: cr.humor, historia: cr.historia, interes: cr.interes });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fb, setFb] = useState<{ count: number; enough: boolean } | null>(null);
  useEffect(() => { window.api.clipFeedback().then(setFb).catch(() => undefined); }, [clip.scoredBy]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr('');
    try {
      await fn();
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="disagree" data-testid="disagree">
      {!open ? (
        <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn small" onClick={() => { setVals({ humor: cr.humor, historia: cr.historia, interes: cr.interes }); setOpen(true); }}>No estoy de acuerdo</button>
          {clip.scoredBy === 'user' && <button className="btn ghost small" disabled={busy} onClick={() => void run(() => window.api.undoClipCorrection(clip.id))}>Volver a la nota de la IA</button>}
          {fb && fb.count > 0 && <span className="muted small">La IA ha aprendido de {fb.count} corrección(es){fb.enough ? '' : ' (con 3 empieza a notar tu criterio)'}.</span>}
        </div>
      ) : (
        <div className="disagree-edit">
          {EDITABLE.map((k) => (
            <label key={k} className="crit-row" style={{ alignItems: 'center' }}>
              <span className="crit-name">{CRITERION_LABEL[k]}</span>
              <input type="range" min={0} max={10} step={0.5} value={vals[k]} aria-label={`${CRITERION_LABEL[k]} según tú`} onChange={(e) => setVals((v) => ({ ...v, [k]: Number(e.target.value) }))} />
              <span className="crit-val">{fmtScore(vals[k])}</span>
            </label>
          ))}
          <div className="muted small">«Puede ser viral» lo valora solo la IA: una persona no puede saberlo. La IA usa tus correcciones como ejemplos para valorar mejor los próximos clips.</div>
          {err && <div className="msg bad" role="alert">{err}</div>}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn small" disabled={busy} onClick={() => void run(() => window.api.correctClipScore(clip.id, vals))}>{busy ? 'Guardando…' : 'Guardar mi valoración'}</button>
            <button className="btn ghost small" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClipPreview({ clip, state, busy, onAdd, onClose, onCorrected }: { clip: TwitchClip; state: ClipLibraryState; busy: boolean; onAdd: () => void; onClose: () => void; onCorrected: () => void }) {
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
        {clip.score === undefined && clip.reason && <div className="muted small" data-testid="clip-preview-noscore" style={{ marginTop: 8 }}>{clip.reason}</div>}
        {clip.score !== undefined && (
          <div className="clipprev-score" data-testid="clip-preview-score">
            <div className={`bigscore${clip.gold ? ' gold' : ''}`}>{fmtScore(clip.score)}<small>/10</small></div>
            <Criteria clip={clip} />
            {clip.criteria && <Disagree clip={clip} onDone={onCorrected} />}
          </div>
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
type Show = 'all' | 'new' | 'library' | 'gold';

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
  const [sort, setSort] = useState<ClipSort>('fecha');
  const [dir, setDir] = useState<SortDir>('desc');
  const [scoring, setScoring] = useState<ClipsResultScoring | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  /** Canal que se está viendo: '' es el propio. */
  const [channel, setChannel] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [own, setOwn] = useState(true);
  const [shownChannel, setShownChannel] = useState('');
  const channelRef = useRef(channel);
  channelRef.current = channel;

  const load = useCallback(
    async (force = false) => {
      setLoading(true);
      const asked = channel;
      try {
        const r = await window.api.channelClips(force, asked || undefined);
        // si mientras tanto se cambió de canal, esta respuesta ya no vale
        if (asked !== channelRef.current) return;
        setClips(r.clips);
        setHistory(r.loading);
        setWarning(r.warning);
        setOwn(r.own);
        setScoring(r.scoring);
        setShownChannel(r.channel);
        setError('');
      } catch (e) {
        setError(`${errMsg(e)}`);
      } finally {
        setLoading(false);
      }
    },
    [channel],
  );

  useEffect(() => {
    void load();
    // el canal propio se refresca solo; el de otro canal solo cuando se pide (cada lectura son varias peticiones a Twitch)
    if (channel) return undefined;
    const t = setInterval(() => void load(), history ? LOADING_MS : scoring && scoring.pending > 0 ? SCORING_MS : REFRESH_MS);
    return () => clearInterval(t);
  }, [load, history, channel, scoring]);

  function goTo(login: string) {
    setClips(null);
    setError('');
    setWarning('');
    setQuery('');
    setShow('all');
    setLimit(PAGE);
    setChannel(login);
  }

  const stateOf = (c: TwitchClip) => clipLibraryState(c.id, vods, outputs);
  const counts = useMemo(() => {
    const all = clips ?? [];
    const inLib = all.filter((c) => clipLibraryState(c.id, vods, outputs) !== 'none').length;
    return { all: all.length, library: inLib, fresh: all.length - inLib, gold: all.filter((c) => c.gold).length };
  }, [clips, vods, outputs]);
  const matching = useMemo(() => {
    const byName = filterClips(clips ?? [], query, sort, dir);
    if (show === 'gold') return byName.filter((c) => c.gold);
    return byName.filter((c) => show === 'all' || (show === 'library') === (clipLibraryState(c.id, vods, outputs) !== 'none'));
  }, [clips, query, sort, dir, show, vods, outputs]);
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

  const sortLabel: Record<ClipSort, string> = { fecha: 'Fecha', nombre: 'Nombre', nota: 'Nota' };
  const dirText = (d: SortDir) => (sort === 'fecha' ? (d === 'desc' ? 'más recientes primero' : 'más antiguos primero') : sort === 'nombre' ? (d === 'asc' ? 'de la A a la Z' : 'de la Z a la A') : d === 'desc' ? 'mejor nota primero' : 'peor nota primero');
  const progress = scoring && scoring.total > 0 ? Math.round((scoring.scored / scoring.total) * 100) : 0;

  return (
    <section className="card twpanel" aria-label="Clips de tu canal de Twitch">
      <div className="twhead">
        <div>
          <h2>{own ? 'Clips de tu canal de Twitch' : `Clips del canal ${shownChannel}`}</h2>
          <div className="muted small">
            {own ? 'Pulsa uno para verlo aquí sin descargarlo; «Añadir» lo deja en la Biblioteca en vertical y horizontal.' : 'Clips de los últimos 12 meses de este canal. Puedes verlos y añadirlos; solo los de tu canal se valoran.'}
          </div>
        </div>
        <div className="twstats" aria-label="Resumen">
          <span className="twstat"><b>{counts.all}</b> clips</span>
          {own && scoring && <span className="twstat"><b>{scoring.scored}</b> valorados</span>}
          {own && <span className="twstat gold"><b>{counts.gold}</b> destacados</span>}
        </div>
        <button className="btn ghost small" disabled={loading} onClick={() => void load(true)} title="Vuelve a pedir todos los clips a Twitch">{loading ? 'Actualizando…' : 'Actualizar'}</button>
      </div>
      {own && scoring && (
        <div className="twscoring" data-testid="scoring-status" role="status">
          {scoring.problem ? (
            <span className="small" data-testid="scoring-problem">{scoring.problem}</span>
          ) : !scoring.enabled ? (
            <span className="muted small">La valoración en segundo plano está desactivada (Ajustes, Piloto automático).</span>
          ) : scoring.pending > 0 ? (
            <>
              {scoring.waiting && <span className="small" data-testid="scoring-waiting">En pausa: {scoring.waiting}. Seguirá solo cuando termine.</span>}
              <span className="small">Valorando tus clips en segundo plano: {scoring.scored} de {scoring.total}. Solo trabaja cuando no hay directo ni análisis en marcha.</span>
              {scoring.failed ? <span className="muted small">{scoring.failed} clip(s) han fallado{scoring.lastError ? `: ${scoring.lastError}` : ''}.</span> : null}
              {scoring.working && <span className="muted small" data-testid="scoring-working">Ahora: {scoring.working}{scoring.secPerClip ? ` · unos ${scoring.secPerClip} s por clip, quedan ${scoring.etaMin! >= 90 ? `${Math.round(scoring.etaMin! / 60)} h` : `${scoring.etaMin} min`}` : ''}</span>}
              <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /></div>
            </>
          ) : (
            <span className="muted small">{scoring.failed ? `${scoring.failed} clip(s) no se han podido valorar${scoring.lastError ? `: ${scoring.lastError}` : ''}. ` : ''}La nota sale del contenido: humor, si se cuenta algo, si puede ser viral y si es un momento interesante. No mira visualizaciones.</span>
          )}
          {scoring.notesFile && scoring.scored > 0 && (
            <span className="small">Las notas se guardan en un documento y no se repiten al abrir el programa.{' '}
              <button className="btn ghost small" onClick={() => void window.api.openPath(scoring.notesFile!).catch(() => undefined)}>Abrir documento de notas</button>
            </span>
          )}
        </div>
      )}
      <div className="twbar">
        <label className="searchbox">
          <IconSearch size={16} />
          <input type="search" aria-label="Buscar clips por nombre" placeholder="Buscar por nombre…" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} />
        </label>
        <div className="twsort" role="group" aria-label="Orden">
          <label className="row" style={{ gap: 6 }}>
            <span className="muted small">Ordenar por</span>
            <select aria-label="Ordenar clips por" value={sort} onChange={(e) => { const v = e.target.value as ClipSort; setSort(v); setDir(defaultDir(v)); setLimit(PAGE); }}>
              <option value="fecha">{sortLabel.fecha}</option>
              <option value="nombre">{sortLabel.nombre}</option>
              <option value="nota" disabled={!own}>{sortLabel.nota}</option>
            </select>
          </label>
          <button
            type="button"
            className="btn ghost small dirbtn"
            data-testid="sort-dir"
            data-dir={dir}
            aria-label={`Sentido del orden: ${dir === 'asc' ? 'ascendente' : 'descendente'}, ${dirText(dir)}. Pulsa para cambiarlo`}
            title={`${dir === 'asc' ? 'Ascendente' : 'Descendente'}: ${dirText(dir)}. Pulsa para invertir`}
            onClick={() => { setDir(dir === 'asc' ? 'desc' : 'asc'); setLimit(PAGE); }}
          >
            {dir === 'asc' ? <IconSortAsc size={16} /> : <IconSortDesc size={16} />}
            <span className="small">{dir === 'asc' ? 'Ascendente' : 'Descendente'}</span>
          </button>
        </div>
        <div className="seg" role="group" aria-label="Qué clips mostrar">
          <button type="button" aria-pressed={show === 'all'} className={`segbtn ${show === 'all' ? 'active' : ''}`} onClick={() => { setShow('all'); setLimit(PAGE); }}>Todos ({counts.all})</button>
          <button type="button" aria-pressed={show === 'new'} className={`segbtn ${show === 'new' ? 'active' : ''}`} onClick={() => { setShow('new'); setLimit(PAGE); }}>Sin añadir ({counts.fresh})</button>
          <button type="button" aria-pressed={show === 'library'} className={`segbtn ${show === 'library' ? 'active' : ''}`} onClick={() => { setShow('library'); setLimit(PAGE); }}>En la Biblioteca ({counts.library})</button>
          {own && <button type="button" aria-pressed={show === 'gold'} className={`segbtn gold ${show === 'gold' ? 'active' : ''}`} onClick={() => { setShow('gold'); setLimit(PAGE); }}>Destacados ({counts.gold})</button>}
        </div>
        <form
          className="twchannel"
          onSubmit={(e) => {
            e.preventDefault();
            if (channelInput.trim()) goTo(channelInput.trim());
          }}
        >
          <label className="searchbox">
            <IconSearch size={16} />
            <input type="text" aria-label="Buscar otro canal de Twitch" placeholder="Ver otro canal…" value={channelInput} onChange={(e) => setChannelInput(e.target.value)} />
          </label>
          <button className="btn small" type="submit" disabled={!channelInput.trim() || loading}>Ver canal</button>
          {!own && <button className="btn ghost small" type="button" onClick={() => { setChannelInput(''); goTo(''); }}>Volver a mi canal</button>}
        </form>
      </div>
      {history && clips && <div className="muted small" role="status" style={{ marginTop: 6 }}>Leyendo el resto del historial de tu canal… ya puedes ver y usar los clips que han salido.</div>}
      {warning && <div className="msg warn" role="status">{warning}</div>}
      {error && <div className="msg bad" role="alert">{error} (revisa la pestaña Conexiones)</div>}
      {!clips && !error && <div className="muted" role="status">Cargando los clips de {own ? 'tu canal' : 'ese canal'} (la primera vez puede tardar unos segundos)…</div>}
      {clips && clips.length === 0 && !error && <div className="muted" style={{ marginTop: 8 }}>{own ? 'Tu canal no tiene clips todavía.' : 'Este canal no tiene clips en los últimos 12 meses.'}</div>}
      {clips && clips.length > 0 && matching.length === 0 && <div className="muted" style={{ marginTop: 8 }}>{query.trim() ? 'Ningún clip se llama así.' : 'No hay clips en esta lista.'}</div>}
      <div className="tiles twclips" data-testid="twitch-clips">
        {shown.map((c) => {
          const st = stateOf(c);
          return (
            <div key={c.id} className={`tile twclip${c.gold ? ' gold' : ''}`} data-testid={`twclip-${c.id}`} data-state={st} data-gold={c.gold ? 'true' : 'false'} role="button" tabIndex={0} aria-label={`Ver ${c.title}${c.gold ? ' (clip destacado)' : ''}`}
              onClick={() => setOpen(c.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(c.id); } }}>
              <div className="twthumb">
                {c.thumbnail ? <img src={c.thumbnail} alt="" draggable={false} loading="lazy" /> : null}
                <span className="twdur">{fmtTime(Math.round(c.durationSec))}</span>
                {c.score !== undefined && <span className="twscore" data-testid={`twscore-${c.id}`} title="Nota del contenido del clip (no depende de las visualizaciones)">{fmtScore(c.score)}/10</span>}
              </div>
              <div className="tile-title title-ellipsis" title={c.gold ? `${c.title} · clip destacado` : c.title}>{c.title}</div>
              <div className="muted small" style={{ padding: '0 3px' }}>{fmtDate(c.createdAt)} · {c.views} vis.</div>
              <Criteria clip={c} compact />
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
      {current && <ClipPreview clip={current} state={stateOf(current)} busy={busy === current.id} onAdd={() => void importClip(current.id)} onClose={() => setOpen(null)} onCorrected={() => void load(false)} />}
    </section>
  );
}

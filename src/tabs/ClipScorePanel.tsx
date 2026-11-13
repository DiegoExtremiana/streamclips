import { useEffect, useState } from 'react';
import type { TwitchClip } from '../../shared/types';
import { CLIP_CRITERIA, CRITERION_LABEL, POINTS_LABEL, RUBRIC, type ClipCriterion } from '../../shared/clipCriteria';
import { EDITABLE, type EditableScores } from '../../shared/clipFeedback';
import { errMsg } from '../lib';
import { Fold } from '../library/ui';

export const fmtScore = (n: number) => n.toFixed(1).replace('.', ',');

const PROVIDER_NAME: Record<string, string> = { gemini: 'Gemini', groq: 'Groq' };
/** «Gemini · gemini-3.5-flash-lite · 13/11/2026»: quién examinó el clip y cuándo. */
function stampText(w: NonNullable<TwitchClip['scoredWith']>): string {
  const when = w.at ? ` · ${new Date(w.at).toLocaleDateString('es-ES')}` : '';
  return `${PROVIDER_NAME[w.provider] ?? w.provider} · ${w.model}${w.vision ? ' (con imagen)' : ''}${when}`;
}

const HELP: Record<ClipCriterion, string> = {
  historia: 'Si se entiende qué pasa, hay desarrollo y desenlace, y se entiende sin ver el directo.',
  interes: 'Si pasa algo inesperado o raro, hay una reacción fuerte y se recordaría.',
  humor: 'Si hay remate, contraste, exageración o actuación que haga gracia.',
  viral: 'Si un desconocido lo compartiría. Mezcla las preguntas de abajo (75 %) con lo medido en el clip (25 %): que se hable pronto y el pico de volumen.',
};

/** Una estadística: barra que se llena hasta su nota; se abre para ver las preguntas y la prueba. */
function Stat({ clip, k, index }: { clip: TwitchClip; k: ClipCriterion; index: number }) {
  const v = clip.criteria![k];
  return (
    <details className="stat" data-testid={`stat-${k}-${clip.id}`}>
      <summary>
        <span className="stat-name">{CRITERION_LABEL[k]}</span>
        <span className="crit-bar" role="img" aria-label={`${CRITERION_LABEL[k]}: ${fmtScore(v)} de 10`}>
          <i style={{ width: `${Math.min(100, v * 10)}%`, animationDelay: `${0.12 + index * 0.1}s` }} />
        </span>
        <span className="crit-val">{fmtScore(v)}</span>
      </summary>
      <div className="stat-body">
        <div className="muted small">{HELP[k]}</div>
        {clip.items && RUBRIC[k].map((it) => {
          const p = clip.items?.[`${k}.${it.key}`] ?? 0;
          return (
            <div key={it.key} className="crit-q">
              <span className={`crit-pts p${p}`}>{POINTS_LABEL[p]}</span>
              <span>{it.label}</span>
            </div>
          );
        })}
        {clip.evidence?.[k] && <div className="crit-proof muted small">Prueba: «{clip.evidence[k]}»</div>}
      </div>
    </details>
  );
}

/** Todo lo de la nota de un clip, ordenado: nota, qué pasa, estadísticas, mi valoración y quién la hizo. */
export function ClipScorePanel({ clip, onCorrected }: { clip: TwitchClip; onCorrected: () => void }) {
  const cr = clip.criteria;
  if (clip.score === undefined || !cr) return null;
  const by = clip.scoredBy === 'user' ? 'Corregido por ti.' : 'Valorado por la IA.';
  return (
    <div className="formcol" data-testid="clip-preview-score">
      <Fold label="Nota" title="Nota del clip">
        <div className="score-head">
          <div className={`bigscore${clip.gold ? ' gold' : ''}`}>{fmtScore(clip.score)}<small>/10</small></div>
          <div className="score-tags">
            {clip.gold && <span className="badge ok">Clip destacado</span>}
            {cr.viral >= 8 && <span className="badge ok" data-testid={`viral-${clip.id}`}>Puede ser viral</span>}
            {clip.scoredBy === 'user' && <span className="badge">Corregido por ti</span>}
          </div>
        </div>
        {clip.summary && <p className="score-summary" data-testid={`summary-${clip.id}`}>{clip.summary}</p>}
        {clip.reason && <div className="crit-reason muted" data-testid={`reason-${clip.id}`}>{clip.reason}</div>}
      </Fold>
      <Fold label="Estadísticas" title="Estadísticas">
        <div className="stats" data-testid={`crit-${clip.id}`}>
          <div className="muted small">Pulsa una para ver el porqué.</div>
          {CLIP_CRITERIA.map((k, i) => <Stat key={k} clip={clip} k={k} index={i} />)}
        </div>
      </Fold>
      <Fold label="Tu valoración" title="Tu valoración">
        <Disagree clip={clip} onDone={onCorrected} />
      </Fold>
      <div className="muted small score-stamp" data-testid={`stamp-${clip.id}`}>{by}{clip.scoredWith ? ` Examinado con ${stampText(clip.scoredWith)}.` : ''}</div>
    </div>
  );
}

/** «No estoy de acuerdo»: se mueven «se cuenta algo», momento interesante y humor; «Puede ser viral» lo valora solo la IA. La IA aprende de estas correcciones. */
function Disagree({ clip, onDone }: { clip: TwitchClip; onDone: () => void }) {
  const cr = clip.criteria!;
  const start = (): EditableScores => ({ humor: cr.humor, historia: cr.historia, interes: cr.interes });
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<EditableScores>(start);
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
          <button className="btn small" onClick={() => { setVals(start()); setOpen(true); }}>No estoy de acuerdo</button>
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

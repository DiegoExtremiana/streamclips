import { useCallback, useEffect, useState } from 'react';
import type { ThemeProposal } from '../shared/themes';
import { clock } from '../shared/themes';
import { Modal } from './library/ui';
import { errMsg } from './lib';

const dur = (sec: number) => {
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m ? `${m} min${s % 60 ? ` ${s % 60} s` : ''}` : `${s} s`;
};

/**
 * Ventana que pregunta cómo aprovechar un tema que el análisis ha encontrado: un vídeo largo o varios cortos.
 * Solo aparece cuando hay una oportunidad real con las dos opciones; cada tema es independiente.
 */
export default function ThemesDialog() {
  const [list, setList] = useState<ThemeProposal[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await window.api.listThemes());
    } catch {
      /* sin propuestas no pasa nada */
    }
  }, []);
  useEffect(() => {
    void load();
    return window.api.onDataChanged(() => void load());
  }, [load]);

  const p = list.find((x) => !hidden.has(x.id));
  if (!p) return null;
  const left = list.filter((x) => !hidden.has(x.id)).length;
  const shortSecs = p.shorts.map((s) => s.sec);
  const choose = async (choice: 'long' | 'shorts' | 'dismiss') => {
    setBusy(true);
    setError('');
    try {
      await window.api.chooseTheme(p.id, choice);
      setHidden((h) => new Set(h).add(p.id));
      await load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Tema para un vídeo" wide onClose={() => !busy && setHidden((h) => new Set(h).add(p.id))}>
      <div className="modal-body" style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          ¿Prefieres un vídeo largo de {dur(p.long.sec)} sobre «{p.title}» o {p.shorts.length} vídeos cortos?
        </p>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 14px' }}>
          <dt>Tema</dt>
          <dd style={{ margin: 0 }}>{p.title}</dd>
          <dt>Contexto</dt>
          <dd style={{ margin: 0 }}>{p.context}{p.resolved ? '' : ' (la historia queda sin resolver)'}</dd>
          {p.why && (<><dt>Por qué es un tema</dt><dd style={{ margin: 0 }}>{p.why} (seguridad {Math.round(p.confidence * 100)} %)</dd></>)}
          {(p.category || p.participants.length > 0) && (<><dt>Categoría</dt><dd style={{ margin: 0 }}>{[p.category, p.participants.length ? `con ${p.participants.join(', ')}` : ''].filter(Boolean).join(' · ')}</dd></>)}
          <dt>Fragmentos detectados</dt>
          <dd style={{ margin: 0 }}>{p.pieces.length}: {p.pieces.map((x) => clock(x.start)).join(' · ')}</dd>
          <dt>Número de vídeos</dt>
          <dd style={{ margin: 0 }}>1 largo, o {p.shorts.length} cortos</dd>
          <dt>Duración estimada</dt>
          <dd style={{ margin: 0 }}>
            Largo: {dur(p.long.sec)} · Cortos: {shortSecs.map(dur).join(', ')}
          </dd>
        </dl>
        <div>
          <strong>Propuesta de estructura</strong>
          <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {p.structure.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </div>
        {error && <div className="msg bad">{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {left > 1 && <span style={{ marginRight: 'auto', opacity: 0.7 }}>Quedan {left - 1} tema(s) más</span>}
          <button className="btn ghost" disabled={busy} onClick={() => void choose('dismiss')}>Ahora no</button>
          <button className="btn" disabled={busy} onClick={() => void choose('shorts')}>{p.shorts.length} vídeos cortos</button>
          <button className="btn primary" disabled={busy} onClick={() => void choose('long')}>Vídeo largo ({dur(p.long.sec)})</button>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import type { StyleProfile, TitleStyle } from '../../shared/styleProfile';
import { errMsg } from '../lib';

const TITLES: Record<TitleStyle, string> = { estetico: 'Estéticos', sobrio: 'Sobrios', llamativo: 'Llamativos' };

function Num(props: { label: string; value: number; step: number; min: number; max: number; unit: string; onSave: (v: number) => void }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  return (
    <label className="row" style={{ gap: 8 }}>
      <span style={{ minWidth: 250 }}>{props.label}</span>
      <input
        type="number"
        style={{ width: 90 }}
        step={props.step}
        min={props.min}
        max={props.max}
        value={text}
        aria-label={props.label}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace(',', '.'));
          if (Number.isFinite(n) && n !== props.value) props.onSave(n);
          else setText(String(props.value));
        }}
      />
      <span className="muted small">{props.unit}</span>
    </label>
  );
}

/**
 * Tu estilo de edición, con los valores que dijiste en la entrevista. Aquí lo consultas y lo corriges; el lore del canal
 * (bromas, muletillas, personajes) lo vas añadiendo tú y el programa lo usa para reconocerlo en los directos.
 */
export default function StyleCard() {
  const [s, setS] = useState<StyleProfile | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [triggers, setTriggers] = useState('');
  async function act(f: () => Promise<StyleProfile>): Promise<boolean> {
    try {
      setS(await f());
      setMsg(null);
      return true;
    } catch (e) {
      setMsg(errMsg(e));
      return false;
    }
  }
  useEffect(() => {
    void act(() => window.api.getStyle());
  }, []);
  const set = (patch: Partial<StyleProfile>) => void act(() => window.api.setStyle(patch));
  if (!s) return <section className="card" aria-label="Tu estilo de edición"><h2>Tu estilo de edición</h2><div className="muted">Cargando…</div></section>;
  return (
    <section className="card" aria-label="Tu estilo de edición">
      <h2>Tu estilo de edición</h2>
      <div className="muted small">
        Lo que contaste en la entrevista. De momento es tu perfil guardado y editable; el montaje automático lo irá usando por fases (silencios, planos, música, títulos), y todo lo que cambies aquí vale para los próximos vídeos.
      </div>
      <div className="list" style={{ marginTop: 10 }}>
        <Num label="Cortar silencios de más de" value={s.silenceMaxSec} step={0.5} min={0.3} max={30} unit="segundos (vídeos largos)" onSave={(v) => set({ silenceMaxSec: v })} />
        <Num label="Cada plano dura como mucho" value={s.shortShotMaxSec} step={0.5} min={0.5} max={30} unit="segundos (clips frenéticos)" onSave={(v) => set({ shortShotMaxSec: v })} />
        <Num label="Cortos verticales, mínimo" value={s.shortMinSec} step={5} min={5} max={600} unit="segundos" onSave={(v) => set({ shortMinSec: v })} />
        <Num label="Cortos verticales, máximo" value={s.shortMaxSec} step={5} min={5} max={600} unit="segundos" onSave={(v) => set({ shortMaxSec: v })} />
        <Num label="Vídeos largos, mínimo" value={Math.round(s.longMinSec / 60)} step={1} min={1} max={120} unit="minutos" onSave={(v) => set({ longMinSec: v * 60 })} />
        <Num label="Vídeos largos, máximo" value={Math.round(s.longMaxSec / 60)} step={1} min={1} max={120} unit="minutos" onSave={(v) => set({ longMaxSec: v * 60 })} />
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.preferTransitions} onChange={(e) => set({ preferTransitions: e.target.checked })} /> Prefiero transiciones a cortes secos
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.music.enabled} onChange={(e) => set({ music: { ...s.music, enabled: e.target.checked } })} /> Música de fondo ({s.music.genre}, solo libre de derechos)
        </label>
        <label className="row" style={{ gap: 8 }}>
          <span style={{ minWidth: 250 }}>Volumen de la música respecto a la voz</span>
          <input type="range" min={0} max={0.5} step={0.01} value={s.music.level} aria-label="Volumen de la música" onChange={(e) => setS({ ...s, music: { ...s.music, level: Number(e.target.value) } })} onMouseUp={() => set({ music: s.music })} onKeyUp={() => set({ music: s.music })} />
          <span className="muted small">{Math.round(s.music.level * 100)} %</span>
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={s.subtitlesDefaultOn} onChange={(e) => set({ subtitlesDefaultOn: e.target.checked })} /> Subtítulos activados por defecto (siempre se pueden activar o quitar en cada vídeo)
        </label>
        <label className="row" style={{ gap: 8 }}>
          <span style={{ minWidth: 250 }}>Estilo de los títulos</span>
          <select value={s.titleStyle} aria-label="Estilo de los títulos" onChange={(e) => set({ titleStyle: e.target.value as TitleStyle })}>
            {(Object.keys(TITLES) as TitleStyle[]).map((k) => <option key={k} value={k}>{TITLES[k]}</option>)}
          </select>
        </label>
      </div>
      <h3 style={{ marginTop: 16 }}>Lore del canal</h3>
      <div className="muted small">
        Bromas recurrentes, muletillas, personajes o sucesos de estos 6 años. Pon cómo lo llamas, qué significa y, si quieres, palabras que lo delatan al hablar (separadas por comas).
      </div>
      {s.lore.length === 0 ? (
        <div className="muted small" style={{ margin: '8px 0' }}>Todavía no hay nada. Se irá llenando poco a poco.</div>
      ) : (
        <ul style={{ margin: '8px 0', paddingLeft: 18 }}>
          {s.lore.map((l) => (
            <li key={l.id} className="small">
              <strong>{l.name}</strong>{l.note ? `: ${l.note}` : ''}{l.triggers.length ? ` (se reconoce por: ${l.triggers.join(', ')})` : ''}{' '}
              <button className="btn ghost small" onClick={() => void act(() => window.api.removeLore(l.id))}>Quitar</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Nombre" aria-label="Nombre del detalle del canal" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
        <input type="text" placeholder="Qué significa" aria-label="Qué significa" value={note} onChange={(e) => setNote(e.target.value)} style={{ width: 280 }} />
        <input type="text" placeholder="Palabras clave, separadas por comas" aria-label="Palabras clave" value={triggers} onChange={(e) => setTriggers(e.target.value)} style={{ width: 240 }} />
        <button
          className="btn small"
          disabled={!name.trim()}
          onClick={() => void act(() => window.api.addLore(name, note, triggers.split(',').map((t) => t.trim()).filter(Boolean))).then((ok) => { if (ok) { setName(''); setNote(''); setTriggers(''); } })}
        >
          Añadir
        </button>
      </div>
      <div style={{ marginTop: 10 }}>
        <button className="btn ghost small" onClick={() => void act(() => window.api.resetStyle())}>Volver a los valores de la entrevista</button>
      </div>
      {msg && <div className="msg bad" role="alert">{msg}</div>}
    </section>
  );
}

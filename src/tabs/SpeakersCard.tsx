import { useEffect, useState } from 'react';
import { DEFAULT_SPEAKER_COLORS } from '../../shared/speakers';
import { errMsg } from '../lib';

type Info = Awaited<ReturnType<typeof window.api.getSpeakers>>;

/**
 * Voces que el programa ha ido reconociendo en tus directos. Cada voz nueva es «Hablante N»; aquí le pones nombre (se
 * recuerda en los próximos directos), marcas cuál eres tú (sale en blanco), unes dos que son la misma persona y eliges los colores
 * de los subtítulos. Si no está seguro de quién habla, la palabra se queda sin color en vez de atribuirla mal.
 */
export default function SpeakersCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [colors, setColors] = useState<string[]>(DEFAULT_SPEAKER_COLORS);
  const [enabled, setEnabled] = useState(true);
  const [names, setNames] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const [i, s] = await Promise.all([window.api.getSpeakers(), window.api.getSettings()]);
      setInfo(i);
      setNames(Object.fromEntries(i.profiles.map((p) => [p.id, p.named ? p.alias : ''])));
      setEnabled(s.autopilot.speakers !== false);
      setColors(s.autopilot.speakerColors?.length ? s.autopilot.speakerColors : DEFAULT_SPEAKER_COLORS);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function act(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try {
      await fn();
      await load();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  const profiles = info?.profiles ?? [];
  return (
    <section className="card" aria-label="Hablantes">
      <h2>Hablantes</h2>
      <div className="muted small">
        El piloto automático identifica quién habla en los tramos que elige (solo en el propio ordenador, sin coste) y pinta los subtítulos de un color por voz.
        La primera vez descarga un modelo de voz de 40 MB. Si dos personas hablan a la vez, o no hay seguridad, esas palabras no se atribuyen a nadie.
        Las voces se reconocen entre directos; con el audio mezclado de Discord puede confundir voces parecidas, por eso puedes unirlas o renombrarlas.
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={enabled} onChange={(e) => void act(() => window.api.setSettings({ autopilot: { speakers: e.target.checked } }), 'Guardado.')} /> Identificar hablantes y colorear los subtítulos por voz
      </label>
      {info && !info.available.ok && <div className="msg bad" role="alert">{info.available.reason}</div>}
      {profiles.length === 0 ? (
        <div className="muted small">Todavía no se ha identificado ninguna voz. Aparecerán tras el próximo análisis.</div>
      ) : (
        <div>
          {profiles.map((p) => (
            <div className="row" key={p.id} style={{ gap: 8, alignItems: 'center', marginTop: 6 }}>
              <input
                aria-label={`Nombre del hablante ${p.id}`}
                value={names[p.id] ?? ''}
                placeholder={`Hablante ${p.id}`}
                onChange={(e) => setNames({ ...names, [p.id]: e.target.value })}
                onBlur={() => names[p.id] !== (p.named ? p.alias : '') && void act(() => window.api.renameSpeaker(p.id, names[p.id] ?? ''), 'Nombre guardado.')}
              />
              <label className="row" style={{ gap: 4 }}>
                <input type="radio" name="self-speaker" checked={p.self} onChange={() => void act(() => window.api.setSelfSpeaker(p.id), 'Marcado como tu voz.')} /> Soy yo
              </label>
              {profiles.length > 1 && (
                <select aria-label={`Unir el hablante ${p.id} con otro`} value="" onChange={(e) => e.target.value && void act(() => window.api.mergeSpeakers(p.id, Number(e.target.value)), 'Hablantes unidos.')}>
                  <option value="">Unir con…</option>
                  {profiles.filter((q) => q.id !== p.id).map((q) => <option key={q.id} value={q.id}>{q.alias}</option>)}
                </select>
              )}
            </div>
          ))}
          {profiles.some((p) => p.self) && <button className="btn" style={{ marginTop: 6 }} onClick={() => void act(() => window.api.setSelfSpeaker(null), 'Ninguna voz marcada como tuya.')}>Quitar «Soy yo»</button>}
        </div>
      )}
      <div className="field">
        <label>Colores de las voces (el primero, para ti)</label>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {colors.map((c, i) => (
            <input key={i} type="color" aria-label={`Color ${i + 1}`} value={c} onChange={(e) => setColors(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
          ))}
        </div>
        <button className="btn" onClick={() => void act(() => window.api.setSettings({ autopilot: { speakerColors: colors } }), 'Colores guardados.')}>Guardar colores</button>
      </div>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
    </section>
  );
}

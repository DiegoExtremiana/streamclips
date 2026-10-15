import { useEffect, useState } from 'react';
import type { AutopilotSettings, Platform } from '../../shared/types';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS } from '../../shared/subtitles';
import { errMsg } from '../lib';

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];

export default function AutopilotCard() {
  const [a, setA] = useState<AutopilotSettings | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    window.api.getSettings().then((s) => { setA(s.autopilot); setKey(s.autopilot.llm.apiKey); }).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);
  if (!a) return <section className="card"><h2>Piloto automático</h2><div className="muted">Cargando…</div></section>;

  const up = (p: Partial<AutopilotSettings>) => setA({ ...a, ...p });

  async function save() {
    if (!a) return;
    setMsg(null);
    try {
      const s = await window.api.setSettings({
        autopilot: {
          enabled: a.enabled, requireApproval: a.requireApproval, maxClips: a.maxClips, subtitles: a.subtitles, platforms: a.platforms,
          slots: a.slots, summaryMinutes: a.summaryMinutes, mainMinutes: a.mainMinutes, chatCapture: a.chatCapture,
          llm: { provider: a.llm.provider, model: a.llm.model, apiKey: key },
        },
      });
      setA(s.autopilot);
      setKey(s.autopilot.llm.apiKey);
      setMsg({ ok: true, text: 'Guardado.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  return (
    <section className="card" aria-label="Piloto automático">
      <h2>Piloto automático</h2>
      <div className="muted small">
        Al terminar un directo, el programa recoge el VOD, lo transcribe, busca los mejores momentos (volumen, voz y chat) y prepara un resumen
        para la mañana, un vídeo principal para la tarde y clips. Por defecto todo espera tu visto bueno en el Panel.
      </div>
      <label className="row" style={{ gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={a.enabled} onChange={(e) => up({ enabled: e.target.checked })} /> Activar el piloto automático
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.requireApproval} onChange={(e) => up({ requireApproval: e.target.checked })} /> Pedir mi visto bueno antes de programar (recomendado)
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.chatCapture} onChange={(e) => up({ chatCapture: e.target.checked })} /> Guardar la actividad del chat durante el directo (anónimo, solo cuenta mensajes)
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-clips">Clips por directo</label>
          <input id="ap-clips" type="text" inputMode="numeric" value={a.maxClips} onChange={(e) => up({ maxClips: num(e.target.value, a.maxClips) })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-sum">Resumen (minutos)</label>
          <input id="ap-sum" type="text" inputMode="numeric" value={a.summaryMinutes} onChange={(e) => up({ summaryMinutes: num(e.target.value, a.summaryMinutes) })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-main">Vídeo principal (minutos)</label>
          <input id="ap-main" type="text" inputMode="numeric" value={a.mainMinutes} onChange={(e) => up({ mainMinutes: num(e.target.value, a.mainMinutes) })} />
        </div>
      </div>
      <div className="row">
        {(['summary', 'main', 'clips'] as const).map((k) => (
          <div className="field" style={{ flex: 1 }} key={k}>
            <label htmlFor={`ap-slot-${k}`}>Hora {k === 'summary' ? 'del resumen' : k === 'main' ? 'del principal' : 'de los clips'}</label>
            <input id={`ap-slot-${k}`} type="text" placeholder="07:00" value={a.slots[k]} onChange={(e) => up({ slots: { ...a.slots, [k]: e.target.value } })} />
          </div>
        ))}
      </div>
      <div className="field">
        <label>Publicar en</label>
        <div className="row" style={{ gap: 14 }}>
          {PLATFORMS.map((p) => (
            <label key={p.id} className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={a.platforms.includes(p.id)}
                onChange={(e) => up({ platforms: e.target.checked ? [...a.platforms, p.id] : a.platforms.filter((x) => x !== p.id) })}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="ap-subs">Subtítulos grabados en lo automático</label>
        <select id="ap-subs" value={a.subtitles} onChange={(e) => up({ subtitles: e.target.value as AutopilotSettings['subtitles'] })}>
          <option value="">Sin subtítulos</option>
          {SUBTITLE_STYLE_IDS.map((id) => <option key={id} value={id}>{SUBTITLE_STYLES[id].label}</option>)}
        </select>
      </div>

      <h3 style={{ marginTop: 14 }}>Títulos con IA (opcional, gratis)</h3>
      <div className="muted small">
        Sin esto, los títulos salen de lo que se dice en cada momento. Con una clave gratuita de Groq o Gemini, un modelo de lenguaje redacta títulos y descripciones.
        Solo se le envía texto de la transcripción; nunca decide los cortes.
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-llm">Proveedor</label>
          <select id="ap-llm" value={a.llm.provider} onChange={(e) => setA({ ...a, llm: { ...a.llm, provider: e.target.value as AutopilotSettings['llm']['provider'] } })}>
            <option value="none">Ninguno</option>
            <option value="groq">Groq</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-model">Modelo (vacío = el recomendado)</label>
          <input id="ap-model" type="text" value={a.llm.model} onChange={(e) => setA({ ...a, llm: { ...a.llm, model: e.target.value } })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ap-key">Clave de API</label>
        <input id="ap-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
      </div>
      <button className="btn" onClick={() => void save()}>Guardar piloto automático</button>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
    </section>
  );
}

import { useEffect, useState } from 'react';
import type { AutopilotSettings, Platform } from '../../shared/types';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS } from '../../shared/subtitles';
import { errMsg } from '../lib';

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'instagram', label: 'Instagram' },
];

/** De «8:00, 12:00 21:30» a ['08:00','12:00','21:30'] (lo inválido se deja tal cual para que el servidor lo rechace). */
function parseTimes(t: string): string[] {
  return t.split(/[\s,;]+/).filter(Boolean).map((x) => (/^\d:\d\d$/.test(x) ? `0${x}` : x));
}

export default function AutopilotCard() {
  const [a, setA] = useState<AutopilotSettings | null>(null);
  const [key, setKey] = useState('');
  const [timesText, setTimesText] = useState({ video: '', clip: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    window.api.getSettings().then((s) => { setA(s.autopilot); setKey(s.autopilot.llm.apiKey); setTimesText({ video: s.autopilot.videoTimes.join(', '), clip: s.autopilot.clipTimes.join(', ') }); }).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
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
          visibility: a.visibility, series: a.series, maxVideos: a.maxVideos, videoTimes: parseTimes(timesText.video), clipTimes: parseTimes(timesText.clip), summaryMinutes: a.summaryMinutes, mainMinutes: a.mainMinutes, chatCapture: a.chatCapture, proEdit: a.proEdit !== false, cleanup: a.cleanup !== false, purgePublished: a.purgePublished !== false, styledCovers: a.styledCovers !== false, fastAnalysis: a.fastAnalysis !== false, parallel: a.parallel ?? 2,
          llm: { provider: a.llm.provider, model: a.llm.model, apiKey: key },
        },
      });
      setA(s.autopilot);
      setKey(s.autopilot.llm.apiKey);
      setTimesText({ video: s.autopilot.videoTimes.join(', '), clip: s.autopilot.clipTimes.join(', ') });
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
        Al terminar un directo, el programa recoge el VOD, lo transcribe (en castellano), busca los mejores momentos (volumen, voz y chat) y prepara
        un resumen, varios vídeos y clips. Los programa solos en las horas de abajo (uno por hueco y día). Todo lo programado se puede cambiar
        en la pestaña Inicio.
      </div>
      <label className="row" style={{ gap: 8, marginTop: 10 }}>
        <input type="checkbox" checked={a.enabled} onChange={(e) => up({ enabled: e.target.checked })} /> Activar el piloto automático
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.requireApproval} onChange={(e) => up({ requireApproval: e.target.checked })} /> Pedir mi visto bueno antes de programar (si no, se programa solo)
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.proEdit !== false} onChange={(e) => up({ proEdit: e.target.checked })} /> Edición profesional: quita silencios y tiempos muertos, acerca la imagen en los momentos fuertes, añade efectos de sonido y fundidos y iguala el volumen
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.fastAnalysis !== false} onChange={(e) => up({ fastAnalysis: e.target.checked })} /> Análisis rápido: elige los momentos por volumen y chat y solo transcribe lo elegido (mucho más rápido que transcribir el directo entero; si lo desactivas, se transcribe todo antes de elegir y los momentos también cuentan por lo que se dice)
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.styledCovers !== false} onChange={(e) => up({ styledCovers: e.target.checked })} /> Portadas con estilo de los canales grandes: el fotograma más vivo y expresivo, una frase corta grande con contorno y el número del episodio
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.cleanup !== false} onChange={(e) => up({ cleanup: e.target.checked })} /> Al terminar, borrar el directo completo y los datos que ya no sirven (se conservan los vídeos, los clips y sus transcripciones; si hace falta el directo más adelante, se vuelve a descargar solo)
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.purgePublished !== false} onChange={(e) => up({ purgePublished: e.target.checked })} /> Borrar cada vídeo o clip (sus archivos) cuando ya está publicado en todas sus redes; en Inicio queda el registro de lo publicado
      </label>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={a.chatCapture} onChange={(e) => up({ chatCapture: e.target.checked })} /> Guardar la actividad del chat durante el directo (anónimo, solo cuenta mensajes)
      </label>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="ap-parallel">Directos que se analizan a la vez</label>
        <select id="ap-parallel" value={a.parallel ?? 2} onChange={(e) => up({ parallel: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="muted small">Se reparten los núcleos del procesador: el total no acaba antes, pero ninguno espera a que termine otro. Con 1 se hacen de uno en uno.</div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-videos">Vídeos por directo (resumen incluido)</label>
          <input id="ap-videos" type="text" inputMode="numeric" value={a.maxVideos} onChange={(e) => up({ maxVideos: num(e.target.value, a.maxVideos) })} />
        </div>
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
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-vtimes">Horas de los vídeos en YouTube (una por vídeo al día)</label>
          <input id="ap-vtimes" type="text" placeholder="08:00, 12:00, 16:00, 21:30" value={timesText.video} onChange={(e) => setTimesText({ ...timesText, video: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-ctimes">Horas de los clips (uno al día por cada hora, en todas las redes)</label>
          <input id="ap-ctimes" type="text" placeholder="10:00, 14:00, 19:00" value={timesText.clip} onChange={(e) => setTimesText({ ...timesText, clip: e.target.value })} />
        </div>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="ap-series">Serie en curso (opcional)</label>
          <input id="ap-series" type="text" maxLength={60} placeholder="Minecraft extremo" value={a.series.name} onChange={(e) => up({ series: { ...a.series, name: e.target.value } })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-series-day">Próximo día</label>
          <input id="ap-series-day" type="text" inputMode="numeric" value={a.series.nextDay} onChange={(e) => up({ series: { ...a.series, nextDay: num(e.target.value, a.series.nextDay) } })} />
        </div>
      </div>
      <div className="muted small">
        Con una serie, los vídeos de cada directo se llaman «{a.series.name.trim() || 'Minecraft extremo'} Día {a.series.nextDay}» (y «- Resumen» o «- Parte 2» si hay varios),
        y el tema concreto va a la descripción. El día sube solo con cada directo. Si el título del directo ya dice «… día 3», se usa ese y no hace falta rellenar nada.
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
        <label htmlFor="ap-vis">Visibilidad en YouTube de lo automático</label>
        <select id="ap-vis" value={a.visibility} onChange={(e) => up({ visibility: e.target.value as AutopilotSettings['visibility'] })}>
          <option value="public">Público (sale abierto a su hora)</option>
          <option value="private">Privado (solo tú lo ves; lo haces público a mano)</option>
        </select>
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

import { useEffect, useState, type ReactNode } from 'react';
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

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

type Msg = { ok: boolean; text: string } | null;

/**
 * Carga los ajustes del piloto una vez y deja guardar solo los campos de cada tarjeta (el servidor admite cambios parciales),
 * para que las tarjetas de Ajustes sean independientes y una no pise a otra.
 */
function useAutopilot() {
  const [a, setA] = useState<AutopilotSettings | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    window.api.getSettings().then((s) => setA(s.autopilot)).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);
  const up = (p: Partial<AutopilotSettings>) => setA((cur) => (cur ? { ...cur, ...p } : cur));
  async function save(patch: Parameters<typeof window.api.setSettings>[0]['autopilot']): Promise<AutopilotSettings | null> {
    setMsg(null);
    try {
      const s = await window.api.setSettings({ autopilot: patch });
      setA(s.autopilot);
      setMsg({ ok: true, text: 'Guardado.' });
      return s.autopilot;
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
      return null;
    }
  }
  return { a, up, save, msg };
}

function Check(props: { checked: boolean; onChange: (v: boolean) => void; title: string; children?: ReactNode }) {
  return (
    <label className="opt">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        <strong>{props.title}</strong>
        {props.children && <span className="muted small opt-help">{props.children}</span>}
      </span>
    </label>
  );
}

function Loading(props: { title: string }) {
  return <section className="card"><h2>{props.title}</h2><div className="muted">Cargando…</div></section>;
}

const Status = ({ msg }: { msg: Msg }) => (msg ? <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div> : null);

/** Qué hace el programa solo al acabar un directo. */
export function AutopilotCard() {
  const { a, up, save, msg } = useAutopilot();
  const [counts, setCounts] = useState<{ minQuality: string } | null>(null);
  if (!a) return <Loading title="Piloto automático" />;
  const q = counts?.minQuality ?? String(a.minQuality ?? 6.5);
  return (
    <section className="card" aria-label="Piloto automático">
      <h2>Piloto automático</h2>
      <div className="muted small">
        Al terminar un directo, el programa recoge el VOD, lo transcribe (en castellano), busca los mejores momentos (volumen, voz y chat) y prepara
        un resumen, varios vídeos y clips. Todo lo programado se puede cambiar en la pestaña Inicio.
      </div>
      <Check checked={a.enabled} onChange={(v) => up({ enabled: v })} title="Activar el piloto automático" />
      <Check checked={a.requireApproval} onChange={(v) => up({ requireApproval: v })} title="Pedir mi visto bueno antes de programar">Si lo desactivas, se programa solo.</Check>
      <Check checked={a.proEdit !== false} onChange={(v) => up({ proEdit: v })} title="Edición profesional">Quita silencios y tiempos muertos, acerca la imagen en los momentos fuertes, añade efectos de sonido y fundidos e iguala el volumen.</Check>
      <Check checked={a.soundCues !== false} onChange={(v) => up({ soundCues: v })} title="Efectos de sonido según lo que digo">Pone un sonido cuando dices «ganamos», «dinero», «he muerto»… (sonidos propios, sin derechos de autor; puedes sustituir cualquiera dejando un archivo con su nombre, por ejemplo tada.mp3, en %APPDATA%\\StreamClips\\Sonidos).</Check>
      <Check checked={a.music !== false} onChange={(v) => up({ music: v })} title="Música lofi de fondo">Si el vídeo no tiene ya música o sonido de fondo, añade una lofi sin letra, siempre por debajo de las voces, según el tema (café, viaje, noche, charla, juego). Puedes poner tu propia música con ese nombre (cafe.mp3…) en %APPDATA%\\StreamClips\\Música.</Check>
      <Check checked={a.topics !== false} onChange={(v) => up({ topics: v })} title="Vídeos por tema">Si hablas de lo mismo en varios momentos del directo, los junta en orden en un vídeo con sentido (unos 10 min, algo más o menos).</Check>
      <Check checked={a.fastAnalysis !== false} onChange={(v) => up({ fastAnalysis: v })} title="Análisis rápido">Elige los momentos por volumen y chat y solo transcribe lo elegido (mucho más rápido). Si lo desactivas, se transcribe todo antes de elegir y los momentos también cuentan por lo que se dice.</Check>
      <Check checked={a.chatCapture} onChange={(v) => up({ chatCapture: v })} title="Guardar la actividad del chat durante el directo">Es anónimo: solo cuenta mensajes.</Check>
      <Check checked={a.cleanup !== false} onChange={(v) => up({ cleanup: v })} title="Borrar el directo completo al terminar">Se conservan los vídeos, los clips y sus transcripciones; si hace falta el directo más adelante, se vuelve a descargar solo.</Check>
      <Check checked={a.purgePublished !== false} onChange={(v) => up({ purgePublished: v })} title="Borrar cada vídeo o clip cuando ya está publicado en todas sus redes">En Inicio queda el registro de lo publicado.</Check>

      <h3>Cuánto prepara</h3>
      <div className="row">
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
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-q">Nota mínima (3 a 9,5)</label>
          <input id="ap-q" type="text" inputMode="decimal" value={q} onChange={(e) => setCounts({ minQuality: e.target.value })} title="Solo entran momentos con esta nota o más. Más alta: menos vídeos pero mejores; más baja: más material." />
        </div>
      </div>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="ap-parallel">Directos que se analizan a la vez</label>
        <select id="ap-parallel" value={a.parallel ?? 2} onChange={(e) => up({ parallel: Number(e.target.value) })}>
          {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className="muted small">Se reparten los núcleos del procesador: el total no acaba antes, pero ninguno espera a que termine otro. Con 1 se hacen de uno en uno.</div>
      </div>

      <h3>Serie en curso</h3>
      <div className="row">
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="ap-series">Nombre de la serie (opcional)</label>
          <input id="ap-series" type="text" maxLength={60} placeholder="Minecraft extremo" value={a.series.name} onChange={(e) => up({ series: { ...a.series, name: e.target.value } })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-series-day">Próximo día</label>
          <input id="ap-series-day" type="text" inputMode="numeric" value={a.series.nextDay} onChange={(e) => up({ series: { ...a.series, nextDay: num(e.target.value, a.series.nextDay) } })} />
        </div>
      </div>
      <div className="muted small">
        Con una serie, los vídeos de cada directo se llaman «{a.series.name.trim() || 'Minecraft extremo'} Día {a.series.nextDay}» (y «- Resumen» o «- Parte 2» si hay varios),
        y el tema concreto va a la descripción. El día sube solo con cada directo. Si el título del directo ya dice «… día 3», se usa ese.
      </div>
      <button
        className="btn"
        onClick={() => {
          const minQuality = Number(q.replace(',', '.'));
          void save({
            enabled: a.enabled, requireApproval: a.requireApproval, proEdit: a.proEdit !== false, soundCues: a.soundCues !== false, music: a.music !== false, topics: a.topics !== false, fastAnalysis: a.fastAnalysis !== false, chatCapture: a.chatCapture,
            cleanup: a.cleanup !== false, purgePublished: a.purgePublished !== false, maxVideos: a.maxVideos, maxClips: a.maxClips, summaryMinutes: a.summaryMinutes,
            mainMinutes: a.mainMinutes, parallel: a.parallel ?? 2, series: a.series, ...(Number.isFinite(minQuality) && q.trim() !== '' ? { minQuality } : {}),
          }).then(() => setCounts(null));
        }}
      >
        Guardar piloto automático
      </button>
      <Status msg={msg} />
    </section>
  );
}

/** Cuándo y dónde se publica lo automático. */
export function PublishingCard() {
  const { a, up, save, msg } = useAutopilot();
  const [times, setTimes] = useState<{ video: string; clip: string } | null>(null);
  useEffect(() => {
    if (a && !times) setTimes({ video: a.videoTimes.join(', '), clip: a.clipTimes.join(', ') });
  }, [a, times]);
  if (!a || !times) return <Loading title="Qué se publica y cuándo" />;
  return (
    <section className="card" aria-label="Qué se publica y cuándo">
      <h2>Qué se publica y cuándo</h2>
      <div className="muted small">Lo que prepara el piloto automático se programa solo en estos huecos (uno por hueco y día).</div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-vtimes">Horas de los vídeos en YouTube (una por vídeo al día)</label>
          <input id="ap-vtimes" type="text" placeholder="08:00, 12:00, 16:00, 21:30" value={times.video} onChange={(e) => setTimes({ ...times, video: e.target.value })} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-ctimes">Horas de los clips (uno al día por cada hora, en todas las redes)</label>
          <input id="ap-ctimes" type="text" placeholder="10:00, 14:00, 19:00" value={times.clip} onChange={(e) => setTimes({ ...times, clip: e.target.value })} />
        </div>
      </div>
      <div className="field">
        <label>Publicar en</label>
        <div className="row" style={{ gap: 14 }}>
          {PLATFORMS.map((p) => (
            <label key={p.id} className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={a.platforms.includes(p.id)} onChange={(e) => up({ platforms: e.target.checked ? [...a.platforms, p.id] : a.platforms.filter((x) => x !== p.id) })} />
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
      <button className="btn" onClick={() => void save({ platforms: a.platforms, visibility: a.visibility, videoTimes: parseTimes(times.video), clipTimes: parseTimes(times.clip) }).then((s) => s && setTimes({ video: s.videoTimes.join(', '), clip: s.clipTimes.join(', ') }))}>
        Guardar publicación
      </button>
      <Status msg={msg} />
    </section>
  );
}

/** Subtítulos grabados en lo automático. */
export function AutoSubtitlesCard() {
  const { a, up, save, msg } = useAutopilot();
  if (!a) return <Loading title="Subtítulos de lo automático" />;
  return (
    <section className="card" aria-label="Subtítulos de lo automático">
      <h2>Subtítulos de lo automático</h2>
      <div className="field">
        <label htmlFor="ap-subs">Subtítulos grabados en los vídeos que prepara solo el programa</label>
        <select id="ap-subs" value={a.subtitles} onChange={(e) => up({ subtitles: e.target.value as AutopilotSettings['subtitles'] })}>
          <option value="">Sin subtítulos</option>
          {SUBTITLE_STYLE_IDS.map((id) => <option key={id} value={id}>{SUBTITLE_STYLES[id].label}</option>)}
        </select>
      </div>
      <button className="btn" onClick={() => void save({ subtitles: a.subtitles })}>Guardar subtítulos</button>
      <Status msg={msg} />
    </section>
  );
}

/** La clave del modelo de lenguaje y lo que se hace con él. */
export function AiCard() {
  const { a, up, save, msg } = useAutopilot();
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (a && key === null) setKey(a.llm.apiKey);
  }, [a, key]);
  if (!a || key === null) return <Loading title="Inteligencia artificial" />;
  const on = a.llm.provider !== 'none' && key !== '';
  return (
    <section className="card" aria-label="Inteligencia artificial">
      <h2>Inteligencia artificial (gratis)</h2>
      <div className="muted small">
        Un modelo de lenguaje gratuito (Groq o Gemini) lee lo que se dice en los clips y en los directos para puntuarlos, elegir los mejores momentos y redactar títulos.
        Solo se le envía texto de la transcripción; nunca ve tu pantalla ni decide los cortes.
      </div>
      <div className="row" style={{ gap: 8, margin: '8px 0' }}>
        <span className={`badge ${on ? 'ok' : 'warn'}`}>{on ? 'Conectado' : 'Sin clave: se usa solo el volumen y el chat'}</span>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-llm">Proveedor</label>
          <select id="ap-llm" value={a.llm.provider} onChange={(e) => up({ llm: { ...a.llm, provider: e.target.value as AutopilotSettings['llm']['provider'] } })}>
            <option value="none">Ninguno</option>
            <option value="groq">Groq (recomendado)</option>
            <option value="gemini">Gemini</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="ap-model">Modelo (vacío = el recomendado)</label>
          <input id="ap-model" type="text" value={a.llm.model} onChange={(e) => up({ llm: { ...a.llm, model: e.target.value } })} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="ap-key">Clave de API</label>
        <input id="ap-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="gsk_…" />
      </div>
      <details className="howto">
        <summary>Cómo conseguir la clave gratuita de Groq, paso a paso</summary>
        <ol>
          <li>Abre <code>console.groq.com/keys</code> en el navegador.</li>
          <li>Inicia sesión con tu cuenta de Google o de GitHub. No pide tarjeta.</li>
          <li>Pulsa <strong>Create API Key</strong>, ponle un nombre (por ejemplo StreamClips) y confirma.</li>
          <li>Copia la clave en ese momento (empieza por <code>gsk_</code>): no se vuelve a mostrar.</li>
          <li>Aquí arriba, elige <strong>Groq</strong> como proveedor, pega la clave en «Clave de API» y pulsa Guardar.</li>
        </ol>
      </details>

      <h3>Qué hace con ella</h3>
      <Check checked={a.scoreClips !== false} onChange={(v) => up({ scoreClips: v })} title="Puntuar en segundo plano los clips de tu canal">
        Solo con el equipo libre y sin directo en marcha. La nota (x/10, con sus cuatro criterios y el motivo) se ve en Clips y marca en dorado los mejores. Al poner la clave, se vuelven a puntuar los clips que se hicieron sin ella.
      </Check>
      <Check checked={a.smartSelect !== false} onChange={(v) => up({ smartSelect: v })} title="Selección inteligente de momentos">
        El modelo lee cada candidato y puntúa humor, originalidad, interacción, reacción, contexto y si se entiende solo; elige con variedad y no rellena con momentos flojos.
      </Check>
      <button className="btn" onClick={() => void save({ scoreClips: a.scoreClips !== false, smartSelect: a.smartSelect !== false, llm: { provider: a.llm.provider, model: a.llm.model, apiKey: key } }).then((s) => s && setKey(s.llm.apiKey))}>
        Guardar inteligencia artificial
      </button>
      <Status msg={msg} />
    </section>
  );
}

/** Aspecto de las portadas automáticas. */
export function CoversStyleCard() {
  const { a, up, save, msg } = useAutopilot();
  if (!a) return <Loading title="Portadas automáticas" />;
  return (
    <section className="card" aria-label="Portadas automáticas">
      <h2>Portadas automáticas</h2>
      <Check checked={a.styledCovers !== false} onChange={(v) => up({ styledCovers: v })} title="Portadas con estilo de los canales grandes">El fotograma más vivo y expresivo, una frase corta grande con contorno y el número del episodio.</Check>
      <button className="btn" onClick={() => void save({ styledCovers: a.styledCovers !== false })}>Guardar portadas</button>
      <Status msg={msg} />
    </section>
  );
}

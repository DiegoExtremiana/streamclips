import { useEffect, useState, type ReactNode } from 'react';
import type { AutopilotSettings, Platform } from '../../shared/types';
import { MAX_LLM_SLOTS } from '../../shared/model/settings';
import { AI_LABEL, assignments, type AiProvider } from '../../shared/llmRoles';
import { SUBTITLE_STYLES, SUBTITLE_STYLE_IDS } from '../../shared/subtitles';
import { errMsg } from '../lib';
import { SubTabs, useSubTab } from '../SubTabs';

import { IconBolt, IconEye, IconKey, IconPen, IconPlus, IconRoute, IconStar, IconTrash } from '../icons';
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

const AP_TABS = [{ id: 'publicar', label: 'Antes de publicar' },{ id: 'edita', label: 'Cómo edita' },{ id: 'busca', label: 'Cómo busca los momentos' },{ id: 'limpieza', label: 'Limpieza' },{ id: 'prepara', label: 'Cuánto prepara' },{ id: 'serie', label: 'Serie en curso' }];

/** Qué hace el programa solo al acabar un directo. */
export function AutopilotCard() {
  const { a, up, save, msg } = useAutopilot();
  const [pt, setPt] = useSubTab('streamclips.ap.tab', AP_TABS.map((t) => t.id));
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
      <div className="apsummary" data-testid="ap-summary">
        <span className={`badge ${a.enabled ? 'ok' : 'warn'}`}>{a.enabled ? 'Activado' : 'Desactivado'}</span>
        <span className="muted small">
          {a.enabled
            ? `Prepara hasta ${a.maxVideos} vídeo(s) y ${a.maxClips} clip(s) por directo${a.requireApproval ? ' y te pide el visto bueno antes de programar' : ' y lo programa solo'}.`
            : 'No hace nada solo: puedes analizar los directos a mano desde Clips y publicación.'}
        </span>
      </div>
      <Check checked={a.enabled} onChange={(v) => up({ enabled: v })} title="Activar el piloto automático" />
      <SubTabs label="Bloques del piloto automático" tabs={AP_TABS} value={pt} onChange={setPt} />

      {pt === 'publicar' && (<div className="aptab" role="tabpanel">
      <Check checked={a.requireApproval} onChange={(v) => up({ requireApproval: v })} title="Pedir mi visto bueno antes de programar">Si lo desactivas, se programa solo.</Check>
      </div>)}
      {pt === 'edita' && (<div className="aptab" role="tabpanel">
      <Check checked={a.director !== false} onChange={(v) => up({ director: v })} title="Director de edición para YouTube">Con los momentos ya valorados (lo que se dice, lo que se ve, el volumen y el chat), la IA decide la estructura del vídeo largo como un editor: un gancho con lo más fuerte en los primeros segundos, capítulos con sentido y ritmo, un cierre, rótulos en pantalla, el título, la descripción con capítulos y la frase de la miniatura. Si no puede, se monta el resumen de mejores momentos de siempre.</Check>
      <Check checked={a.studio !== false} onChange={(v) => up({ studio: v })} title="Estudio de edición con varios editores de IA">En vez de un solo director, varios editores trabajan a la vez sobre los momentos valorados, como en una sala de edición: el de historia decide la estructura del vídeo resumen, el de ritmo recorta el aire de cada momento, el de humor elige los clips graciosos con su inicio y su remate, y un jefe de edición revisa el montaje y quita lo que sobra. Si alguno no responde, el resto sigue.</Check>
      <Check checked={a.proEdit !== false} onChange={(v) => up({ proEdit: v })} title="Edición profesional">Quita silencios y tiempos muertos, acerca la imagen en los momentos fuertes, añade efectos de sonido y fundidos e iguala el volumen.</Check>
      <Check checked={a.soundCues !== false} onChange={(v) => up({ soundCues: v })} title="Efectos de sonido según lo que digo">Pone un sonido cuando dices «ganamos», «dinero», «he muerto»… (sonidos propios, sin derechos de autor; puedes sustituir cualquiera dejando un archivo con su nombre, por ejemplo tada.mp3, en %APPDATA%\\StreamClips\\Sonidos).</Check>
      <Check checked={a.music !== false} onChange={(v) => up({ music: v })} title="Música lofi de fondo">Si el vídeo no tiene ya música o sonido de fondo, añade una lofi sin letra, siempre por debajo de las voces, según el tema (café, viaje, noche, charla, juego). Puedes poner tu propia música con ese nombre (cafe.mp3…) en %APPDATA%\\StreamClips\\Música.</Check>
      </div>)}
      {pt === 'busca' && (<div className="aptab" role="tabpanel">
      <Check checked={a.fastAnalysis !== false} onChange={(v) => up({ fastAnalysis: v })} title="Análisis rápido">Elige los momentos por volumen y chat y solo transcribe lo elegido (mucho más rápido). Si lo desactivas, se transcribe todo antes de elegir y los momentos también cuentan por lo que se dice.</Check>
      <Check checked={a.vodVision !== false} onChange={(v) => up({ vodVision: v })} title="Mirar el directo, no solo oírlo">De los mejores momentos saca fotogramas y el modelo puntúa lo que se ve (gestos, pantalla, gags visuales) y descarta los momentos con la imagen muerta (pantalla de espera, menú). Es un factor más de la nota.</Check>
      <Check checked={a.topics !== false} onChange={(v) => up({ topics: v })} title="Vídeos por tema">Busca temas e historias que se retoman a lo largo del directo y, si hay material, hace un vídeo con sentido o te pregunta si prefieres uno largo o varios cortos.</Check>
      <Check checked={a.chatCapture} onChange={(v) => up({ chatCapture: v })} title="Guardar la actividad del chat durante el directo">Es anónimo: solo cuenta mensajes.</Check>
      </div>)}
      {pt === 'limpieza' && (<div className="aptab" role="tabpanel">
      <Check checked={a.cleanup !== false} onChange={(v) => up({ cleanup: v })} title="Borrar el directo completo al terminar">Se conservan los vídeos, los clips y sus transcripciones; si hace falta el directo más adelante, se vuelve a descargar solo.</Check>
      <Check checked={a.purgePublished !== false} onChange={(v) => up({ purgePublished: v })} title="Borrar cada vídeo o clip cuando ya está publicado en todas sus redes">En Inicio queda el registro de lo publicado.</Check>
      </div>)}
      {pt === 'prepara' && (<div className="aptab" role="tabpanel">
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

      </div>)}
      {pt === 'serie' && (<div className="aptab" role="tabpanel">
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
      </div>)}
      <button
        className="btn"
        onClick={() => {
          const minQuality = Number(q.replace(',', '.'));
          void save({
            enabled: a.enabled, requireApproval: a.requireApproval, proEdit: a.proEdit !== false, director: a.director !== false, studio: a.studio !== false, soundCues: a.soundCues !== false, music: a.music !== false, topics: a.topics !== false, vodVision: a.vodVision !== false, fastAnalysis: a.fastAnalysis !== false, chatCapture: a.chatCapture,
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
/** Cómo se presenta cada IA: un icono por lo que mejor hace (no son los logotipos de las marcas) y su color. */
const AI_LOOK: Record<AiProvider, { icon: ReactNode; tint: string; strength: string; placeholder: string }> = {
  gemini: { icon: <IconEye size={18} />, tint: 'ai-blue', strength: 'Ve imágenes y entiende textos largos. La mejor para la principal.', placeholder: 'AIza…' },
  groq: { icon: <IconBolt size={18} />, tint: 'ai-orange', strength: 'La más rápida. Ideal para valorar muchos momentos.', placeholder: 'gsk_…' },
  mistral: { icon: <IconPen size={18} />, tint: 'ai-violet', strength: 'Buena redactando: temas, títulos y descripciones.', placeholder: 'Clave de Mistral' },
  openrouter: { icon: <IconRoute size={18} />, tint: 'ai-green', strength: 'Reparte entre modelos gratuitos. Útil como último relevo.', placeholder: 'sk-or-…' },
};
const AI_ORDER: AiProvider[] = ['gemini', 'groq', 'mistral', 'openrouter'];

function AiBadge({ p, size = 'md' }: { p: AiProvider; size?: 'sm' | 'md' }) {
  return <span className={`ai-tile ${AI_LOOK[p].tint} ${size}`} aria-hidden="true">{AI_LOOK[p].icon}</span>;
}

type AiItem = { provider: AiProvider; model: string; apiKey: string };

export function AiCard() {
  const { a, up, save, msg } = useAutopilot();
  const [items, setItems] = useState<AiItem[] | null>(null);
  const [open, setOpen] = useState<AiProvider | null>(null);
  useEffect(() => {
    if (!a || items) return;
    const main: AiItem[] = a.llm.provider !== 'none' ? [{ provider: a.llm.provider, model: a.llm.model, apiKey: a.llm.apiKey }] : [];
    setItems([...main, ...(a.llmExtra ?? []).filter((x) => x.provider !== a.llm.provider)]);
  }, [a, items]);
  if (!a || !items) return <Loading title="Inteligencia artificial" />;
  const configured = items.filter((x) => x.apiKey).map((x) => x.provider);
  const roles = assignments(configured);
  const leads = (p: AiProvider) => roles.filter((r) => r.main === p);
  const missing = AI_ORDER.filter((p) => !items.some((x) => x.provider === p));
  const set = (p: AiProvider, patch: Partial<AiItem>) => setItems(items.map((x) => (x.provider === p ? { ...x, ...patch } : x)));
  const remove = (p: AiProvider) => setItems(items.filter((x) => x.provider !== p));
  const makeMain = (p: AiProvider) => setItems([...items.filter((x) => x.provider === p), ...items.filter((x) => x.provider !== p)]);
  const add = (p: AiProvider) => {
    setItems([...items, { provider: p, model: '', apiKey: '' }]);
    setOpen(p);
  };
  const doSave = () => {
    const [main, ...rest] = items;
    void save({
      scoreClips: a.scoreClips !== false,
      smartSelect: a.smartSelect !== false,
      llm: main ? { provider: main.provider, model: main.model, apiKey: main.apiKey } : { provider: 'none', model: '', apiKey: '' },
      llmExtra: rest.filter((x) => x.apiKey),
    }).then((s) => {
      if (!s) return;
      const m: AiItem[] = s.llm.provider !== 'none' ? [{ provider: s.llm.provider, model: s.llm.model, apiKey: s.llm.apiKey }] : [];
      setItems([...m, ...(s.llmExtra ?? []).filter((x) => x.provider !== s.llm.provider)]);
    });
  };
  return (
    <section className="card" aria-label="Inteligencia artificial">
      <div className="ai-head">
        <div>
          <h2>Inteligencia artificial</h2>
          <div className="muted small">Cuentas gratuitas que forman tu equipo de edición. Cada una tiene sus tareas y, si una falla, otra la sustituye.</div>
        </div>
        <span className={`badge ${configured.length ? 'ok' : 'warn'}`}>{configured.length ? `${configured.length} conectada${configured.length > 1 ? 's' : ''}` : 'Ninguna conectada'}</span>
      </div>

      <h3>Tu equipo</h3>
      {!items.length && <div className="muted small">Todavía no hay ninguna IA. Sin ella se usa solo el volumen y el chat. Empieza por Gemini.</div>}
      <div className="ai-list">
        {items.map((x, i) => {
          const tasks = leads(x.provider);
          const isOpen = open === x.provider || !x.apiKey;
          return (
            <div className={`ai-item ${i === 0 ? 'main' : ''}`} key={x.provider} data-testid={`ai-item-${x.provider}`}>
              <div className="ai-item-top">
                <AiBadge p={x.provider} />
                <div className="ai-item-name">
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <strong>{AI_LABEL[x.provider]}</strong>
                    <span className={`badge ${i === 0 ? 'accent' : ''}`}>{i === 0 ? 'Principal' : 'Apoyo'}</span>
                    <span className={`badge ${x.apiKey ? 'ok' : 'warn'}`}>{x.apiKey ? 'Conectada' : 'Falta la clave'}</span>
                  </div>
                  <div className="muted small">{AI_LOOK[x.provider].strength}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {i > 0 && (
                    <button className="iconbtn" aria-label={`Hacer principal a ${AI_LABEL[x.provider]}`} title="Hacer principal" onClick={() => makeMain(x.provider)}>
                      <IconStar size={15} />
                    </button>
                  )}
                  <button className="iconbtn" aria-label={`Clave y modelo de ${AI_LABEL[x.provider]}`} title="Clave y modelo" aria-expanded={isOpen} onClick={() => setOpen(open === x.provider ? null : x.provider)}>
                    <IconKey size={15} />
                  </button>
                  <button className="iconbtn danger" aria-label={`Quitar ${AI_LABEL[x.provider]}`} title="Quitar" onClick={() => remove(x.provider)}>
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
              {tasks.length > 0 && (
                <div className="ai-tasks">
                  {tasks.map((t) => (
                    <span className="chip" key={t.id} title={t.why}>{t.label.split(':')[0]}</span>
                  ))}
                </div>
              )}
              {isOpen && (
                <div className="ai-fields">
                  <div className="field">
                    <label htmlFor={`ai-key-${x.provider}`}>Clave de API</label>
                    <input id={`ai-key-${x.provider}`} type="password" value={x.apiKey} placeholder={AI_LOOK[x.provider].placeholder} autoComplete="off" onChange={(e) => set(x.provider, { apiKey: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ai-model-${x.provider}`}>Modelo (vacío = el recomendado)</label>
                    <input id={`ai-model-${x.provider}`} type="text" value={x.model} onChange={(e) => set(x.provider, { model: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {missing.length > 0 && items.length < MAX_LLM_SLOTS + 1 && (
        <>
          <h3>Añadir una IA</h3>
          <div className="ai-add">
            {missing.map((p) => (
              <button className="ai-add-btn" key={p} onClick={() => add(p)} aria-label={`Añadir ${AI_LABEL[p]}`}>
                <AiBadge p={p} size="sm" />
                <span>
                  <strong>{AI_LABEL[p]}</strong>
                  <span className="muted small">{AI_LOOK[p].strength}</span>
                </span>
                <IconPlus size={15} />
              </button>
            ))}
          </div>
        </>
      )}

      <h3>Quién hace qué</h3>
      <table className="ai-roles" data-testid="ai-roles">
        <thead>
          <tr><th>Tarea</th><th>La hace</th><th>Si falla</th></tr>
        </thead>
        <tbody>
          {roles.map((t) => (
            <tr key={t.id} title={t.why}>
              <td>{t.label}</td>
              <td>
                {t.main ? (
                  <span className="ai-who"><AiBadge p={t.main} size="sm" />{AI_LABEL[t.main]}</span>
                ) : (
                  <span className="badge warn">Nadie</span>
                )}
              </td>
              <td>
                <span className="ai-backups">
                  {t.backups.length ? t.backups.map((p) => <AiBadge key={p} p={p} size="sm" />) : <span className="muted small">Sin relevo</span>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <KeyHowTo current={items[0]?.provider ?? 'gemini'} />

      <h3>Qué hace con ella</h3>
      <Check checked={a.scoreClips !== false} onChange={(v) => up({ scoreClips: v })} title="Puntuar en segundo plano los clips de tu canal">
        Solo con el equipo libre y sin directo en marcha. La nota (x/10, con sus cuatro criterios y el motivo) se ve en Clips y marca en dorado los mejores. Al poner la clave, se vuelven a puntuar los clips que se hicieron sin ella.
      </Check>
      <Check checked={a.smartSelect !== false} onChange={(v) => up({ smartSelect: v })} title="Selección inteligente de momentos">
        El modelo lee cada candidato y puntúa humor, originalidad, interacción, reacción, contexto y si se entiende solo; elige con variedad y no rellena con momentos flojos.
      </Check>
      <button className="btn" onClick={doSave}>
        Guardar inteligencia artificial
      </button>
      <Status msg={msg} />
    </section>
  );
}

type KeyProvider = 'gemini' | 'groq' | 'mistral' | 'openrouter';
const KEY_GUIDE: Record<KeyProvider, { name: string; steps: ReactNode[]; note: string }> = {
  gemini: {
    name: 'Gemini (Google)',
    steps: [
      <>Abre <code>aistudio.google.com/apikey</code> en el navegador.</>,
      <>Inicia sesión con tu cuenta de Google. No pide tarjeta.</>,
      <>Pulsa <strong>Crear clave de API</strong> (Create API key). Si te pide un proyecto, elige uno nuevo o el que te proponga.</>,
      <>Copia la clave (empieza por <code>AIza</code>).</>,
      <>Aquí arriba, elige <strong>Gemini</strong> como proveedor, pega la clave en «Clave de API» y pulsa Guardar inteligencia artificial.</>,
    ],
    note: 'Ve las imágenes de los clips directamente. En el plan gratuito, Google puede usar lo que se le envía (frases y fotogramas) para mejorar sus productos. Sus límites diarios se ven en tu panel de AI Studio.',
  },
  groq: {
    name: 'Groq',
    steps: [
      <>Abre <code>console.groq.com/keys</code> en el navegador.</>,
      <>Inicia sesión con tu cuenta de Google o de GitHub. No pide tarjeta.</>,
      <>Pulsa <strong>Create API Key</strong>, ponle un nombre (por ejemplo StreamClips) y confirma.</>,
      <>Copia la clave en ese momento (empieza por <code>gsk_</code>): no se vuelve a mostrar.</>,
      <>Aquí arriba, elige <strong>Groq</strong> como proveedor, pega la clave en «Clave de API» y pulsa Guardar inteligencia artificial.</>,
    ],
    note: 'Muy rápido, pero con un límite diario de texto bajo (cientos de clips al día como mucho) y la imagen depende de un modelo en vista previa.',
  },
  mistral: {
    name: 'Mistral',
    steps: [
      <>Abre <code>console.mistral.ai</code> en el navegador y crea una cuenta (pide verificar un teléfono, no tarjeta).</>,
      <>Elige el plan gratuito <strong>Experiment</strong>.</>,
      <>Entra en <strong>API Keys</strong>, pulsa <strong>Create new key</strong> y copia la clave.</>,
      <>Aquí arriba, pulsa «Añadir IA de apoyo», elige <strong>Mistral</strong>, pega la clave y pulsa Guardar inteligencia artificial.</>,
    ],
    note: 'Sirve de relevo para el texto. En el plan gratuito, Mistral puede usar lo que se le envía para mejorar sus modelos. El programa no le manda imágenes.',
  },
  openrouter: {
    name: 'OpenRouter',
    steps: [
      <>Abre <code>openrouter.ai/keys</code> en el navegador e inicia sesión con Google o GitHub. No pide tarjeta.</>,
      <>Pulsa <strong>Create Key</strong>, ponle un nombre y copia la clave (empieza por <code>sk-or-</code>).</>,
      <>Aquí arriba, pulsa «Añadir IA de apoyo», elige <strong>OpenRouter</strong>, pega la clave y pulsa Guardar inteligencia artificial.</>,
    ],
    note: 'Con el modelo recomendado reparte cada petición entre los modelos gratuitos que haya en ese momento, así que la calidad varía y el límite diario es bajo. Es el último relevo. El programa no le manda imágenes.',
  },
};

/** Cómo conseguir la clave gratuita: se elige el proveedor y salen sus pasos (empieza en el que está elegido arriba). */
function KeyHowTo({ current }: { current: string }) {
  const [pick, setPick] = useState<KeyProvider>(current === 'groq' || current === 'mistral' || current === 'openrouter' ? current : 'gemini');
  useEffect(() => { if (current === 'groq' || current === 'gemini' || current === 'mistral' || current === 'openrouter') setPick(current); }, [current]);
  const g = KEY_GUIDE[pick];
  return (
    <details className="howto" data-testid="key-howto">
      <summary>Cómo conseguir la clave gratuita, paso a paso</summary>
      <div className="field" style={{ margin: '8px 0' }}>
        <label htmlFor="ap-howto">Proveedor</label>
        <select id="ap-howto" value={pick} onChange={(e) => setPick(e.target.value as KeyProvider)}>
          {(Object.keys(KEY_GUIDE) as KeyProvider[]).map((k) => (
            <option key={k} value={k}>{KEY_GUIDE[k].name}</option>
          ))}
        </select>
      </div>
      <ol>
        {g.steps.map((st, i) => (
          <li key={i}>{st}</li>
        ))}
      </ol>
      <div className="muted small">{g.note}</div>
    </details>
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

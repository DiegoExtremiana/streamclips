import { useEffect, useState } from 'react';
import { IconCheck } from '../icons';
import type { TabId } from '../App';

interface Step {
  id: string;
  title: string;
  why: string;
  done: boolean;
  go: TabId;
  action: string;
}

const HIDE_KEY = 'streamclips.guide.hidden';
const read = (): boolean => {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * «Primeros pasos»: lo mínimo para que el programa trabaje solo. Cada paso se marca al cumplirse y lleva
 * directo a donde se hace. Cuando está todo hecho se oculta (y se puede volver a mostrar).
 */
export default function GuideCard(props: { onNavigate: (tab: TabId) => void; refreshKey: number }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(read);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [settings, conns, whisper] = await Promise.all([window.api.getSettings(), window.api.listConnections(), window.api.whisperStatus()]);
        if (!alive) return;
        setSteps([
          {
            id: 'twitch',
            title: 'Conecta tu canal de Twitch',
            why: 'Así el programa se entera cuando empiezas y terminas un directo y recoge su VOD solo.',
            done: Boolean(settings.twitch.login && settings.twitch.clientId),
            go: 'conexiones',
            action: 'Ir a Conexiones',
          },
          {
            id: 'whisper',
            title: 'Descarga el modelo de Whisper',
            why: 'Transcribe lo que dices para encontrar los mejores momentos y poner subtítulos. Se hace una vez y es gratis.',
            done: whisper.engine && whisper.modelInstalled,
            go: 'ajustes',
            action: 'Ir a Ajustes',
          },
          {
            id: 'networks',
            title: 'Conecta al menos una red social',
            why: 'YouTube, TikTok o Instagram: sin ninguna, las subidas se quedan «en espera».',
            done: conns.some((c) => c.connected),
            go: 'conexiones',
            action: 'Ir a Conexiones',
          },
        ]);
      } catch {
        /* sin datos no se muestra la guía */
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.refreshKey]);

  if (!steps) return null;
  const left = steps.filter((s) => !s.done);
  const allDone = left.length === 0;
  if (hidden || allDone) {
    return allDone || !hidden ? null : (
      <div className="row"><button className="btn ghost small" onClick={() => { setHidden(false); try { localStorage.removeItem(HIDE_KEY); } catch { /* sin almacenamiento */ } }}>Mostrar la guía de inicio ({left.length} paso(s) pendiente(s))</button></div>
    );
  }
  return (
    <section className="card guide" aria-label="Primeros pasos">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Primeros pasos</h2>
        <button className="btn ghost small" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* sin almacenamiento */ } }}>Ocultar</button>
      </div>
      <div className="muted small">Faltan {left.length} de {steps.length}. Cuando termines, deja el programa abierto: al acabar tu directo aparecerá aquí lo que prepara para que lo apruebes.</div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id} className={s.done ? 'done' : ''}>
            <span className="stepno" aria-hidden="true">{s.done ? <IconCheck size={14} /> : i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{s.title}{s.done && <span className="badge ok" style={{ marginLeft: 8 }}>Hecho</span>}</div>
              {!s.done && <div className="muted small">{s.why}</div>}
            </div>
            {!s.done && <button className="btn small" onClick={() => props.onNavigate(s.go)}>{s.action}</button>}
          </li>
        ))}
      </ol>
    </section>
  );
}

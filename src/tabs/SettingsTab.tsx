import { useEffect, useState } from 'react';
import type { ToolStatus, WhisperStatus } from '../../shared/types';
import { errMsg } from '../lib';
import StorageCard from './StorageCard';
import { AutopilotCard, PublishingCard, AutoSubtitlesCard, AiCard, CoversStyleCard } from './AutopilotCards';
import UpdatesCard from './UpdatesCard';
import VocabularyCard from './VocabularyCard';
import SpeakersCard from './SpeakersCard';
import PrefsCard from './PrefsCard';
import StyleCard from './StyleCard';
import CloudCard from './CloudCard';
import EngineCard from './EngineCard';
import { SideNav, useSubTab } from '../SubTabs';

const SECTIONS = [
  { id: 'general', label: 'General', hint: 'Dónde se guardan los vídeos, las herramientas que usa el programa y las actualizaciones.' },
  { id: 'ia', label: 'Inteligencia artificial', hint: 'La clave gratuita (Groq o Gemini) con la que el programa entiende los clips y los directos.' },
  { id: 'piloto', label: 'Piloto automático', hint: 'Qué prepara solo el programa al acabar un directo, cuánto y cuándo lo publica.' },
  { id: 'voz', label: 'Voz y subtítulos', hint: 'Cómo escucha lo que dices (Whisper), quién habla, tu vocabulario y los subtítulos.' },
  { id: 'estilo', label: 'Mi estilo', hint: 'Cómo quieres que edite: ritmo, silencios, música, títulos, portadas y lo que ha aprendido de ti.' },
  { id: 'nube', label: 'PC apagado', hint: 'Opcional: que un servicio gratuito de GitHub prepare y suba los vídeos mientras tu PC está apagado.' },
];

export default function SettingsTab() {
  const [outputDir, setOutputDir] = useState('');
  const [ffmpegPath, setFfmpegPath] = useState('');
  const [ytdlpPath, setYtdlpPath] = useState('');
  const [whisperPath, setWhisperPath] = useState('');
  const [whisperModel, setWhisperModel] = useState('small');
  const [whisperLanguage, setWhisperLanguage] = useState('');
  const [wstat, setWstat] = useState<WhisperStatus | null>(null);
  const [wprog, setWprog] = useState<number | null>(null);
  const [tools, setTools] = useState<ToolStatus | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sub, setSub] = useSubTab('streamclips.settings.sec', SECTIONS.map((x) => x.id));

  useEffect(() => {
    window.api
      .getSettings()
      .then((s) => {
        setOutputDir(s.outputDir);
        setFfmpegPath(s.ffmpegPath);
        setYtdlpPath(s.ytdlpPath);
        setWhisperPath(s.whisperPath);
        setWhisperModel(s.whisperModel);
        setWhisperLanguage(s.whisperLanguage);
      })
      .catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);

  const refreshWhisper = () => window.api.whisperStatus().then(setWstat).catch(() => setWstat(null));
  useEffect(() => {
    void refreshWhisper();
    return window.api.onTaskUpdate((t) => {
      if (t.kind !== 'model') return;
      if (t.status === 'running') setWprog(t.progress);
      else {
        setWprog(null);
        void refreshWhisper();
      }
    });
  }, []);

  async function downloadModel() {
    if (!(await persist())) return;
    setWprog(0);
    try {
      setWstat(await window.api.downloadWhisperModel());
      setMsg({ ok: true, text: 'Modelo de Whisper listo.' });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setWprog(null);
    }
  }

  async function pick() {
    try {
      const dir = await window.api.pickFolder();
      if (dir) setOutputDir(dir);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  async function persist(): Promise<boolean> {
    setMsg(null);
    try {
      const s = await window.api.setSettings({ outputDir, ffmpegPath, ytdlpPath, whisperPath, whisperModel, whisperLanguage });
      setOutputDir(s.outputDir);
      setFfmpegPath(s.ffmpegPath);
      setYtdlpPath(s.ytdlpPath);
      setWhisperPath(s.whisperPath);
      setWhisperModel(s.whisperModel);
      setWhisperLanguage(s.whisperLanguage);
      void refreshWhisper();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
      return false;
    }
  }

  async function save() {
    if (await persist()) setMsg({ ok: true, text: 'Guardado.' });
  }

  async function check() {
    if (!(await persist())) return;
    try {
      setTools(await window.api.checkTools());
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  const status = (name: string, t?: { ok: boolean; version?: string }) =>
    t && (
      <div className="row small">
        <span className={`badge ${t.ok ? 'ok' : 'bad'}`}>{t.ok ? 'OK' : 'No encontrado'}</span>
        <span>{name}</span>
        {t.version && <span className="muted">{t.version}</span>}
      </div>
    );

  return (
    <SideNav label="Ajustes" tabs={SECTIONS} value={sub} onChange={setSub}>
      {sub === 'general' && <div className="grid">
      <section className="card">
        <h2>Carpeta de salida</h2>
        <div className="muted small">Aquí se guardan los VODs descargados (subcarpeta vods) y los clips (vertical, horizontal y long).</div>
        <div className="row">
          <input type="text" aria-label="Carpeta de salida" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
          <button className="btn ghost" onClick={() => void pick()}>Elegir…</button>
        </div>
        <button className="btn" onClick={() => void save()}>Guardar</button>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
      </section>

      <section className="card">
        <h2>Herramientas</h2>
        <div className="muted small">ffmpeg y yt-dlp son las herramientas que cortan y descargan los vídeos. Si el programa las encuentra solo, no hay nada que tocar.</div>
        <details className="adv">
          <summary>Rutas de las herramientas (solo si no las encuentra)</summary>
          <div className="adv-body">
            <div className="muted small">Si están en el PATH de Windows, deja los campos vacíos.</div>
        <div className="field">
          <label htmlFor="ffmpeg-path">Ruta de ffmpeg.exe (opcional; ffprobe debe estar en la misma carpeta)</label>
          <input id="ffmpeg-path" type="text" value={ffmpegPath} onChange={(e) => setFfmpegPath(e.target.value)} placeholder="C:\ffmpeg\bin\ffmpeg.exe" />
        </div>
        <div className="field">
          <label htmlFor="ytdlp-path">Ruta de yt-dlp.exe (opcional)</label>
          <input id="ytdlp-path" type="text" value={ytdlpPath} onChange={(e) => setYtdlpPath(e.target.value)} placeholder="C:\tools\yt-dlp.exe" />
        </div>
          </div>
        </details>
        <button className="btn" onClick={() => void check()}>Guardar y comprobar</button>
        {tools && (
          <div className="list">
            {status('ffmpeg', tools.ffmpeg)}
            {status('ffprobe', tools.ffprobe)}
            {status('yt-dlp', tools.ytdlp)}
          </div>
        )}
      </section>

      <StorageCard />
      <UpdatesCard />
      </div>}

      {sub === 'ia' && <div className="grid">
        <AiCard />
      </div>}

      {sub === 'piloto' && <div className="grid">
        <AutopilotCard />
        <PublishingCard />
        <CoversStyleCard />
      </div>}

      {sub === 'voz' && <div className="grid">
      <section className="card">
        <h2>Transcripción (Whisper)</h2>
        <div className="muted small">
          El programa escucha el directo con Whisper (gratuito y local) para subtitular y encontrar los mejores momentos. Necesita el motor
          (<code>whisper-cli</code>, incluido en el instalador) y un modelo, que se descarga una vez desde Hugging Face. Si prefieres, puedes
          importar una transcripción ya hecha (JSON, SRT o VTT) desde cada VOD.
        </div>
        {wstat && (
          <div className="row" style={{ gap: 8, margin: '8px 0' }}>
            <span className={`badge ${wstat.engine ? 'ok' : 'warn'}`}>{wstat.engine ? 'Motor encontrado' : 'Motor no encontrado'}</span>
            <span className={`badge ${wstat.modelInstalled ? 'ok' : 'warn'}`}>
              {wstat.modelInstalled ? `Modelo ${wstat.model} instalado` : `Modelo ${wstat.model} sin descargar (${wstat.modelApproxMb} MB)`}
            </span>
            {!wstat.modelInstalled && (
              <button className="btn" disabled={wprog !== null} onClick={() => void downloadModel()}>
                {wprog !== null ? `Descargando ${wprog}%` : 'Descargar modelo'}
              </button>
            )}
          </div>
        )}
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="whisper-model">Modelo</label>
            <select id="whisper-model" value={whisperModel} onChange={(e) => setWhisperModel(e.target.value)}>
              <option value="tiny">tiny (78 MB, rápido)</option>
              <option value="base">base (148 MB)</option>
              <option value="small">small (488 MB, recomendado)</option>
              <option value="medium">medium (1,5 GB, preciso)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="whisper-lang">Idioma (es = español de España; vacío = detectar)</label>
            <input id="whisper-lang" type="text" value={whisperLanguage} onChange={(e) => setWhisperLanguage(e.target.value)} placeholder="es" maxLength={3} />
          </div>
        </div>
        <details className="adv">
          <summary>Avanzado: ruta de whisper-cli</summary>
          <div className="adv-body">
        <div className="field">
          <label htmlFor="whisper-path">Ruta de whisper-cli (opcional)</label>
          <input id="whisper-path" type="text" value={whisperPath} onChange={(e) => setWhisperPath(e.target.value)} placeholder="Vacío = el incluido con el programa" />
        </div>
          </div>
        </details>
        <button className="btn" onClick={() => void save()}>Guardar transcripción</button>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
      </section>
        <AutoSubtitlesCard />
        <SpeakersCard />
        <VocabularyCard />
      </div>}

      {sub === 'estilo' && <div className="grid">
        <StyleCard />
        <PrefsCard />
      </div>}

      {sub === 'nube' && <div className="grid">
        <CloudCard />
        <EngineCard />
      </div>}
    </SideNav>
  );
}

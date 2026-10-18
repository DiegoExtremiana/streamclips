import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { IconLibrary, IconLink, IconLogo, IconPanel, IconScissors, IconSettings } from './icons';
import type { Group, OutputItem, Publication, VodJob } from '../shared/types';
import ScheduleTab from './tabs/ScheduleTab';
import ClipsTab from './tabs/ClipsTab';
import LibraryTab from './tabs/LibraryTab';
import ConnectionsTab from './tabs/ConnectionsTab';
import SettingsTab from './tabs/SettingsTab';
import { errMsg } from './lib';
import { useUpdateStatus } from './tabs/UpdatesCard';
import Toasts from './Toasts';

export type TabId = 'programacion' | 'biblioteca' | 'clips' | 'conexiones' | 'ajustes';

const TABS: { id: TabId; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'programacion', label: 'Inicio', hint: 'Tus últimos clips y vídeos a la izquierda: arrástralos a un día (o una hora, en la línea de tiempo) del calendario y configura ahí su publicación.', icon: <IconPanel /> },
  { id: 'biblioteca', label: 'Biblioteca', hint: 'Tus clips y vídeos: edítalos, ordénalos en carpetas y programa su publicación.', icon: <IconLibrary /> },
  { id: 'clips', label: 'Clips y publicación', hint: 'Los clips de tu canal de Twitch, las herramientas para crear los tuyos a partir de un directo y los directos recogidos.', icon: <IconScissors /> },
  { id: 'conexiones', label: 'Conexiones', hint: 'Estado de tu canal de Twitch, primeros pasos y tus redes sociales.', icon: <IconLink /> },
  { id: 'ajustes', label: 'Ajustes', hint: 'Carpetas y herramientas, piloto automático y subtítulos, y publicar con el PC apagado.', icon: <IconSettings /> },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('programacion');
  const [vods, setVods] = useState<VodJob[]>([]);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [loadError, setLoadError] = useState('');
  const [openOutput, setOpenOutput] = useState<string | null>(null);
  const upd = useUpdateStatus();

  const refresh = useCallback(async () => {
    try {
      const [v, o, p, g] = await Promise.all([
        window.api.listVods(),
        window.api.listOutputs(),
        window.api.listPublications(),
        window.api.listGroups(),
      ]);
      setVods(v);
      setOutputs(o);
      setPubs(p);
      setGroups(g);
      setLoadError('');
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const offData = window.api.onDataChanged(() => void refresh());
    const offVod = window.api.onVodUpdate((job) =>
      setVods((prev) => prev.map((v) => (v.id === job.id ? { ...job } : v))),
    );
    return () => {
      offData();
      offVod();
    };
  }, [refresh]);

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  // Ctrl+1…5 cambia de sección sin soltar el teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const t = TABS[Number(e.key) - 1];
      if (t) {
        e.preventDefault();
        setTab(t.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lo que necesita tu atención: vídeos esperando tu visto bueno y subidas que han fallado
  const attention: Partial<Record<TabId, number>> = {
    programacion: outputs.filter((o) => o.auto?.review === 'pending').length + pubs.filter((p) => p.status === 'failed').length,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark"><IconLogo size={18} /></span>
          StreamClips
        </div>
        <nav
          className="nav"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Secciones"
          onKeyDown={(e) => {
            // flechas arriba/abajo, Inicio y Fin, como en cualquier lista de pestañas
            const i = TABS.findIndex((t) => t.id === tab);
            const next = e.key === 'ArrowDown' ? (i + 1) % TABS.length : e.key === 'ArrowUp' ? (i + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
            if (next < 0) return;
            e.preventDefault();
            setTab(TABS[next].id);
            (e.currentTarget.querySelectorAll<HTMLElement>('[role=tab]')[next])?.focus();
          }}
        >
          <div className="nav-label">Menú</div>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className="navbtn" title={`${t.label} (Ctrl+${TABS.indexOf(t) + 1})`} onClick={() => setTab(t.id)}>
              {t.icon}
              {t.label}
              {attention[t.id] ? <span className="navcount" aria-label={`${attention[t.id]} pendiente(s)`}>{attention[t.id]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          De tus directos de Twitch a YouTube, TikTok e Instagram.
          {upd && <div style={{ marginTop: 6 }}>v{upd.currentVersion}{upd.status === 'downloading' ? ' · descargando actualización' : upd.status === 'ready' ? ' · actualización lista' : ''}</div>}
        </div>
      </aside>
      <div className="content">
        <header className="pagehead">
          <h1>{current.label}</h1>
          <p>{current.hint}</p>
        </header>
        <main className={`main ${tab === 'programacion' ? 'fit' : ''}`}>
          {loadError && <div className="msg bad" style={{ marginBottom: 16 }}>No se pudieron cargar los datos: {loadError}</div>}
          {tab === 'programacion' && <ScheduleTab vods={vods} outputs={outputs} pubs={pubs} onChanged={refresh} onNavigate={setTab} onOpenVideo={(id) => { setOpenOutput(id); setTab('biblioteca'); }} />}
          {tab === 'biblioteca' && <LibraryTab outputs={outputs} groups={groups} pubs={pubs} onChanged={refresh} openId={openOutput} onOpened={() => setOpenOutput(null)} />}
          {tab === 'clips' && <ClipsTab vods={vods} outputs={outputs} pubs={pubs} onChanged={refresh} onNavigate={setTab} />}
          {tab === 'conexiones' && <ConnectionsTab vods={vods} outputs={outputs} pubs={pubs} onChanged={refresh} onNavigate={setTab} />}
          {tab === 'ajustes' && <SettingsTab />}
        </main>
      </div>
      <Toasts />
    </div>
  );
}

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { IconLibrary, IconLink, IconLogo, IconPanel, IconScissors, IconSettings } from './icons';
import type { Group, OutputItem, Publication, VodJob } from '../shared/types';
import PanelTab from './tabs/PanelTab';
import ClipsTab from './tabs/ClipsTab';
import LibraryTab from './tabs/LibraryTab';
import ConnectionsTab from './tabs/ConnectionsTab';
import SettingsTab from './tabs/SettingsTab';
import { errMsg } from './lib';
import { useUpdateStatus } from './tabs/UpdatesCard';

type TabId = 'panel' | 'biblioteca' | 'clips' | 'conexiones' | 'ajustes';

const TABS: { id: TabId; label: string; hint: string; icon: ReactNode }[] = [
  { id: 'panel', label: 'Panel', hint: 'Tu canal en directo, lo que el programa prepara solo y lo que espera tu visto bueno.', icon: <IconPanel /> },
  { id: 'biblioteca', label: 'Biblioteca', hint: 'Tus clips y vídeos: edítalos, ordénalos en carpetas y programa su publicación.', icon: <IconLibrary /> },
  { id: 'clips', label: 'Clips y publicación', hint: 'Crea clips y vídeos largos a partir de un VOD.', icon: <IconScissors /> },
  { id: 'conexiones', label: 'Conexiones', hint: 'Tu canal de Twitch y tus redes sociales.', icon: <IconLink /> },
  { id: 'ajustes', label: 'Ajustes', hint: 'Carpetas y herramientas.', icon: <IconSettings /> },
];

export default function App() {
  const [tab, setTab] = useState<TabId>('panel');
  const [vods, setVods] = useState<VodJob[]>([]);
  const [outputs, setOutputs] = useState<OutputItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [loadError, setLoadError] = useState('');
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

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark"><IconLogo size={18} /></span>
          StreamClips
        </div>
        <nav className="nav" role="tablist" aria-orientation="vertical" aria-label="Secciones">
          <div className="nav-label">Menú</div>
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className="navbtn" onClick={() => setTab(t.id)}>
              {t.icon}
              {t.label}
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
        <main className="main">
          {loadError && <div className="msg bad" style={{ marginBottom: 16 }}>No se pudieron cargar los datos: {loadError}</div>}
          {tab === 'panel' && <PanelTab vods={vods} outputs={outputs} pubs={pubs} onChanged={refresh} />}
          {tab === 'biblioteca' && <LibraryTab outputs={outputs} groups={groups} pubs={pubs} onChanged={refresh} />}
          {tab === 'clips' && <ClipsTab vods={vods} outputs={outputs} pubs={pubs} onChanged={refresh} />}
          {tab === 'conexiones' && <ConnectionsTab />}
          {tab === 'ajustes' && <SettingsTab />}
        </main>
      </div>
    </div>
  );
}

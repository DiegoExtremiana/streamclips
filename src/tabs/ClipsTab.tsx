import { useState } from 'react';
import type { OutputItem, Publication, VodJob } from '../../shared/types';
import type { TabId } from '../App';
import TwitchClips from './TwitchClips';
import BroadcastsCard from './BroadcastsCard';
import CutClipDialog from './CutClipDialog';
import { SideNav, useSubTab } from '../SubTabs';

export default function ClipsTab(props: {
  vods: VodJob[];
  outputs: OutputItem[];
  pubs: Publication[];
  onChanged: () => Promise<void>;
  onNavigate: (tab: TabId) => void;
}) {
  const [sub, setSub] = useSubTab('streamclips.clips.sub2', ['canal', 'directos']);
  /** Directo desde el que se corta un clip: '' = elegir en la ventana; null = ventana cerrada. */
  const [cutting, setCutting] = useState<string | null>(null);

  return (
    <SideNav
      label="Clips y publicación"
      value={sub}
      onChange={setSub}
      tabs={[
        { id: 'canal', label: 'Clips de tu canal', hint: 'Los clips que la gente (o tú) ha creado en Twitch: míralos y elige cuáles llevar a la Biblioteca.' },
        { id: 'directos', label: 'Directos y actividad', hint: 'Tus directos de Twitch al momento: analízalos o mira uno y corta clips a mano; el estado sale sobre cada miniatura.' },
      ]}
    >
      {sub === 'canal' && <TwitchClips vods={props.vods} outputs={props.outputs} onChanged={props.onChanged} />}
      {sub === 'directos' && <BroadcastsCard vods={props.vods} onChanged={props.onChanged} onCut={setCutting} />}
      {cutting !== null && (
        <CutClipDialog
          vods={props.vods}
          initialVodId={cutting || undefined}
          onChanged={props.onChanged}
          onOpenLibrary={() => {
            setCutting(null);
            props.onNavigate('biblioteca');
          }}
          onClose={() => setCutting(null)}
        />
      )}
    </SideNav>
  );
}

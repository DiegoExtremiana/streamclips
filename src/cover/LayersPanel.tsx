import type { Layer } from '../../shared/coverDesign';
import { IconTrash } from '../icons';

const ICON: Record<Layer['type'], string> = { image: '🖼', text: 'T', rect: '▭' };

/** Lista de capas, la de arriba del todo es la que se ve delante. */
export default function LayersPanel(props: {
  layers: Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggle: (id: string, key: 'visible' | 'locked') => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!props.layers.length) return <div className="muted small cve-empty">Todavía no hay capas. Añade una imagen, un texto o un rectángulo.</div>;
  return (
    <ul className="cve-layers" aria-label="Capas">
      {[...props.layers].reverse().map((l) => (
        <li key={l.id} className={`cve-layer ${props.selectedId === l.id ? 'on' : ''}`} data-testid="cover-layer">
          <button className="cve-layer-main" onClick={() => props.onSelect(l.id)} aria-pressed={props.selectedId === l.id} title={l.name}>
            <span className="cve-layer-ic" aria-hidden="true">{ICON[l.type]}</span>
            <span className="title-ellipsis">{l.type === 'text' ? l.text.split('\n')[0] || l.name : l.name}</span>
          </button>
          <button className="btn ghost small" aria-label={`${l.visible ? 'Ocultar' : 'Mostrar'} ${l.name}`} aria-pressed={!l.visible} onClick={() => props.onToggle(l.id, 'visible')}>{l.visible ? '👁' : '—'}</button>
          <button className="btn ghost small" aria-label={`${l.locked ? 'Desbloquear' : 'Bloquear'} ${l.name}`} aria-pressed={l.locked} onClick={() => props.onToggle(l.id, 'locked')}>{l.locked ? '🔒' : '🔓'}</button>
          <button className="btn ghost small" aria-label={`Subir ${l.name}`} onClick={() => props.onMove(l.id, 1)}>↑</button>
          <button className="btn ghost small" aria-label={`Bajar ${l.name}`} onClick={() => props.onMove(l.id, -1)}>↓</button>
          <button className="btn ghost small" aria-label={`Duplicar ${l.name}`} onClick={() => props.onDuplicate(l.id)}>⧉</button>
          <button className="btn ghost small" aria-label={`Borrar ${l.name}`} onClick={() => props.onDelete(l.id)}><IconTrash size={14} /></button>
        </li>
      ))}
    </ul>
  );
}

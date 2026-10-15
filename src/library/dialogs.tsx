import { useState } from 'react';
import type { Group, GroupKind, Section } from '../../shared/types';
import { MAX_GROUP_NAME_LEN } from '../../shared/types';
import { flattenGroups, subtreeIds } from '../../shared/groupTree';
import { IconFolder, IconLibrary } from '../icons';
import { Modal } from './ui';

export function GroupDialog(props: {
  title: string;
  initial?: { name: string; kind: GroupKind };
  submitLabel: string;
  onSubmit: (name: string, kind: GroupKind) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(props.initial?.name ?? '');
  const [kind, setKind] = useState<GroupKind>(props.initial?.kind ?? 'theme');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setErr('');
    try {
      await props.onSubmit(name, kind);
      props.onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="field">
          <label htmlFor="group-name">Nombre</label>
          <input id="group-name" type="text" value={name} maxLength={MAX_GROUP_NAME_LEN} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <fieldset className="kinds">
          <legend className="muted small">Tipo de carpeta</legend>
          <label className="check"><input type="radio" name="gk" checked={kind === 'theme'} onChange={() => setKind('theme')} /> Tema (Pokémon, Just Chatting…)</label>
          <label className="check"><input type="radio" name="gk" checked={kind === 'series'} onChange={() => setKind('series')} /> Serie (Road to Master, Locke en chanclas…)</label>
        </fieldset>
        {err && <div className="msg bad" role="alert">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={props.onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={busy || !name.trim()}>{props.submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog(props: { title: string; text: string; confirmLabel: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [err, setErr] = useState('');
  return (
    <Modal title={props.title} onClose={props.onClose}>
      <p>{props.text}</p>
      {err && <div className="msg bad" role="alert">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={props.onClose}>Cancelar</button>
        <button
          className="btn"
          onClick={() => {
            props.onConfirm().then(props.onClose, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
          }}
        >
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Elegir carpeta de destino. Si se mueve una carpeta, ella y lo que cuelga de ella no son destinos válidos. */
export function MoveDialog(props: {
  title: string;
  groups: Group[];
  section: Section;
  excludeSubtreeOf?: string;
  currentParent?: string;
  onPick: (groupId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [err, setErr] = useState('');
  const banned = props.excludeSubtreeOf ? subtreeIds(props.groups, props.excludeSubtreeOf) : new Set<string>();
  const options = flattenGroups(props.groups, props.section).filter((x) => !banned.has(x.group.id));

  function pick(id: string | null) {
    props.onPick(id).then(props.onClose, (e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      <div className="movelist" role="listbox" aria-label="Carpetas de destino">
        <button role="option" aria-selected={props.currentParent === undefined} className="moveopt" onClick={() => pick(null)}>
          <IconLibrary /> Biblioteca (sin carpeta)
        </button>
        {options.map(({ group, depth }) => (
          <button
            key={group.id}
            role="option"
            aria-selected={props.currentParent === group.id}
            className="moveopt"
            style={{ paddingLeft: 12 + depth * 18 }}
            onClick={() => pick(group.id)}
          >
            <IconFolder /> {group.name} <span className="badge">{group.kind === 'series' ? 'Serie' : 'Tema'}</span>
          </button>
        ))}
      </div>
      {err && <div className="msg bad" role="alert">{err}</div>}
    </Modal>
  );
}

import { useState, type DragEvent } from 'react';
import type { Group, GroupKind, OutputItem, Publication, RenderKind, Section } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { childGroups, countInside, groupLabel, itemsIn, pathOf } from '../../shared/groupTree';
import { fmtTime } from '../../shared/time';
import { errMsg } from '../lib';
import ItemModal, { PLATFORMS, PUB_STATUS } from '../library/ItemModal';
import { ConfirmDialog, GroupDialog, MoveDialog } from '../library/dialogs';
import { IconFilm, IconFolder, IconLibrary, IconMore, IconPlus } from '../icons';
import { ContextMenu, type MenuItem } from '../library/ui';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'clips', label: 'Clips' },
  { id: 'videos', label: 'Vídeos' },
];
const KIND_LABEL = { clip: 'Clip', long: 'Vídeo largo' } as const;
const SHORT = { youtube: 'YT', tiktok: 'TT', instagram: 'IG' } as const;
const DRAG_TYPE = 'application/x-streamclips';

type Drag = { type: 'item' | 'group'; id: string };
type Dialog =
  | { type: 'new-group'; parentId?: string; withItems: string[] }
  | { type: 'edit-group'; group: Group }
  | { type: 'move-item'; item: OutputItem }
  | { type: 'move-group'; group: Group }
  | { type: 'delete-group'; group: Group };
type Menu = { x: number; y: number; items: MenuItem[] };

export default function LibraryTab(props: {
  outputs: OutputItem[];
  groups: Group[];
  pubs: Publication[];
  onChanged: () => Promise<void>;
}) {
  const { outputs, groups, pubs } = props;
  const [section, setSection] = useState<Section>('clips');
  const [current, setCurrent] = useState<Record<Section, string | undefined>>({ clips: undefined, videos: undefined });
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');
  const [dropOver, setDropOver] = useState<string | null>(null);

  // Si la carpeta actual se borró o se movió a otra sección, se vuelve a la raíz.
  const here = groups.some((g) => g.id === current[section] && g.section === section) ? current[section] : undefined;
  const crumbs = pathOf(groups, here);
  const subgroups = childGroups(groups, section, here);
  const items = itemsIn(outputs, groups, section, here);
  const openItem = outputs.find((o) => o.id === openId) ?? null;

  const goTo = (id: string | undefined) => setCurrent((c) => ({ ...c, [section]: id }));

  /** Ejecuta una acción, refresca y enseña el error si lo hay. */
  async function act(fn: () => Promise<unknown>) {
    setMsg('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setMsg(errMsg(e));
    } finally {
      await props.onChanged();
    }
  }

  // ---------- menús
  const showMenu = (e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void }, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const download = (o: OutputItem, version: RenderKind) =>
    void act(async () => {
      const dest = await window.api.exportOutput(o.id, version);
      if (dest) setNotice(`Guardado en ${dest}`);
    });
  const itemMenu = (o: OutputItem): MenuItem[] => [
    { label: 'Abrir', onClick: () => setOpenId(o.id) },
    ...(o.kind === 'long'
      ? [{ label: 'Descargar vídeo', onClick: () => download(o, 'long') }]
      : [
          { label: 'Descargar en horizontal', onClick: () => download(o, 'horizontal') },
          { label: 'Descargar en vertical', onClick: () => download(o, 'vertical') },
        ]),
    { label: 'Mover a carpeta…', onClick: () => setDialog({ type: 'move-item', item: o }) },
    ...(o.groupId ? [{ label: 'Sacar de la carpeta', onClick: () => void act(() => window.api.moveOutput(o.id, null)) }] : []),
    { label: 'Nueva carpeta con este vídeo…', onClick: () => setDialog({ type: 'new-group', parentId: here, withItems: [o.id] }) },
  ];
  const groupMenu = (g: Group): MenuItem[] => [
    { label: 'Abrir carpeta', onClick: () => goTo(g.id) },
    { label: 'Renombrar o cambiar tipo…', onClick: () => setDialog({ type: 'edit-group', group: g }) },
    { label: 'Mover a…', onClick: () => setDialog({ type: 'move-group', group: g }) },
    ...(g.parentId ? [{ label: 'Sacar al nivel superior', onClick: () => void act(() => window.api.moveGroup(g.id, null)) }] : []),
    { label: 'Eliminar carpeta (conserva su contenido)', danger: true, onClick: () => setDialog({ type: 'delete-group', group: g }) },
  ];
  const blankMenu = (): MenuItem[] => [{ label: 'Nueva carpeta aquí…', onClick: () => setDialog({ type: 'new-group', parentId: here, withItems: [] }) }];

  // ---------- arrastrar y soltar
  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
    e.dataTransfer.effectAllowed = 'move';
  };
  const readDrag = (e: DragEvent): Drag | null => {
    try {
      const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as Drag;
      return (d.type === 'item' || d.type === 'group') && typeof d.id === 'string' ? d : null;
    } catch {
      return null;
    }
  };
  /** Zona donde se puede soltar: una carpeta, un nivel de la ruta o (con `itemTarget`) otro vídeo. */
  const dropProps = (key: string, onDrop: (d: Drag) => void) => ({
    onDragOver: (e: DragEvent) => {
      if (e.dataTransfer.types.includes(DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropOver(key);
      }
    },
    onDragLeave: () => setDropOver((k) => (k === key ? null : k)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(null);
      const d = readDrag(e);
      if (d) onDrop(d);
    },
  });
  const moveInto = (d: Drag, groupId: string | null) =>
    void act(() => (d.type === 'item' ? window.api.moveOutput(d.id, groupId) : window.api.moveGroup(d.id, groupId)));

  // ---------- diálogos
  async function createGroup(name: string, kind: GroupKind, parentId: string | undefined, withItems: string[]) {
    const g = await window.api.createGroup(name, kind, section, parentId);
    try {
      for (const id of withItems) await window.api.moveOutput(id, g.id);
    } finally {
      await props.onChanged();
    }
  }

  return (
    <div onContextMenu={(e) => showMenu(e, blankMenu())} style={{ minHeight: '100%' }}>
      <div className="libbar">
        <div className="seg" role="tablist" aria-label="Sección de la biblioteca">
          {SECTIONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={section === s.id} className={`segbtn ${section === s.id ? 'active' : ''}`} onClick={() => setSection(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button className="btn ghost small" onClick={() => setDialog({ type: 'new-group', parentId: here, withItems: [] })}><IconPlus /> Nueva carpeta</button>
      </div>

      <nav className="crumbs" aria-label="Ruta de carpetas">
        <button className={`crumb ${dropOver === 'root' ? 'over' : ''}`} onClick={() => goTo(undefined)} {...dropProps('root', (d) => moveInto(d, null))}>
          <IconLibrary /> {SECTIONS.find((s) => s.id === section)?.label}
        </button>
        {crumbs.map((c) => (
          <span key={c.id}>
            <span className="muted"> / </span>
            <button className={`crumb ${dropOver === `crumb-${c.id}` ? 'over' : ''}`} onClick={() => goTo(c.id)} {...dropProps(`crumb-${c.id}`, (d) => moveInto(d, c.id))}>
              {c.name}
            </button>
          </span>
        ))}
      </nav>

      {msg && <div className="msg bad" role="alert" style={{ marginBottom: 12 }}>{msg}</div>}
      {notice && <div className="msg ok" role="status" style={{ marginBottom: 12 }}>{notice}</div>}

      {subgroups.length === 0 && items.length === 0 && (
        <div className="empty">
          <IconFilm size={34} />
          <div>
            {here
              ? 'Esta carpeta está vacía. Arrastra vídeos aquí.'
              : section === 'clips'
                ? 'Aún no hay clips. Aparecen aquí cuando el render se valida.'
                : 'Aún no hay vídeos largos.'}
          </div>
        </div>
      )}

      <div className="tiles" data-testid="library-grid">
        {subgroups.map((g) => (
          <div
            key={g.id}
            className={`tile folder ${dropOver === `g-${g.id}` ? 'over' : ''}`}
            data-testid={`group-${g.name}`}
            draggable
            tabIndex={0}
            role="button"
            aria-label={`Carpeta ${g.name}`}
            onDragStart={(e) => startDrag(e, { type: 'group', id: g.id })}
            onClick={() => goTo(g.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goTo(g.id);
            }}
            onContextMenu={(e) => showMenu(e, groupMenu(g))}
            {...dropProps(`g-${g.id}`, (d) => (d.type === 'group' && d.id === g.id ? undefined : moveInto(d, g.id)))}
          >
            <div className="folder-icon"><IconFolder size={44} /></div>
            <div className="tile-title title-ellipsis">{g.name}</div>
            <div className="muted small">
              <span className="badge">{g.kind === 'series' ? 'Serie' : 'Tema'}</span> {countInside(outputs, groups, g.id)} vídeo(s)
            </div>
            <button className="btn ghost small more" aria-label={`Opciones de ${g.name}`} onClick={(e) => showMenu(e, groupMenu(g))}><IconMore /></button>
          </div>
        ))}

        {items.map((o) => {
          const itemPubs = pubs.filter((p) => p.outputId === o.id);
          return (
            <div
              key={o.id}
              className={`tile item ${dropOver === `o-${o.id}` ? 'over' : ''}`}
              data-testid={`item-${o.title}`}
              draggable
              tabIndex={0}
              role="button"
              aria-label={`${KIND_LABEL[o.kind]}: ${o.title}`}
              onDragStart={(e) => startDrag(e, { type: 'item', id: o.id })}
              onClick={() => setOpenId(o.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setOpenId(o.id);
              }}
              onContextMenu={(e) => showMenu(e, itemMenu(o))}
              // soltar un vídeo sobre otro propone crear una carpeta con los dos
              {...dropProps(`o-${o.id}`, (d) => {
                if (d.type === 'item' && d.id !== o.id) setDialog({ type: 'new-group', parentId: here, withItems: [o.id, d.id] });
              })}
            >
              <div className="thumb">
                {o.thumbnail ? (
                  <img src={mediaUrl(o.id, 'thumb', o.thumbnail)} alt="" draggable={false} loading="lazy" />
                ) : (
                  <div className="nothumb"><IconFilm size={32} /></div>
                )}
                <span className="dur">{fmtTime(o.durationSec)}</span>
              </div>
              <div className="tile-title title-ellipsis" title={o.title}>{o.title}</div>
              <div className="muted small row" style={{ gap: 4 }}>
                <span className="badge">{KIND_LABEL[o.kind]}</span>
                {itemPubs.map((p) => (
                  <span key={p.key} className={`badge ${PUB_STATUS[p.status].cls}`} title={`${PLATFORMS.find((x) => x.id === p.platform)?.label}: ${PUB_STATUS[p.status].label}`}>
                    {SHORT[p.platform]}
                  </span>
                ))}
              </div>
              <button className="btn ghost small more" aria-label={`Opciones de ${o.title}`} onClick={(e) => showMenu(e, itemMenu(o))}><IconMore /></button>
            </div>
          );
        })}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {openItem && <ItemModal key={openItem.id} output={openItem} pubs={pubs.filter((p) => p.outputId === openItem.id)} playlists={[...new Set(outputs.map((o) => o.playlist).filter((p): p is string => Boolean(p)))].sort()} onChanged={props.onChanged} onClose={() => setOpenId(null)} />}

      {dialog?.type === 'new-group' && (
        <GroupDialog
          title={dialog.withItems.length ? `Nueva carpeta con ${dialog.withItems.length} vídeo(s)` : 'Nueva carpeta'}
          submitLabel="Crear"
          onSubmit={(name, kind) => createGroup(name, kind, dialog.parentId, dialog.withItems)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'edit-group' && (
        <GroupDialog
          title="Renombrar carpeta"
          initial={{ name: dialog.group.name, kind: dialog.group.kind }}
          submitLabel="Guardar"
          onSubmit={async (name, kind) => {
            await window.api.updateGroup(dialog.group.id, { name, kind });
            await props.onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'move-item' && (
        <MoveDialog
          title={`Mover «${dialog.item.title}»`}
          groups={groups}
          section={section}
          currentParent={dialog.item.groupId}
          onPick={async (id) => {
            await window.api.moveOutput(dialog.item.id, id);
            await props.onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'move-group' && (
        <MoveDialog
          title={`Mover la carpeta «${dialog.group.name}»`}
          groups={groups}
          section={section}
          excludeSubtreeOf={dialog.group.id}
          currentParent={dialog.group.parentId}
          onPick={async (id) => {
            await window.api.moveGroup(dialog.group.id, id);
            await props.onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'delete-group' && (
        <ConfirmDialog
          title="Eliminar carpeta"
          text={`Se eliminará la carpeta «${groupLabel(groups, dialog.group.id)}». Sus vídeos y subcarpetas NO se borran: pasan a la carpeta superior.`}
          confirmLabel="Eliminar carpeta"
          onConfirm={async () => {
            await window.api.deleteGroup(dialog.group.id);
            await props.onChanged();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useState, type DragEvent } from 'react';
import { platformsFor, sectionOf } from '../../shared/types';
import type { Group, GroupKind, OutputItem, Publication, RenderKind, Section } from '../../shared/types';
import { mediaUrl } from '../../shared/media';
import { childGroups, countInside, groupLabel, itemsIn, pathOf } from '../../shared/groupTree';
import { fmtTime } from '../../shared/time';
import { errMsg, notify } from '../lib';
import ItemModal from '../library/ItemModal';
import { PlatformDots } from '../library/PlatformSwitch';
import { ConfirmDialog, GroupDialog, MoveDialog } from '../library/dialogs';
import { IconCalendar, IconCheck, IconFilm, IconFolder, IconLibrary, IconMore, IconPlus, IconSearch, IconTrash } from '../icons';
import ScheduleDialog from '../library/ScheduleDialog';
import { ContextMenu, type MenuItem } from '../library/ui';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'clips', label: 'Clips' },
  { id: 'videos', label: 'Vídeos' },
];
const KIND_LABEL = { clip: 'Clip', long: 'Vídeo largo' } as const;
const DRAG_TYPE = 'application/x-streamclips';

type Drag = { type: 'item' | 'group'; id: string };
type Dialog =
  | { type: 'new-group'; parentId?: string; withItems: string[] }
  | { type: 'edit-group'; group: Group }
  | { type: 'move-item'; item: OutputItem }
  | { type: 'move-group'; group: Group }
  | { type: 'delete-group'; group: Group }
  | { type: 'delete-items'; items: OutputItem[] }
  | { type: 'schedule'; outputId: string };
type Menu = { x: number; y: number; items: MenuItem[] };

export default function LibraryTab(props: {
  outputs: OutputItem[];
  groups: Group[];
  pubs: Publication[];
  onChanged: () => Promise<void>;
  /** Abrir este vídeo al entrar (viene de la línea de tiempo). */
  openId?: string | null;
  onOpened?: () => void;
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
  const { openId: requestedId, onOpened } = props;
  useEffect(() => {
    if (requestedId) {
      setOpenId(requestedId);
      onOpened?.();
    }
  }, [requestedId, onOpened]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'new' | 'old' | 'name'>('new');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Si la carpeta actual se borró o se movió a otra sección, se vuelve a la raíz.
  const here = groups.some((g) => g.id === current[section] && g.section === section) ? current[section] : undefined;
  const crumbs = pathOf(groups, here);
  const plain = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = plain(query.trim());
  const searching = q.length > 0;
  // buscando se mira en toda la sección (da igual en qué carpeta esté); si no, solo en la carpeta actual
  const subgroups = searching ? [] : childGroups(groups, section, here);
  const items = [...(searching ? outputs.filter((o) => sectionOf(o.kind) === section && plain(o.title).includes(q)) : itemsIn(outputs, groups, section, here))].sort((a, b) =>
    sort === 'name' ? a.title.localeCompare(b.title, 'es') : sort === 'old' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt),
  );
  const openItem = outputs.find((o) => o.id === openId) ?? null;

  const goTo = (id: string | undefined) => setCurrent((c) => ({ ...c, [section]: id }));

  // ---------- selección y borrado
  const selectedItems = items.filter((o) => selected.has(o.id));
  const toggle = (id: string) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const askDelete = (list: OutputItem[]) => list.length && setDialog({ type: 'delete-items', items: list });
  async function deleteItems(list: OutputItem[]) {
    const r = await window.api.deleteOutputs(list.map((o) => o.id));
    await props.onChanged();
    if (r.removed) notify(r.removed === 1 ? 'Vídeo eliminado.' : `${r.removed} vídeos eliminados.`, 'ok');
    for (const e of r.errors) notify(`No se pudo eliminar «${e.title}»: ${e.reason}`, 'bad');
    if (r.filesLeft.length) notify(`Windows no dejó borrar ${r.filesLeft.length} archivo(s) (¿están abiertos en otro programa?). Se pueden borrar a mano: ${r.filesLeft.join(', ')}`, 'warn');
    setSelected(new Set());
    if (!r.errors.length) setSelecting(false);
  }
  function deleteText(list: OutputItem[]): string {
    const ids = new Set(list.map((o) => o.id));
    const mine = pubs.filter((p) => ids.has(p.outputId));
    const pending = mine.filter((p) => p.status === 'scheduled' || p.status === 'failed').length;
    const published = mine.filter((p) => p.status === 'published').length;
    const names = list.slice(0, 4).map((o) => `«${o.title}»`).join(', ') + (list.length > 4 ? ` y ${list.length - 4} más` : '');
    const lines = [`Se va a eliminar ${list.length === 1 ? 'el vídeo' : `${list.length} vídeos`}: ${names}.`, 'Se borran sus archivos del disco (todas sus versiones y la miniatura). El VOD de origen no se toca.'];
    if (pending) lines.push(`${pending} subida(s) programada(s) se cancelarán.`);
    if (published) lines.push(`Lo que ya está publicado en las redes se queda donde está.`);
    lines.push('Esta acción no se puede deshacer.');
    return lines.join('\n');
  }

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
    { label: 'Programar subida…', onClick: () => setDialog({ type: 'schedule', outputId: o.id }) },
    ...(o.remote
      ? [] // vive solo en la nube: no hay archivo que descargar
      : o.kind === 'long'
      ? [{ label: 'Descargar vídeo', onClick: () => download(o, 'long') }]
      : [
          { label: 'Descargar en horizontal', onClick: () => download(o, 'horizontal') },
          { label: 'Descargar en vertical', onClick: () => download(o, 'vertical') },
        ]),
    { label: 'Mover a carpeta…', onClick: () => setDialog({ type: 'move-item', item: o }) },
    ...(o.groupId ? [{ label: 'Sacar de la carpeta', onClick: () => void act(() => window.api.moveOutput(o.id, null)) }] : []),
    { label: 'Nueva carpeta con este vídeo…', onClick: () => setDialog({ type: 'new-group', parentId: here, withItems: [o.id] }) },
    { label: 'Eliminar…', danger: true, onClick: () => askDelete([o]) },
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
        <label className="searchbox">
          <IconSearch size={16} />
          <input type="search" aria-label="Buscar en la Biblioteca" placeholder={`Buscar ${section === 'clips' ? 'clips' : 'vídeos'} por nombre…`} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select aria-label="Ordenar por" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }}>
          <option value="new">Más recientes primero</option>
          <option value="old">Más antiguos primero</option>
          <option value="name">Por nombre (A-Z)</option>
        </select>
        <div className="row">
          {!selecting && items.length > 0 && <button className="btn ghost small" onClick={() => setSelecting(true)}><IconCheck /> Seleccionar</button>}
          <button className="btn ghost small" onClick={() => setDialog({ type: 'new-group', parentId: here, withItems: [] })}><IconPlus /> Nueva carpeta</button>
        </div>
      </div>

      {selecting && (
        <div className="selbar" role="region" aria-label="Selección">
          <span aria-live="polite"><strong>{selectedItems.length}</strong> seleccionado(s)</span>
          <button className="btn ghost small" onClick={() => setSelected(new Set(items.map((o) => o.id)))}>Seleccionar todo</button>
          <button className="btn ghost small" disabled={!selectedItems.length} onClick={() => setSelected(new Set())}>Ninguno</button>
          <span className="grow" />
          <button className="btn danger small" disabled={!selectedItems.length} onClick={() => askDelete(selectedItems)}><IconTrash /> Eliminar</button>
          <button className="btn ghost small" onClick={stopSelecting}>Listo</button>
        </div>
      )}

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

      {searching && items.length === 0 && <div className="muted" style={{ marginBottom: 12 }}>Nada se llama así en {section === 'clips' ? 'los clips' : 'los vídeos'}.</div>}
      {subgroups.length === 0 && items.length === 0 && !searching && (
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
              className={`tile item ${dropOver === `o-${o.id}` ? 'over' : ''} ${selected.has(o.id) ? 'selected' : ''}`}
              data-testid={`item-${o.title}`}
              draggable={!selecting}
              tabIndex={0}
              role="button"
              aria-label={`${KIND_LABEL[o.kind]}: ${o.title}`}
              aria-pressed={selecting ? selected.has(o.id) : undefined}
              onDragStart={(e) => startDrag(e, { type: 'item', id: o.id })}
              onClick={() => (selecting ? toggle(o.id) : setOpenId(o.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (selecting && e.key === ' ')) {
                  e.preventDefault();
                  if (selecting) toggle(o.id);
                  else setOpenId(o.id);
                } else if (e.key === 'Delete' && e.target === e.currentTarget) askDelete(selecting && selected.size ? selectedItems : [o]);
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
                <PlatformDots platforms={itemPubs.filter((p) => p.status !== 'failed').map((p) => p.platform)} all={platformsFor(o.kind)} />
              </div>
              {selecting ? (
                <span className="selbox" aria-hidden="true">{selected.has(o.id) && <IconCheck size={14} />}</span>
              ) : (
                <div className="tile-actions">
                  <button className="btn ghost small" aria-label={`Programar subida de ${o.title}`} title="Programar subida" onClick={(e) => { e.stopPropagation(); setDialog({ type: 'schedule', outputId: o.id }); }}><IconCalendar /></button>
                  <button className="btn ghost small" aria-label={`Eliminar ${o.title}`} title="Eliminar" onClick={(e) => { e.stopPropagation(); askDelete([o]); }}><IconTrash /></button>
                  <button className="btn ghost small" aria-label={`Opciones de ${o.title}`} title="Más opciones" onClick={(e) => showMenu(e, itemMenu(o))}><IconMore /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {openItem && <ItemModal key={openItem.id} output={openItem} pubs={pubs.filter((p) => p.outputId === openItem.id)} playlists={[...new Set(outputs.map((o) => o.playlist).filter((p): p is string => Boolean(p)))].sort()} onChanged={props.onChanged} onClose={() => setOpenId(null)} onDelete={() => { const o = openItem; setOpenId(null); askDelete([o]); }} />}

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
      {dialog?.type === 'delete-items' && (
        <ConfirmDialog
          title={dialog.items.length === 1 ? 'Eliminar vídeo' : `Eliminar ${dialog.items.length} vídeos`}
          text={deleteText(dialog.items)}
          confirmLabel="Eliminar"
          danger
          onConfirm={() => deleteItems(dialog.items)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'schedule' && <ScheduleDialog outputs={outputs} pubs={pubs} outputId={dialog.outputId} onChanged={props.onChanged} onClose={() => setDialog(null)} />}
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

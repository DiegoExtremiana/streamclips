import { IconBack } from '../icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COVER_H, COVER_W, DESIGN_NAME_MAX, MAX_LAYERS, emptyDesign, emptyHistory, newImageLayer, newLayerId, newRectLayer, newTextLayer, normalizeDesign, pushState, redo, reorder, undo,
  type CoverFont, type Design, type DesignRecord, type History, type Layer,
} from '../../shared/coverDesign';
import type { CoverAsset } from '../../shared/covers';
import { errMsg, notify } from '../lib';
import LayersPanel from './LayersPanel';
import PropsPanel from './PropsPanel';
import Stage from './Stage';
import { drawDesign, loadPiece, registerFonts, type ImageMap } from './render';

/**
 * El editor de portadas: lienzo de 1280×720 con capas (imágenes de tu biblioteca, textos con tipografía, rectángulos),
 * ajustes de imagen, deshacer/rehacer y guardado como proyecto + imagen PNG en la biblioteca.
 */
export default function CoverEditor(props: {
  record: DesignRecord | null;
  assets: CoverAsset[];
  fonts: CoverFont[];
  onFontsChanged: () => void;
  onSaved: (rec: DesignRecord) => void;
  onClose: () => void;
}) {
  const [design, setDesign] = useState<Design>(() => (props.record ? normalizeDesign(props.record.design) : emptyDesign()));
  const [history, setHistory] = useState<History>(emptyHistory());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState(props.record?.name ?? 'Portada_nueva');
  const [recordId, setRecordId] = useState<string | null>(props.record?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [picker, setPicker] = useState(false);
  const images = useRef<ImageMap>(new Map());
  const loading = useRef(new Set<string>());
  const fontsDone = useRef(new Set<string>());
  const designRef = useRef(design);
  designRef.current = design;
  const historyRef = useRef(history);
  historyRef.current = history;

  // imágenes de las capas: se cargan una vez cada una
  useEffect(() => {
    for (const l of design.layers) {
      if (l.type !== 'image' || images.current.has(l.assetId) || loading.current.has(l.assetId)) continue;
      loading.current.add(l.assetId);
      void loadPiece(l.assetId).then((img) => {
        loading.current.delete(l.assetId);
        if (img) {
          images.current.set(l.assetId, img);
          setVersion((v) => v + 1);
        }
      });
    }
  }, [design.layers]);
  // tipografías propias
  useEffect(() => {
    void registerFonts(props.fonts, fontsDone.current).then(() => setVersion((v) => v + 1));
  }, [props.fonts]);

  const begin = useCallback(() => {
    setHistory((h) => pushState(h, designRef.current));
    setDirty(true);
  }, []);
  const edit = useCallback((fn: (d: Design) => Design) => {
    setDesign(fn);
    setDirty(true);
  }, []);
  const patch = useCallback((id: string, fn: (l: Layer) => Layer) => edit((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fn(l) : l)) })), [edit]);

  function addLayer(l: Layer, atBottom = false) {
    if (designRef.current.layers.length >= MAX_LAYERS) return notify(`Como máximo ${MAX_LAYERS} capas.`, 'warn');
    begin();
    edit((d) => ({ ...d, layers: atBottom ? [l, ...d.layers] : [...d.layers, l] }));
    setSelectedId(l.id);
  }
  async function addPiece(a: CoverAsset) {
    setPicker(false);
    let img = images.current.get(a.id) ?? null;
    if (!img) {
      img = await loadPiece(a.id);
      if (img) images.current.set(a.id, img);
    }
    if (!img) return notify(`No se pudo abrir «${a.name}».`, 'bad');
    const asBackground = a.kind === 'fondo' || a.kind === 'foto';
    addLayer(newImageLayer(a.id, a.name, img.naturalWidth, img.naturalHeight, asBackground), asBackground);
  }
  function removeLayer(id: string) {
    begin();
    edit((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId((s) => (s === id ? null : s));
  }
  function duplicate(id: string) {
    const l = designRef.current.layers.find((x) => x.id === id);
    if (!l) return;
    addLayer({ ...l, id: newLayerId(), name: `${l.name} (copia)`.slice(0, 40), x: l.x + 30, y: l.y + 30 } as Layer);
  }
  function doUndo() {
    const r = undo(historyRef.current, designRef.current);
    if (!r) return;
    setHistory(r.history);
    setDesign(r.design);
    setDirty(true);
  }
  function doRedo() {
    const r = redo(historyRef.current, designRef.current);
    if (!r) return;
    setHistory(r.history);
    setDesign(r.design);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const c = document.createElement('canvas');
      c.width = COVER_W;
      c.height = COVER_H;
      drawDesign(c.getContext('2d')!, designRef.current, images.current);
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
      if (!blob) throw new Error('No se pudo generar la imagen.');
      const rec = await window.api.designsSave({ id: recordId, name: name.trim() || 'Portada', design: designRef.current, png: new Uint8Array(await blob.arrayBuffer()) });
      setRecordId(rec.id);
      setName(rec.name);
      setDirty(false);
      props.onSaved(rec);
      notify(`Portada «${rec.name}» guardada en la biblioteca.`);
    } catch (e) {
      notify(errMsg(e), 'bad');
    } finally {
      setSaving(false);
    }
  }

  function close() {
    if (dirty && !window.confirm('Hay cambios sin guardar. ¿Salir sin guardarlos?')) return;
    props.onClose();
  }

  const selected = design.layers.find((l) => l.id === selectedId) ?? null;
  const pieces = useMemo(() => props.assets.filter((a) => a.isImage), [props.assets]);

  return (
    <div
      className="cve"
      data-testid="cover-editor"
      onKeyDown={(e) => {
        if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
        else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); doRedo(); }
      }}
    >
      <div className="cve-bar">
        <button className="btn ghost small" onClick={close}><IconBack size={14} /> Volver</button>
        <input className="cve-name" type="text" aria-label="Nombre de la portada" value={name} maxLength={DESIGN_NAME_MAX} onChange={(e) => { setName(e.target.value); setDirty(true); }} />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn ghost small" disabled={!history.past.length} onClick={doUndo} title="Deshacer (Ctrl+Z)">Deshacer</button>
          <button className="btn ghost small" disabled={!history.future.length} onClick={doRedo} title="Rehacer (Ctrl+Y)">Rehacer</button>
          <button className="btn" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : dirty ? 'Guardar portada' : 'Guardada'}</button>
        </div>
      </div>

      <div className="cve-grid">
        <aside className="cve-side" aria-label="Capas y herramientas">
          <div className="cve-tools">
            <button className="btn small" onClick={() => setPicker((p) => !p)} aria-expanded={picker}>+ Imagen</button>
            <button className="btn small" onClick={() => addLayer(newTextLayer())}>+ Texto</button>
            <button className="btn small" onClick={() => addLayer(newRectLayer())}>+ Rectángulo</button>
          </div>
          {picker && (
            <div className="cve-picker" role="listbox" aria-label="Elige una imagen de tu biblioteca">
              {pieces.length === 0 && <div className="muted small">No hay imágenes. Sube tus PNG y fondos en «Mis piezas».</div>}
              {pieces.map((a) => <PickerItem key={a.id} a={a} onPick={() => void addPiece(a)} />)}
            </div>
          )}
          <label className="cve-field">
            <span className="small">Color de fondo</span>
            <input type="color" aria-label="Color de fondo" value={design.background} onFocus={begin} onChange={(e) => edit((d) => ({ ...d, background: e.target.value }))} />
          </label>
          <h3>Capas</h3>
          <LayersPanel
            layers={design.layers}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onToggle={(id, key) => { begin(); patch(id, (l) => ({ ...l, [key]: !l[key] })); }}
            onMove={(id, dir) => { begin(); edit((d) => ({ ...d, layers: reorder(d.layers, id, dir) })); }}
            onDuplicate={duplicate}
            onDelete={removeLayer}
          />
        </aside>

        <div className="cve-center">
          <Stage design={design} images={images.current} version={version} selectedId={selectedId} onSelect={setSelectedId} onBegin={begin} onPatch={patch} onDelete={removeLayer} />
          <div className="muted small">Pulsa una capa para moverla; tira de las esquinas para cambiar su tamaño y del punto de arriba para girarla. Flechas = mover de 1 en 1 (Mayús, de 10 en 10).</div>
        </div>

        <aside className="cve-side" aria-label="Propiedades">
          <h3>{selected ? (selected.type === 'text' ? 'Texto' : selected.type === 'image' ? 'Imagen' : 'Rectángulo') : 'Propiedades'}</h3>
          <PropsPanel layer={selected} fonts={props.fonts} onBegin={begin} onPatch={(fn) => selected && patch(selected.id, fn)} onFontsChanged={props.onFontsChanged} />
        </aside>
      </div>
    </div>
  );
}

function PickerItem({ a, onPick }: { a: CoverAsset; onPick: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.api.coversPreview(a.id).then((s) => alive && setSrc(s)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [a.id]);
  return (
    <button className="cve-pick" role="option" aria-selected={false} onClick={onPick} title={a.name}>
      <span className="cv-thumb">{src ? <img src={src} alt="" /> : null}</span>
      <span className="small title-ellipsis">{a.name}</span>
    </button>
  );
}

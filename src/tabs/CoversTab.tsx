import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ASSET_KINDS, KIND_LABEL, MAX_ASSET_BYTES, PHRASE_MAX_CHARS, cleanPhrase, type AssetKind, type CoverAsset } from '../../shared/covers';
import { IconImage, IconPlus, IconTrash } from '../icons';
import { errMsg } from '../lib';
import { SideNav, useSubTab } from '../SubTabs';
import type { CoverFont, DesignRecord } from '../../shared/coverDesign';
import CoverEditor from '../cover/CoverEditor';
import DesignGallery from '../cover/DesignGallery';

type Msg = { ok: boolean; text: string } | null;
type Filter = 'todas' | AssetKind;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'imagen', label: 'Imágenes' },
  { id: 'fondo', label: 'Fondos' },
  { id: 'foto', label: 'Fotos' },
  { id: 'documento', label: 'Documentos' },
  { id: 'portada', label: 'Portadas hechas' },
];

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Miniatura que se pide al programa solo cuando se ve la pieza. */
function Thumb({ a }: { a: CoverAsset }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (a.isImage) void window.api.coversPreview(a.id).then((s) => alive && setSrc(s)).catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [a.id, a.isImage]);
  if (!a.isImage) return <div className="cv-thumb cv-doc">{a.ext.replace('.', '').toUpperCase()}</div>;
  return <div className="cv-thumb">{src ? <img src={src} alt={a.name} /> : <IconImage size={28} />}</div>;
}

function Piece(props: { a: CoverAsset; onChanged: () => void; onMsg: (m: Msg) => void }) {
  const { a } = props;
  const [name, setName] = useState(a.name);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setName(a.name), [a.name]);
  const run = (p: Promise<unknown>) => p.then(() => props.onChanged()).catch((e) => props.onMsg({ ok: false, text: errMsg(e) }));
  return (
    <div className="cv-piece" data-testid="cover-piece">
      <Thumb a={a} />
      <input
        className="cv-name"
        type="text"
        aria-label={`Nombre de ${a.name}`}
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() !== a.name && void run(window.api.coversRename(a.id, name))}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <div className="row" style={{ gap: 6 }}>
        <select aria-label={`Tipo de ${a.name}`} value={a.kind} disabled={!a.isImage} onChange={(e) => void run(window.api.coversSetKind(a.id, e.target.value as AssetKind))}>
          {ASSET_KINDS.filter((k) => (a.isImage ? k !== 'documento' : k === 'documento')).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <span className="muted small">{fmtSize(a.bytes)}</span>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn ghost small" onClick={() => void window.api.coversReveal(a.id).catch((e) => props.onMsg({ ok: false, text: errMsg(e) }))}>Mostrar en carpeta</button>
        {confirm ? (
          <>
            <button className="btn danger small" onClick={() => void run(window.api.coversRemove(a.id))}>Sí, borrar</button>
            <button className="btn ghost small" onClick={() => setConfirm(false)}>No</button>
          </>
        ) : (
          <button className="btn ghost small" aria-label={`Borrar ${a.name}`} onClick={() => setConfirm(true)}><IconTrash size={14} /></button>
        )}
      </div>
    </div>
  );
}

/** Portadas: la biblioteca de piezas (PNG, fondos, fotos, documentos) y el montaje de portadas con ellas. */
export default function CoversTab() {
  const [items, setItems] = useState<CoverAsset[]>([]);
  const [filter, setFilter] = useState<Filter>('todas');
  const [msg, setMsg] = useState<Msg>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [bg, setBg] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [badge, setBadge] = useState('');
  const [title, setTitle] = useState('');
  const [made, setMade] = useState<CoverAsset | null>(null);
  const [making, setMaking] = useState(false);
  const [sub, setSub] = useSubTab('streamclips.covers.sub', ['disenar', 'piezas', 'rapida']);
  const [designs, setDesigns] = useState<DesignRecord[]>([]);
  const [fonts, setFonts] = useState<CoverFont[]>([]);
  /** Diseño que se está editando: un registro guardado, 'new' (en blanco) o null (se ve la galería). */
  const [editing, setEditing] = useState<DesignRecord | 'new' | null>(null);
  const loadDesigns = useCallback(() => {
    window.api.designsList().then(setDesigns).catch(() => undefined);
    window.api.fontsList().then(setFonts).catch(() => undefined);
  }, []);
  useEffect(loadDesigns, [loadDesigns]);

  const load = useCallback(() => {
    window.api.coversList().then(setItems).catch((e) => setMsg({ ok: false, text: errMsg(e) }));
  }, []);
  useEffect(load, [load]);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    setBusy(true);
    setMsg(null);
    const errors: string[] = [];
    let ok = 0;
    for (const f of files) {
      try {
        if (f.size > MAX_ASSET_BYTES) throw new Error(`«${f.name}» pesa más de ${Math.round(MAX_ASSET_BYTES / 1048576)} MB.`);
        await window.api.coversAdd(f.name, new Uint8Array(await f.arrayBuffer()));
        ok++;
      } catch (e) {
        errors.push(errMsg(e));
      }
    }
    setBusy(false);
    load();
    setMsg(errors.length ? { ok: false, text: `${ok ? `${ok} añadida(s). ` : ''}${errors.join(' ')}` } : { ok: true, text: ok === 1 ? 'Pieza añadida.' : `${ok} piezas añadidas.` });
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addFiles(Array.from(e.dataTransfer.files));
  };

  const images = items.filter((a) => a.isImage);
  const backgrounds = images.filter((a) => a.kind !== 'portada');
  const shown = items.filter((a) => filter === 'todas' || a.kind === filter);

  async function make() {
    setMaking(true);
    setMsg(null);
    try {
      const n = Number(badge);
      const a = await window.api.coversCompose({ backgroundId: bg, subjectId: subject || undefined, text, badge: badge.trim() && Number.isInteger(n) ? n : null, name: title.trim() || undefined });
      setMade(a);
      load();
      setMsg({ ok: true, text: `Portada «${a.name}» creada y guardada en la biblioteca.` });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setMaking(false);
    }
  }

  // mientras se edita una portada, el editor ocupa todo el ancho (sin el menú lateral)
  if (sub === 'disenar' && editing) {
    return (
      <CoverEditor
        key={editing === 'new' ? 'new' : editing.id}
        record={editing === 'new' ? null : editing}
        assets={items}
        fonts={fonts}
        onFontsChanged={loadDesigns}
        onSaved={() => { loadDesigns(); load(); }}
        onClose={() => { setEditing(null); loadDesigns(); }}
      />
    );
  }

  return (
    <SideNav
      label="Portadas"
      value={sub}
      onChange={(id) => { setSub(id); setEditing(null); }}
      tabs={[
        { id: 'disenar', label: 'Diseñar portadas', hint: 'El editor: mezcla tus imágenes, fondos y textos en capas y guarda tus portadas para usarlas en los vídeos.' },
        { id: 'piezas', label: 'Mis piezas', hint: 'Tus PNG sin fondo, fondos, fotos y documentos, con el nombre que quieras.' },
        { id: 'rapida', label: 'Portada rápida', hint: 'Fondo + pieza principal + frase con el estilo de los canales grandes, en un paso.' },
      ]}
    >
    <div className="stack">
      {sub === 'disenar' && <DesignGallery designs={designs} onNew={() => setEditing('new')} onEdit={setEditing} onChanged={() => { loadDesigns(); load(); }} />}
      {sub === 'piezas' && <section className="card">
        <h2>Tus piezas</h2>
        <div className="muted small">
          Suelta aquí tus PNG (tú sorprendido, un logo), fondos, fotos y documentos de referencia. Ponles el nombre que quieras (por ejemplo Diego_Sorprendido o Fondo_Ciudad): con ellas se componen las portadas.
        </div>
        <div
          className={`cv-drop ${over ? 'over' : ''}`}
          data-testid="cover-drop"
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <IconPlus size={22} />
          <div>{busy ? 'Añadiendo…' : 'Arrastra aquí los archivos'}</div>
          <div className="muted small">Imágenes (PNG, JPG, WEBP, GIF) y documentos (PDF, TXT, MD, DOC, DOCX, ODT), hasta 25 MB cada uno</div>
          <button className="btn ghost" onClick={() => fileInput.current?.click()} disabled={busy}>Elegir archivos…</button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            data-testid="cover-input"
            accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md,.doc,.docx,.odt"
            onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
          />
        </div>
        {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 12 }} role="group" aria-label="Filtrar piezas">
          {FILTERS.map((f) => {
            const n = items.filter((a) => f.id === 'todas' || a.kind === f.id).length;
            return <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label} <span className="muted">{n}</span></button>;
          })}
        </div>
        {shown.length === 0 ? (
          <div className="muted" style={{ marginTop: 14 }}>{items.length ? 'No hay piezas de este tipo.' : 'Todavía no hay piezas. Suelta la primera arriba.'}</div>
        ) : (
          <div className="cv-grid">{shown.map((a) => <Piece key={a.id} a={a} onChanged={load} onMsg={setMsg} />)}</div>
        )}
      </section>}

      {sub === 'rapida' && <section className="card">
        <h2>Crear una portada</h2>
        <div className="muted small">
          Elige un fondo y, si quieres, una pieza principal (va grande a la derecha, ideal para un PNG recortado de ti). La frase sale grande a la izquierda con contorno, al estilo de los canales grandes. La portada (1280×720) se guarda en la biblioteca.
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cv-bg">Fondo</label>
            <select id="cv-bg" value={bg} onChange={(e) => setBg(e.target.value)}>
              <option value="">Elige un fondo…</option>
              {backgrounds.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cv-subject">Pieza principal (opcional)</label>
            <select id="cv-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Ninguna</option>
              {backgrounds.filter((a) => a.id !== bg).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 2 }}>
            <label htmlFor="cv-text">Frase (hasta 4 palabras)</label>
            <input id="cv-text" type="text" value={text} maxLength={PHRASE_MAX_CHARS + 6} onChange={(e) => setText(e.target.value)} placeholder="NO LO ESPERABA" />
            <div className="muted small">Sale así: {cleanPhrase(text) || 'sin frase'}</div>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cv-badge">Número de episodio (opcional)</label>
            <input id="cv-badge" type="text" inputMode="numeric" value={badge} onChange={(e) => setBadge(e.target.value.replace(/\D/g, '').slice(0, 3))} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="cv-title">Nombre de la portada (opcional)</label>
            <input id="cv-title" type="text" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
          </div>
        </div>
        <button className="btn" disabled={!bg || making} onClick={() => void make()}>{making ? 'Creando…' : 'Crear portada'}</button>
        {made && <div className="cv-made" data-testid="cover-made"><Thumb a={made} /><div className="muted small">{made.name}</div></div>}
      </section>}
    </div>
    </SideNav>
  );
}

import { useEffect, useState } from 'react';
import type { DesignRecord } from '../../shared/coverDesign';
import { fmtDate } from '../../shared/time';
import { IconImage, IconPlus, IconTrash } from '../icons';
import { errMsg, notify } from '../lib';

function Preview({ assetId }: { assetId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (assetId) void window.api.coversPreview(assetId).then((s) => alive && setSrc(s)).catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return <div className="cv-thumb">{src ? <img src={src} alt="" /> : <IconImage size={28} />}</div>;
}

/** Tus portadas guardadas: se abren para seguir editándolas o se borran. */
export default function DesignGallery(props: { designs: DesignRecord[]; onNew: () => void; onEdit: (d: DesignRecord) => void; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  async function remove(id: string) {
    try {
      await window.api.designsRemove(id, true);
      setConfirm(null);
      props.onChanged();
    } catch (e) {
      notify(errMsg(e), 'bad');
    }
  }
  return (
    <section className="card" aria-label="Tus portadas">
      <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
        <h2>Tus portadas</h2>
        <button className="btn" onClick={props.onNew}><IconPlus size={14} /> Nueva portada</button>
      </div>
      <div className="muted small">
        Mezcla tus imágenes (PNG sin fondo con tus expresiones), fondos, textos con la tipografía que quieras y ajustes de imagen en un lienzo de 1280×720, como un Photoshop pequeño.
        Se guardan para seguir editándolas, y luego las pones como miniatura de cualquier vídeo.
      </div>
      {props.designs.length === 0 ? (
        <div className="muted" style={{ marginTop: 14 }}>Todavía no has creado ninguna. Pulsa «Nueva portada» para empezar.</div>
      ) : (
        <div className="cv-grid">
          {props.designs.map((d) => (
            <div key={d.id} className="cv-piece" data-testid="cover-design">
              <Preview assetId={d.assetId} />
              <div className="cv-name-static">{d.name}</div>
              <div className="muted small">{fmtDate(new Date(d.updatedAt).toISOString())} · {d.design.layers.length} capa(s)</div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn small" onClick={() => props.onEdit(d)}>Editar</button>
                {confirm === d.id ? (
                  <>
                    <button className="btn danger small" onClick={() => void remove(d.id)}>Sí, borrar</button>
                    <button className="btn ghost small" onClick={() => setConfirm(null)}>No</button>
                  </>
                ) : (
                  <button className="btn ghost small" aria-label={`Borrar ${d.name}`} onClick={() => setConfirm(d.id)}><IconTrash size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

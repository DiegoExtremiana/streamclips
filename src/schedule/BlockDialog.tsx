import { useState } from 'react';
import type { Block } from '../../shared/schedulePlan';
import { toLocalInputValue, localInputToIso } from '../../shared/time';
import { errMsg, notify } from '../lib';
import { Modal } from '../library/ui';
import { PLATFORMS } from '../library/ItemModal';
import { IconTrash } from '../icons';

/** Detalle de una subida: cambiar la hora con el teclado, o quitarla. (Arrastrarla es lo más rápido.) */
export default function BlockDialog(props: { block: Block; onChanged: () => Promise<void>; onClose: () => void; onOpenVideo: (outputId: string) => void }) {
  const { block: b } = props;
  const [when, setWhen] = useState(toLocalInputValue(new Date(b.at)));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr('');
    const iso = localInputToIso(when);
    if (!iso) return setErr('Fecha y hora no válidas.');
    setBusy(true);
    try {
      const r = await window.api.schedule(b.outputId, b.platforms, iso);
      await props.onChanged();
      notify(r.warnings?.length ? `Hora cambiada. Aviso: ${r.warnings.join(' ')}` : 'Hora cambiada.', r.warnings?.length ? 'warn' : 'ok');
      props.onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      for (const k of b.keys) await window.api.cancelPublication(k);
      await props.onChanged();
      notify('Subida quitada de la programación.');
      props.onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={b.title} onClose={props.onClose}>
      <div className="muted small">Redes: {b.platforms.map((p) => PLATFORMS.find((x) => x.id === p)?.label).join(', ')}. Para cambiar el día y la hora más rápido, arrastra la subida en la línea de tiempo o en el calendario.</div>
      {b.note && <div className="msg small">{b.note}</div>}
      <div className="field">
        <label htmlFor="bd-when">Fecha y hora</label>
        <input id="bd-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      {err && <div className="msg bad" role="alert">{err}</div>}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn ghost danger-text" disabled={busy} onClick={() => void remove()}><IconTrash /> Quitar subida</button>
        <div className="row">
          <button className="btn ghost" onClick={() => { props.onClose(); props.onOpenVideo(b.outputId); }}>Ver el vídeo</button>
          <button className="btn" disabled={busy} onClick={() => void save()}>Guardar hora</button>
        </div>
      </div>
    </Modal>
  );
}

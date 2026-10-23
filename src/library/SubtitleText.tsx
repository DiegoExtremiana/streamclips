import { useMemo, useState } from 'react';
import { editableLines } from '../../shared/subtitleEdit';
import type { Range } from '../../shared/timeline';
import type { Word } from '../../shared/subtitles';
import { errMsg } from '../lib';

const PAGE = 25;

const clock = (t: number): string => {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Corregir el texto de los subtítulos: cada línea sale de la transcripción y se puede reescribir. Al guardar, la
 * transcripción queda corregida y el programa aprende de los cambios (palabras que Whisper entendió mal) para
 * corregirlas solo en los próximos directos.
 */
export default function SubtitleText(props: {
  vodId: string;
  words: Word[];
  ranges: Range[];
  /** Se llama tras guardar; `rerender` pide volver a montar el vídeo con el texto nuevo. */
  onSaved: (rerender: boolean) => Promise<void>;
  canRerender: boolean;
}) {
  const lines = useMemo(() => editableLines(props.words, props.ranges), [props.words, props.ranges]);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = Object.entries(edits).filter(([i, t]) => lines[Number(i)] && t.trim() !== lines[Number(i)].text);
  const pages = Math.max(1, Math.ceil(lines.length / PAGE));

  async function save(rerender: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await window.api.editTranscript(
        props.vodId,
        changed.map(([i, t]) => ({ start: lines[Number(i)].start, end: lines[Number(i)].end, text: t.trim() })),
      );
      setEdits({});
      const learned = r.learned.length ? ` Aprendido: ${r.learned.slice(0, 5).map((l) => `«${l.from}» → «${l.to}»`).join(', ')}${r.learned.length > 5 ? '…' : ''}.` : '';
      setMsg({ ok: true, text: `${r.changed} línea${r.changed === 1 ? '' : 's'} corregida${r.changed === 1 ? '' : 's'}.${learned}` });
      await props.onSaved(rerender);
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!lines.length) return null;
  return (
    <div data-testid="subtitle-text">
      <button type="button" className="btn ghost small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Ocultar el texto' : 'Editar el texto de los subtítulos'}
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div className="muted small">Corrige lo que Whisper entendió mal. Al guardar, el programa aprende de tus cambios y los aplica solo en los próximos directos.</div>
          {lines.slice(page * PAGE, page * PAGE + PAGE).map((l, k) => {
            const i = page * PAGE + k;
            const value = edits[i] ?? l.text;
            return (
              <div key={`${l.start}-${i}`} className="row" style={{ gap: 8, marginTop: 4 }}>
                <span className="muted small" style={{ width: 56 }}>{clock(l.start)}</span>
                <input
                  type="text"
                  aria-label={`Texto de la línea de ${clock(l.start)}`}
                  value={value}
                  style={{ flex: 1, ...(value.trim() !== l.text ? { borderColor: 'var(--accent, #7c5cff)' } : {}) }}
                  onChange={(e) => setEdits({ ...edits, [i]: e.target.value })}
                />
              </div>
            );
          })}
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn ghost small" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <span className="muted small">Página {page + 1} de {pages} · {lines.length} líneas</span>
            <button type="button" className="btn ghost small" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button type="button" className="btn small" data-testid="subtext-save" disabled={busy || !changed.length} onClick={() => void save(false)}>
              Guardar correcciones{changed.length ? ` (${changed.length})` : ''}
            </button>
            {props.canRerender && (
              <button type="button" className="btn small" disabled={busy || !changed.length} onClick={() => void save(true)}>
                Guardar y volver a montar el vídeo
              </button>
            )}
          </div>
          {msg && <div className={`msg small ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { formatVocabText, parseVocabText, type Vocabulary } from '../../shared/vocab';
import { errMsg } from '../lib';

/**
 * Palabras propias (nombres, apodos, juegos…) que Whisper no conoce. Se usan para guiarle al transcribir y para
 * corregir lo ya transcrito. También se llena sola: cada vez que corriges el texto de un subtítulo, el programa
 * apunta el cambio como corrección («marsan => Marshall»).
 */
export default function VocabularyCard() {
  const [vocab, setVocab] = useState<Vocabulary | null>(null);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function load() {
    try {
      const v = await window.api.getVocabulary();
      setVocab(v);
      setText(formatVocabText(v));
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setMsg(null);
    try {
      const v = await window.api.setVocabulary(parseVocabText(text, vocab?.corrections));
      setVocab(v);
      setText(formatVocabText(v));
      setMsg({ ok: true, text: `Guardado: ${v.terms.length} palabra${v.terms.length === 1 ? '' : 's'} y ${v.corrections.length} corrección${v.corrections.length === 1 ? '' : 'es'}.` });
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) });
    }
  }

  return (
    <section className="card" aria-label="Vocabulario">
      <h2>Mi vocabulario</h2>
      <div className="muted small">
        Una palabra por línea (nombres, apodos, juegos…): Whisper las usa para acertar al transcribir y el programa corrige lo parecido que haya salido mal.
        Para una corrección concreta escribe <code>lo que sale mal =&gt; lo correcto</code>. Se aplica también a las transcripciones que ya tienes. Además
        aprende solo: lo que corrijas a mano en el texto de un subtítulo se añade aquí.
      </div>
      <div className="field">
        <label htmlFor="vocab-text">Palabras y correcciones</label>
        <textarea id="vocab-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Movidas\nMarrshall\nmarsan => Marshall'} />
      </div>
      <button className="btn" onClick={() => void save()}>Guardar vocabulario</button>
      {msg && <div className={`msg ${msg.ok ? 'ok' : 'bad'}`} role="alert">{msg.text}</div>}
    </section>
  );
}

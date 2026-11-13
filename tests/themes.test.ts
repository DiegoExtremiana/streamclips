import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProposal, decideFormat, dedupeProposals, overlapRatio, parseThemes, themePrompt, transcriptBlocks, type ThemeUnit } from '../shared/themes';

const u = (id: string, start: number, len: number, total = 6, title = ''): ThemeUnit => ({ id, start, end: start + len, text: `texto ${id}`, total, title: title || undefined });
const units = [u('a', 900, 90, 7, 'La situación'), u('b', 3000, 80, 6), u('c', 7200, 100, 8, 'Otra vez'), u('d', 10800, 120, 9, 'El remate'), u('e', 12000, 20, 4)];

describe('edición temática', () => {
  it('valida lo que devuelve el modelo: ids conocidos, ninguno repetido entre temas, 2 piezas o más y solo lo que vale', () => {
    const raw = {
      temas: [
        { titulo: 'El pato del bar', contexto: 'Se retoma', vale: true, piezas: [{ id: 'a', rol: 'inicio' }, { id: 'c', rol: 'raro' }, { id: 'zz', rol: 'desarrollo' }, { id: 'd', rol: 'desenlace', contexto: true }], cortos: [{ titulo: 'Parte 1', ids: ['a', 'zz'] }] },
        { titulo: 'Repite c', vale: true, piezas: [{ id: 'c' }, { id: 'b' }] },
        { titulo: 'No vale', vale: false, piezas: [{ id: 'b' }, { id: 'e' }] },
        { titulo: 'Una sola', vale: true, piezas: [{ id: 'e' }] },
      ],
    };
    const t = parseThemes(raw, new Set(units.map((x) => x.id)));
    assert.equal(t.length, 1);
    assert.deepEqual(t[0].pieces.map((p) => [p.id, p.role, p.needsContext]), [['a', 'inicio', false], ['c', 'desarrollo', false], ['d', 'desenlace', true]]);
    assert.deepEqual(t[0].shorts, [{ title: 'Parte 1', ids: ['a'] }]);
    assert.deepEqual(parseThemes('basura', new Set()), []);
  });

  it('monta el vídeo en orden cronológico, añade contexto a la pieza que lo pide y explica la estructura', () => {
    const [t] = parseThemes({ temas: [{ titulo: 'El pato', vale: true, piezas: [{ id: 'd', rol: 'desenlace', contexto: true }, { id: 'a', rol: 'inicio' }, { id: 'c', rol: 'desarrollo' }] }] }, new Set(units.map((x) => x.id)));
    const p = buildProposal(t, units, 'v1', { minLongSec: 100 })!;
    assert.deepEqual(p.long.segs.map((s) => s.start), [900, 7200, 10794], 'orden cronológico y 6 s de contexto en el desenlace');
    assert.equal(p.long.sec, 90 + 100 + 126);
    assert.match(p.structure[0], /^Inicio · 15:00 · 1:30 — La situación/);
    assert.match(p.structure[2], /^Desenlace/);
  });

  it('un gancho abre el vídeo pero el resto sigue en orden', () => {
    const [t] = parseThemes({ temas: [{ titulo: 'Gancho', vale: true, piezas: [{ id: 'a', rol: 'inicio' }, { id: 'c', rol: 'desarrollo' }, { id: 'd', rol: 'gancho' }] }] }, new Set(units.map((x) => x.id)));
    const p = buildProposal(t, units, 'v1', { minLongSec: 100 })!;
    assert.deepEqual(p.long.segs.map((s) => s.start), [10800, 900, 7200]);
  });

  it('se pasa un poco del objetivo pero con tope: quita primero lo de menos nota y respeta inicio y desenlace', () => {
    const many = Array.from({ length: 8 }, (_, i) => u(`m${i}`, i * 1000, 150, i === 1 ? 2 : 7));
    const [t] = parseThemes({ temas: [{ titulo: 'Largo', vale: true, piezas: many.map((m, i) => ({ id: m.id, rol: i === 0 ? 'inicio' : i === 7 ? 'desenlace' : 'desarrollo' })) }] }, new Set(many.map((m) => m.id)));
    const p = buildProposal(t, many, 'v', { targetSec: 600, hardCapSec: 840 })!;
    assert.ok(p.long.sec <= 840 && p.long.sec >= 600, `${p.long.sec}`);
    assert.ok(!p.pieces.some((x) => x.id === 'm1'), 'la pieza de peor nota se quita antes');
    assert.equal(p.pieces[0].id, 'm0');
    assert.equal(p.pieces[p.pieces.length - 1].id, 'm7');
  });

  it('decide cuándo preguntar: solo con dos opciones buenas; con una se hace sola; sin material no sale nada', () => {
    const [t] = parseThemes({ temas: [{ titulo: 'Dos formas', vale: true, piezas: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }] }, new Set(units.map((x) => x.id)));
    const ask = buildProposal(t, units, 'v', { minLongSec: 100 })!;
    assert.equal(decideFormat(ask), 'ask');
    assert.equal(ask.shorts.length, 3);
    assert.equal(decideFormat({ ...ask, shorts: ask.shorts.slice(0, 1) }), 'long');
    assert.equal(decideFormat({ ...ask, long: { segs: [], sec: 0 } }), 'shorts');
    assert.equal(decideFormat({ ...ask, long: { segs: [], sec: 0 }, shorts: [] }), 'none');
    const tiny = buildProposal(parseThemes({ temas: [{ titulo: 'Poco', vale: true, piezas: [{ id: 'e' }, { id: 'b' }] }] }, new Set(units.map((x) => x.id)))[0], units, 'v');
    assert.equal(tiny, null, 'sin material suficiente no se propone nada');
  });

  it('no repite: descarta lo casi idéntico a lo ya generado y a otra propuesta de la misma tanda', () => {
    const mk = (ids: string[], title: string) => buildProposal(parseThemes({ temas: [{ titulo: title, vale: true, piezas: ids.map((id) => ({ id })) }] }, new Set(units.map((x) => x.id)))[0], units, 'v', { minLongSec: 100 })!;
    const p1 = mk(['a', 'b', 'c'], 'Uno');
    const p2 = mk(['a', 'b', 'c'], 'Dos igual');
    const p3 = mk(['c', 'd'], 'Tres distinto');
    const r = dedupeProposals([p1, p2, p3], [[{ start: 10800, end: 10920 }]]);
    assert.deepEqual(r.kept.map((x) => x.title), ['Uno', 'Tres distinto']);
    assert.equal(r.dropped, 1);
    assert.deepEqual(dedupeProposals([p3], [[{ start: 7200, end: 7300 }, { start: 10800, end: 10920 }]]).kept, [], 'ya hay un vídeo con casi todo eso');
    assert.equal(overlapRatio([{ start: 0, end: 10 }], [{ start: 5, end: 20 }]), 0.5);
  });

  it('las unidades para el modelo incluyen charla con contenido que no coincide con los momentos ya valorados', () => {
    const words = Array.from({ length: 300 }, (_, i) => ({ text: 'x', start: 5000 + i * 0.5, end: 5000 + i * 0.5 + 0.3 }));
    const blocks = transcriptBlocks(words, [{ start: 900, end: 990 }]);
    assert.ok(blocks.length >= 1 && blocks.every((b) => b.start >= 4950));
    assert.deepEqual(transcriptBlocks(words, [{ start: 4950, end: 5250 }]), []);
    const p = JSON.parse(themePrompt(units));
    assert.equal(p.fragmentos[0].hora, '15:00');
  });
});

describe('agrupaciones dudosas y tienda de propuestas', () => {
  it('descarta un tema con poca confianza', () => {
    const r = parseThemes({ temas: [{ titulo: 'Dudoso', vale: true, confianza: 0.2, piezas: [{ id: 'a' }, { id: 'b' }] }] }, new Set(['a', 'b']));
    assert.equal(r.length, 0);
  });
  it('guarda, devuelve y resuelve propuestas, y protege sus tramos', async () => {
    const { ThemeStore } = await import('../electron/domain/themes');
    const os = await import('node:os');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'th-'));
    const file = path.join(dir, 't.json');
    let n = 0;
    const st = new ThemeStore(file, () => n++);
    const p = { id: 'v:1:x', vodId: 'v', title: 'X', context: '', category: '', participants: [], confidence: 0.8, why: '', potential: { clip: 1, long: 1, several: 1 }, resolved: true, pieces: [{ id: 'a', role: 'inicio', start: 10, end: 50 }], structure: [], long: { segs: [], sec: 0 }, shorts: [], status: 'pending', createdAt: '' } as never;
    st.put('v', [p]);
    assert.equal(st.hasPending('v'), true);
    assert.deepEqual(st.pendingSpans('v'), [{ start: 10, end: 50 }]);
    assert.equal(new ThemeStore(file).pending().length, 1);
    st.resolve('v:1:x', 'dismissed');
    assert.equal(st.hasPending('v'), false);
    assert.ok(n >= 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

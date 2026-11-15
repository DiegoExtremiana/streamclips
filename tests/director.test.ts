import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTOR_SYSTEM, directedCut, directorCandidates, directorPrompt, parseDirectorPlan, type DirectorCandidate } from '../shared/director';
import { buildOverlayAss } from '../shared/overlays';
import { normalizeEffects, validateEffects, validateLongSpec, normalizeLong } from '../shared/plan';
import type { Judged } from '../shared/judge';

const cand = (id: string, start: number, dur: number, total: number): DirectorCandidate => ({ id, start, end: start + dur, total, kind: 'gracia', reason: 'x', text: 't' });

const CANDS = [cand('c1', 100, 60, 7), cand('c2', 300, 90, 8.5), cand('c3', 600, 120, 6), cand('c4', 900, 60, 9), cand('c5', 1200, 90, 5), cand('c6', 1500, 70, 7.5)];

const plan = (over: Record<string, unknown> = {}) => ({
  titulo: 'La partida que se torció',
  descripcion: 'Empezamos bien y acabamos como siempre.',
  miniatura: 'SE TORCIÓ TODO',
  gancho: { id: 'c4', desde: 10, hasta: 22, rotulo: 'lo que pasó al final' },
  capitulos: [
    { titulo: 'Arranque', ids: ['c2', 'c1'], ritmo: 'normal' },
    { titulo: 'La racha', ids: ['c3', 'c4'], ritmo: 'rapido' },
    { titulo: 'El final', ids: ['c6'], ritmo: 'normal' },
  ],
  frases: [{ id: 'c4', en: 15, texto: 'no me lo creo' }, { id: 'zz', en: 1, texto: 'fuera' }, { id: 'c5', en: 1, texto: 'no está en el vídeo' }],
  motivo: 'Gancho con el momento 9, luego por orden.',
  ...over,
});

describe('director de edición', () => {
  it('los candidatos llevan texto, imagen, volumen y chat, van por orden del directo y fuera lo descartado o flojo', () => {
    const judged: Judged[] = [
      { id: 'a', start: 100, end: 140, signal: 1, total: 8, visual: { score: 8, note: 'cara de susto' }, judgement: { id: 'a', scores: {} as never, kind: 'fail', reason: 'Fail claro', discard: false, trim: { start: 105, end: 135 } } },
      { id: 'b', start: 10, end: 50, signal: 1, total: 6, judgement: { id: 'b', scores: {} as never, kind: 'gracia', reason: 'Risa. Imagen (7/10): gesto exagerado', discard: false } },
      { id: 'c', start: 200, end: 240, signal: 1, total: 9, judgement: { id: 'c', scores: {} as never, kind: 'epico', reason: 'x', discard: true } },
      { id: 'd', start: 300, end: 340, signal: 1, total: 3, judgement: { id: 'd', scores: {} as never, kind: 'otro', reason: 'x', discard: false } },
    ];
    const words = [{ text: 'hola', start: 106, end: 107 }, { text: 'susto', start: 120, end: 121 }];
    const energy = Array.from({ length: 400 }, (_, i) => (i >= 105 && i < 135 ? -10 : -30));
    const chat = Array.from({ length: 400 }, (_, i) => (i >= 105 && i < 135 ? 2 : 0));
    const out = directorCandidates(judged, words, { energyDb: energy, chat });
    assert.deepEqual(out.map((c) => c.id), ['b', 'a'], 'por orden del directo, sin el descartado ni el de nota 3');
    const a = out[1];
    assert.deepEqual([a.start, a.end], [105, 135], 'usa el recorte del modelo');
    assert.equal(a.visual?.note, 'cara de susto');
    assert.ok((a.energy ?? 0) > 10, String(a.energy));
    assert.equal(a.chatPerMin, 120);
    assert.match(a.text, /\[1s\] hola \[15s\] susto/);
    assert.equal(out[0].visual?.score, 7, 'la nota de imagen también se lee del motivo antiguo');
    assert.ok(!/Imagen \(/.test(out[0].reason));
    const p = directorPrompt({ vodTitle: 'Directo', dateLabel: '1 de enero', categories: ['Pokémon'], minSec: 600, maxSec: 900, candidates: out, style: { titleStyle: 'estetico', lore: [{ id: '1', name: 'El cubo', note: 'siempre se le cae', triggers: [] }] } });
    assert.match(p, /entre 10 y 15 minutos/);
    assert.match(p, /El cubo: siempre se le cae/);
    assert.match(p, /"imagen":"8\/10: cara de susto"/);
    assert.match(DIRECTOR_SYSTEM, /GANCHO/);
  });

  it('valida el plan: ids reales sin repetir, orden cronológico dentro del capítulo, gancho de 5 a 20 s, frases solo de momentos usados', () => {
    const r = parseDirectorPlan(plan(), CANDS)!;
    assert.ok(r);
    assert.equal(r.title, 'La partida que se torció');
    assert.equal(r.coverText, 'SE TORCIÓ TODO');
    assert.deepEqual(r.chapters.map((c) => c.ids), [['c1', 'c2'], ['c3', 'c4'], ['c6']], 'dentro del capítulo manda el orden del directo');
    assert.deepEqual(r.hook, { id: 'c4', from: 10, to: 22, caption: 'lo que pasó al final' });
    assert.deepEqual(r.phrases, [{ id: 'c4', at: 15, text: 'no me lo creo' }]);
    // repetidos, ids falsos y gancho demasiado largo
    const r2 = parseDirectorPlan(plan({ capitulos: [{ titulo: 'A', ids: ['c1', 'c1', 'nope'] }, { titulo: 'B', ids: ['c1', 'c2'] }], gancho: { id: 'c2', desde: 0, hasta: 60 } }), CANDS)!;
    assert.deepEqual(r2.chapters.map((c) => c.ids), [['c1'], ['c2']]);
    assert.deepEqual([r2.hook!.from, r2.hook!.to], [0, 20], 'el gancho se recorta a 20 s');
    assert.equal(parseDirectorPlan(plan({ capitulos: [{ titulo: 'solo uno', ids: ['c1'] }] }), CANDS), null, 'con un capítulo no hay estructura');
    assert.equal(parseDirectorPlan({}, CANDS), null);
    assert.equal(parseDirectorPlan('x', CANDS), null);
  });

  it('el montaje sale del plan: gancho primero, capítulos con su etiqueta en el primer tramo, rótulos en segundos del directo', () => {
    const r = parseDirectorPlan(plan(), CANDS)!;
    const cut = directedCut(r, CANDS, { minSec: 300, maxSec: 600, floorSec: 150 })!;
    assert.ok(cut);
    assert.deepEqual(cut.segs[0], { start: 910, end: 922 }, 'el gancho es un trozo del momento c4');
    assert.deepEqual(cut.segs.slice(1).map((s) => s.start), [100, 300, 600, 900, 1500]);
    assert.deepEqual(cut.labels, ['', 'Arranque', '', 'La racha', '', 'El final']);
    assert.equal(cut.hookRepeats, true);
    const kinds = cut.captions.map((c) => c.kind);
    assert.deepEqual(kinds.filter((k) => k === 'gancho').length, 1);
    assert.deepEqual(kinds.filter((k) => k === 'capitulo').length, 3);
    assert.deepEqual(cut.captions.find((c) => c.kind === 'frase'), { at: 915, text: 'no me lo creo', kind: 'frase', duration: 3 });
    assert.equal(cut.totalSec, 12 + 60 + 90 + 120 + 60 + 70);
  });

  it('si se pasa de la duración quita lo más flojo (nunca el cierre ni el único de un capítulo); si no llega al mínimo, nada', () => {
    const r = parseDirectorPlan(plan(), CANDS)!;
    const cut = directedCut(r, CANDS, { minSec: 200, maxSec: 240, floorSec: 150 })!;
    assert.ok(cut);
    assert.ok(cut.totalSec <= 240 * 1.1, String(cut.totalSec));
    assert.ok(cut.segs.some((s) => s.start === 1500), 'el cierre se queda');
    assert.ok(!cut.segs.some((s) => s.start === 600), 'fuera el de nota 6 (c3) antes que los de 7 o más');
    assert.equal(directedCut(r, CANDS, { minSec: 3000, maxSec: 4000, floorSec: 150 }), null, 'ni la mitad del mínimo: no vale');
  });

  it('los rótulos van en un ASS aparte, no se solapan y el gancho sale en mayúsculas; el efecto «title» se valida y normaliza', () => {
    const ass = buildOverlayAss([
      { start: 10, end: 13, text: 'La racha', kind: 'capitulo' },
      { start: 0.3, end: 4, text: 'lo que pasó al final', kind: 'gancho' },
      { start: 12, end: 15, text: 'no me lo creo', kind: 'frase' },
    ], 1920, 1080);
    assert.match(ass, /Style: Capitulo,Inter/);
    assert.match(ass, /Dialogue: 1,0:00:00\.30,0:00:04\.00,Gancho,,0,0,0,,\{\\fad\(200,300\)\}LO QUE PASÓ AL FINAL/);
    assert.match(ass, /0:00:13\.00,0:00:15\.00,Frase/, 'la frase espera a que acabe la cartela del capítulo');
    const ranges = [{ start: 100, end: 160 }];
    assert.equal(validateEffects([{ type: 'title', at: 120, text: 'Hola' }], ranges), null);
    assert.match(validateEffects([{ type: 'title', at: 200, text: 'Hola' }], ranges) ?? '', /cortada o fuera/);
    assert.match(validateEffects([{ type: 'title', at: 120, text: '' }], ranges) ?? '', /texto de 1 a 60/);
    assert.match(validateEffects([{ type: 'title', at: 120, text: 'x', duration: 30 }], ranges) ?? '', /entre 1 y 8/);
    assert.match(validateEffects([{ type: 'title', at: 120, text: 'x', kind: 'nope' as never }], ranges) ?? '', /capitulo, frase, gancho/);
    assert.deepEqual(normalizeEffects([{ type: 'title', at: 120, text: '  Hola   mundo ' }]), [{ type: 'title', at: 120, text: 'Hola mundo', duration: 3, kind: 'frase' }]);
    assert.equal(validateLongSpec({ title: 't', segments: ranges, coverText: 'x'.repeat(41) }), 'la frase de la portada debe ser texto de 40 caracteres como máximo');
    assert.equal(normalizeLong({ title: 't', segments: ranges, coverText: ' SE  TORCIÓ ' }).coverText, 'SE TORCIÓ');
  });
});

describe('gancho de los clips verticales', () => {
  it('pone el título en pantalla en los 3 primeros segundos y lo acorta si es largo', async () => {
    const { withClipHook, CLIP_HOOK_SEC } = await import('../shared/autoEdit');
    const fx = withClipHook([{ type: 'polish' }], 'No te vas a creer lo que le pasa a este tío en directo', [{ start: 100, end: 140 }]);
    const t = fx.find((e) => e.type === 'title');
    assert.ok(t && t.type === 'title');
    assert.equal(t.kind, 'gancho');
    assert.equal(t.duration, CLIP_HOOK_SEC);
    assert.ok(t.text.length <= 38);
    assert.ok(t.at >= 100 && t.at < 101);
    // un clip demasiado corto no lleva gancho
    assert.equal(withClipHook([{ type: 'polish' }], 'Corto', [{ start: 0, end: 4 }]).some((e) => e.type === 'title'), false);
  });
});

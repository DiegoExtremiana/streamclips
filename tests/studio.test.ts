import test from 'node:test';
import assert from 'node:assert/strict';
import { directedCut, parseDirectorPlan, type DirectorCandidate } from '../shared/director';
import { SCENE, applyChief, applyTrims, parseChief, parseFunny, parseTrims, rebasePlan, sceneCandidate, sceneSpans } from '../shared/studio';

const c = (id: string, start: number, end: number, total = 7): DirectorCandidate => ({ id, start, end, total, kind: 'gracia', title: `t-${id}`, reason: 'r', text: 'x' });

test('escenas: los picos cercanos se unen en un tramo continuo con contexto y los lejanos van aparte', () => {
  const spans = sceneSpans([c('a', 100, 140), c('b', 200, 250, 9), c('c', 2000, 2040)], { ...SCENE, durationSec: 5000 });
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0].members.map((m) => m.id), ['a', 'b']);
  assert.equal(spans[0].start, 100 - SCENE.lead);
  assert.equal(spans[0].end, 250 + SCENE.tail);
  assert.equal(spans[1].start, 2000 - SCENE.lead);
  const sc = sceneCandidate(spans[0], 0, 'texto');
  assert.equal(sc.id, 'e1');
  assert.ok(sc.total > 7 && sc.total < 9);
});

test('escenas: no pasan del máximo, no se pisan y respetan los límites de categoría', () => {
  const many = Array.from({ length: 8 }, (_, i) => c(`m${i}`, 100 + i * 80, 150 + i * 80));
  const spans = sceneSpans(many, { ...SCENE, durationSec: 5000 });
  assert.ok(spans.length >= 2);
  spans.forEach((s, i) => {
    assert.ok(s.end - s.start <= SCENE.maxSec + 0.1, `escena ${i} de ${s.end - s.start}s`);
    if (i) assert.ok(s.start >= spans[i - 1].end);
  });
  const lim = sceneSpans([c('a', 100, 140), c('b', 160, 200)], { ...SCENE, durationSec: 5000 }, (x) => (x.start < 150 ? { start: 0, end: 150 } : { start: 150, end: 900 }));
  assert.equal(lim.length, 2);
  assert.equal(lim[0].end, 150);
  assert.equal(lim[1].start, 150);
});

test('ritmo: solo acepta recortes razonables y el plan se recoloca tras recortar', () => {
  const cands = [c('e1', 0, 100), c('e2', 200, 300), c('e3', 400, 440)];
  const trims = parseTrims({ recortes: [{ id: 'e1', desde: 10, hasta: 95 }, { id: 'e2', desde: 60, hasta: 100 }, { id: 'zz', desde: 0, hasta: 5 }, { id: 'e3', desde: 0, hasta: 40 }] }, cands);
  assert.deepEqual(trims, [{ id: 'e1', from: 10, to: 95 }]);
  const t = applyTrims(cands, trims);
  assert.deepEqual([t[0].start, t[0].end], [10, 95]);
  const plan = parseDirectorPlan({ titulo: 'T', capitulos: [{ titulo: 'A', ids: ['e1'] }, { titulo: 'B', ids: ['e2', 'e3'] }], gancho: { id: 'e1', desde: 20, hasta: 32 }, frases: [{ id: 'e1', en: 5, texto: 'fuera' }, { id: 'e1', en: 50, texto: 'dentro' }] }, cands)!;
  const p = rebasePlan(plan, trims, 5);
  assert.deepEqual([p.hook!.from, p.hook!.to], [10, 22]);
  assert.deepEqual(p.phrases.map((x) => [x.text, x.at]), [['dentro', 40]]);
  const cut = directedCut(p, t, { minSec: 100, maxSec: 900, floorSec: 60 })!;
  assert.deepEqual(cut.segs[0], { start: 20, end: 32 });
});

test('humor: exige gracia, ajusta la duración y ordena por gracia', () => {
  const cands = [c('a', 0, 70), c('b', 100, 130), c('d', 300, 400)];
  const f = parseFunny({ clips: [{ id: 'a', desde: 30, hasta: 34, titulo: 'Uno', gracia: 7 }, { id: 'b', desde: 0, hasta: 30, gracia: 5 }, { id: 'd', desde: 0, hasta: 100, titulo: 'Largo', gracia: 9 }] }, cands, 5);
  assert.deepEqual(f.map((x) => x.id), ['d', 'a']);
  assert.equal(f[0].end - f[0].start, 60);
  assert.equal(f[0].end, 400);
  assert.ok(f[1].end - f[1].start >= 12);
});

test('clips virales: lo viral manda al elegir y al ordenar, aunque haga menos gracia', () => {
  const cands = [c('a', 0, 40), c('b', 100, 140), c('d', 300, 340), c('e', 500, 540)];
  const f = parseFunny(
    {
      clips: [
        { id: 'a', desde: 0, hasta: 30, titulo: 'Gracioso pero de nicho', gracia: 8, viral: 5 },
        { id: 'b', desde: 0, hasta: 30, titulo: 'Jugada increíble', gracia: 3, viral: 9 },
        { id: 'd', desde: 0, hasta: 30, titulo: 'Flojo', gracia: 4, viral: 5 },
        { id: 'e', desde: 0, hasta: 30, titulo: 'Sin dato viral', gracia: 7 },
      ],
    },
    cands,
    5,
  );
  assert.deepEqual(f.map((x) => x.id), ['b', 'e', 'a'], 'primero lo más viral; lo que no engancha ni hace gracia, fuera');
  assert.equal(f[0].viral, 9);
  assert.equal(f[1].viral, 7, 'sin nota viral, cuenta la gracia');
  assert.deepEqual(parseFunny({ clips: [{ id: 'd', desde: 0, hasta: 30, gracia: 4, viral: 5.6 }] }, cands, 5, 5.5, 5.5).map((x) => x.id), ['d'], 'priorizando la cantidad, el listón baja');
});

test('jefe: quita lo que sobra sin vaciar capítulos ni tocar el cierre ni el gancho', () => {
  const cands = [c('e1', 0, 100), c('e2', 200, 300), c('e3', 400, 500), c('e4', 600, 700), c('e5', 800, 900), c('e6', 1000, 1100)];
  const plan = parseDirectorPlan({ titulo: 'T', capitulos: [{ titulo: 'A', ids: ['e1', 'e2', 'e3'] }, { titulo: 'B', ids: ['e4'] }, { titulo: 'C', ids: ['e5', 'e6'] }], gancho: { id: 'e1', desde: 0, hasta: 10 } }, cands)!;
  const r = parseChief({ aprobado: false, quitar: ['e1', 'e2', 'e4', 'e6', 'nope'], titulo: 'Mejor', notas: 'ok' }, plan)!;
  const a = applyChief(plan, r);
  assert.equal(a.dropped, 1);
  assert.deepEqual(a.plan.chapters.map((x) => x.ids), [['e1', 'e3'], ['e4'], ['e5', 'e6']]);
  assert.equal(a.plan.title, 'Mejor');
});

test('tramos mudos: se mide la parte en silencio de un tramo', async () => {
  const { silentShare, MUTED_SHARE } = await import('../shared/highlights');
  const e = [...Array.from({ length: 100 }, () => -25), ...Array.from({ length: 100 }, () => -91)];
  assert.equal(silentShare(e, { start: 10, end: 60 }), 0);
  assert.equal(silentShare(e, { start: 120, end: 180 }), 1);
  assert.ok(silentShare(e, { start: 80, end: 120 }) >= MUTED_SHARE);
  assert.equal(silentShare(undefined, { start: 0, end: 10 }), 0);
});

test('equipo: las notas de los compañeros y las correcciones del jefe llegan al editor de historia', async () => {
  const { teamNotes, revisionNote } = await import('../shared/studio');
  const n = teamNotes({ funny: [{ sceneId: 'e3', title: 'El cubo', fun: 9 }], themes: [{ title: 'Política', sceneIds: ['e2', 'e5'] }, { title: 'Vacío', sceneIds: [] }], trimmed: 2 });
  assert.match(n, /NOTAS DE TU EQUIPO/);
  assert.match(n, /Editor de clips virales: .*e3 \(«El cubo», 9\/10\)/);
  assert.match(n, /Editor de temas: .*«Política» con e2, e5/);
  assert.doesNotMatch(n, /Vacío/);
  assert.match(n, /Editor de ritmo: .*2 escena/);
  assert.equal(teamNotes({ funny: [], themes: [], trimmed: 0 }), '');
  assert.match(revisionNote({ approved: false, drop: ['e4'], title: '', coverText: '', notes: 'El final no remata' }), /CORRECCIONES DEL JEFE DE EDICIÓN.*El final no remata.*e4/);
});

test('relleno: si el resumen se queda corto se añaden las mejores escenas no usadas en su capítulo y en orden', async () => {
  const { fillPlan } = await import('../shared/studio');
  const cands = [c('e1', 0, 60, 8), c('e2', 100, 160, 6), c('e3', 200, 260, 9), c('e4', 500, 560, 4), c('e5', 320, 380, 7)];
  const plan = parseDirectorPlan({ titulo: 'T', capitulos: [{ titulo: 'A', ids: ['e1'] }, { titulo: 'B', ids: ['e5'] }] }, cands)!;
  const r = fillPlan(plan, cands, 230, 5);
  assert.equal(r.added, 2);
  assert.deepEqual(r.plan.chapters.map((x) => x.ids), [['e1', 'e2'], ['e3', 'e5']]);
  assert.equal(fillPlan(plan, cands, 60, 5).added, 0);
});

test('lectura completa: el texto preciso manda donde lo hay y la lectura rápida cubre el resto del directo', async () => {
  const { mergeWords } = await import('../shared/subtitles');
  const w = (text: string, start: number) => ({ text, start, end: start + 0.4 });
  const precise = [w('hola', 100), w('buenas', 101)];
  const rough = [w('ola', 100.1), w('buena', 101.2), w('naturaleza', 500), w('política', 900)];
  assert.deepEqual(mergeWords(precise, rough).map((x) => x.text), ['hola', 'buenas', 'naturaleza', 'política']);
  assert.deepEqual(mergeWords([], rough).length, 4);
});

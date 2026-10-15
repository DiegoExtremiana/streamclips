import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CLIPS_PER_PLAN, MAX_TITLE_LEN, parsePlan, validateClipSpec, validateLongSpec,
} from '../shared/plan';
import { childGroups, countInside, flattenGroups, groupLabel, itemsIn, pathOf, subtreeIds } from '../shared/groupTree';
import type { Group, OutputItem } from '../shared/types';
import { youtubeProblems } from '../shared/youtube';
import { defaultLocalDateTime, fmtTime, localInputToIso, parseTime } from '../shared/time';

const clip = (o: Record<string, unknown> = {}) => ({ kind: 'vertical', start: 10, end: 40, title: 't', ...o });

describe('shared/time', () => {
  it('parseTime acepta segundos, m:ss y h:mm:ss', () => {
    assert.equal(parseTime('90'), 90);
    assert.equal(parseTime('1:30'), 90);
    assert.equal(parseTime('1:02:03'), 3723);
    assert.equal(parseTime('  2:05 '), 125);
    assert.equal(parseTime('1.5'), 1.5);
    assert.equal(parseTime('0:00'), 0);
  });

  it('parseTime rechaza entradas no válidas', () => {
    for (const bad of ['', '   ', 'abc', '-5', '1:60', '1:2:3:4', '1::2', '1:xx', '1e3', '0x10', '1,5']) {
      assert.ok(Number.isNaN(parseTime(bad)), `debería rechazar "${bad}"`);
    }
  });

  it('fmtTime formatea y no se rompe con negativos', () => {
    assert.equal(fmtTime(0), '0:00');
    assert.equal(fmtTime(59), '0:59');
    assert.equal(fmtTime(90), '1:30');
    assert.equal(fmtTime(3600), '1:00:00');
    assert.equal(fmtTime(3723), '1:02:03');
    assert.equal(fmtTime(-5), '0:00');
  });

  it('parseTime y fmtTime son inversas', () => {
    for (const s of [0, 1, 59, 60, 61, 3599, 3600, 7322]) assert.equal(parseTime(fmtTime(s)), s);
  });

  it('localInputToIso convierte hora local a ISO y rechaza lo inválido', () => {
    const v = '2026-10-15T20:30';
    assert.equal(localInputToIso(v), new Date(v).toISOString());
    for (const bad of ['', 'abc', '2026-13-45T10:00', '2026-10-15', '2026-10-15T20:30:00']) {
      assert.equal(localInputToIso(bad), null, bad);
    }
  });

  it('defaultLocalDateTime cae en hora en punto y en el futuro', () => {
    const now = new Date(2026, 9, 15, 16, 47).getTime();
    const v = defaultLocalDateTime(now);
    assert.match(v, /T\d{2}:00$/);
    assert.ok(new Date(v).getTime() > now);
  });
});

describe('shared/plan: validateClipSpec', () => {
  it('acepta un clip correcto', () => {
    assert.equal(validateClipSpec(clip()), null);
    assert.equal(validateClipSpec(clip({ cropX: 0 })), null);
    assert.equal(validateClipSpec(clip({ cropX: 1 })), null);
    assert.equal(validateClipSpec(clip({ kind: 'horizontal' })), null);
    assert.equal(validateClipSpec(clip({ kind: 'both' })), null);
    assert.equal(validateClipSpec({ start: 1, end: 5 }), null, 'sin tipo = las dos versiones');
  });

  it('rechaza lo que no es un objeto', () => {
    for (const bad of [null, undefined, 'x', 5, [], true]) assert.ok(validateClipSpec(bad));
  });

  it('rechaza tipo, números y rangos no válidos', () => {
    assert.match(validateClipSpec(clip({ kind: 'cuadrado' }))!, /tipo/);
    assert.match(validateClipSpec(clip({ kind: 'long' }))!, /tipo/);
    assert.match(validateClipSpec(clip({ start: '10' }))!, /números/);
    assert.match(validateClipSpec(clip({ end: NaN }))!, /números/);
    assert.match(validateClipSpec(clip({ end: Infinity }))!, /números/);
    assert.match(validateClipSpec(clip({ start: -1 }))!, /negativo/);
    assert.match(validateClipSpec(clip({ start: 40, end: 40 }))!, /posterior/);
    assert.match(validateClipSpec(clip({ start: 40, end: 10 }))!, /posterior/);
    assert.match(validateClipSpec(clip({ start: 10, end: 10.5 }))!, /menos de/);
    assert.match(validateClipSpec(clip({ start: 0, end: 181 }))!, /más de 3 minutos/);
    assert.equal(validateClipSpec(clip({ start: 0, end: 180 })), null);
  });

  it('valida cropX y el título', () => {
    for (const bad of [-0.1, 1.1, 'x', NaN]) assert.match(validateClipSpec(clip({ cropX: bad }))!, /cropX/);
    assert.match(validateClipSpec(clip({ title: 5 }))!, /título/);
  });

  it('respeta el final del VOD con 0,5 s de tolerancia', () => {
    assert.equal(validateClipSpec(clip({ start: 10, end: 100.4 }), 100), null);
    assert.match(validateClipSpec(clip({ start: 10, end: 100.6 }), 100)!, /después del final/);
  });
});

describe('shared/plan: validateLongSpec', () => {
  const seg = (start: number, end: number) => ({ start, end });

  it('acepta tramos correctos en cualquier orden', () => {
    assert.equal(validateLongSpec({ title: 'L', segments: [seg(100, 200), seg(0, 50)] }), null);
  });

  it('rechaza estructuras no válidas', () => {
    assert.match(validateLongSpec({ segments: [] })!, /sin tramos|no tiene tramos/);
    assert.match(validateLongSpec({ title: 'x' })!, /tramos/);
    assert.match(validateLongSpec(null)!, /objeto/);
    assert.match(validateLongSpec({ segments: [seg(5, 5)] })!, /tramo 1/);
    assert.match(validateLongSpec({ segments: [{ start: 'a', end: 3 }] })!, /tramo 1/);
    assert.match(validateLongSpec({ segments: [seg(0, 0.2)] })!, /menos de/);
    assert.match(validateLongSpec({ segments: [seg(-1, 10)] })!, /tramo 1/);
  });

  it('limita tramos y duración total', () => {
    const many = Array.from({ length: 201 }, (_, i) => seg(i * 10, i * 10 + 5));
    assert.match(validateLongSpec({ segments: many })!, /más de 200 tramos/);
    const long = [seg(0, 1000), seg(1000, 2000), seg(2000, 3000), seg(3000, 4000)];
    assert.match(validateLongSpec({ segments: long })!, /60 minutos/);
  });

  it('comprueba cada tramo contra el final del VOD', () => {
    assert.match(validateLongSpec({ segments: [seg(0, 10), seg(90, 120)] }, 100)!, /tramo 2/);
  });
});

describe('shared/plan: parsePlan', () => {
  const plan = (o: unknown) => JSON.stringify(o);

  it('lanza si el JSON no es utilizable', () => {
    assert.throws(() => parsePlan('no es json', 100), /JSON no válido/);
    assert.throws(() => parsePlan('[]', 100), /objeto/);
    assert.throws(() => parsePlan('5', 100), /objeto/);
    assert.throws(() => parsePlan('null', 100), /objeto/);
    assert.throws(() => parsePlan('{}', 100), /ni vídeo largo/);
    assert.throws(() => parsePlan(plan({ clips: 'x' }), 100), /lista/);
  });

  it('separa lo válido de lo inválido y explica cada descarte', () => {
    const r = parsePlan(
      plan({
        clips: [clip({ title: 'ok' }), clip({ end: 500 }), clip({ kind: 'raro' }), 7],
        long: { title: 'L', segments: [{ start: 0, end: 20 }, { start: 30, end: 10 }] },
      }),
      100,
    );
    assert.equal(r.plan.clips.length, 1);
    assert.equal(r.plan.long, undefined); // un tramo malo invalida el largo entero: no se monta a medias
    assert.equal(r.errors.length, 4);
    assert.match(r.errors[0], /clip 2/);
  });

  it('normaliza títulos: recorta, limita y pone uno por defecto', () => {
    const r = parsePlan(plan({ clips: [clip({ title: '  hola  ' }), clip({ title: '' }), clip({ title: undefined }), clip({ title: 'x'.repeat(500) })] }), 100);
    assert.equal(r.plan.clips[0].title, 'hola');
    assert.equal(r.plan.clips[1].title, 'Clip 2');
    assert.equal(r.plan.clips[2].title, 'Clip 3');
    assert.equal(r.plan.clips[3].title.length, MAX_TITLE_LEN);
  });

  it('limita el número de clips por plan', () => {
    const clips = Array.from({ length: MAX_CLIPS_PER_PLAN + 5 }, () => clip());
    const r = parsePlan(plan({ clips }), 100);
    assert.equal(r.plan.clips.length, MAX_CLIPS_PER_PLAN);
    assert.ok(r.errors.some((e) => /primeros/.test(e)));
  });

  it('admite un plan solo con vídeo largo', () => {
    const r = parsePlan(plan({ long: { title: 'Resumen', segments: [{ start: 0, end: 30 }] } }), 100);
    assert.equal(r.plan.clips.length, 0);
    assert.equal(r.plan.long?.title, 'Resumen');
    assert.deepEqual(r.errors, []);
  });

  it('ignora campos desconocidos (no se cuelan en el render)', () => {
    const r = parsePlan(plan({ clips: [clip({ ffmpegArgs: '-vf evil', start: 1, end: 9 })] }), 100);
    assert.deepEqual(Object.keys(r.plan.clips[0]).sort(), ['cropX', 'end', 'kind', 'start', 'title']);
  });
});

describe('shared/groupTree', () => {
  const g = (id: string, name: string, parentId?: string, section: 'clips' | 'videos' = 'clips'): Group => ({
    id, name, kind: 'theme', section, parentId, createdAt: 'x',
  });
  const groups = [g('b', 'Zelda'), g('a', 'Pokémon'), g('a1', 'Road to Master', 'a'), g('a2', 'Locke', 'a1'), g('v', 'Series', undefined, 'videos')];
  const o = (id: string, kind: OutputItem['kind'], groupId?: string): OutputItem => ({ id, kind, title: id, files: kind === 'long' ? { long: 'f' } : { vertical: 'f' }, durationSec: 1, createdAt: 'x', groupId });

  it('ordena por nombre sin distinguir tildes ni mayúsculas, y separa secciones', () => {
    assert.deepEqual(childGroups(groups, 'clips', undefined).map((x) => x.id), ['a', 'b']);
    assert.deepEqual(childGroups(groups, 'clips', 'a').map((x) => x.id), ['a1']);
    assert.deepEqual(childGroups(groups, 'videos', undefined).map((x) => x.id), ['v']);
  });

  it('camino, etiqueta y subárbol', () => {
    assert.deepEqual(pathOf(groups, 'a2').map((x) => x.id), ['a', 'a1', 'a2']);
    assert.equal(groupLabel(groups, 'a2'), 'Pokémon / Road to Master / Locke');
    assert.deepEqual(pathOf(groups, 'nope'), []);
    assert.deepEqual([...subtreeIds(groups, 'a')].sort(), ['a', 'a1', 'a2']);
  });

  it('vídeos por carpeta: un vídeo con carpeta inexistente aparece en la raíz', () => {
    const outs = [o('1', 'clip', 'a'), o('2', 'clip'), o('3', 'clip', 'borrada'), o('4', 'long'), o('5', 'clip', 'a2')];
    assert.deepEqual(itemsIn(outs, groups, 'clips', undefined).map((x) => x.id), ['2', '3']);
    assert.deepEqual(itemsIn(outs, groups, 'clips', 'a').map((x) => x.id), ['1']);
    assert.deepEqual(itemsIn(outs, groups, 'videos', undefined).map((x) => x.id), ['4']);
    assert.equal(countInside(outs, groups, 'a'), 2);
  });

  it('lista plana en orden de árbol con nivel', () => {
    assert.deepEqual(flattenGroups(groups, 'clips').map((x) => [x.group.id, x.depth]), [['a', 0], ['a1', 1], ['a2', 2], ['b', 0]]);
  });

  it('un ciclo corrupto no cuelga la aplicación', () => {
    const cyc = [g('x', 'x', 'y'), g('y', 'y', 'x')];
    assert.ok(pathOf(cyc, 'x').length <= 100);
    assert.equal(subtreeIds(cyc, 'x').size, 2);
  });
});

describe('shared/youtube', () => {
  it('avisa de lo que YouTube no admitiría', () => {
    assert.deepEqual(youtubeProblems({ title: 'ok', description: 'ok', playlist: 'ok' }), []);
    assert.equal(youtubeProblems({ title: 'x'.repeat(101) }).length, 1);
    assert.equal(youtubeProblems({ title: 'a<b', description: 'c>d' }).length, 2);
    assert.equal(youtubeProblems({ title: 'ok', description: 'x'.repeat(5001), playlist: 'x'.repeat(151) }).length, 2);
  });
});

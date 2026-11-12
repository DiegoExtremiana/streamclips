"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const plan_1 = require("../shared/plan");
const groupTree_1 = require("../shared/groupTree");
const youtube_1 = require("../shared/youtube");
const time_1 = require("../shared/time");
const clip = (o = {}) => ({ kind: 'vertical', start: 10, end: 40, title: 't', ...o });
(0, node_test_1.describe)('shared/time', () => {
    (0, node_test_1.it)('parseTime acepta segundos, m:ss y h:mm:ss', () => {
        strict_1.default.equal((0, time_1.parseTime)('90'), 90);
        strict_1.default.equal((0, time_1.parseTime)('1:30'), 90);
        strict_1.default.equal((0, time_1.parseTime)('1:02:03'), 3723);
        strict_1.default.equal((0, time_1.parseTime)('  2:05 '), 125);
        strict_1.default.equal((0, time_1.parseTime)('1.5'), 1.5);
        strict_1.default.equal((0, time_1.parseTime)('0:00'), 0);
    });
    (0, node_test_1.it)('parseTime rechaza entradas no válidas', () => {
        for (const bad of ['', '   ', 'abc', '-5', '1:60', '1:2:3:4', '1::2', '1:xx', '1e3', '0x10', '1,5']) {
            strict_1.default.ok(Number.isNaN((0, time_1.parseTime)(bad)), `debería rechazar "${bad}"`);
        }
    });
    (0, node_test_1.it)('fmtTime formatea y no se rompe con negativos', () => {
        strict_1.default.equal((0, time_1.fmtTime)(0), '0:00');
        strict_1.default.equal((0, time_1.fmtTime)(59), '0:59');
        strict_1.default.equal((0, time_1.fmtTime)(90), '1:30');
        strict_1.default.equal((0, time_1.fmtTime)(3600), '1:00:00');
        strict_1.default.equal((0, time_1.fmtTime)(3723), '1:02:03');
        strict_1.default.equal((0, time_1.fmtTime)(-5), '0:00');
    });
    (0, node_test_1.it)('parseTime y fmtTime son inversas', () => {
        for (const s of [0, 1, 59, 60, 61, 3599, 3600, 7322])
            strict_1.default.equal((0, time_1.parseTime)((0, time_1.fmtTime)(s)), s);
    });
    (0, node_test_1.it)('localInputToIso convierte hora local a ISO y rechaza lo inválido', () => {
        const v = '2026-10-15T20:30';
        strict_1.default.equal((0, time_1.localInputToIso)(v), new Date(v).toISOString());
        for (const bad of ['', 'abc', '2026-13-45T10:00', '2026-10-15', '2026-10-15T20:30:00']) {
            strict_1.default.equal((0, time_1.localInputToIso)(bad), null, bad);
        }
    });
    (0, node_test_1.it)('defaultLocalDateTime cae en hora en punto y en el futuro', () => {
        const now = new Date(2026, 9, 15, 16, 47).getTime();
        const v = (0, time_1.defaultLocalDateTime)(now);
        strict_1.default.match(v, /T\d{2}:00$/);
        strict_1.default.ok(new Date(v).getTime() > now);
    });
});
(0, node_test_1.describe)('shared/plan: validateClipSpec', () => {
    (0, node_test_1.it)('acepta un clip correcto', () => {
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip()), null);
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ cropX: 0 })), null);
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ cropX: 1 })), null);
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ kind: 'horizontal' })), null);
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ kind: 'both' })), null);
        strict_1.default.equal((0, plan_1.validateClipSpec)({ start: 1, end: 5 }), null, 'sin tipo = las dos versiones');
    });
    (0, node_test_1.it)('rechaza lo que no es un objeto', () => {
        for (const bad of [null, undefined, 'x', 5, [], true])
            strict_1.default.ok((0, plan_1.validateClipSpec)(bad));
    });
    (0, node_test_1.it)('rechaza tipo, números y rangos no válidos', () => {
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ kind: 'cuadrado' })), /tipo/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ kind: 'long' })), /tipo/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: '10' })), /números/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ end: NaN })), /números/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ end: Infinity })), /números/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: -1 })), /negativo/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: 40, end: 40 })), /posterior/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: 40, end: 10 })), /posterior/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: 10, end: 10.5 })), /menos de/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: 0, end: 181 })), /más de 3 minutos/);
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ start: 0, end: 180 })), null);
    });
    (0, node_test_1.it)('valida cropX y el título', () => {
        for (const bad of [-0.1, 1.1, 'x', NaN])
            strict_1.default.match((0, plan_1.validateClipSpec)(clip({ cropX: bad })), /cropX/);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ title: 5 })), /título/);
    });
    (0, node_test_1.it)('respeta el final del VOD con 0,5 s de tolerancia', () => {
        strict_1.default.equal((0, plan_1.validateClipSpec)(clip({ start: 10, end: 100.4 }), 100), null);
        strict_1.default.match((0, plan_1.validateClipSpec)(clip({ start: 10, end: 100.6 }), 100), /después del final/);
    });
});
(0, node_test_1.describe)('shared/plan: validateLongSpec', () => {
    const seg = (start, end) => ({ start, end });
    (0, node_test_1.it)('acepta tramos correctos en cualquier orden', () => {
        strict_1.default.equal((0, plan_1.validateLongSpec)({ title: 'L', segments: [seg(100, 200), seg(0, 50)] }), null);
    });
    (0, node_test_1.it)('rechaza estructuras no válidas', () => {
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [] }), /sin tramos|no tiene tramos/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ title: 'x' }), /tramos/);
        strict_1.default.match((0, plan_1.validateLongSpec)(null), /objeto/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [seg(5, 5)] }), /tramo 1/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [{ start: 'a', end: 3 }] }), /tramo 1/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [seg(0, 0.2)] }), /menos de/);
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [seg(-1, 10)] }), /tramo 1/);
    });
    (0, node_test_1.it)('limita tramos y duración total', () => {
        const many = Array.from({ length: 201 }, (_, i) => seg(i * 10, i * 10 + 5));
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: many }), /más de 200 tramos/);
        const long = [seg(0, 1000), seg(1000, 2000), seg(2000, 3000), seg(3000, 4000)];
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: long }), /60 minutos/);
    });
    (0, node_test_1.it)('comprueba cada tramo contra el final del VOD', () => {
        strict_1.default.match((0, plan_1.validateLongSpec)({ segments: [seg(0, 10), seg(90, 120)] }, 100), /tramo 2/);
    });
});
(0, node_test_1.describe)('shared/plan: parsePlan', () => {
    const plan = (o) => JSON.stringify(o);
    (0, node_test_1.it)('lanza si el JSON no es utilizable', () => {
        strict_1.default.throws(() => (0, plan_1.parsePlan)('no es json', 100), /JSON no válido/);
        strict_1.default.throws(() => (0, plan_1.parsePlan)('[]', 100), /objeto/);
        strict_1.default.throws(() => (0, plan_1.parsePlan)('5', 100), /objeto/);
        strict_1.default.throws(() => (0, plan_1.parsePlan)('null', 100), /objeto/);
        strict_1.default.throws(() => (0, plan_1.parsePlan)('{}', 100), /ni vídeo largo/);
        strict_1.default.throws(() => (0, plan_1.parsePlan)(plan({ clips: 'x' }), 100), /lista/);
    });
    (0, node_test_1.it)('separa lo válido de lo inválido y explica cada descarte', () => {
        const r = (0, plan_1.parsePlan)(plan({
            clips: [clip({ title: 'ok' }), clip({ end: 500 }), clip({ kind: 'raro' }), 7],
            long: { title: 'L', segments: [{ start: 0, end: 20 }, { start: 30, end: 10 }] },
        }), 100);
        strict_1.default.equal(r.plan.clips.length, 1);
        strict_1.default.equal(r.plan.long, undefined); // un tramo malo invalida el largo entero: no se monta a medias
        strict_1.default.equal(r.errors.length, 4);
        strict_1.default.match(r.errors[0], /clip 2/);
    });
    (0, node_test_1.it)('normaliza títulos: recorta, limita y pone uno por defecto', () => {
        const r = (0, plan_1.parsePlan)(plan({ clips: [clip({ title: '  hola  ' }), clip({ title: '' }), clip({ title: undefined }), clip({ title: 'x'.repeat(500) })] }), 100);
        strict_1.default.equal(r.plan.clips[0].title, 'hola');
        strict_1.default.equal(r.plan.clips[1].title, 'Clip 2');
        strict_1.default.equal(r.plan.clips[2].title, 'Clip 3');
        strict_1.default.equal(r.plan.clips[3].title.length, plan_1.MAX_TITLE_LEN);
    });
    (0, node_test_1.it)('limita el número de clips por plan', () => {
        const clips = Array.from({ length: plan_1.MAX_CLIPS_PER_PLAN + 5 }, () => clip());
        const r = (0, plan_1.parsePlan)(plan({ clips }), 100);
        strict_1.default.equal(r.plan.clips.length, plan_1.MAX_CLIPS_PER_PLAN);
        strict_1.default.ok(r.errors.some((e) => /primeros/.test(e)));
    });
    (0, node_test_1.it)('admite un plan solo con vídeo largo', () => {
        const r = (0, plan_1.parsePlan)(plan({ long: { title: 'Resumen', segments: [{ start: 0, end: 30 }] } }), 100);
        strict_1.default.equal(r.plan.clips.length, 0);
        strict_1.default.equal(r.plan.long?.title, 'Resumen');
        strict_1.default.deepEqual(r.errors, []);
    });
    (0, node_test_1.it)('ignora campos desconocidos (no se cuelan en el render)', () => {
        const r = (0, plan_1.parsePlan)(plan({ clips: [clip({ ffmpegArgs: '-vf evil', start: 1, end: 9 })] }), 100);
        strict_1.default.deepEqual(Object.keys(r.plan.clips[0]).sort(), ['cropX', 'end', 'kind', 'start', 'title']);
    });
});
(0, node_test_1.describe)('shared/groupTree', () => {
    const g = (id, name, parentId, section = 'clips') => ({
        id, name, kind: 'theme', section, parentId, createdAt: 'x',
    });
    const groups = [g('b', 'Zelda'), g('a', 'Pokémon'), g('a1', 'Road to Master', 'a'), g('a2', 'Locke', 'a1'), g('v', 'Series', undefined, 'videos')];
    const o = (id, kind, groupId) => ({ id, kind, title: id, files: kind === 'long' ? { long: 'f' } : { vertical: 'f' }, durationSec: 1, createdAt: 'x', groupId });
    (0, node_test_1.it)('ordena por nombre sin distinguir tildes ni mayúsculas, y separa secciones', () => {
        strict_1.default.deepEqual((0, groupTree_1.childGroups)(groups, 'clips', undefined).map((x) => x.id), ['a', 'b']);
        strict_1.default.deepEqual((0, groupTree_1.childGroups)(groups, 'clips', 'a').map((x) => x.id), ['a1']);
        strict_1.default.deepEqual((0, groupTree_1.childGroups)(groups, 'videos', undefined).map((x) => x.id), ['v']);
    });
    (0, node_test_1.it)('camino, etiqueta y subárbol', () => {
        strict_1.default.deepEqual((0, groupTree_1.pathOf)(groups, 'a2').map((x) => x.id), ['a', 'a1', 'a2']);
        strict_1.default.equal((0, groupTree_1.groupLabel)(groups, 'a2'), 'Pokémon / Road to Master / Locke');
        strict_1.default.deepEqual((0, groupTree_1.pathOf)(groups, 'nope'), []);
        strict_1.default.deepEqual([...(0, groupTree_1.subtreeIds)(groups, 'a')].sort(), ['a', 'a1', 'a2']);
    });
    (0, node_test_1.it)('vídeos por carpeta: un vídeo con carpeta inexistente aparece en la raíz', () => {
        const outs = [o('1', 'clip', 'a'), o('2', 'clip'), o('3', 'clip', 'borrada'), o('4', 'long'), o('5', 'clip', 'a2')];
        strict_1.default.deepEqual((0, groupTree_1.itemsIn)(outs, groups, 'clips', undefined).map((x) => x.id), ['2', '3']);
        strict_1.default.deepEqual((0, groupTree_1.itemsIn)(outs, groups, 'clips', 'a').map((x) => x.id), ['1']);
        strict_1.default.deepEqual((0, groupTree_1.itemsIn)(outs, groups, 'videos', undefined).map((x) => x.id), ['4']);
        strict_1.default.equal((0, groupTree_1.countInside)(outs, groups, 'a'), 2);
    });
    (0, node_test_1.it)('lista plana en orden de árbol con nivel', () => {
        strict_1.default.deepEqual((0, groupTree_1.flattenGroups)(groups, 'clips').map((x) => [x.group.id, x.depth]), [['a', 0], ['a1', 1], ['a2', 2], ['b', 0]]);
    });
    (0, node_test_1.it)('un ciclo corrupto no cuelga la aplicación', () => {
        const cyc = [g('x', 'x', 'y'), g('y', 'y', 'x')];
        strict_1.default.ok((0, groupTree_1.pathOf)(cyc, 'x').length <= 100);
        strict_1.default.equal((0, groupTree_1.subtreeIds)(cyc, 'x').size, 2);
    });
});
(0, node_test_1.describe)('shared/youtube', () => {
    (0, node_test_1.it)('avisa de lo que YouTube no admitiría', () => {
        strict_1.default.deepEqual((0, youtube_1.youtubeProblems)({ title: 'ok', description: 'ok', playlist: 'ok' }), []);
        strict_1.default.equal((0, youtube_1.youtubeProblems)({ title: 'x'.repeat(101) }).length, 1);
        strict_1.default.equal((0, youtube_1.youtubeProblems)({ title: 'a<b', description: 'c>d' }).length, 2);
        strict_1.default.equal((0, youtube_1.youtubeProblems)({ title: 'ok', description: 'x'.repeat(5001), playlist: 'x'.repeat(151) }).length, 2);
    });
});

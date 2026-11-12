"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const clipScores_1 = require("../electron/domain/clipScores");
const dirs = [];
(0, node_test_1.afterEach)(() => {
    while (dirs.length)
        node_fs_1.default.rmSync(dirs.pop(), { recursive: true, force: true });
});
const tmp = () => {
    const d = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-clipscore-'));
    dirs.push(d);
    return node_path_1.default.join(d, 'scores.json');
};
const clip = (id, over = {}) => ({ id, title: id, url: `https://clips.twitch.tv/${id}`, durationSec: 30, createdAt: `2026-11-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T10:00:00Z`, creator: 'x', views: 10, thumbnail: '', ...over });
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];
const phrase = 'no puede ser madre mía jajaja increíble vamos ostia no me lo creo'.split(' ');
const hype = Array.from({ length: 75 }, (_, i) => ({ text: phrase[i % phrase.length], start: i * 0.4, end: i * 0.4 + 0.3 }));
function make(over = {}, file = tmp()) {
    const analyzed = [];
    const svc = new clipScores_1.ClipScoreService({
        file,
        canRun: () => true,
        sleep: async () => undefined,
        analyze: async (c) => {
            analyzed.push(c.id);
            return c.id.startsWith('good') ? { durationSec: 30, words: hype, energyDb: loud } : { durationSec: 30, words: [{ text: 'vale', start: 0, end: 1 }], energyDb: Array.from({ length: 30 }, () => -40) };
        },
        ...over,
    });
    return { svc, analyzed, file };
}
// la nota no mira las visualizaciones: se dan valores distintos para comprobarlo
const many = (n) => Array.from({ length: n }, (_, i) => clip(`c${i + 1}`, { views: i + 1 }));
(0, node_test_1.describe)('puntuación de clips en segundo plano', () => {
    (0, node_test_1.it)('puntúa solo lo que falta, lo recuerda en disco y solo dice si es dorado', async () => {
        const { svc, analyzed, file } = make();
        const clips = [...many(10), clip('good1', { views: 500 })];
        svc.enqueue(clips);
        await svc.idle();
        strict_1.default.equal(analyzed.length, 11);
        strict_1.default.equal(svc.gold('good1'), true);
        strict_1.default.equal(svc.gold('c2'), false);
        strict_1.default.equal(svc.gold('no-existe'), false);
        strict_1.default.ok((svc.scoreOf('good1') ?? 0) >= 8, 'la nota del clip bueno es de 8 o más');
        strict_1.default.ok((svc.scoreOf('c2') ?? 99) < 8);
        strict_1.default.equal(svc.scoreOf('no-existe'), undefined);
        // otra instancia con el mismo archivo no vuelve a analizar nada
        const again = make({}, file);
        again.svc.enqueue(clips);
        await again.svc.idle();
        strict_1.default.equal(again.analyzed.length, 0);
        strict_1.default.equal(again.svc.gold('good1'), true);
    });
    (0, node_test_1.it)('los más recientes primero y los muy largos o cortísimos no se analizan', async () => {
        const { svc, analyzed } = make();
        svc.enqueue([clip('c1'), clip('c3'), clip('c2'), clip('long', { durationSec: 600 }), clip('tiny', { durationSec: 1 })]);
        await svc.idle();
        strict_1.default.deepEqual(analyzed, ['c3', 'c2', 'c1']);
    });
    (0, node_test_1.it)('con el equipo ocupado espera y no trabaja; al liberarse sigue', async () => {
        let free = false;
        let sleeps = 0;
        const { svc, analyzed } = make({ canRun: () => free, sleep: async () => { if (++sleeps === 3)
                free = true; } });
        svc.enqueue([clip('c1')]);
        await svc.idle();
        strict_1.default.equal(sleeps, 3);
        strict_1.default.deepEqual(analyzed, ['c1']);
    });
    (0, node_test_1.it)('un fallo no para la cola; tras dos fallos no se insiste (hasta pasado un día)', async () => {
        let t = 1_000_000;
        let calls = 0;
        const { svc } = make({
            now: () => t,
            analyze: async (c) => {
                if (c.id === 'bad') {
                    calls++;
                    throw new Error('sin red');
                }
                return { durationSec: 30, words: [], energyDb: undefined };
            },
        });
        svc.enqueue([clip('bad'), clip('c1')]);
        await svc.idle();
        strict_1.default.equal(calls, 1);
        svc.enqueue([clip('bad')]);
        await svc.idle();
        strict_1.default.equal(calls, 2, 'segundo intento');
        svc.enqueue([clip('bad')]);
        await svc.idle();
        strict_1.default.equal(calls, 2, 'ya no insiste');
        t += 25 * 3600_000;
        svc.enqueue([clip('bad')]);
        await svc.idle();
        strict_1.default.equal(calls, 3, 'pasado un día lo vuelve a intentar');
    });
    (0, node_test_1.it)('el modelo lee los clips que tienen algo que leer (no los de una palabra) y su nota manda sobre las señales', async () => {
        const asked = [];
        const { svc } = make({ judge: async (c) => { asked.push(c.id); const n = c.id === 'good1' ? 9.5 : 2; return { criteria: { humor: n, historia: n, viral: n, interes: n }, reason: n > 5 ? 'Remate con sorpresa' : 'Charla sin más' }; } });
        svc.enqueue([...many(10), clip('good1', { views: 500 }), clip('good2', { views: 500 })]);
        await svc.idle();
        strict_1.default.deepEqual(asked.sort(), ['good1', 'good2'], 'sin texto que leer no se gasta modelo');
        strict_1.default.equal(svc.gold('good1'), true);
        strict_1.default.equal(svc.gold('good2'), false, 'el modelo lo rebaja');
        const d = svc.detailOf('good1');
        strict_1.default.equal(d.by, 'model');
        strict_1.default.equal(d.reason, 'Remate con sorpresa');
        strict_1.default.equal(d.criteria.humor, 9.5);
        strict_1.default.equal(svc.scoreOf('good2'), 2);
    });
    (0, node_test_1.it)('si el modelo falla o no hay, vale la nota por señales', async () => {
        const { svc } = make({ judge: async () => { throw new Error('límite'); } });
        svc.enqueue([...many(10), clip('good1', { views: 500 })]);
        await svc.idle();
        strict_1.default.equal(svc.gold('good1'), true);
        strict_1.default.equal(svc.detailOf('good1').by, 'signals', 'sin modelo se dice que se calculó con señales');
        strict_1.default.match(svc.detailOf('good1').reason, /Calculado con lo que se oye/);
        const { svc: s2 } = make({ judge: async () => null });
        s2.enqueue([...many(10), clip('good1', { views: 500 })]);
        await s2.idle();
        strict_1.default.equal(s2.gold('good1'), true);
    });
    (0, node_test_1.it)('un chiste tranquilo (sin gritos ni risas) lo valora el modelo aunque las señales lo vean flojo', async () => {
        const quiet = 'el otro día fui a la tienda a comprar pan y me dijeron que era un libro entonces compré el libro'.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
        const { svc } = make({
            analyze: async () => ({ durationSec: 30, words: quiet, energyDb: Array.from({ length: 30 }, () => -40) }),
            judge: async () => ({ criteria: { humor: 9, historia: 8, viral: 8, interes: 8 }, reason: 'Remate absurdo' }),
        });
        svc.enqueue([clip('c1')]);
        await svc.idle();
        strict_1.default.equal(svc.detailOf('c1').by, 'model');
        strict_1.default.ok((svc.scoreOf('c1') ?? 0) >= 8);
    });
    (0, node_test_1.it)('lo valorado sin modelo se repite con modelo en cuanto lo hay, sin insistir a cada rato', async () => {
        let t = 1_000_000;
        let has = false;
        let asked = 0;
        const { svc, analyzed } = make({
            now: () => t,
            hasJudge: () => has,
            judge: async () => {
                asked++;
                return { criteria: { humor: 6, historia: 6, viral: 6, interes: 6 }, reason: 'Normal' };
            },
        });
        // al principio no hay modelo: judge existe pero la app aún no tiene clave y devuelve null
        const noKey = make({ now: () => t, hasJudge: () => has, judge: async () => null });
        noKey.svc.enqueue([clip('good1')]);
        await noKey.svc.idle();
        strict_1.default.equal(noKey.svc.detailOf('good1').by, 'signals');
        // con el mismo archivo y ya con clave, se vuelve a analizar, pero pasado el tiempo de espera
        const again = make({ now: () => t, hasJudge: () => true, judge: async () => ({ criteria: { humor: 9, historia: 9, viral: 9, interes: 9 }, reason: 'Muy bueno' }) }, noKey.file);
        again.svc.enqueue([clip('good1')]);
        await again.svc.idle();
        strict_1.default.equal(again.analyzed.length, 0, 'recién puntuado: aún no insiste');
        t += 31 * 60_000;
        again.svc.enqueue([clip('good1')]);
        await again.svc.idle();
        strict_1.default.equal(again.analyzed.length, 1);
        strict_1.default.equal(again.svc.detailOf('good1').by, 'model');
        strict_1.default.equal(svc.scoreOf('good1'), undefined);
        strict_1.default.equal(asked + analyzed.length, 0);
        has = true;
    });
    (0, node_test_1.it)('un archivo de puntuaciones estropeado o de otra versión se ignora', async () => {
        const file = tmp();
        node_fs_1.default.writeFileSync(file, '{"c1":{"score":9,"v":0,"at":1},"c2":{');
        const { svc, analyzed } = make({}, file);
        strict_1.default.equal(svc.gold('c1'), false);
        svc.enqueue([clip('c1')]);
        await svc.idle();
        strict_1.default.deepEqual(analyzed, ['c1']);
    });
});

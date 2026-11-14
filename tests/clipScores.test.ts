import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TwitchClip } from '../shared/types';
import { ClipScoreService, type ClipScoreDeps } from '../electron/domain/clipScores';
import type { ClipJudgement } from '../shared/clipCriteria';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-clipscore-'));
  dirs.push(d);
  return path.join(d, 'scores.json');
};
const clip = (id: string, over: Partial<TwitchClip> = {}): TwitchClip => ({ id, title: id, url: `https://clips.twitch.tv/${id}`, durationSec: 30, createdAt: `2026-11-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T10:00:00Z`, creator: 'x', views: 10, thumbnail: '', ...over });
const loud = [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)];
const phrase = 'no puede ser madre mía jajaja increíble vamos ostia no me lo creo'.split(' ');
const hype = Array.from({ length: 75 }, (_, i) => ({ text: phrase[i % phrase.length], start: i * 0.4, end: i * 0.4 + 0.3 }));

const VIRAL_KEYS = ['gancho', 'citable', 'emocion', 'universal', 'cierre', 'compartible', 'retencion', 'sinDefectos'];
const viralItems = (v: number) => Object.fromEntries(VIRAL_KEYS.map((k) => [`viral.${k}`, v]));
const judged = (n: number, reason = 'Motivo'): ClipJudgement => ({ criteria: { humor: n, historia: n, viral: n, interes: n }, reason, items: { 'humor.remate': n >= 8 ? 2 : 0, ...viralItems(n >= 9 ? 2 : 0) }, evidence: { humor: 'cita' } });
/** Segundo examen en el que todos los espectadores simulados se quedan. */
const passes = async () => ({ items: viralItems(2), stay: 6, total: 6, refutation: '' });

function make(over: Partial<ClipScoreDeps> = {}, file = tmp()) {
  const analyzed: string[] = [];
  const svc = new ClipScoreService({
    file,
    canRun: () => true,
    sleep: async () => undefined,
    judge: async (c) => ({ ...judged(c.id.startsWith('good') ? 9.5 : 2), ai: { provider: 'test', model: 'modelo-1' } }),
    verifyViral: passes,
    analyze: async (c) => {
      analyzed.push(c.id);
      return c.id.startsWith('good') ? { durationSec: 30, words: hype, energyDb: loud } : { durationSec: 30, words: [{ text: 'vale', start: 0, end: 1 }], energyDb: Array.from({ length: 30 }, () => -40) };
    },
    ...over,
  });
  return { svc, analyzed, file };
}

// la nota no mira las visualizaciones: se dan valores distintos para comprobarlo
const many = (n: number) => Array.from({ length: n }, (_, i) => clip(`c${i + 1}`, { views: i + 1 }));

describe('clips sin palabras', () => {
  it('un clip mudo con imagen se valora por lo que se ve y se oye, y el aviso de «sin palabras» ya no cuenta como fallo', async () => {
    let calls = 0;
    const { svc } = make({
      analyze: async () => ({ durationSec: 20, words: [], energyDb: Array.from({ length: 20 }, () => -30), frames: ['f1.jpg', 'f2.jpg'] }),
      judge: async (_c, words, frames) => {
        calls++;
        assert.equal(words.length, 0);
        assert.equal(frames?.length, 2);
        return { ...judged(8), ai: { provider: 'test', model: 'vision', vision: true } };
      },
    });
    svc.enqueue([clip('mudo1')]);
    await svc.idle();
    assert.equal(calls, 1);
    assert.ok(svc.scoreOf('mudo1') !== undefined, 'tiene nota');
    assert.equal(svc.diagnostics().failed, 0);
  });
});

describe('puntuación de clips en segundo plano', () => {
  it('puntúa solo lo que falta, lo recuerda en disco y solo dice si es dorado', async () => {
    const { svc, analyzed, file } = make();
    const clips = [...many(10), clip('good1', { views: 500 })];
    svc.enqueue(clips);
    await svc.idle();
    assert.equal(analyzed.length, 11);
    assert.equal(svc.gold('good1'), true);
    assert.equal(svc.gold('c2'), false);
    assert.equal(svc.gold('no-existe'), false);
    assert.ok((svc.scoreOf('good1') ?? 0) >= 8, 'la nota del clip bueno es de 8 o más');
    assert.equal(svc.scoreOf('c2'), undefined, 'un clip casi mudo no recibe nota');
    assert.ok(svc.skipReason('c2'));
    assert.equal(svc.scoreOf('no-existe'), undefined);
    // otra instancia con el mismo archivo no vuelve a analizar nada
    const again = make({}, file);
    again.svc.enqueue(clips);
    await again.svc.idle();
    assert.equal(again.analyzed.length, 0);
    assert.equal(again.svc.gold('good1'), true);
  });

  it('los más recientes primero y los muy largos o cortísimos no se analizan', async () => {
    const { svc, analyzed } = make();
    svc.enqueue([clip('c1'), clip('c3'), clip('c2'), clip('long', { durationSec: 600 }), clip('tiny', { durationSec: 1 })]);
    await svc.idle();
    assert.deepEqual(analyzed, ['c3', 'c2', 'c1']);
  });

  it('con el equipo ocupado espera y no trabaja; al liberarse sigue', async () => {
    let free = false;
    let sleeps = 0;
    const { svc, analyzed } = make({ canRun: () => free, sleep: async () => { if (++sleeps === 3) free = true; } });
    svc.enqueue([clip('c1')]);
    await svc.idle();
    assert.equal(sleeps, 3);
    assert.deepEqual(analyzed, ['c1']);
  });

  it('un fallo no para la cola; tras dos fallos no se insiste (hasta pasado un día)', async () => {
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
    assert.equal(calls, 1);
    svc.enqueue([clip('bad')]);
    await svc.idle();
    assert.equal(calls, 2, 'segundo intento');
    svc.enqueue([clip('bad')]);
    await svc.idle();
    assert.equal(calls, 2, 'ya no insiste');
    t += 25 * 3600_000;
    svc.enqueue([clip('bad')]);
    await svc.idle();
    assert.equal(calls, 3, 'pasado un día lo vuelve a intentar');
  });

  it('el modelo lee los clips que tienen algo que leer (no los de una palabra) y su nota manda sobre las señales', async () => {
    const asked: string[] = [];
    const { svc } = make({ judge: async (c) => { asked.push(c.id); const n = c.id === 'good1' ? 9.5 : 2; return { ...judged(n), reason: n > 5 ? 'Remate con sorpresa' : 'Charla sin más' }; } });
    svc.enqueue([...many(10), clip('good1', { views: 500 }), clip('good2', { views: 500 })]);
    await svc.idle();
    assert.deepEqual(asked.sort(), ['good1', 'good2'], 'sin texto que leer no se gasta modelo');
    assert.equal(svc.gold('good1'), true);
    assert.equal(svc.gold('good2'), false, 'el modelo lo rebaja');
    const d = svc.detailOf('good1')!;
    assert.equal(d.by, 'model');
    assert.ok(d.reason.startsWith('Remate con sorpresa'));
    assert.equal(d.criteria.humor, 9.5);
    assert.ok((svc.scoreOf('good2') ?? 99) < 4, 'la nota del modelo manda (la viralidad suma un poco de lo medido)');
  });

  it('si el modelo no está disponible no se inventa una nota: se detiene y avisa; sin modelo configurado vale la de señales', async () => {
    const { svc, analyzed } = make({ judge: async () => { throw new Error('El modelo «x» no existe o ya no está disponible.'); } });
    svc.enqueue(Array.from({ length: 8 }, (_, i) => clip(`good${i + 1}`)));
    await svc.idle();
    assert.equal(svc.scoreOf('good8'), undefined, 'sin nota engañosa');
    assert.ok(analyzed.length <= 2, 'no se siguen bajando clips para nada (solo los que ya estaban en curso)');
    assert.match(svc.problem() ?? '', /La IA no está disponible/);
    // sin IA que responda (judge devuelve null) tampoco se guarda nada
    const { svc: s2 } = make({ judge: async () => null });
    s2.enqueue([clip('good1')]);
    await s2.idle();
    assert.equal(s2.scoreOf('good1'), undefined);
    assert.match(s2.problem() ?? '', /No hay IA configurada/);
  });

  it('un chiste tranquilo (sin gritos ni risas) lo valora el modelo aunque las señales lo vean flojo', async () => {
    const quiet = 'el otro día fui a la tienda a comprar pan y me dijeron que era un libro entonces compré el libro'.split(' ').map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));
    const { svc } = make({
      analyze: async () => ({ durationSec: 30, words: quiet, energyDb: Array.from({ length: 30 }, () => -40) }),
      judge: async () => ({ ...judged(9), reason: 'Remate absurdo' }),
    });
    svc.enqueue([clip('c1')]);
    await svc.idle();
    assert.equal(svc.detailOf('c1')!.by, 'model');
    assert.ok((svc.scoreOf('c1') ?? 0) >= 8);
  });

  it('sin IA configurada no se descarga nada y se explica; al ponerla se examina', async () => {
    let has = false;
    const { svc, analyzed } = make({ hasJudge: () => has });
    svc.enqueue([clip('good1')]);
    await svc.idle();
    assert.equal(analyzed.length, 0, 'ni se descarga');
    assert.match(svc.problem() ?? '', /No hay IA configurada/);
    has = true;
    svc.enqueue([clip('good1')]);
    await svc.idle();
    assert.equal(analyzed.length, 1);
    assert.equal(svc.problem(), undefined);
  });

  it('cada nota guarda la IA, el modelo y la fecha del examen; lo guardado sin IA anotada se vuelve a examinar', async () => {
    const file = tmp();
    const notes = path.join(path.dirname(file), 'n.md');
    const first = make({ now: () => 1_800_000_000_000, notesFile: notes, judge: async () => ({ ...judged(9), ai: { provider: 'gemini', model: 'gemini-3.5-flash-lite', vision: true } }) }, file);
    first.svc.enqueue([clip('good1')]);
    await first.svc.idle();
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')).good1;
    assert.deepEqual(stored.ai, { provider: 'gemini', model: 'gemini-3.5-flash-lite', vision: true });
    assert.equal(stored.at, 1_800_000_000_000);
    const md = fs.readFileSync(notes, 'utf8');
    assert.match(md, /\| IA \| Modelo \| Examinado \|/);
    assert.match(md, /gemini-3\.5-flash-lite \(con imagen\)/);
    assert.match(md, /2027-01-15 08:00/);
    // la base de datos: una fila por clip con un campo por columna, incluido «Modificado» (Sí/No)
    const csv = fs.readFileSync(path.join(path.dirname(file), 'Base de datos', 'Clips de Twitch.csv'), 'utf8');
    const [head, row] = csv.replace('\ufeff', '').split('\r\n');
    assert.match(head, /;Dorado;Modificado;Nota de la IA;/);
    const cols = head.split(';');
    assert.equal(row.split(';')[cols.indexOf('Modificado')], 'No');
    assert.equal(row.split(';')[cols.indexOf('Id del clip')], 'good1');
    // la misma nota sin `ai` (cálculo con audio o de una versión anterior) no vale
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete j.good1.ai;
    fs.writeFileSync(file, JSON.stringify(j));
    const again = make({}, file);
    again.svc.enqueue([clip('good1')]);
    await again.svc.idle();
    assert.equal(again.analyzed.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).good1.ai.model, 'modelo-1');
    // la ficha del clip puede mostrar con qué IA y cuándo se examinó
    const d = again.svc.detailOf('good1');
    assert.equal(d?.ai?.model, 'modelo-1');
    assert.equal(typeof d?.at, 'number');
  });

  it('dorado es solo «Puede ser viral» de 9,5 o más y exige pasar el examen estricto', async () => {
    const run = async (over: Partial<ClipScoreDeps>) => {
      const m = make({ judge: async () => ({ ...judged(9.5), ai: { provider: 'test', model: 'm' } }), ...over });
      m.svc.enqueue([clip('good1')]);
      await m.svc.idle();
      return m.svc;
    };
    const ok = await run({});
    assert.equal(ok.gold('good1'), true, 'todas las puertas, los seis espectadores y lo medido');
    assert.ok((ok.detailOf('good1')!.criteria.viral) >= 9.5);
    assert.match(ok.detailOf('good1')!.reason, /6 espectadores simulados: 6/);
    const one = await run({ verifyViral: async () => ({ items: viralItems(2), stay: 5, total: 6, refutation: 'arranca lento' }) });
    assert.equal(one.gold('good1'), false, 'si un espectador simulado no lo comparte, no se apuesta por él');
    assert.ok(one.detailOf('good1')!.criteria.viral <= 9.4);
    assert.match(one.detailOf('good1')!.reason, /Pega: arranca lento/);
    const gate = await run({ verifyViral: async () => ({ items: { ...viralItems(2), 'viral.gancho': 1 }, stay: 6, total: 6, refutation: '' }) });
    assert.equal(gate.gold('good1'), false, 'una puerta a «algo» impide el dorado');
    assert.ok(gate.detailOf('good1')!.criteria.viral <= 8.9);
    const noCheck = await run({ verifyViral: undefined });
    assert.equal(noCheck.gold('good1'), false, 'sin la segunda comprobación no hay dorado');
    const failed = await run({ verifyViral: async () => null });
    assert.equal(failed.gold('good1'), false);
    const weak = await run({ judge: async () => ({ ...judged(9.5), items: { ...viralItems(2), 'viral.cierre': 0 }, ai: { provider: 'test', model: 'm' } }) });
    assert.equal(weak.gold('good1'), false, 'una puerta a 0 limita la viralidad a 6');
    assert.ok(weak.detailOf('good1')!.criteria.viral <= 6);
    const flat = await run({ judge: async () => ({ ...judged(1), ai: { provider: 'test', model: 'm' } }) });
    assert.equal(flat.gold('good1'), false);
  });

  it('los clips puntuados antes del examen estricto no son dorados hasta que se vuelvan a examinar', async () => {
    const file = tmp();
    const old = { good1: { v: 8, at: 1, score: 9.9, crit: { humor: 9, historia: 9, viral: 9.9, interes: 9 }, by: 'model', reason: 'x', ai: { provider: 'test', model: 'm' } } };
    fs.writeFileSync(file, JSON.stringify(old));
    const { svc } = make({}, file);
    assert.equal(svc.scoreOf('good1'), 9.9, 'la nota anterior se conserva');
    assert.equal(svc.gold('good1'), false);
  });

  it('un clip sin palabras no se puntúa con ceros: queda sin nota con su motivo y no se repite', async () => {
    const { svc, analyzed } = make({ analyze: async (c) => { return { durationSec: 30, words: [{ text: 'ah', start: 1, end: 1.2 }], energyDb: loud, ...(c.id ? {} : {}) }; }, judge: async () => judged(9) });
    svc.enqueue([clip('c1')]);
    await svc.idle();
    assert.equal(svc.scoreOf('c1'), undefined);
    assert.equal(svc.detailOf('c1'), undefined);
    assert.match(svc.skipReason('c1') ?? '', /no hay imagen con la que valorarlo/);
    assert.equal(analyzed.length, 0);
    svc.enqueue([clip('c1')]);
    await svc.idle();
    assert.equal(svc.skipReason('c1') !== undefined, true);
  });

  it('el modelo guarda las respuestas de la rúbrica y sus pruebas, y la viralidad incluye lo medido', async () => {
    const { svc } = make({ judge: async () => judged(10) });
    svc.enqueue([clip('good1')]);
    await svc.idle();
    const d = svc.detailOf('good1')!;
    assert.equal(d.by, 'model');
    assert.equal(d.items?.['humor.remate'], 2);
    assert.equal(d.evidence?.humor, 'cita');
    assert.equal(d.criteria.humor, 10);
    assert.ok(d.criteria.viral <= 10 && d.criteria.viral > 7.5, String(d.criteria.viral));
  });

  it('si falta Whisper no se valora ni se descarga nada, y se dice por qué; al arreglarlo sigue', async () => {
    let problem: string | null = 'Falta el modelo de Whisper';
    const { svc, analyzed } = make({ ready: () => problem });
    svc.enqueue([clip('c1'), clip('c2')]);
    await svc.idle();
    assert.equal(analyzed.length, 0);
    assert.equal(svc.problem(), 'Falta el modelo de Whisper');
    assert.equal(svc.pending(), 0);
    problem = null;
    svc.enqueue([clip('c1'), clip('c2')]);
    await svc.idle();
    assert.equal(analyzed.length, 2);
    assert.equal(svc.problem(), undefined);
  });

  it('el diagnóstico dice por qué espera, cuántos fallaron y el último error', async () => {
    let free = false;
    let sleeps = 0;
    const { svc } = make({ canRun: () => free, waitReason: () => 'hay un directo en marcha', sleep: async () => { if (++sleeps === 3) free = true; } });
    svc.enqueue([clip('c1')]);
    assert.equal(svc.diagnostics().waiting, 'hay un directo en marcha');
    await svc.idle();
    assert.equal(svc.diagnostics().waiting, undefined);
    const bad = make({ analyze: async () => { throw new Error('yt-dlp no encontrado'); } });
    bad.svc.enqueue([clip('c1'), clip('c2')]);
    await bad.svc.idle();
    assert.deepEqual(bad.svc.diagnostics(), { failed: 2, lastError: 'yt-dlp no encontrado' });
  });

  it('un archivo de puntuaciones estropeado o de otra versión se ignora', async () => {
    const file = tmp();
    fs.writeFileSync(file, '{"c1":{"score":9,"v":0,"at":1},"c2":{');
    const { svc, analyzed } = make({}, file);
    assert.equal(svc.gold('c1'), false);
    svc.enqueue([clip('c1')]);
    await svc.idle();
    assert.deepEqual(analyzed, ['c1']);
  });

  it('guarda las notas en un documento legible, conserva el título y mide el tiempo por fase', async () => {
    const file = tmp();
    const notes = path.join(path.dirname(file), 'Notas de clips.md');
    let t = 0;
    const { svc } = make({ notesFile: notes, now: () => (t += 1000), analyze: async (_c, onPhase) => { onPhase?.('transcripcion'); return { durationSec: 30, words: hype, energyDb: loud }; } }, file);
    svc.enqueue([clip('good1', { title: 'Mi clip | genial' })]);
    await svc.idle();
    const md = fs.readFileSync(notes, 'utf8');
    assert.match(md, /Mi clip \/ genial/);
    assert.match(md, /\| Nota \| Humor/);
    const d = svc.diagnostics();
    assert.ok((d.secPerClip ?? 0) > 0);
    assert.ok(d.phases?.transcripcion !== undefined);
    // al reabrir (otra instancia) la nota sigue y no se vuelve a analizar
    const again = make({}, file);
    again.svc.enqueue([clip('good1')]);
    await again.svc.idle();
    assert.deepEqual(again.analyzed, []);
  });

  it('valora varios clips a la vez sin repetir ninguno', async () => {
    let live = 0;
    let peak = 0;
    const seen: string[] = [];
    const { svc } = make({
      analyze: async (c) => {
        seen.push(c.id);
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return { durationSec: 30, words: hype, energyDb: loud };
      },
    });
    svc.enqueue(many(8));
    await svc.idle();
    assert.equal(peak, 2);
    assert.equal(new Set(seen).size, 8);
  });

  it('los fallos de una sesión anterior no bloquean: al reabrir se vuelve a intentar', async () => {
    const file = tmp();
    fs.writeFileSync(file, JSON.stringify({ old1: { v: 5, at: Date.now(), fails: 2 } }));
    const { svc, analyzed } = make({}, file);
    svc.enqueue([clip('old1')]);
    await svc.idle();
    assert.deepEqual(analyzed, ['old1']);
  });

  it('las notas de la IA anteriores a la calibración se examinan de nuevo y las correcciones del usuario se conservan', () => {
    const file = path.join(os.tmpdir(), `sc-cal-${process.pid}-${Date.now()}.json`);
    const crit = { humor: 8, historia: 1, viral: 9, interes: 6 };
    const ai = { provider: 'gemini', model: 'm' };
    fs.writeFileSync(file, JSON.stringify({
      viejo: { v: 5, at: 1, score: 7, crit, by: 'model', ai },
      mio: { v: 5, at: 1, score: 3, crit, by: 'user', ai },
      previo: { v: 7, at: 1, score: 5, crit, by: 'model', ai },
      nuevo: { v: 8, at: 1, score: 3, crit, by: 'model', ai },
    }));
    const m = make({}, file);
    assert.equal(m.svc.scoreOf('viejo'), undefined);
    assert.equal(m.svc.scoreOf('mio'), 3);
    assert.equal(m.svc.scoreOf('previo'), undefined, 'la nota hecha con el criterio anterior (v7) también se repite');
    assert.equal(m.svc.scoreOf('nuevo'), 3);
  });
});

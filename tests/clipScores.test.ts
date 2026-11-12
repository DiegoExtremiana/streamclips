import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TwitchClip } from '../shared/types';
import { ClipScoreService, type ClipScoreDeps } from '../electron/domain/clipScores';

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

function make(over: Partial<ClipScoreDeps> = {}, file = tmp()) {
  const analyzed: string[] = [];
  const svc = new ClipScoreService({
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
const many = (n: number) => Array.from({ length: n }, (_, i) => clip(`c${i + 1}`, { views: i + 1 }));

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
    assert.ok((svc.scoreOf('c2') ?? 99) < 8);
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

  it('el modelo solo se consulta para los que pueden ser dorados y su nota manda sobre las señales', async () => {
    const asked: string[] = [];
    const { svc } = make({ judge: async (c) => { asked.push(c.id); return c.id === 'good1' ? 9.5 : 2; } });
    svc.enqueue([...many(10), clip('good1', { views: 500 }), clip('good2', { views: 500 })]);
    await svc.idle();
    assert.deepEqual(asked.sort(), ['good1', 'good2'], 'los aburridos no gastan modelo');
    assert.equal(svc.gold('good1'), true);
    assert.equal(svc.gold('good2'), false, 'el modelo lo rebaja');
  });

  it('si el modelo falla o no hay, vale la nota por señales', async () => {
    const { svc } = make({ judge: async () => { throw new Error('límite'); } });
    svc.enqueue([...many(10), clip('good1', { views: 500 })]);
    await svc.idle();
    assert.equal(svc.gold('good1'), true);
    const { svc: s2 } = make({ judge: async () => null });
    s2.enqueue([...many(10), clip('good1', { views: 500 })]);
    await s2.idle();
    assert.equal(s2.gold('good1'), true);
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
});

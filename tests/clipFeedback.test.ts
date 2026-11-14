import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyCorrection, cleanScores, feedbackGuide, feedbackSummary, trend, type ClipCorrection } from '../shared/clipFeedback';
import { clipJudgePrompt } from '../shared/clipCriteria';
import { ClipFeedbackStore } from '../electron/domain/clipFeedback';
import { ClipScoreService } from '../electron/domain/clipScores';
import type { TwitchClip } from '../shared/types';

const corr = (i: number, ai: number, user: number, text = 'una frase larga de ejemplo que se decía en el clip número ' + i): ClipCorrection => ({ clipId: `c${i}`, title: `t${i}`, text, ai: { humor: ai, historia: ai, interes: ai }, user: { humor: user, historia: user, interes: user }, at: i });

const dirs: string[] = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-fb-')); dirs.push(d); return d; };

describe('correcciones del streamer a las notas', () => {
  it('valida los valores: 0 a 10 con un decimal y los tres criterios', () => {
    assert.deepEqual(cleanScores({ humor: 12, historia: -3, interes: 4.26 }), { humor: 10, historia: 0, interes: 4.3 });
    assert.deepEqual(cleanScores({ humor: 1, historia: 2, interes: 3, viral: 9.46 }), { humor: 1, historia: 2, interes: 3 }, 'la viralidad no se puede corregir: se ignora');
    assert.equal(cleanScores({ humor: 5 }), null);
    assert.equal(cleanScores('x'), null);
  });

  it('solo cambia humor, historia e interés: la viralidad se queda como la dejó la IA', () => {
    const r = applyCorrection({ humor: 1, historia: 2, viral: 7, interes: 3 }, { humor: 9, historia: 8, interes: 7 });
    assert.deepEqual(r, { humor: 9, historia: 8, viral: 7, interes: 7 });
  });

  it('una o dos correcciones no crean tendencia; con tres sí, y solo si la diferencia importa', () => {
    assert.deepEqual(trend([corr(1, 1, 8), corr(2, 1, 8)]), {});
    const t = trend([corr(1, 1, 8), corr(2, 2, 7), corr(3, 1, 6)]);
    assert.ok((t.humor ?? 0) > 4);
    assert.deepEqual(trend([corr(1, 5, 5.5), corr(2, 4, 4.2), corr(3, 6, 6)]), {});
    assert.equal(feedbackSummary([corr(1, 1, 8)]).enough, false);
  });

  it('la guía para la IA lleva ejemplos y, con varias correcciones, la tendencia; sin texto no enseña nada', () => {
    const one = feedbackGuide([corr(1, 1, 8)]);
    assert.match(one, /Ejemplos de clips/);
    assert.doesNotMatch(one, /MÁS alto/);
    const three = feedbackGuide([corr(1, 1, 8), corr(2, 2, 7), corr(3, 1, 6)]);
    assert.match(three, /MÁS alto/);
    assert.equal(feedbackGuide([corr(1, 1, 8, 'corto')]), '');
    assert.equal(feedbackGuide([]), '');
  });

  it('la guía entra en la petición al modelo', () => {
    const p = clipJudgePrompt('t', [{ text: 'hola', start: 0, end: 1 }], 20, 0, feedbackGuide([corr(1, 1, 8)]));
    assert.match(p, /CALIBRACIÓN/);
    assert.doesNotMatch(clipJudgePrompt('t', [], 20), /CALIBRACIÓN/);
  });

  it('la tienda guarda una corrección por clip, sobrevive al reinicio y se puede borrar', () => {
    const file = path.join(tmp(), 'f.json');
    const s = new ClipFeedbackStore(file);
    s.add(corr(1, 1, 8));
    s.add(corr(1, 1, 6));
    s.add(corr(2, 2, 5));
    assert.equal(new ClipFeedbackStore(file).all().length, 2);
    assert.equal(s.all().find((c) => c.clipId === 'c1')!.user.humor, 6);
    assert.equal(s.remove('c1'), true);
    s.clear();
    assert.equal(new ClipFeedbackStore(file).all().length, 0);
  });
});

describe('corregir la nota de un clip', () => {
  const clip: TwitchClip = { id: 'k1', title: 'Clip', url: 'https://clips.twitch.tv/k1', durationSec: 30, createdAt: '2026-11-10T10:00:00Z', creator: 'x', views: 1, thumbnail: '' };
  const words = Array.from({ length: 30 }, (_, i) => ({ text: `palabra${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const judgement = { criteria: { humor: 1, historia: 4, viral: 6, interes: 3 }, reason: 'Poco', items: {}, evidence: {} };

  async function scored(by: 'model' | 'none' = 'model') {
    const feedback = new ClipFeedbackStore(path.join(tmp(), 'f.json'));
    let asked = 0;
    const svc = new ClipScoreService({
      file: path.join(tmp(), 's.json'), canRun: () => true, sleep: async () => undefined, feedback,
      analyze: async () => ({ durationSec: 30, words, energyDb: Array.from({ length: 30 }, () => -40) }),
      judge: async () => { asked++; return by === 'model' ? judgement : null; },
    });
    svc.enqueue([clip]);
    await svc.idle();
    return { svc, feedback, asked: () => asked };
  }

  it('el dorado no cambia al corregir: depende solo de la viralidad de la IA y tú no puedes tocarla', async () => {
    const m = { criteria: { humor: 1, historia: 4, viral: 9.6, interes: 3 }, reason: 'x', items: {}, evidence: {} };
    const svc = new ClipScoreService({
      file: path.join(tmp(), 's.json'), canRun: () => true, sleep: async () => undefined, feedback: new ClipFeedbackStore(path.join(tmp(), 'f.json')),
      analyze: async () => ({ durationSec: 30, words, energyDb: [...Array.from({ length: 24 }, () => -40), ...Array.from({ length: 6 }, () => -14)] }),
      judge: async () => ({ ...m, items: Object.fromEntries(['gancho', 'citable', 'emocion', 'universal', 'cierre', 'compartible', 'retencion', 'sinDefectos'].map((k) => [`viral.${k}`, 2])) }),
      verifyViral: async () => ({ items: Object.fromEntries(['gancho', 'citable', 'emocion', 'universal', 'cierre', 'compartible', 'retencion', 'sinDefectos'].map((k) => [`viral.${k}`, 2])), stay: 6, total: 6, refutation: '' }),
    });
    svc.enqueue([clip]);
    await svc.idle();
    const viral = svc.detailOf('k1')!.criteria.viral;
    assert.ok(viral >= 9.5);
    assert.equal(svc.gold('k1'), true);
    svc.correct('k1', { humor: 0, historia: 0, interes: 0 });
    assert.equal(svc.detailOf('k1')!.criteria.viral, viral, 'tu corrección no toca la viralidad');
    assert.equal(svc.gold('k1'), true, 'sigue dorado');
    svc.undoCorrection('k1');
    assert.equal(svc.gold('k1'), true);
  });

  it('recalcula la nota con lo que dices, conserva la viralidad de la IA y guarda la corrección con lo que se decía', async () => {
    const { svc, feedback } = await scored();
    const before = svc.scoreOf('k1')!;
    const r = svc.correct('k1', { humor: 9, historia: 8, interes: 8 });
    assert.ok(r.score > before);
    const d = svc.detailOf('k1')!;
    assert.equal(d.by, 'user');
    assert.equal(d.criteria.humor, 9);
    assert.equal(d.criteria.viral, svc.detailOf('k1')!.criteria.viral);
    const saved = feedback.all()[0];
    assert.equal(saved.ai.humor, 1);
    assert.equal(saved.user.humor, 9);
    assert.match(saved.text, /palabra3/);
  });

  it('corregir dos veces conserva la nota original de la IA como referencia, y no se vuelve a valorar sola', async () => {
    const { svc, feedback, asked } = await scored();
    svc.correct('k1', { humor: 9, historia: 8, interes: 8 });
    svc.correct('k1', { humor: 6, historia: 8, interes: 8 });
    assert.equal(feedback.all().length, 1);
    assert.equal(feedback.all()[0].ai.humor, 1);
    svc.enqueue([clip]);
    await svc.idle();
    assert.equal(asked(), 1);
  });

  it('volver a la nota de la IA deshace la corrección y la olvida', async () => {
    const { svc, feedback } = await scored();
    const before = svc.scoreOf('k1');
    svc.correct('k1', { humor: 9, historia: 8, interes: 8 });
    svc.undoCorrection('k1');
    assert.equal(svc.scoreOf('k1'), before);
    assert.equal(svc.detailOf('k1')!.by, 'model');
    assert.equal(feedback.all().length, 0);
  });

  it('no deja corregir un clip que la IA aún no ha valorado', async () => {
    const { svc } = await scored('none');
    assert.throws(() => svc.correct('k1', { humor: 9, historia: 8, interes: 8 }), /todavía no tiene nota/);
    assert.throws(() => svc.correct('nope', { humor: 9, historia: 8, interes: 8 }), /todavía no tiene nota/);
  });
});

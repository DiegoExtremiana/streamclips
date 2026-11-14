import { bestStretches, buildSummary, findMoments } from '../../../shared/highlights';
import { dominantCategory, fitToCategory } from '../../../shared/categories';
import { isCancelled, throwIfCancelled } from '../../services/abort';
import type { Candidate } from '../../../shared/judge';
import type { Phase } from './context';

/**
 * Fase 2: señales del directo (volumen por segundo, chat, transcripción si la hay) y, con ellas, los tramos de siempre:
 * momentos para clips, resumen y vídeos continuos. Con modelo de lenguaje se reúnen además más candidatos de los
 * necesarios para que él elija los buenos de verdad.
 */
export const signalsPhase: Phase = async (ctx) => {
  const { host, vod, task, notes } = ctx;
  const d = host.d;
  const cfg = host.cfg;
  host.mark(vod, 'analyzing');
  ctx.clock.mark('volumen y chat');
  task.update(30, 'Analizando audio y chat…');
  ctx.duration = await d.clips.vodDuration(vod.id);
  let energyDb: number[] | undefined;
  const er = await ctx.energyJob;
  if ('v' in er) energyDb = er.v;
  else {
    if (isCancelled(er.e)) throw er.e;
    notes.push(`Sin análisis de volumen: ${(er.e as Error).message}`);
  }
  task.update(50);
  throwIfCancelled();
  const chat = host.chatFor(vod);
  if (!chat && cfg.chatCapture) notes.push('Sin datos de chat de este directo.');
  const words = ctx.words;
  ctx.sig = { durationSec: ctx.duration, energyDb, chat, words: words.length ? words : undefined };
  if (!energyDb && !chat && !words.length) throw new Error('No hay ninguna señal para analizar (ni audio, ni chat, ni transcripción).');

  // 3) tramos
  let moments = cfg.maxClips > 0 ? findMoments(ctx.sig, { count: cfg.maxClips }) : [];
  let summary = buildSummary(ctx.sig, { minSec: cfg.summaryMinutes * 60 * 0.85, maxSec: cfg.summaryMinutes * 60 * 1.25 });
  // el resumen cuenta como uno de los vídeos del directo; el resto son tramos continuos distintos
  let mains = cfg.maxVideos > 1 ? bestStretches(ctx.sig, cfg.mainMinutes * 60, cfg.maxVideos - 1) : [];
  if (!cfg.maxVideos) summary.length = 0;
  // Cada clip y cada vídeo es de una sola categoría de Twitch: se recorta a la del momento y lo que no cabe se descarta.
  ctx.cats = await d.categories.ensure(vod.id);
  ctx.multiCat = new Set(ctx.cats.map((c) => c.title)).size > 1;
  if (ctx.multiCat) {
    const before = moments.length + mains.length;
    moments = moments.flatMap((m) => {
      const f = fitToCategory(m, ctx.cats, 15);
      return f ? [{ ...m, start: f.start, end: f.end }] : [];
    });
    mains = mains.flatMap((m) => {
      const f = fitToCategory(m, ctx.cats, 90);
      return f ? [f] : [];
    });
    const dom = dominantCategory(summary, ctx.cats, 8);
    if (dom.category && dom.segs.length !== summary.length) notes.push(`Resumen solo de la categoría «${dom.category}».`);
    summary = dom.segs;
    if (before !== moments.length + mains.length) notes.push('Algunos momentos se recortaron o descartaron para no mezclar categorías.');
  }
  // Selección inteligente: más candidatos de los necesarios, para que el modelo de lenguaje elija los buenos de verdad
  ctx.llmConf = host.llmConf();
  let pool: Candidate[] = [];
  if (ctx.llmConf && cfg.smartSelect !== false && (cfg.maxClips > 0 || cfg.maxVideos > 0)) {
    const need = cfg.maxClips + (cfg.maxVideos ? Math.ceil((cfg.summaryMinutes * 60) / 40) : 0);
    pool = findMoments(ctx.sig, { count: Math.min(60, Math.max(16, need * 2)), minLen: 25, maxLen: 75, gap: 45 }).flatMap((m, i) => {
      const f = ctx.multiCat ? fitToCategory(m, ctx.cats, 15) : { start: m.start, end: m.end };
      return f ? [{ id: `c${i}`, start: f.start, end: f.end, signal: m.score }] : [];
    });
  }
  ctx.legacy = { moments, summary, mains };
  if (pool.length) {
    // lo que se transcribe es el conjunto de candidatos; la selección por señales solo se transcribe si el modelo falla
    moments = [];
    summary = [];
  }
  ctx.moments = moments;
  ctx.summary = summary;
  ctx.mains = mains;
  ctx.pool = pool;
  if (!moments.length && !summary.length && !mains.length && !pool.length) {
    host.mark(vod, 'skipped', ['No se encontraron momentos que destaquen en este directo.', ...notes].join(' '));
    task.done('Sin momentos destacados');
    return 'stop';
  }
  return 'continue';
};

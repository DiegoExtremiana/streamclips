import { isCancelled } from '../../services/abort';
import type { Phase } from './context';

/**
 * Fase 1: transcripción. Si hay Whisper y no se pide análisis rápido, se transcribe el directo entero ahora; con análisis
 * rápido se deja para después de elegir los momentos (solo se transcribe lo elegido). Sin Whisper se sigue sin texto.
 */
export const transcribePhase: Phase = async (ctx) => {
  const { host, vod, task, notes } = ctx;
  const d = host.d;
  ctx.words = d.transcripts.words(vod.id);
  if (d.transcripts.isFull(vod.id)) return 'continue';
  const st = d.transcripts.status();
  const skip = st.engine && d.canTranscribe ? d.canTranscribe(vod.durationSec ?? (await d.clips.vodDuration(vod.id))) : null;
  if (skip) {
    notes.push(`Sin transcripción: ${skip}.`);
    return 'continue';
  }
  if (st.engine && host.cfg.fastAnalysis !== false && !d.transcripts.hasCheckpoint(vod.id)) {
    // análisis rápido: primero se eligen los momentos con el volumen y el chat, y luego se transcribe solo lo elegido
    ctx.deferTranscribe = true;
    return 'continue';
  }
  if (!st.engine) {
    notes.push('Sin transcripción: Whisper no está disponible.');
    return 'continue';
  }
  host.mark(vod, 'transcribing');
  ctx.clock.mark('transcripción completa');
  task.update(2, 'Transcribiendo el directo (puede tardar)…');
  try {
    const ts = Date.now();
    // la transcripción ocupa del 2 % al 30 % de la barra del análisis (y es casi todo el tiempo)
    await d.transcripts.transcribe(vod.id, undefined, {
      onProgress: (pct, detail) => task.update(2 + pct * 0.28, detail ? `Transcribiendo (${detail})…` : undefined),
      onEstimate: (sec) => task.estimate(sec / 0.28),
    });
    ctx.words = d.transcripts.words(vod.id);
    ctx.tTranscribe = ctx.lap(ts);
    const mins = (vod.durationSec ?? 0) / 60;
    d.log.info(`Transcripción de "${vod.title}": ${ctx.tTranscribe}${mins ? ` (${(mins / Math.max(0.05, (Date.now() - ts) / 60000)).toFixed(1)}× tiempo real)` : ''}`);
  } catch (e) {
    if (isCancelled(e)) throw e;
    notes.push(`Sin transcripción: ${(e as Error).message}`);
  }
  return 'continue';
};

/** Fase 3b: con análisis rápido, se transcribe solo lo elegido (tramos de clips, resumen, vídeos y candidatos). */
export const transcribeChosenPhase: Phase = async (ctx) => {
  if (!ctx.deferTranscribe) return 'continue';
  const { host, vod, task, notes } = ctx;
  const d = host.d;
  const spans = [...ctx.moments, ...ctx.summary, ...ctx.mains, ...ctx.pool].map((g) => ({ start: g.start, end: g.end }));
  host.mark(vod, 'transcribing');
  ctx.clock.mark('transcripción de lo elegido');
  task.update(40, 'Transcribiendo solo lo elegido…');
  try {
    const ts = Date.now();
    const est = d.transcripts.estimate(vod.id, spans);
    if (est.sec > 0) task.estimate(est.eta / 0.15);
    await d.transcripts.ensure(vod.id, spans, {
      onProgress: (doneSec, totalSec) => task.update(40 + (totalSec ? (doneSec / totalSec) * 15 : 15), `Transcribiendo lo elegido (${Math.round(doneSec / 60)} de ${Math.round(totalSec / 60)} min)…`),
    });
    ctx.words = d.transcripts.words(vod.id);
    ctx.tTranscribe = ctx.lap(ts);
    d.log.info(`Transcripción de lo elegido en "${vod.title}": ${ctx.tTranscribe} (${Math.round(est.sec / 60)} min de audio, de ${Math.round((vod.durationSec ?? ctx.duration) / 60)} del directo)`);
    notes.push(`Análisis rápido: se transcribieron ${Math.round(est.sec / 60)} min de ${Math.round(ctx.duration / 60)}.`);
  } catch (e) {
    if (isCancelled(e)) throw e;
    notes.push(`Sin transcripción: ${(e as Error).message}`);
  }
  host.mark(vod, 'analyzing');
  return 'continue';
};

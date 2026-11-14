import type { Phase } from './context';

/**
 * Fase 6: cierre. Un análisis repetido sustituye los vídeos pendientes del anterior; se da el visto bueno (o se deja para
 * revisar); los temas con dos formatos posibles se dejan para que elijas; se borra el directo completo si procede; y se
 * anotan los tiempos por fase.
 */
export const finishPhase: Phase = async (ctx) => {
  const { host, vod, task, notes, created } = ctx;
  const d = host.d;
  const cfg = host.cfg;
  // un análisis repetido sustituye a los vídeos del anterior que seguían pendientes de revisión (sin publicar ni tocar por ti)
  const prior = d.store.data.outputs.filter(
    (x) => x.vodId === vod.id && x.auto?.review === 'pending' && !created.includes(x) && x.titleSource !== 'manual' && x.descSource !== 'manual' && !d.store.data.publications.some((p) => p.outputId === x.id),
  );
  if (prior.length) {
    const r = d.library.removeMany(prior.map((x) => x.id));
    if (r.removed) notes.push(`Se sustituyeron ${r.removed} vídeo(s) pendientes de revisión de un análisis anterior.`);
  }

  // 6) visto bueno o programación
  if (!cfg.requireApproval) {
    for (const o of created) {
      try {
        host.approve(o.id);
        ctx.scheduled++;
      } catch (e) {
        ctx.errors.push(`${o.title}: ${(e as Error).message}`); // se queda para revisar a mano
      }
    }
  }
  // temas con dos formas buenas de aprovecharlos: se te pregunta cuál prefieres (ventana en la aplicación)
  if (ctx.askProposals.length && d.themes) {
    d.themes.put(vod.id, ctx.askProposals);
    notes.push(`${ctx.askProposals.length} tema(s) esperan que elijas formato: ${ctx.askProposals.map((p) => `«${p.title}»`).join(', ')}.`);
  }
  // ya están los vídeos y los clips: el directo completo y lo que solo servía para sacarlos se borra
  if (cfg.cleanup !== false && d.discardSource && !d.themes?.hasPending(vod.id)) {
    try {
      const r = host.discard(vod.id, { fromRun: true });
      notes.push(`Directo completo borrado del disco (${(r.freedBytes / 1024 ** 3).toFixed(1)} GB liberados); se conservan ${r.kept} vídeo(s) y clip(s) con sus transcripciones.`);
    } catch (e) {
      notes.push(`No se pudo borrar el directo completo: ${(e as Error).message}`);
    }
  }
  ctx.clock.mark(null);
  notes.push(`Tiempos: ${ctx.clock.describe() || `montaje ${ctx.lap(ctx.renderStarted ?? ctx.t0)}`}; total ${ctx.lap(ctx.t0)}.`);
  host.recordTimes(vod, ctx.clock.seconds(), Math.round((Date.now() - ctx.t0) / 1000));
  d.log.info(`Análisis de "${vod.title}": ${notes[notes.length - 1]}`);
  const msg = `${created.length} vídeo(s) listos${cfg.requireApproval ? ' para revisar' : ` (${ctx.scheduled} programados)`}.`;
  host.mark(vod, 'done', [msg, ...ctx.errors, ...notes].join(' '));
  task.done(msg);
  return 'continue';
};

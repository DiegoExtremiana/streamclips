import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dominantCategory } from '../../../shared/categories';
import { kindSummary, selectBest, textFn, type Judged } from '../../../shared/judge';
import { applyEdits } from '../../../shared/momentEdits';
import { applyPrefs, describePrefs } from '../../../shared/preferences';
import { decideFormat } from '../../../shared/themes';
import { judgeCandidates } from '../../services/momentJudge';
import { judgeVisual } from '../../services/visualJudge';
import { measureUnseen } from '../../services/motionMeasure';
import { loadEdits, loadPrefs, saveSnapshot } from '../../services/momentStore';
import { isCancelled, throwIfCancelled } from '../../services/abort';
import type { Phase, RunContext } from './context';

/** Notas mínimas (0-10) para que un momento entre: el modelo puntúa 5 lo normal, 7 lo bueno. Antes un vídeo corto y bueno que uno largo con relleno. */
export const DEFAULT_QUALITY = 6.5;
/** Un resumen de menos de esto no merece publicarse. */
export const MIN_SUMMARY_SEC = 150;

/** 3c) El modelo de lenguaje lee los candidatos (y mira su imagen) y devuelve cada uno valorado; null si no pudo. */
async function judgeAll(ctx: RunContext): Promise<Judged[] | null> {
  const { host, vod, task, notes, words, pool } = ctx;
  const d = host.d;
  const llmConf = ctx.llmConf!;
  let judged: Judged[] | null = null;
  try {
    const r = await judgeCandidates(llmConf, words, pool, {
      fetchFn: d.llmFetch,
      cacheFile: d.judgeDir ? path.join(d.judgeDir, `${vod.id}.json`) : undefined,
      onProgress: (done, total) => task.update(56 + (total ? (done / total) * 4 : 4), `Valorando candidatos (${done}/${total})…`),
      signal: () => throwIfCancelled(),
    });
    judged = r.judged;
    notes.push(`Selección inteligente: ${r.judged.length} candidatos valorados${r.cached ? ` (${r.cached} ya estaban guardados)` : ''}${r.failedChunks ? `, ${r.failedChunks} lote(s) sin respuesta` : ''}.`);
    // 3c-bis) mirar el directo: la imagen de los mejores momentos es otro factor de la nota
    if (host.cfg.vodVision !== false && vod.filePath && fs.existsSync(vod.filePath)) {
      ctx.clock.mark('imagen del directo');
      task.update(60, 'Mirando los mejores momentos…');
      const tmpDir = path.join(os.tmpdir(), `streamclips-vision-${vod.id}`);
      const vr = await judgeVisual(llmConf, words, judged, {
        ffmpeg: d.tools().ffmpeg,
        file: vod.filePath,
        tmpDir,
        cacheFile: d.judgeDir ? path.join(d.judgeDir, `${vod.id}.visual.json`) : undefined,
        fetchFn: d.llmFetch,
        signal: () => throwIfCancelled(),
        // los fotogramas se sacan alrededor del pico de volumen del momento: ahí están los gestos y las reacciones
        peakAt: (seg) => {
          const e = ctx.sig.energyDb;
          if (!e?.length) return undefined;
          let best = -1;
          for (let t = Math.max(0, Math.floor(seg.start)); t <= Math.min(e.length - 1, Math.ceil(seg.end)); t++) if (best < 0 || e[t] > e[best]) best = t;
          return best < 0 ? undefined : best + 0.5;
        },
      }).catch((e) => {
        if (isCancelled(e)) throw e;
        return null;
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (vr && !vr.failed) {
        judged = vr.judged;
        notes.push(`Vista del directo: ${vr.looked} momentos mirados${vr.cached ? ` (${vr.cached} ya estaban guardados)` : ''}${vr.dead ? `, ${vr.dead} con la imagen muerta descartados` : ''}.`);
      } else notes.push(`Sin vista del directo${vr?.error ? ` (${vr.error.split('\n')[0]})` : ''}: se eligió por lo que se oye.`);
      // el resto de candidatos (el modelo solo mira los mejores) se mide con ffmpeg: imagen quieta o con acción
      const mm = await measureUnseen(d.tools().ffmpeg, vod.filePath, judged, { signal: () => throwIfCancelled() }).catch((e) => {
        if (isCancelled(e)) throw e;
        return null;
      });
      if (mm && mm.measured) {
        judged = mm.judged;
        notes.push(`Imagen medida en ${mm.measured} candidatos más${mm.dead ? ` (${mm.dead} con la imagen casi quieta descartados)` : ''}.`);
      }
    }
  } catch (e) {
    if (isCancelled(e)) throw e;
    notes.push(`Selección inteligente no disponible (${(e as Error).message}); se usó el volumen y el chat.`);
  }
  return judged;
}

/** Tus preferencias aprendidas y tus correcciones a mano sobre lo valorado; se guarda la instantánea para la revisión. */
function personalize(ctx: RunContext, judged: Judged[]): { judged: Judged[]; raw: Judged[] } {
  const { host, vod, notes } = ctx;
  const d = host.d;
  if (d.prefsFile) {
    const prefs = loadPrefs(d.prefsFile);
    const act = describePrefs(prefs).filter((x) => x.active);
    if (prefs.enabled && act.length) {
      judged = applyPrefs(judged, prefs);
      notes.push(`Preferencias aprendidas aplicadas: ${act.map((x) => `${x.kind} ${x.bias > 0 ? '+' : ''}${x.bias}`).join(', ')}.`);
    }
  }
  const raw = judged;
  if (d.momentsDir) {
    const edits = loadEdits(d.momentsDir, vod.id);
    const n = edits.exclude.length + edits.pin.length + Object.keys(edits.trims).length + edits.extra.length;
    if (n) {
      judged = applyEdits(judged, edits);
      notes.push(`Se aplicaron ${n} corrección(es) tuyas a la selección de momentos.`);
    }
  }
  return { judged, raw };
}

/**
 * Fase 3c: valoración con el modelo de lenguaje y selección. Sin modelo (o si falla) se vuelve a la selección por señales.
 * Deja en el contexto los clips, el resumen (por mejores momentos) y las propuestas de vídeos temáticos.
 */
export const judgePhase: Phase = async (ctx) => {
  if (!ctx.pool.length) return 'continue';
  const { host, vod, task, notes, words } = ctx;
  const d = host.d;
  const cfg = host.cfg;
  ctx.clock.mark('modelo de lenguaje');
  task.update(56, 'Valorando los momentos candidatos…');
  let judged: Judged[] | null = null;
  if (!words.length) notes.push('Selección inteligente omitida: no hay transcripción.');
  else judged = await judgeAll(ctx);

  if (judged) {
    const quality = cfg.minQuality ?? DEFAULT_QUALITY;
    const p = personalize(ctx, judged);
    judged = p.judged;
    ctx.judged = judged;
    const textFor = textFn(words);
    const clips = cfg.maxClips > 0 ? selectBest(judged, { maxSec: Infinity, minTotal: quality, maxCount: cfg.maxClips, maxLen: 60, minGap: 30, textFor }) : null;
    const sum = cfg.maxVideos > 0 ? selectBest(judged, { maxSec: cfg.summaryMinutes * 60 * 1.25, minTotal: quality, maxLen: 90, minGap: 20, textFor }) : null;
    if (clips) {
      ctx.moments = clips.chosen.map((c) => ({ start: c.seg.start, end: c.seg.end, peak: (c.seg.start + c.seg.end) / 2, score: c.total, reasons: [c.judgement.kind] }));
      clips.chosen.forEach((c, i) => ctx.meta.set(ctx.moments[i], { score: c.total, kind: c.judgement.kind, reason: c.judgement.reason }));
      if (clips.chosen.length < cfg.maxClips) notes.push(`Solo ${clips.chosen.length} de ${cfg.maxClips} clips superan la nota mínima (${quality}/10); no se rellenó con momentos flojos.`);
    }
    if (d.momentsDir) saveSnapshot(d.momentsDir, vod.id, p.raw, [...(clips?.chosen ?? []), ...(sum?.chosen ?? [])].map((c) => c.start), quality);
    if (sum && sum.chosen.length) {
      if (sum.totalSec >= MIN_SUMMARY_SEC) {
        ctx.summary = sum.chosen.map((c) => ({ start: c.seg.start, end: c.seg.end }));
        const avg = sum.chosen.reduce((a, c) => a + c.total, 0) / sum.chosen.length;
        notes.push(`Resumen de ${Math.round(sum.totalSec / 60)} min con ${sum.chosen.length} momentos (nota media ${avg.toFixed(1)}/10): ${kindSummary(sum)}.${sum.totalSec < cfg.summaryMinutes * 60 * 0.85 ? ' Más corto de lo configurado: no había más momentos buenos.' : ''}`);
        if (ctx.multiCat) {
          const dom = dominantCategory(ctx.summary, ctx.cats, 8);
          if (dom.category && dom.segs.length !== ctx.summary.length) notes.push(`Resumen solo de la categoría «${dom.category}».`);
          ctx.summary = dom.segs;
        }
        for (const c of sum.chosen) if (c.judgement.title) ctx.chapterLabels.set(Math.round(c.seg.start), c.judgement.title);
        ctx.summaryMeta = { score: avg, kind: 'resumen', reason: kindSummary(sum) };
      } else notes.push(`No hay suficientes momentos buenos para un resumen (${Math.round(sum.totalSec)} s por encima de ${quality}/10).`);
    } else if (sum) notes.push(`Ningún momento supera la nota mínima del resumen (${quality}/10).`);
    if (cfg.topics !== false && (cfg.maxVideos > 0 || cfg.maxClips > 0)) {
      ctx.clock.mark('temas');
      const found = await host.findThemes(vod, judged, words, ctx.llmConf!, notes);
      for (const pr of found) {
        const how = decideFormat(pr);
        if (how === 'ask') ctx.askProposals.push(pr);
        else if (how === 'long') ctx.topicLongs.push(pr);
        else if (how === 'shorts') ctx.topicShorts.push(pr);
      }
    }
  } else {
    // el modelo no estuvo disponible: selección por señales de siempre, transcribiendo lo que haga falta
    ctx.moments = ctx.legacy.moments;
    ctx.summary = ctx.legacy.summary;
    try {
      await d.transcripts.ensure(vod.id, [...ctx.moments, ...ctx.summary].map((g) => ({ start: g.start, end: g.end })));
      ctx.words = d.transcripts.words(vod.id);
    } catch (e) {
      if (isCancelled(e)) throw e;
    }
  }
  return 'continue';
};

/** Tras valorar (y tras el director): si nada supera la nota mínima no se genera nada, para no publicar relleno. */
export const qualityGatePhase: Phase = async (ctx) => {
  if (!ctx.pool.length) return 'continue';
  if (ctx.moments.length || ctx.summary.length || ctx.mains.length || ctx.directed) return 'continue';
  ctx.host.mark(ctx.vod, 'skipped', ['Ningún momento supera la nota mínima de calidad: no se genera nada para no publicar relleno.', ...ctx.notes].join(' '));
  ctx.task.done('Sin momentos con la calidad mínima');
  return 'stop';
};

/** Fase 3d: quién habla en lo elegido (para colorear los subtítulos por voz). */
export const speakersPhase: Phase = async (ctx) => {
  const { host, vod, task, notes } = ctx;
  const d = host.d;
  if (host.cfg.speakers === false || !ctx.words.length) return 'continue';
  const avail = d.speakers.available();
  if (!avail.ok) {
    notes.push(`Hablantes sin identificar: ${avail.reason}`);
    return 'continue';
  }
  const spans = [...ctx.moments, ...ctx.summary, ...ctx.mains].map((g) => ({ start: g.start, end: g.end }));
  const need = d.speakers.pendingSeconds(vod.id, spans);
  if (need <= 0) return 'continue';
  ctx.clock.mark('hablantes');
  task.update(60, 'Identificando hablantes…');
  try {
    const ts = Date.now();
    const r = await d.speakers.diarize(vod.id, spans, (done, total) => task.update(60 + (total ? (done / total) * 14 : 14), `Identificando hablantes (${Math.round(done / 60)} de ${Math.round(total / 60)} min)…`));
    ctx.words = d.transcripts.words(vod.id);
    notes.push(`Hablantes: ${r.voices} voz/voces en ${Math.round(r.sec / 60)} min de audio (${ctx.lap(ts)}).`);
  } catch (e) {
    if (isCancelled(e)) throw e;
    notes.push(`Hablantes sin identificar: ${(e as Error).message}`);
  }
  return 'continue';
};

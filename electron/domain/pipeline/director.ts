import fs from 'node:fs';
import path from 'node:path';
import { DIRECTOR_SYSTEM, directedCut, directorCandidates, directorPrompt, parseDirectorPlan, type DirectorCandidate, type DirectorPlan } from '../../../shared/director';
import { categoriesOf } from '../../../shared/categories';
import { askJson } from '../../services/llm';
import { isCancelled } from '../../services/abort';
import { MIN_SUMMARY_SEC } from './judge';
import type { Phase } from './context';

const CACHE_VERSION = 1;

/** Candidatos de una sola categoría de Twitch (la que más material tiene): un vídeo no puede mezclar dos. */
export function singleCategory(cands: DirectorCandidate[], cats: { start: number; end: number; title: string }[], multi: boolean): { cands: DirectorCandidate[]; category?: string } {
  if (!multi) return { cands };
  const by = new Map<string, number>();
  const of = (c: DirectorCandidate) => categoriesOf(cats, c)[0];
  for (const c of cands) {
    const k = of(c);
    if (k) by.set(k, (by.get(k) ?? 0) + (c.end - c.start));
  }
  const best = [...by.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ? { cands: cands.filter((c) => of(c) === best), category: best } : { cands };
}

/**
 * Fase 3e: director de edición para YouTube. Con los momentos valorados (texto, imagen, volumen, chat) el modelo decide
 * la estructura del vídeo largo: gancho, capítulos, cierre, rótulos, título, descripción y miniatura. Si falla o no hay
 * material, no deja nada y el montaje hace el resumen de mejores momentos de siempre.
 */
export const directorPhase: Phase = async (ctx) => {
  const { host, vod, task, notes, words } = ctx;
  const cfg = host.cfg;
  const d = host.d;
  if (cfg.director === false || cfg.maxVideos <= 0 || !ctx.judged || !ctx.llmConf || !words.length) return 'continue';
  ctx.clock.mark('director de edición');
  task.update(64, 'Decidiendo la estructura del vídeo…');
  const all = directorCandidates(ctx.judged, words, ctx.sig);
  const { cands, category } = singleCategory(all, ctx.cats, ctx.multiCat);
  if (cands.length < 4) {
    notes.push(`Director de edición: solo ${cands.length} momento(s) con nota suficiente; se monta el resumen de siempre.`);
    return 'continue';
  }
  const style = host.style();
  const input = {
    vodTitle: vod.title ?? '',
    dateLabel: new Date(vod.streamStartedAt ?? vod.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }),
    categories: category ? [category] : [...new Set(ctx.cats.map((c) => c.title))],
    minSec: style.longMinSec,
    maxSec: style.longMaxSec,
    candidates: cands,
    style: { titleStyle: style.titleStyle, lore: style.lore },
  };
  // el plan se guarda por directo: repetir el análisis no vuelve a gastar modelo si los candidatos son los mismos
  const key = `${CACHE_VERSION}|${cands.map((c) => `${c.id}:${c.start}:${c.end}:${c.total}`).join(',')}`;
  const cacheFile = d.judgeDir ? path.join(d.judgeDir, `${vod.id}.director.json`) : undefined;
  let plan: DirectorPlan | null = null;
  try {
    const cached = cacheFile && fs.existsSync(cacheFile) ? (JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as { key: string; plan: DirectorPlan }) : null;
    if (cached?.key === key) plan = cached.plan;
    else {
      const raw = await askJson(ctx.llmConf, DIRECTOR_SYSTEM, directorPrompt(input), { fetchFn: d.llmFetch, temperature: 0.3 });
      plan = parseDirectorPlan(raw, cands);
      if (plan && cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({ key, plan }));
      }
    }
  } catch (e) {
    if (isCancelled(e)) throw e;
    notes.push(`Director de edición no disponible (${(e as Error).message.split('\n')[0]}); se monta el resumen de siempre.`);
    return 'continue';
  }
  if (!plan) {
    notes.push('Director de edición: el modelo no devolvió una estructura válida; se monta el resumen de siempre.');
    return 'continue';
  }
  const cut = directedCut(plan, cands, { minSec: style.longMinSec, maxSec: style.longMaxSec, floorSec: MIN_SUMMARY_SEC });
  if (!cut) {
    notes.push('Director de edición: no hay material suficiente para un vídeo con estructura; se monta el resumen de siempre.');
    return 'continue';
  }
  const labels = new Map<number, string>();
  cut.labels.forEach((l, i) => l && labels.set(Math.round(cut.segs[i].start), l));
  const avg = cands.filter((c) => plan!.chapters.some((ch) => ch.ids.includes(c.id))).reduce((a, c, _i, arr) => a + c.total / arr.length, 0);
  ctx.directed = {
    title: plan.title,
    description: plan.description,
    segs: cut.segs,
    labelsByIndex: cut.labels,
    chapterLabels: labels,
    coverText: plan.coverText || undefined,
    captions: cut.captions,
    meta: { score: Math.round(avg * 10) / 10, kind: 'dirigido', reason: (plan.reason || `Estructura de ${plan.chapters.length} capítulos decidida por el director de edición.`).slice(0, 200) },
  };
  notes.push(
    `Director de edición: «${plan.title || 'sin título'}», ${Math.round(cut.totalSec / 60)} min en ${plan.chapters.length} capítulos (${plan.chapters.map((c) => c.title).join(' · ')})${plan.hook ? `, con gancho${cut.hookRepeats ? ' que se repite entero en su sitio' : ''}` : ', sin gancho'}${cut.captions.length ? `, ${cut.captions.length} rótulos` : ''}. Sustituye al resumen por mejores momentos.`,
  );
  return 'continue';
};

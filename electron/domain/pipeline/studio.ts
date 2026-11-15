import fs from 'node:fs';
import path from 'node:path';
import { DIRECTOR_SYSTEM, HOOK, directedCut, directorCandidates, directorPrompt, parseDirectorPlan, type DirectorPlan } from '../../../shared/director';
import {
  AGENT_LABEL,
  HISTORIA_EXTRA,
  HUMOR_SYSTEM,
  JEFE_SYSTEM,
  RITMO_SYSTEM,
  applyChief,
  applyTrims,
  humorPrompt,
  jefePrompt,
  parseChief,
  parseFunny,
  parseTrims,
  rebasePlan,
  ritmoPrompt,
  SCENE,
  sceneCandidate,
  sceneSpans,
  sumSec,
  type AgentId,
  type ChiefReview,
  type FunnyClip,
  type ProjectOutput,
  type StudioProject,
  type Trim,
} from '../../../shared/studio';
import { MUTED_SHARE, silentShare, snapToSentences, type Seg } from '../../../shared/highlights';
import { judgeText, type Judged } from '../../../shared/judge';
import { decideFormat, type ThemeProposal } from '../../../shared/themes';
import { askJson } from '../../services/llm';
import { isCancelled } from '../../services/abort';
import { MIN_SUMMARY_SEC } from './judge';
import { directorPhase, singleCategory } from './director';
import type { Phase } from './context';

const CACHE_VERSION = 2;
/** Vídeos por tema: de 5 a 15 minutos. */
const THEME_VIDEO = { minSec: 300, maxSec: 900 };
/** El resumen no pasa de 17 minutos (directedCut admite un 10 % sobre el máximo). */
const SUMMARY_MAX_SEC = (17 * 60) / 1.1;

interface Saved {
  key: string;
  plan: DirectorPlan | null;
  trims: Trim[];
  clips: FunnyClip[];
  review: ChiefReview | null;
  project?: StudioProject;
}

const overlaps = (a: Seg, b: Seg) => a.start < b.end && b.start < a.end;

/**
 * Fase «estudio de edición» (sustituye a la del director cuando `cfg.studio !== false`). Lanza a la vez a los editores
 * de historia, ritmo y humor sobre los mismos momentos valorados; con lo que devuelven monta el plan y se lo pasa al
 * jefe de edición, que puede quitar lo que sobre. Deja:
 *  - `ctx.directed`: el vídeo resumen de 10-15 min (igual que el director, pero con los momentos recortados y revisados);
 *  - `ctx.moments`: los clips graciosos del editor de humor por delante de los elegidos por nota;
 *  - `<vod>.studio.json`: el proyecto (líneas de tiempo de resumen, temas y clips) y qué dijo cada agente.
 * Cada agente falla por separado: sin historia se monta el resumen de siempre; sin ritmo no se recorta; sin humor se
 * quedan los clips por nota; sin jefe se monta lo que haya. Los vídeos por tema vienen ya de la fase de valoración.
 */
export const studioPhase: Phase = async (ctx) => {
  const { host, vod, task, notes, words } = ctx;
  const cfg = host.cfg;
  const d = host.d;
  if (cfg.studio === false) return directorPhase(ctx);
  if (!ctx.judged || !ctx.llmConf || !words.length) return 'continue';
  const conf = ctx.llmConf;
  ctx.clock.mark('estudio de edición');
  task.update(64, 'Estudio de edición: los editores están trabajando…');
  const all = directorCandidates(ctx.judged, words, ctx.sig);
  const { cands: picks, category } = singleCategory(all, ctx.cats, ctx.multiCat);
  // picos sueltos → escenas continuas con contexto (lo que hace que el vídeo se entienda); ver shared/studio.ts
  const chapterOf = (c: Seg) => ctx.cats.find((k) => c.start < k.end && c.end > k.start && Math.min(c.end, k.end) - Math.max(c.start, k.start) >= (c.end - c.start) / 2);
  // el contexto añadido puede caer en un trozo silenciado por Twitch: esa escena se queda fuera
  let spans = sceneSpans(picks, { ...SCENE, durationSec: ctx.duration }, ctx.multiCat ? chapterOf : undefined).filter((s) => silentShare(ctx.sig.energyDb, s) < MUTED_SHARE);
  let sceneWords = words;
  if (cfg.director !== false && cfg.maxVideos > 0 && spans.length) {
    try {
      // con el análisis rápido solo están transcritos los picos: hay que transcribir el contexto que se añade
      await d.transcripts.ensure(vod.id, spans.map((s) => ({ start: s.start, end: s.end })));
      sceneWords = d.transcripts.words(vod.id);
      ctx.words = sceneWords;
    } catch (e) {
      if (isCancelled(e)) throw e;
      notes.push(`No se pudo transcribir el contexto de las escenas (${(e as Error).message.split('\n')[0]}).`);
    }
    // cada escena empieza y acaba en frase completa, sin pisar a la anterior
    let prevEnd = 0;
    spans = spans.map((s) => {
      const sn = snapToSentences(s.start, s.end, sceneWords, 6);
      const start = Math.max(prevEnd, Math.min(sn.start, s.members[0].start));
      const end = Math.max(sn.end, s.members[s.members.length - 1].end);
      prevEnd = end;
      return { ...s, start, end };
    });
  }
  const scenes = spans.map((s, i) => sceneCandidate(s, i, judgeText(sceneWords, s, 1500)));
  // con muy pocas escenas (directo corto o todo seguido) no hay con qué estructurar: se trabaja con los momentos, como el director
  const useScenes = scenes.length >= 4 && scenes.length < picks.length;
  const cands = useScenes ? scenes : picks;
  const wantLong = cfg.director !== false && cfg.maxVideos > 0 && cands.length >= 4;
  const wantClips = cfg.maxClips > 0 && all.length > 0;
  // Editor de temas (a la vez que los demás): busca de qué se habla a lo largo del directo y junta las escenas del mismo
  // tema aunque estén separadas en el tiempo. Lee las escenas enteras (con su contexto), no los picos sueltos.
  const wantThemes = cfg.topics !== false && (cfg.maxVideos > 0 || cfg.maxClips > 0);
  const byPick = new Map((ctx.judged ?? []).map((j) => [j.id, j]));
  const themeUnits: Judged[] = useScenes
    ? spans.map((s, i) => {
        const best = [...s.members].sort((a, b) => b.total - a.total)[0];
        const base = byPick.get(best.id)!;
        const { trim: _t, ...judgement } = base.judgement;
        return { ...base, id: scenes[i].id, start: s.start, end: s.end, total: scenes[i].total, judgement: { ...judgement, title: scenes[i].title } };
      })
    : ctx.judged;
  const themesJob: Promise<{ v: ThemeProposal[] } | { e: unknown }> = wantThemes
    ? host.findThemes(vod, themeUnits, sceneWords, conf, notes, { chars: useScenes ? 900 : 380, minLongSec: THEME_VIDEO.minSec, hardCapSec: THEME_VIDEO.maxSec }).then((v) => ({ v }), (e: unknown) => ({ e }))
    : Promise.resolve({ v: [] });
  const takeThemes = async () => {
    const r = await themesJob;
    if ('e' in r) throw r.e;
    for (const pr of r.v) {
      // si el tema da para un vídeo, se hace el vídeo sin preguntar (Diego quiere un vídeo por tema); los cortos solo si no da
      const how = pr.long.sec > 0 && cfg.maxVideos > 0 ? 'long' : decideFormat(pr);
      if (how === 'ask') ctx.askProposals.push(pr);
      else if (how === 'long') ctx.topicLongs.push(pr);
      else if (how === 'shorts') ctx.topicShorts.push(pr);
    }
  };
  if (!wantLong && !wantClips) {
    await takeThemes();
    return 'continue';
  }
  const style = host.style();
  const key = `${CACHE_VERSION}|${cfg.maxClips}|${wantLong ? 1 : 0}|${cands.map((c) => `${c.id}:${c.start}:${c.end}`).join(',')}|${all.map((c) => `${c.id}:${c.start}:${c.end}:${c.total}`).join(',')}`;
  const file = d.judgeDir ? path.join(d.judgeDir, `${vod.id}.studio.json`) : undefined;
  let saved: Saved | null = null;
  try {
    const s = file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Saved) : null;
    if (s?.key === key) saved = s;
  } catch {
    saved = null;
  }

  const agents: StudioProject['agents'] = [];
  const say = (id: AgentId, ok: boolean, note: string) => agents.push({ id, ok, note });
  const fail = (e: unknown): string => {
    if (isCancelled(e)) throw e;
    return (e as Error).message.split('\n')[0];
  };
  const ask = (system: string, user: string, temperature: number) => askJson(conf, system, user, { fetchFn: d.llmFetch, temperature });

  let plan: DirectorPlan | null = saved?.plan ?? null;
  let trims: Trim[] = saved?.trims ?? [];
  let clips: FunnyClip[] = saved?.clips ?? [];
  let review: ChiefReview | null = saved?.review ?? null;

  if (!saved) {
    // los tres editores trabajan a la vez sobre los mismos momentos
    const [rPlan, rTrims, rClips] = await Promise.allSettled([
      wantLong
        ? ask(
            useScenes ? DIRECTOR_SYSTEM + HISTORIA_EXTRA : DIRECTOR_SYSTEM,
            directorPrompt({
              vodTitle: vod.title ?? '',
              dateLabel: new Date(vod.streamStartedAt ?? vod.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }),
              categories: category ? [category] : [...new Set(ctx.cats.map((c) => c.title))],
              minSec: style.longMinSec,
              maxSec: Math.min(style.longMaxSec, SUMMARY_MAX_SEC),
              candidates: cands,
              style: { titleStyle: style.titleStyle, lore: style.lore },
            }),
            0.3,
          ).then((raw) => parseDirectorPlan(raw, cands))
        : Promise.resolve(null),
      wantLong ? ask(RITMO_SYSTEM, ritmoPrompt(cands), 0.2).then((raw) => parseTrims(raw, cands)) : Promise.resolve([] as Trim[]),
      wantClips ? ask(HUMOR_SYSTEM, humorPrompt(all, Math.max(cfg.maxClips, 3)), 0.4).then((raw) => parseFunny(raw, all, cfg.maxClips)) : Promise.resolve([] as FunnyClip[]),
    ]);
    if (rPlan.status === 'fulfilled') plan = rPlan.value;
    else say('historia', false, fail(rPlan.reason));
    if (rTrims.status === 'fulfilled') trims = rTrims.value;
    else say('ritmo', false, fail(rTrims.reason));
    if (rClips.status === 'fulfilled') clips = rClips.value;
    else say('humor', false, fail(rClips.reason));
  }

  // ── vídeo resumen: historia + ritmo, y revisión del jefe ──
  const outputs: ProjectOutput[] = [];
  if (wantLong && plan) {
    const trimmed = applyTrims(cands, trims);
    let p = rebasePlan(plan, trims, HOOK.minSec);
    const limits = { minSec: style.longMinSec, maxSec: Math.min(style.longMaxSec, SUMMARY_MAX_SEC), floorSec: MIN_SUMMARY_SEC };
    let cut = directedCut(p, trimmed, limits);
    if (cut && !saved) {
      task.update(67, 'Estudio de edición: el jefe de edición revisa el montaje…');
      try {
        review = parseChief(await ask(JEFE_SYSTEM, jefePrompt(p, trimmed, clips, { minSec: style.longMinSec, maxSec: Math.min(style.longMaxSec, SUMMARY_MAX_SEC), totalSec: cut.totalSec }), 0.2), p);
      } catch (e) {
        say('jefe', false, fail(e));
      }
    }
    let dropped = 0;
    if (cut && review) {
      const applied = applyChief(p, review);
      const cut2 = directedCut(applied.plan, trimmed, limits);
      // si al quitar lo que dice el jefe el vídeo se queda corto, manda el montaje original
      if (cut2) {
        p = applied.plan;
        cut = cut2;
        dropped = applied.dropped;
      }
    }
    if (cut) {
      const labels = new Map<number, string>();
      cut.labels.forEach((l, i) => l && labels.set(Math.round(cut!.segs[i].start), l));
      const used = trimmed.filter((c) => p.chapters.some((ch) => ch.ids.includes(c.id)));
      const avg = used.reduce((a, c) => a + c.total / used.length, 0);
      ctx.directed = {
        title: p.title,
        description: p.description,
        segs: cut.segs,
        labelsByIndex: cut.labels,
        chapterLabels: labels,
        coverText: p.coverText || undefined,
        captions: cut.captions,
        meta: { score: Math.round(avg * 10) / 10, kind: 'dirigido', reason: (review?.notes || p.reason || `Estructura de ${p.chapters.length} capítulos decidida por el estudio de edición.`).slice(0, 200) },
      };
      const saving = Math.round(sumSec(cands.filter((c) => trims.some((t) => t.id === c.id))) - sumSec(trimmed.filter((c) => trims.some((t) => t.id === c.id))));
      say('historia', true, `«${p.title || 'sin título'}»: ${p.chapters.length} capítulos (${p.chapters.map((c) => c.title).join(' · ')})${p.hook ? ', con gancho' : ', sin gancho'}.`);
      if (!agents.some((a) => a.id === 'ritmo')) say('ritmo', true, trims.length ? `${trims.length} momento(s) recortados, ${saving} s de aire fuera.` : 'Nada que recortar.');
      if (review) say('jefe', true, `${review.approved && !dropped ? 'Aprobado' : `Corregido${dropped ? `: ${dropped} momento(s) fuera` : ''}`}${review.notes ? `. ${review.notes}` : ''}`);
      outputs.push({ kind: 'resumen', title: p.title, video: cut.segs.map((s, i) => ({ start: s.start, end: s.end, ...(cut!.labels[i] ? { label: cut!.labels[i] } : {}) })), captions: cut.captions.map((c) => ({ at: c.at, text: c.text, kind: c.kind })), totalSec: Math.round(cut.totalSec), ...(review?.notes ? { note: review.notes } : {}) });
    } else if (!agents.some((a) => a.id === 'historia')) say('historia', false, 'No hay material suficiente para un vídeo con estructura; se monta el resumen de siempre.');
  } else if (wantLong && !agents.some((a) => a.id === 'historia')) say('historia', false, 'No devolvió una estructura válida; se monta el resumen de siempre.');

  // ── clips graciosos: primero los del editor de humor; después, hasta el máximo, los elegidos por nota que no se pisen ──
  if (wantClips && clips.length) {
    const byNote = ctx.moments;
    const funny = clips.slice(0, cfg.maxClips).map((c) => {
      const seg = { start: c.start, end: c.end, peak: (c.start + c.end) / 2, score: c.fun, reasons: ['gracia'] };
      if (c.title) (ctx.clipTitles ??= new Map()).set(seg, c.title);
      ctx.meta.set(seg, { score: c.fun, kind: 'gracia', reason: `Editor de humor: ${c.why || c.title || 'hace gracia sin contexto'}`.slice(0, 200) });
      return seg;
    });
    const rest = byNote.filter((m) => !funny.some((f) => overlaps(f, m))).slice(0, Math.max(0, cfg.maxClips - funny.length));
    ctx.moments = [...funny, ...rest];
    say('humor', true, `${funny.length} clip(s) gracioso(s): ${clips.slice(0, funny.length).map((c) => `«${c.title || c.id}» (${c.fun}/10)`).join(', ')}.`);
    for (const c of clips.slice(0, funny.length)) outputs.push({ kind: 'clip', title: c.title, video: [{ start: c.start, end: c.end }], captions: [], totalSec: Math.round(c.end - c.start), note: c.why });
  } else if (wantClips && !agents.some((a) => a.id === 'humor')) say('humor', true, 'Ningún momento hace gracia de verdad fuera de contexto; se quedan los clips elegidos por nota.');

  // ── vídeos por tema: escenas del mismo asunto aunque estén separadas en el tiempo; también van al proyecto ──
  await takeThemes();
  for (const t of [...ctx.topicLongs, ...ctx.askProposals]) outputs.push({ kind: 'tema', title: t.title, video: t.long.segs.map((s) => ({ start: s.start, end: s.end })), captions: [], totalSec: Math.round(t.long.sec), note: t.context.slice(0, 200) });

  if (wantLong && useScenes) notes.push(`Escenas con contexto: ${picks.length} momentos agrupados en ${cands.length} escenas continuas (${Math.round(sumSec(cands) / 60)} min de material).`);
  notes.push(`Estudio de edición: ${agents.map((a) => `${AGENT_LABEL[a.id]}${a.ok ? '' : ' (sin respuesta)'}: ${a.note}`).join(' ')}`);
  if (file) {
    const project: StudioProject = { version: 1, vodId: vod.id, createdAt: new Date().toISOString(), outputs, agents };
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // solo se guarda como caché si los agentes pedidos respondieron; si no, la próxima vez se vuelve a intentar
      const complete = agents.every((a) => a.ok);
      fs.writeFileSync(file, JSON.stringify({ key: complete ? key : '', plan, trims, clips, review, project } satisfies Saved));
    } catch (e) {
      d.log.warn(`No se pudo guardar el proyecto del estudio: ${(e as Error).message}`);
    }
  }
  return 'continue';
};

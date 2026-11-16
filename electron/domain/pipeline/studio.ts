import fs from 'node:fs';
import path from 'node:path';
import { DIRECTOR_SYSTEM, HOOK, directedCut, directorCandidates, directorPrompt, parseDirectorPlan, type DirectorPlan } from '../../../shared/director';
import {
  AGENT_LABEL,
  EQUIPO_BRIEF,
  FUNNY,
  VIRAL_GROUP,
  HISTORIA_EXTRA,
  HUMOR_SYSTEM,
  JEFE_SYSTEM,
  RITMO_SYSTEM,
  applyChief,
  applyTrims,
  fillPlan,
  humorPrompt,
  jefePrompt,
  parseChief,
  parseFunny,
  parseTrims,
  rebasePlan,
  revisionNote,
  ritmoPrompt,
  SCENE,
  sceneCandidate,
  sceneSpans,
  sumSec,
  teamNotes,
  type AgentId,
  type ChiefReview,
  type FunnyClip,
  type ProjectOutput,
  type StudioProject,
  type Trim,
} from '../../../shared/studio';
import { mergeWords } from '../../../shared/subtitles';
import { MUTED_SHARE, silentShare, snapToSentences, type Seg } from '../../../shared/highlights';
import { judgeText, type Judged } from '../../../shared/judge';
import { decideFormat, type ThemeProposal } from '../../../shared/themes';
import os from 'node:os';
import { askJson, forTask, lanesFor, MIN_INTERVAL_MS, visionConfig } from '../../services/llm';
import { AI_LABEL, type AiTask } from '../../../shared/llmRoles';
import { playbookFor, type PlaybookRole } from '../../../shared/editingPlaybook';
import { chronicleMap } from '../../../shared/chronicle';
import { lessonsText } from './lessons';
import { vodFrame } from '../../services/visualJudge';
import { isCancelled, throwIfCancelled } from '../../services/abort';
import { MIN_SUMMARY_SEC } from './judge';
import { directorPhase, singleCategory } from './director';
import type { Phase } from './context';

const CACHE_VERSION = 3;
/** Material de escenas que se prepara (y se transcribe con su contexto), en veces la duración máxima del resumen. */
const SCENE_BUDGET = 2.5;
/** Fotogramas que ve el jefe de edición (uno por escena, desde el principio del montaje). */
const JEFE_FRAMES = 5;
const JEFE_VE =
  ' Además VES un fotograma de los primeros momentos del montaje: si en alguno la imagen es una pantalla de espera («empezamos pronto», «vuelvo enseguida»), está en negro o no hay nada que ver, quítalo aunque el texto sea bueno; si se ve un gesto o algo llamativo, tenlo en cuenta a favor.';
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
  // el resumen es de TODO el directo (Diego: «un resumen de lo que ha pasado en el directo»), no solo de la categoría con
  // más material; las escenas no cruzan de una categoría a otra (chapterOf, más abajo)
  const picks = all;
  const category = ctx.multiCat ? undefined : singleCategory(all, ctx.cats, ctx.multiCat).category;
  // picos sueltos → escenas continuas con contexto (lo que hace que el vídeo se entienda); ver shared/studio.ts
  const chapterOf = (c: Seg) => ctx.cats.find((k) => c.start < k.end && c.end > k.start && Math.min(c.end, k.end) - Math.max(c.start, k.start) >= (c.end - c.start) / 2);
  // el contexto añadido puede caer en un trozo silenciado por Twitch: esa escena se queda fuera
  let spans = sceneSpans(picks, { ...SCENE, durationSec: ctx.duration }, ctx.multiCat ? chapterOf : undefined).filter((s) => silentShare(ctx.sig.energyDb, s) < MUTED_SHARE);
  // Transcribir el contexto es lo más lento del análisis: solo se hace con las mejores escenas, hasta 2,5 veces la duración
  // del vídeo (material de sobra para elegir). El resto no se pierde: sus momentos siguen sirviendo para clips y temas.
  let spare: typeof picks = [];
  {
    const best = (s: (typeof spans)[number]) => Math.max(...s.members.map((m) => m.total));
    const budget = host.style().longMaxSec * SCENE_BUDGET;
    const keep = new Set<(typeof spans)[number]>();
    let acc = 0;
    for (const s of [...spans].sort((a, b) => best(b) - best(a))) {
      if (acc >= budget && keep.size >= 6) break;
      keep.add(s);
      acc += s.end - s.start;
    }
    spare = spans.filter((s) => !keep.has(s)).flatMap((s) => s.members);
    spans = spans.filter((s) => keep.has(s));
  }
  let sceneWords = words;
  if (cfg.director !== false && cfg.maxVideos > 0 && spans.length) {
    try {
      // con el análisis rápido solo están transcritos los picos: hay que transcribir el contexto que se añade
      await d.transcripts.ensure(vod.id, spans.map((s) => ({ start: s.start, end: s.end })));
      sceneWords = mergeWords(d.transcripts.words(vod.id), ctx.skim ?? []);
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
    ? spans.map((s, i): Judged => {
        const best = [...s.members].sort((a, b) => b.total - a.total)[0];
        const base = byPick.get(best.id)!;
        const { trim: _t, ...judgement } = base.judgement;
        return { ...base, id: scenes[i].id, start: s.start, end: s.end, total: scenes[i].total, judgement: { ...judgement, title: scenes[i].title } };
      }).concat(spare.flatMap((m) => (byPick.get(m.id) ? [byPick.get(m.id)!] : [])))
    : ctx.judged;
  const quantity = cfg.quantityFirst !== false;
  const lessons = lessonsText(d);
  const map = chronicleMap(ctx.chronicle ?? []);
  const themesJob: Promise<{ v: ThemeProposal[] } | { e: unknown }> = wantThemes
    ? host.findThemes(vod, themeUnits, sceneWords, forTask(conf, 'themes'), notes, {
        chars: useScenes ? 900 : 380,
        minLongSec: THEME_VIDEO.minSec,
        hardCapSec: THEME_VIDEO.maxSec,
        extraSystem: EQUIPO_BRIEF + playbookFor('temas') + lessons + map,
        max: quantity ? Math.max(3, cfg.maxVideos - 1) : 3,
      }).then((v) => ({ v }), (e: unknown) => ({ e }))
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
  // cada editor pregunta a su IA titular (shared/llmRoles.ts); las demás quedan de relevo
  const relays = new Set<string>();
  // cada editor recibe el encargo común del estudio, el manual de su puesto y lo que el equipo ha aprendido del streamer
  const role: Record<AiTask, Exclude<PlaybookRole, 'comun'>> = { story: 'historia', humor: 'humor', chief: 'jefe', themes: 'temas', titles: 'titulos', judge: 'historia', vision: 'jefe', chronicle: 'cronista' };
  const ask = (system: string, user: string, temperature: number, who: AiTask, roleOf: Exclude<PlaybookRole, 'comun'> = role[who]) =>
    askJson(forTask(conf, who), system + EQUIPO_BRIEF + playbookFor(roleOf) + lessons, user, { fetchFn: d.llmFetch, temperature, onRelay: (by, covered) => relays.add(`${AI_LABEL[by]} cubrió a ${AI_LABEL[covered]}`) });

  let plan: DirectorPlan | null = saved?.plan ?? null;
  let trims: Trim[] = saved?.trims ?? [];
  let clips: FunnyClip[] = saved?.clips ?? [];
  let review: ChiefReview | null = saved?.review ?? null;
  // Editor de clips virales: con muchos momentos, se reparten en grupos que las IAs leen A LA VEZ (cada una a su ritmo);
  // cada grupo propone sus mejores clips y al final se quedan los de más potencial viral de todo el directo
  const viralClips = async (): Promise<FunnyClip[]> => {
    const groups: (typeof all)[] = [];
    for (let i = 0; i < all.length; i += VIRAL_GROUP) groups.push(all.slice(i, i + VIRAL_GROUP));
    const want = Math.max(cfg.maxClips, 3);
    const per = groups.length > 1 ? Math.max(3, Math.ceil((want * 1.5) / groups.length)) : want;
    const minFun = quantity ? FUNNY.minFun - 1 : FUNNY.minFun;
    const minViral = quantity ? FUNNY.minViral - 1 : FUNNY.minViral;
    const lanes = lanesFor(conf, 'humor');
    const found: FunnyClip[][] = groups.map(() => []);
    let ok = 0;
    let lastError: unknown = null;
    await Promise.all(
      lanes.map(async (lane, li) => {
        for (let g = li, first = true; g < groups.length; g += lanes.length, first = false) {
          throwIfCancelled();
          if (!first) await new Promise<void>((r) => setTimeout(r, MIN_INTERVAL_MS[lane.provider]));
          try {
            const raw = await askJson(lane, HUMOR_SYSTEM + EQUIPO_BRIEF + playbookFor('humor') + lessons, humorPrompt(groups[g], per), {
              fetchFn: d.llmFetch,
              temperature: 0.4,
              onRelay: (by, covered) => relays.add(`${AI_LABEL[by]} cubrió a ${AI_LABEL[covered]}`),
            });
            found[g] = parseFunny(raw, groups[g], per, minFun, minViral);
            ok++;
          } catch (e) {
            if (isCancelled(e)) throw e;
            lastError = e;
          }
        }
      }),
    );
    if (!ok && lastError) throw lastError;
    return found.flat().sort((a, b) => b.viral - a.viral || b.fun - a.fun).slice(0, cfg.maxClips);
  };
  const historiaSystem = useScenes ? DIRECTOR_SYSTEM + HISTORIA_EXTRA : DIRECTOR_SYSTEM;
  let historiaPrompt = '';

  if (!saved) {
    // 1) ritmo, humor y temas trabajan a la vez sobre los mismos momentos
    const [rTrims, rClips, rThemes] = await Promise.allSettled([
      wantLong ? ask(RITMO_SYSTEM, ritmoPrompt(cands), 0.2, 'humor', 'ritmo').then((raw) => parseTrims(raw, cands)) : Promise.resolve([] as Trim[]),
      wantClips ? viralClips() : Promise.resolve([] as FunnyClip[]),
      themesJob,
    ]);
    // 2) reunión: lo que han visto los compañeros se le pasa al editor de historia antes de que monte el resumen
    const sceneOf = (t: Seg) => cands.find((c) => t.start < c.end && t.end > c.start)?.id;
    const funnyNow = rClips.status === 'fulfilled' ? rClips.value : [];
    const themesNow = rThemes.status === 'fulfilled' && 'v' in rThemes.value ? rThemes.value.v : [];
    const candIds = new Set(cands.map((c) => c.id));
    const briefing = teamNotes({
      funny: funnyNow.flatMap((f) => {
        const id = sceneOf(f);
        return id ? [{ sceneId: id, title: f.title, fun: f.fun }] : [];
      }).slice(0, 6),
      themes: themesNow.map((t) => ({ title: t.title, sceneIds: [...new Set(t.pieces.map((p) => p.id).filter((id) => candIds.has(id)))] })),
      trimmed: rTrims.status === 'fulfilled' ? rTrims.value.length : 0,
    });
    historiaPrompt =
      directorPrompt({
        vodTitle: vod.title ?? '',
        dateLabel: new Date(vod.streamStartedAt ?? vod.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' }),
        categories: category ? [category] : [...new Set(ctx.cats.map((c) => c.title))],
        minSec: style.longMinSec,
        maxSec: Math.min(style.longMaxSec, SUMMARY_MAX_SEC),
        candidates: cands,
        style: { titleStyle: style.titleStyle, lore: style.lore },
      }) +
      briefing +
      map;
    if (briefing) say('equipo', true, `Reunión de edición: el editor de historia montó el resumen con las notas de ${[funnyNow.length ? 'humor' : '', themesNow.length ? 'temas' : '', rTrims.status === 'fulfilled' && rTrims.value.length ? 'ritmo' : ''].filter(Boolean).join(', ')}.`);
    // 3) el editor de historia monta el resumen
    const [rPlan] = await Promise.allSettled([wantLong ? ask(historiaSystem, historiaPrompt, 0.3, 'story').then((raw) => parseDirectorPlan(raw, cands)) : Promise.resolve(null)]);
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
        const prompt = jefePrompt(p, trimmed, clips, { minSec: style.longMinSec, maxSec: Math.min(style.longMaxSec, SUMMARY_MAX_SEC), totalSec: cut.totalSec });
        // el jefe también MIRA el montaje: un fotograma del centro de cada escena (hasta 5, el límite de Groq por petición)
        let raw: unknown = null;
        if (cfg.vodVision !== false && vod.filePath && fs.existsSync(vod.filePath)) {
          const ids = p.chapters.flatMap((ch) => ch.ids).slice(0, JEFE_FRAMES);
          const tmpDir = path.join(os.tmpdir(), `streamclips-jefe-${vod.id}`);
          try {
            fs.mkdirSync(tmpDir, { recursive: true });
            const images: string[] = [];
            for (const id of ids) {
              const c = trimmed.find((x) => x.id === id);
              if (c) images.push(await vodFrame(d.tools().ffmpeg, vod.filePath, (c.start + c.end) / 2, tmpDir));
            }
            if (images.length) raw = await askJson(visionConfig(conf), JEFE_SYSTEM + JEFE_VE + EQUIPO_BRIEF + playbookFor('jefe') + lessons, `${prompt}\nFotogramas adjuntos, uno por momento y en este orden: ${ids.join(', ')}.`, { fetchFn: d.llmFetch, temperature: 0.2, images });
          } catch (e) {
            if (isCancelled(e)) throw e;
            raw = null; // sin vista (modelo sin imágenes, límite…): revisa solo con el texto
          } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          }
        }
        review = parseChief(raw ?? (await ask(JEFE_SYSTEM, prompt, 0.2, 'chief')), p);
      } catch (e) {
        say('jefe', false, fail(e));
      }
    }
    // 4) vuelta de correcciones: si el jefe no aprueba el montaje, vuelve al editor de historia con sus notas (una sola vez)
    let revised = false;
    if (cut && review && !review.approved && !saved && historiaPrompt) {
      task.update(68, 'Estudio de edición: el editor de historia aplica las correcciones del jefe…');
      try {
        const again = parseDirectorPlan(await ask(historiaSystem, historiaPrompt + revisionNote(review), 0.3, 'story'), cands);
        const p2 = again ? rebasePlan(again, trims, HOOK.minSec) : null;
        const cut2 = p2 ? directedCut(p2, trimmed, limits) : null;
        if (again && p2 && cut2) {
          plan = again;
          p = p2;
          cut = cut2;
          revised = true;
          say('equipo', true, `Vuelta de correcciones: el jefe no aprobó el primer montaje («${review.notes || 'sin motivo'}») y el editor de historia lo rehízo.`);
          review = { ...review, approved: true, drop: [] };
        }
      } catch (e) {
        if (isCancelled(e)) throw e;
      }
    }
    // si el editor de historia se quedó corto, se completan los capítulos con las mejores escenas que no usó, cada una en el
    // capítulo más cercano en el tiempo, hasta llegar a la duración mínima del resumen
    if (cut && cut.totalSec < style.longMinSec * 0.9) {
      const filled = fillPlan(p, trimmed, style.longMinSec, Math.max(0, (cfg.minQuality ?? 5) - 1));
      const cutF = filled.added ? directedCut(filled.plan, trimmed, limits) : null;
      if (cutF && cutF.totalSec > cut.totalSec) {
        notes.push(`El editor de historia se quedó en ${Math.round(cut.totalSec / 60)} min; se añadieron ${filled.added} escena(s) que no había usado hasta ${Math.round(cutF.totalSec / 60)} min.`);
        p = filled.plan;
        cut = cutF;
      }
    }
    let dropped = 0;
    if (cut && review && !revised) {
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

  // ── clips para redes: primero los del editor de clips virales (del más viral al menos); después, hasta el máximo, los elegidos por nota que no se pisen ──
  if (wantClips && clips.length) {
    const byNote = ctx.moments;
    const funny = clips.slice(0, cfg.maxClips).map((c) => {
      const seg = { start: c.start, end: c.end, peak: (c.start + c.end) / 2, score: c.viral, reasons: ['viral'] };
      if (c.title) (ctx.clipTitles ??= new Map()).set(seg, c.title);
      ctx.meta.set(seg, { score: c.viral, kind: c.fun >= c.viral ? 'gracia' : 'viral', reason: `Editor de clips virales: ${c.why || c.title || 'engancha sin contexto'}`.slice(0, 200) });
      return seg;
    });
    const rest = byNote.filter((m) => !funny.some((f) => overlaps(f, m))).slice(0, Math.max(0, cfg.maxClips - funny.length));
    ctx.moments = [...funny, ...rest];
    say('humor', true, `${funny.length} clip(s) para redes, del más viral al menos: ${clips.slice(0, funny.length).map((c) => `«${c.title || c.id}» (viral ${c.viral}/10)`).join(', ')}.`);
    for (const c of clips.slice(0, funny.length)) outputs.push({ kind: 'clip', title: c.title, video: [{ start: c.start, end: c.end }], captions: [], totalSec: Math.round(c.end - c.start), note: c.why });
  } else if (wantClips && !agents.some((a) => a.id === 'humor')) say('humor', true, 'Ningún momento tiene potencial viral fuera de contexto; se quedan los clips elegidos por nota.');

  // ── vídeos por tema: escenas del mismo asunto aunque estén separadas en el tiempo; también van al proyecto ──
  await takeThemes();
  for (const t of [...ctx.topicLongs, ...ctx.askProposals]) outputs.push({ kind: 'tema', title: t.title, video: t.long.segs.map((s) => ({ start: s.start, end: s.end })), captions: [], totalSec: Math.round(t.long.sec), note: t.context.slice(0, 200) });

  if (wantLong && useScenes) notes.push(`Escenas con contexto: ${picks.length - spare.length} momentos agrupados en ${cands.length} escenas continuas (${Math.round(sumSec(cands) / 60)} min de material)${spare.length ? `; ${spare.length} momentos más flojos se dejaron sin contexto para no alargar la transcripción` : ''}.`);
  if (relays.size) say('equipo', true, `Relevos entre IAs: ${[...relays].join('; ')}.`);
  notes.push(`Estudio de edición: ${agents.map((a) => `${AGENT_LABEL[a.id]}${a.ok ? '' : ' (sin respuesta)'}: ${a.note}`).join(' ')}`);
  // con resumen dirigido o vídeos por tema, sobran los tramos seguidos «Parte N»: no tienen un tema como centro
  if ((ctx.directed || ctx.topicLongs.length) && ctx.mains.length) {
    notes.push(`Se omiten ${ctx.mains.length} vídeo(s) de tramo seguido: ya hay resumen o vídeos por tema.`);
    ctx.mains = [];
  }
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

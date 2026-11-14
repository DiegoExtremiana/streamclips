import { planEdit, planLong, withJoints, withMusic, withTitles } from '../../../shared/autoEdit';
import { chapterBlock, outputStarts } from '../../../shared/chapters';
import { shortTitle, type Seg } from '../../../shared/highlights';
import { seriesFor, seriesTitles } from '../../../shared/series';
import { withCategoryLine } from '../../../shared/categories';
import { TITLE, type AutoRole, type OutputItem } from '../../../shared/types';
import type { ThemeProposal } from '../../../shared/themes';
import { isCancelled } from '../../services/abort';
import type { MomentMeta, Phase, RunContext, Titles } from './context';

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Descripción del vídeo temático: de qué va y los capítulos de su estructura. */
export function themeDescription(p: ThemeProposal): string {
  const parts = [p.context || `Todo lo que se habló sobre «${p.title}» durante el directo.`];
  return parts.join('\n\n');
}

/** Fase 4: títulos y descripciones (con el modelo si lo hay) y, si el directo es una serie, el día que le toca. */
export const titlesPhase: Phase = async (ctx) => {
  const { host, vod, task, notes, words } = ctx;
  const cfg = host.cfg;
  ctx.clock.mark('títulos');
  task.update(75, 'Poniendo títulos…');
  ctx.titles = await host.titles(vod, words, ctx.moments, ctx.mains, notes);
  // serie de varios días: «Minecraft extremo Día 1»; el tema concreto de cada vídeo pasa a la descripción
  const ser = cfg.maxVideos > 0 ? seriesFor(vod.title ?? '', { ...cfg.series, nextDay: vod.seriesDay ?? cfg.series.nextDay }) : null;
  if (ser) {
    const st = seriesTitles(ser, ctx.mains.length);
    ctx.titles.summary = { title: clean(st.summary, 100), description: ctx.titles.summary.description };
    ctx.titles.mains = ctx.titles.mains.map((t, i) => ({ title: clean(st.mains[i], 100), description: t.description || `En este vídeo: ${t.title}` }));
    notes.push(`Serie «${ser.name}», día ${ser.day}.`);
    if (!ser.fromTitle) {
      // el día se reserva ya: con varios directos a la vez, dos no pueden coger el mismo número; al repetir este directo conserva el suyo
      vod.seriesDay = ser.day;
      cfg.series.nextDay = Math.max(cfg.series.nextDay, ser.day + 1);
      host.d.store.save();
    }
  }
  return 'continue';
};

/**
 * Fase 5: montaje. Cada vídeo o clip se monta con la edición profesional (cortes de silencio, acercamientos, sonidos, música,
 * subtítulos) y, si esa edición falla, sin ella. Lo creado queda pendiente de revisión con su nota y su motivo.
 */
export const renderPhase: Phase = async (ctx) => {
  const { host, vod, task, notes, words } = ctx;
  const d = host.d;
  const cfg = host.cfg;
  const tr = Date.now();
  ctx.clock.mark('montaje');
  host.mark(vod, 'rendering');
  const { moments, mains, topicLongs, topicShorts, titles } = ctx;
  const summary = ctx.directed ? [] : ctx.summary;
  const total = (summary.length ? 1 : 0) + (ctx.directed ? 1 : 0) + mains.length + topicLongs.length + topicShorts.reduce((n, p) => n + p.shorts.length, 0) + moments.length;
  let doneCount = 0;
  /** Capítulos con marca de tiempo para la descripción del resumen (como los vídeos de los canales grandes). */
  const chapterOf = new Map<string, string>();
  const step = async (role: AutoRole, label: string, fn: () => Promise<OutputItem>, t: Titles, m?: MomentMeta) => {
    try {
      const item = await fn();
      item.auto = { role, review: 'pending', ...(m ? { score: Math.round(m.score * 10) / 10, kind: m.kind, reason: m.reason } : {}) };
      item.titleSource = 'auto';
      item.visibility = cfg.visibility;
      const ch = chapterOf.get(item.id);
      if (t.description || item.category || ch) {
        const base = withCategoryLine(t.description, item.category);
        d.library.setAutoDescription(item.id, ch ? `${base}${base ? '\n\n' : ''}${ch}` : base);
      }
      d.store.save();
      ctx.created.push(item);
    } catch (e) {
      if (isCancelled(e)) throw e;
      ctx.errors.push(`${label}: ${(e as Error).message}`);
    }
    task.update(76 + (++doneCount / total) * 19, `Montando (${doneCount}/${total})…`);
  };
  const pro = cfg.proEdit !== false && words.length > 0;
  if (cfg.proEdit !== false && !words.length) notes.push('Edición profesional omitida: no hay transcripción.');
  const subs = cfg.subtitles ? { subtitles: cfg.subtitles } : {};
  // si la edición profesional falla (efecto no válido, ffmpeg…), el vídeo se monta igualmente sin ella
  const safely = async <T>(edited: boolean, withEdit: () => Promise<T>, plain: () => Promise<T>): Promise<T> => {
    if (!edited) return plain();
    try {
      return await withEdit();
    } catch (err) {
      if (isCancelled(err)) throw err;
      d.log.warn(`Edición profesional falló, se monta sin ella: ${(err as Error).message.split('\n')[0]}`);
      return plain();
    }
  };
  // los silencios de más de lo que dijo el creador (2 s por defecto) se cortan; su estilo manda sobre el criterio general
  const style = host.style();
  const editOpts = { minGap: style.silenceMaxSec, cues: cfg.soundCues !== false };
  const musicFor = (title: string, segs: Seg[], smart: boolean) => host.musicFor(vod, words, title, segs, smart, ctx.llmConf);
  const longMake = async (title: string, segs: Seg[], o: { chapters?: boolean; themed?: boolean; labels?: Map<number, string>; labelsByIndex?: string[]; coverText?: string; captions?: NonNullable<RunContext['directed']>['captions'] } = {}) => {
    let e = pro ? planLong(words, segs, editOpts) : null;
    if (e && o.themed) e = { ...e, effects: withJoints(e.effects) };
    const mood = e ? await musicFor(title, segs, true) : null;
    if (e && mood) e = { ...e, effects: withMusic(e.effects, mood) };
    // los rótulos caen donde empieza algo; si eso cayó en un silencio cortado, se mueven al principio del trozo conservado siguiente
    if (e && o.captions?.length) {
      const kept = e.segments;
      const snap = (at: number): number | null => {
        if (kept.some((r) => at >= r.start && at <= r.end)) return at;
        const next = kept.filter((r) => r.start > at).sort((a, b) => a.start - b.start)[0];
        return next && next.start - at < 30 ? next.start + 0.1 : null;
      };
      const titles = o.captions.flatMap((c) => {
        const at = snap(c.at);
        return at === null ? [] : [{ type: 'title' as const, at, text: c.text, kind: c.kind, ...(c.duration ? { duration: Math.min(TITLE.maxDur, Math.max(TITLE.minDur, c.duration)) } : {}) }];
      });
      e = { ...e, effects: withTitles(e.effects, titles) };
    }
    const extra = o.coverText ? { coverText: o.coverText } : {};
    const item = await safely(
      Boolean(e),
      () => d.clips.createLong(vod.id, { title, segments: e!.segments, effects: e!.effects, ...subs, ...extra }),
      () => d.clips.createLong(vod.id, { title, segments: segs, ...subs, ...extra }),
    );
    const labels = o.labels ?? ctx.chapterLabels;
    if (o.chapters && segs.length >= 3) {
      try {
        const starts = outputStarts(segs, item.segments ?? segs);
        // con etiquetas por tramo (director), los tramos sin etiqueta continúan el capítulo anterior y no abren uno nuevo
        const block = chapterBlock(
          segs.map((g, i) => ({ at: starts[i], label: o.labelsByIndex ? (o.labelsByIndex[i] ?? '') : (labels.get(Math.round(g.start)) ?? (i === 0 ? 'Inicio' : shortTitle(words, g, i) || `Momento ${i + 1}`)) })),
          item.durationSec,
        );
        if (block) chapterOf.set(item.id, block);
      } catch (err) {
        d.log.warn(`Sin capítulos en "${title}": ${(err as Error).message}`);
      }
    }
    return item;
  };
  if (ctx.directed) {
    const p = ctx.directed;
    const title = p.title || titles.summary.title;
    await step('summary', 'vídeo dirigido', () => longMake(title, p.segs, { chapters: true, themed: true, labels: p.chapterLabels, labelsByIndex: p.labelsByIndex, coverText: p.coverText, captions: p.captions }), { title, description: p.description || titles.summary.description }, p.meta);
  }
  if (summary.length) await step('summary', 'resumen', () => longMake(titles.summary.title, summary, { chapters: true }), titles.summary, ctx.summaryMeta);
  for (const [i, m] of mains.entries()) {
    const t = titles.mains[i];
    await step('main', `vídeo ${i + 1}`, () => longMake(t.title, [m]), t);
  }
  for (const p of topicLongs) {
    const t: Titles = { title: clean(p.title, 100), description: themeDescription(p) };
    for (const piece of p.pieces) if (piece.title) ctx.chapterLabels.set(Math.round(piece.start), piece.title);
    await step('main', `tema «${p.title}»`, () => longMake(t.title, p.long.segs, { chapters: true, themed: true }), t, { score: 8, kind: 'tema', reason: `Tema recurrente: ${p.context || p.title}`.slice(0, 200) });
  }
  for (const p of topicShorts) {
    for (const sh of p.shorts) {
      const t: Titles = { title: clean(sh.title, 100), description: p.context };
      await step('clip', `corto «${sh.title}»`, () => host.makeShort(vod.id, words, ctx.llmConf, sh.title, sh.segs[0], subs), t, { score: 7.5, kind: 'tema', reason: `Parte del tema «${p.title}».` });
    }
  }
  for (const [i, m] of moments.entries()) {
    const t = titles.clips[i];
    let e = pro ? planEdit(words, m, editOpts) : null;
    const mood = e ? await musicFor(t.title, [m], false) : null;
    if (e && mood) e = { ...e, effects: withMusic(e.effects, mood) };
    await step('clip', `clip ${i + 1}`, () => safely(Boolean(e), () => d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, cuts: e!.cuts, effects: e!.effects, ...subs }), () => d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, ...subs })), t, ctx.meta.get(m));
  }
  if (!ctx.created.length) throw new Error(`No se pudo montar ningún vídeo. ${ctx.errors.join(' ')}`);
  ctx.renderStarted = tr;
  return 'continue';
};

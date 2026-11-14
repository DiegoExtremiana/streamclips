import { CHANNELS } from '../../../shared/types';
import type { IpcContext } from '../helpers';
import { num, str, obj } from '../helpers';

/** Tareas, Whisper y transcripciones, momentos, portadas, estilo, preferencias y hablantes. */
export function registerContent({ handle, ctx, platform }: IpcContext): void {
  handle(CHANNELS.tasksList, () => ctx.tasks.list());
  handle(CHANNELS.whisperStatus, () => ctx.transcripts.status());
  handle(CHANNELS.whisperModel, () => ctx.transcripts.downloadModel());
  handle(CHANNELS.transcriptGet, (vodId) => ctx.transcripts.words(str(vodId, 'vodId')));
  handle(CHANNELS.transcriptImport, async (vodId) => {
    const id = str(vodId, 'vodId');
    const file = await platform.pickTranscript();
    return file ? ctx.transcripts.importFile(id, file) : null;
  });
  handle(CHANNELS.clipContext, (id) => ctx.library.clipContext(str(id, 'id')));
  handle(CHANNELS.autoName, async () => (await ctx.autopilot.refreshLibraryAtStart({ generic: false })) ?? { renamed: 0, described: 0, noTranscript: 0, kept: 0 });
  handle(CHANNELS.suggestTitle, (vodId, start, end) => ctx.autopilot.suggestTitle(str(vodId, 'vodId'), num(start, 'start'), num(end, 'end')));
  handle(CHANNELS.transcriptRun, (vodId) => ctx.transcripts.transcribe(str(vodId, 'vodId')));
  handle(CHANNELS.transcriptEdit, (vodId, changes) => ctx.transcripts.editLines(str(vodId, 'vodId'), changes as never));
  handle(CHANNELS.vocabGet, () => ctx.transcripts.vocabulary());
  handle(CHANNELS.momentsGet, (v) => ctx.moments.list(str(v, 'vodId')));
  handle(CHANNELS.momentsState, (v, k, st) => {
    if (st !== 'include' && st !== 'exclude' && st !== 'reset') throw new Error('Estado no válido.');
    return ctx.moments.setState(str(v, 'vodId'), str(k, 'key'), st);
  });
  handle(CHANNELS.momentsTrim, (v, k, a, b) => ctx.moments.trim(str(v, 'vodId'), str(k, 'key'), num(a, 'start'), num(b, 'end')));
  handle(CHANNELS.momentsAdd, (v, a, b, t) => ctx.moments.add(str(v, 'vodId'), num(a, 'start'), num(b, 'end'), typeof t === 'string' ? t : undefined));
  handle(CHANNELS.momentsRemove, (v, k) => ctx.moments.remove(str(v, 'vodId'), str(k, 'key')));
  handle(CHANNELS.momentsClear, (v) => ctx.moments.clear(str(v, 'vodId')));
  handle(CHANNELS.coversList, () => ctx.covers.list());
  handle(CHANNELS.coversAdd, (n, d) => {
    if (!(d instanceof Uint8Array)) throw new Error('Parámetro no válido: archivo.');
    return ctx.covers.add(str(n, 'nombre'), Buffer.from(d));
  });
  handle(CHANNELS.coversRename, (id, n) => ctx.covers.rename(str(id, 'id'), str(n, 'nombre')));
  handle(CHANNELS.coversKind, (id, k) => ctx.covers.setKind(str(id, 'id'), k));
  handle(CHANNELS.coversRemove, (id) => ctx.covers.remove(str(id, 'id')));
  handle(CHANNELS.coversPreview, (id) => ctx.covers.preview(str(id, 'id')));
  handle(CHANNELS.coversCompose, (o) => {
    const r = obj(o, 'portada');
    return ctx.covers.compose({
      backgroundId: str(r.backgroundId, 'fondo'),
      subjectId: typeof r.subjectId === 'string' && r.subjectId ? r.subjectId : undefined,
      text: typeof r.text === 'string' ? r.text : '',
      badge: typeof r.badge === 'number' ? r.badge : null,
      name: typeof r.name === 'string' ? r.name : undefined,
    });
  });
  handle(CHANNELS.coversReveal, (id) => platform.showItem(ctx.covers.filePath(str(id, 'id'))));
  handle(CHANNELS.coversFull, (id) => ctx.covers.full(str(id, 'id')));
  handle(CHANNELS.designsList, () => ctx.coverDesigns.list());
  handle(CHANNELS.designsSave, (i) => {
    const r = obj(i, 'diseño');
    if (!(r.png instanceof Uint8Array)) throw new Error('Parámetro no válido: imagen.');
    return ctx.coverDesigns.save({ id: typeof r.id === 'string' && r.id ? r.id : null, name: typeof r.name === 'string' ? r.name : 'Portada', design: r.design, png: Buffer.from(r.png) });
  });
  handle(CHANNELS.designsRemove, (id, img) => ctx.coverDesigns.remove(str(id, 'id'), img === true));
  handle(CHANNELS.fontsList, () => ctx.coverDesigns.fontList());
  handle(CHANNELS.fontsAdd, (n, d) => {
    if (!(d instanceof Uint8Array)) throw new Error('Parámetro no válido: archivo.');
    return ctx.coverDesigns.fontAdd(str(n, 'nombre'), Buffer.from(d));
  });
  handle(CHANNELS.fontsRemove, (id) => ctx.coverDesigns.fontRemove(str(id, 'id')));
  handle(CHANNELS.fontsData, (id) => ctx.coverDesigns.fontData(str(id, 'id')));
  handle(CHANNELS.styleGet, () => ctx.style.get());
  handle(CHANNELS.styleSet, (p) => ctx.style.set(p));
  handle(CHANNELS.styleAddLore, (n, note, tr) => ctx.style.addLore(str(n, 'name'), typeof note === 'string' ? note : '', Array.isArray(tr) ? tr.filter((x): x is string => typeof x === 'string') : []));
  handle(CHANNELS.styleRemoveLore, (id) => ctx.style.removeLore(str(id, 'id')));
  handle(CHANNELS.styleReset, () => ctx.style.reset());
  handle(CHANNELS.prefsGet, () => ctx.moments.prefs());
  handle(CHANNELS.prefsEnabled, (on) => ctx.moments.setPrefsEnabled(on === true));
  handle(CHANNELS.prefsReset, () => ctx.moments.resetPrefs());
  handle(CHANNELS.speakersGet, () => ({ available: ctx.speakers.available(), profiles: ctx.speakers.profiles() }));
  handle(CHANNELS.speakersRename, (id, alias) => ctx.speakers.rename(num(id, 'id'), typeof alias === 'string' ? alias : ''));
  handle(CHANNELS.speakersSelf, (id) => ctx.speakers.setSelf(id === null ? null : num(id, 'id')));
  handle(CHANNELS.speakersMerge, (from, into) => ctx.speakers.merge(num(from, 'from'), num(into, 'into')));
  handle(CHANNELS.vocabSet, (v) => ctx.transcripts.setVocabulary(v));
  handle(CHANNELS.transcriptPrompt, async (vodId) => {
    const id = str(vodId, 'vodId');
    const dur = await ctx.clips.vodDuration(id);
    return ctx.transcripts.claudePrompt(id, dur);
  });

}

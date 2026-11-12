import type { Word } from '../../shared/subtitles';
import { textOf } from '../../shared/highlights';
import { MAX_LEN, MIN_LEN, momentKey, type MomentEdits } from '../../shared/momentEdits';
import { loadEdits, loadPrefs, loadSnapshot, saveEdits, savePrefs } from '../services/momentStore';
import { describePrefs, emptyPrefs, learn } from '../../shared/preferences';
import type { MomentKind } from '../../shared/judge';
import type { MomentRow, MomentsView, PrefsView } from '../../shared/types';

export interface MomentsDeps {
  dir: string;
  prefsFile: string;
  words: (vodId: string) => Word[];
  /** Duración del directo, para no aceptar tiempos fuera de él. */
  duration: (vodId: string) => number | undefined;
  exists: (vodId: string) => boolean;
}

/** Revisión manual de los momentos que eligió el piloto: ver nota y motivo, excluir, fijar, recortar y añadir. */
export class MomentsService {
  constructor(private readonly d: MomentsDeps) {}

  list(vodId: string): MomentsView {
    if (!this.d.exists(vodId)) throw new Error('El VOD no existe.');
    const snap = loadSnapshot(this.d.dir, vodId);
    const edits = loadEdits(this.d.dir, vodId);
    const words = snap || edits.extra.length ? this.d.words(vodId) : [];
    const chosen = new Set(snap?.chosen ?? []);
    const ex = new Set(edits.exclude);
    const pin = new Set(edits.pin);
    const rows: MomentRow[] = (snap?.items ?? []).map((i) => {
      const trim = edits.trims[i.key] ?? i.trim;
      const seg = trim ?? { start: i.start, end: i.end };
      return {
        key: i.key,
        start: seg.start,
        end: seg.end,
        total: Math.round(i.total * 10) / 10,
        kind: i.kind,
        reason: i.reason,
        title: i.title ?? '',
        text: textOf(words, seg.start, seg.end, 500),
        chosen: chosen.has(i.key),
        excluded: ex.has(i.key),
        pinned: pin.has(i.key),
        edited: Boolean(edits.trims[i.key]),
        manual: false,
        belowFloor: i.total < (snap?.quality ?? 0),
      };
    });
    for (const x of edits.extra) {
      const key = momentKey(x.start);
      rows.push({ key, start: x.start, end: x.end, total: 10, kind: 'otro', reason: 'Añadido por ti', title: x.title ?? '', text: textOf(words, x.start, x.end, 500), chosen: chosen.has(key), excluded: ex.has(key), pinned: false, edited: false, manual: true, belowFloor: false });
    }
    rows.sort((a, b) => a.start - b.start);
    const pending = this.countEdits(edits) > 0;
    return { available: Boolean(snap), quality: snap?.quality ?? null, rows, pending };
  }

  private countEdits(e: MomentEdits): number {
    return e.exclude.length + e.pin.length + Object.keys(e.trims).length + e.extra.length;
  }

  private mutate(vodId: string, f: (e: MomentEdits) => void): MomentsView {
    if (!this.d.exists(vodId)) throw new Error('El VOD no existe.');
    const e = loadEdits(this.d.dir, vodId);
    f(e);
    saveEdits(this.d.dir, vodId, e);
    return this.list(vodId);
  }

  private known(vodId: string, key: string): void {
    const inSnap = loadSnapshot(this.d.dir, vodId)?.items.some((i) => i.key === key);
    const inExtra = loadEdits(this.d.dir, vodId).extra.some((x) => momentKey(x.start) === key);
    if (!inSnap && !inExtra) throw new Error('Ese momento ya no existe: actualiza la lista.');
  }

  /** `include` lo fija (sale aunque no llegue a la nota), `exclude` lo descarta y `reset` quita ambas cosas y el recorte manual. */
  setState(vodId: string, key: string, state: 'include' | 'exclude' | 'reset'): MomentsView {
    this.known(vodId, key);
    if (state === 'exclude' || state === 'include') this.learnFrom(vodId, key, state);
    return this.mutate(vodId, (e) => {
      e.exclude = e.exclude.filter((k) => k !== key);
      e.pin = e.pin.filter((k) => k !== key);
      if (state === 'exclude') e.exclude.push(key);
      if (state === 'include') e.pin.push(key);
      if (state === 'reset') delete e.trims[key];
    });
  }

  /** Anota la decisión para aprender del tipo de momento; repetir la misma decisión sobre el mismo momento no cuenta dos veces. */
  private learnFrom(vodId: string, key: string, action: 'exclude' | 'include'): void {
    const e = loadEdits(this.d.dir, vodId);
    if (action === 'exclude' ? e.exclude.includes(key) : e.pin.includes(key)) return;
    const item = loadSnapshot(this.d.dir, vodId)?.items.find((i) => i.key === key);
    if (!item) return;
    // incluir algo que ya estaba elegido no dice nada nuevo
    if (action === 'include' && loadSnapshot(this.d.dir, vodId)?.chosen.includes(key)) return;
    // descartar algo que ni siquiera estaba elegido tampoco
    if (action === 'exclude' && !loadSnapshot(this.d.dir, vodId)?.chosen.includes(key)) return;
    try {
      savePrefs(this.d.prefsFile, learn(loadPrefs(this.d.prefsFile), item.kind as MomentKind, action));
    } catch {
      /* aprender es un extra: si no se puede guardar, la corrección sigue valiendo */
    }
  }

  prefs(): PrefsView {
    const p = loadPrefs(this.d.prefsFile);
    return { enabled: p.enabled, kinds: describePrefs(p) };
  }

  setPrefsEnabled(enabled: boolean): PrefsView {
    savePrefs(this.d.prefsFile, { ...loadPrefs(this.d.prefsFile), enabled });
    return this.prefs();
  }

  resetPrefs(): PrefsView {
    savePrefs(this.d.prefsFile, { ...emptyPrefs(), enabled: loadPrefs(this.d.prefsFile).enabled });
    return this.prefs();
  }

  trim(vodId: string, key: string, start: number, end: number): MomentsView {
    this.known(vodId, key);
    this.checkRange(vodId, start, end);
    return this.mutate(vodId, (e) => {
      const x = e.extra.find((m) => momentKey(m.start) === key);
      if (x) {
        // un momento añadido a mano se mueve entero: su clave pasa a ser el nuevo inicio
        e.extra = e.extra.filter((m) => m !== x);
        e.extra.push({ ...x, start, end });
        e.exclude = e.exclude.filter((k) => k !== key);
      } else e.trims[key] = { start, end };
    });
  }

  add(vodId: string, start: number, end: number, title?: string): MomentsView {
    this.checkRange(vodId, start, end);
    const key = momentKey(start);
    return this.mutate(vodId, (e) => {
      if (e.extra.some((m) => momentKey(m.start) === key)) throw new Error('Ya hay un momento que empieza ahí.');
      e.extra.push({ start, end, ...(title?.trim() ? { title: title.trim().slice(0, 60) } : {}) });
    });
  }

  remove(vodId: string, key: string): MomentsView {
    return this.mutate(vodId, (e) => {
      e.extra = e.extra.filter((m) => momentKey(m.start) !== key);
    });
  }

  /** Borra todas las correcciones del directo (vuelve a lo que eligió el piloto). */
  clear(vodId: string): MomentsView {
    return this.mutate(vodId, (e) => {
      e.exclude = [];
      e.pin = [];
      e.trims = {};
      e.extra = [];
    });
  }

  private checkRange(vodId: string, start: number, end: number): void {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) throw new Error('Los tiempos no son válidos.');
    if (end - start < MIN_LEN) throw new Error(`El momento debe durar al menos ${MIN_LEN} s.`);
    if (end - start > MAX_LEN) throw new Error(`El momento no puede durar más de ${MAX_LEN} s.`);
    const dur = this.d.duration(vodId);
    if (dur && end > dur + 1) throw new Error('El final queda fuera del directo.');
  }
}


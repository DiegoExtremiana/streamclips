"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MomentsService = void 0;
const highlights_1 = require("../../shared/highlights");
const momentEdits_1 = require("../../shared/momentEdits");
const momentStore_1 = require("../services/momentStore");
const preferences_1 = require("../../shared/preferences");
/** Revisión manual de los momentos que eligió el piloto: ver nota y motivo, excluir, fijar, recortar y añadir. */
class MomentsService {
    d;
    constructor(d) {
        this.d = d;
    }
    list(vodId) {
        if (!this.d.exists(vodId))
            throw new Error('El VOD no existe.');
        const snap = (0, momentStore_1.loadSnapshot)(this.d.dir, vodId);
        const edits = (0, momentStore_1.loadEdits)(this.d.dir, vodId);
        const words = snap || edits.extra.length ? this.d.words(vodId) : [];
        const chosen = new Set(snap?.chosen ?? []);
        const ex = new Set(edits.exclude);
        const pin = new Set(edits.pin);
        const rows = (snap?.items ?? []).map((i) => {
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
                text: (0, highlights_1.textOf)(words, seg.start, seg.end, 500),
                chosen: chosen.has(i.key),
                excluded: ex.has(i.key),
                pinned: pin.has(i.key),
                edited: Boolean(edits.trims[i.key]),
                manual: false,
                belowFloor: i.total < (snap?.quality ?? 0),
            };
        });
        for (const x of edits.extra) {
            const key = (0, momentEdits_1.momentKey)(x.start);
            rows.push({ key, start: x.start, end: x.end, total: 10, kind: 'otro', reason: 'Añadido por ti', title: x.title ?? '', text: (0, highlights_1.textOf)(words, x.start, x.end, 500), chosen: chosen.has(key), excluded: ex.has(key), pinned: false, edited: false, manual: true, belowFloor: false });
        }
        rows.sort((a, b) => a.start - b.start);
        const pending = this.countEdits(edits) > 0;
        return { available: Boolean(snap), quality: snap?.quality ?? null, rows, pending };
    }
    countEdits(e) {
        return e.exclude.length + e.pin.length + Object.keys(e.trims).length + e.extra.length;
    }
    mutate(vodId, f) {
        if (!this.d.exists(vodId))
            throw new Error('El VOD no existe.');
        const e = (0, momentStore_1.loadEdits)(this.d.dir, vodId);
        f(e);
        (0, momentStore_1.saveEdits)(this.d.dir, vodId, e);
        return this.list(vodId);
    }
    known(vodId, key) {
        const inSnap = (0, momentStore_1.loadSnapshot)(this.d.dir, vodId)?.items.some((i) => i.key === key);
        const inExtra = (0, momentStore_1.loadEdits)(this.d.dir, vodId).extra.some((x) => (0, momentEdits_1.momentKey)(x.start) === key);
        if (!inSnap && !inExtra)
            throw new Error('Ese momento ya no existe: actualiza la lista.');
    }
    /** `include` lo fija (sale aunque no llegue a la nota), `exclude` lo descarta y `reset` quita ambas cosas y el recorte manual. */
    setState(vodId, key, state) {
        this.known(vodId, key);
        if (state === 'exclude' || state === 'include')
            this.learnFrom(vodId, key, state);
        return this.mutate(vodId, (e) => {
            e.exclude = e.exclude.filter((k) => k !== key);
            e.pin = e.pin.filter((k) => k !== key);
            if (state === 'exclude')
                e.exclude.push(key);
            if (state === 'include')
                e.pin.push(key);
            if (state === 'reset')
                delete e.trims[key];
        });
    }
    /** Anota la decisión para aprender del tipo de momento; repetir la misma decisión sobre el mismo momento no cuenta dos veces. */
    learnFrom(vodId, key, action) {
        const e = (0, momentStore_1.loadEdits)(this.d.dir, vodId);
        if (action === 'exclude' ? e.exclude.includes(key) : e.pin.includes(key))
            return;
        const item = (0, momentStore_1.loadSnapshot)(this.d.dir, vodId)?.items.find((i) => i.key === key);
        if (!item)
            return;
        // incluir algo que ya estaba elegido no dice nada nuevo
        if (action === 'include' && (0, momentStore_1.loadSnapshot)(this.d.dir, vodId)?.chosen.includes(key))
            return;
        // descartar algo que ni siquiera estaba elegido tampoco
        if (action === 'exclude' && !(0, momentStore_1.loadSnapshot)(this.d.dir, vodId)?.chosen.includes(key))
            return;
        try {
            (0, momentStore_1.savePrefs)(this.d.prefsFile, (0, preferences_1.learn)((0, momentStore_1.loadPrefs)(this.d.prefsFile), item.kind, action));
        }
        catch {
            /* aprender es un extra: si no se puede guardar, la corrección sigue valiendo */
        }
    }
    prefs() {
        const p = (0, momentStore_1.loadPrefs)(this.d.prefsFile);
        return { enabled: p.enabled, kinds: (0, preferences_1.describePrefs)(p) };
    }
    setPrefsEnabled(enabled) {
        (0, momentStore_1.savePrefs)(this.d.prefsFile, { ...(0, momentStore_1.loadPrefs)(this.d.prefsFile), enabled });
        return this.prefs();
    }
    resetPrefs() {
        (0, momentStore_1.savePrefs)(this.d.prefsFile, { ...(0, preferences_1.emptyPrefs)(), enabled: (0, momentStore_1.loadPrefs)(this.d.prefsFile).enabled });
        return this.prefs();
    }
    trim(vodId, key, start, end) {
        this.known(vodId, key);
        this.checkRange(vodId, start, end);
        return this.mutate(vodId, (e) => {
            const x = e.extra.find((m) => (0, momentEdits_1.momentKey)(m.start) === key);
            if (x) {
                // un momento añadido a mano se mueve entero: su clave pasa a ser el nuevo inicio
                e.extra = e.extra.filter((m) => m !== x);
                e.extra.push({ ...x, start, end });
                e.exclude = e.exclude.filter((k) => k !== key);
            }
            else
                e.trims[key] = { start, end };
        });
    }
    add(vodId, start, end, title) {
        this.checkRange(vodId, start, end);
        const key = (0, momentEdits_1.momentKey)(start);
        return this.mutate(vodId, (e) => {
            if (e.extra.some((m) => (0, momentEdits_1.momentKey)(m.start) === key))
                throw new Error('Ya hay un momento que empieza ahí.');
            e.extra.push({ start, end, ...(title?.trim() ? { title: title.trim().slice(0, 60) } : {}) });
        });
    }
    remove(vodId, key) {
        return this.mutate(vodId, (e) => {
            e.extra = e.extra.filter((m) => (0, momentEdits_1.momentKey)(m.start) !== key);
        });
    }
    /** Borra todas las correcciones del directo (vuelve a lo que eligió el piloto). */
    clear(vodId) {
        return this.mutate(vodId, (e) => {
            e.exclude = [];
            e.pin = [];
            e.trims = {};
            e.extra = [];
        });
    }
    checkRange(vodId, start, end) {
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0)
            throw new Error('Los tiempos no son válidos.');
        if (end - start < momentEdits_1.MIN_LEN)
            throw new Error(`El momento debe durar al menos ${momentEdits_1.MIN_LEN} s.`);
        if (end - start > momentEdits_1.MAX_LEN)
            throw new Error(`El momento no puede durar más de ${momentEdits_1.MAX_LEN} s.`);
        const dur = this.d.duration(vodId);
        if (dur && end > dur + 1)
            throw new Error('El final queda fuera del directo.');
    }
}
exports.MomentsService = MomentsService;

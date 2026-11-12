"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpeakerService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const speakers_1 = require("../../shared/speakers");
const diarize_1 = require("../services/diarize");
/** Una voz con menos audio que esto no crea perfil nuevo (probablemente ruido o una frase suelta). */
const MIN_VOICE_SEC = 4;
/** Parecido para reconocer una voz ya conocida entre directos (más exigente que unir grupos dentro de un mismo directo). */
const KNOWN_VOICE = 0.55;
/** Trozos de como máximo esto se analizan de una vez (memoria). */
const CHUNK_SEC = 15 * 60;
const JOIN_GAP_SEC = 20;
/** Hablantes: quién habla en cada tramo y la memoria de voces entre directos (con alias que el usuario puede poner y corregir). */
class SpeakerService {
    d;
    dir;
    engine = null;
    versions = new Map();
    cache = new Map();
    chain = Promise.resolve();
    constructor(d) {
        this.d = d;
        this.dir = node_path_1.default.join(node_path_1.default.dirname(d.store.file), 'speakers');
    }
    file(vodId) {
        return node_path_1.default.join(this.dir, `${vodId.replace(/[^\w-]/g, '_')}.json`);
    }
    read(vodId) {
        const f = this.file(vodId);
        try {
            const mtime = node_fs_1.default.statSync(f).mtimeMs;
            const hit = this.cache.get(vodId);
            if (hit && hit.mtime === mtime)
                return hit.data;
            const j = JSON.parse(node_fs_1.default.readFileSync(f, 'utf8'));
            const data = { segs: Array.isArray(j.segs) ? j.segs : [], covered: Array.isArray(j.covered) ? j.covered : [] };
            this.cache.set(vodId, { mtime, data });
            return data;
        }
        catch {
            return { segs: [], covered: [] };
        }
    }
    write(vodId, data) {
        node_fs_1.default.mkdirSync(this.dir, { recursive: true });
        const f = this.file(vodId);
        node_fs_1.default.writeFileSync(`${f}.tmp`, JSON.stringify(data));
        node_fs_1.default.renameSync(`${f}.tmp`, f);
        this.cache.delete(vodId);
        this.versions.set(vodId, (this.versions.get(vodId) ?? 0) + 1);
    }
    /** Para el servicio de transcripciones: los tramos de cada voz de un directo. */
    overlay(vodId) {
        const s = this.read(vodId);
        return s.segs.length ? { segs: s.segs, version: this.versions.get(vodId) ?? 1 } : null;
    }
    /** ¿Se puede identificar hablantes en este equipo? */
    available() {
        if (this.d.engine)
            return { ok: true };
        if (!(0, diarize_1.loadSherpa)())
            return { ok: false, reason: 'El módulo de diarización (sherpa-onnx) no está disponible en este equipo.' };
        if (!node_fs_1.default.existsSync(this.d.segmentationModel))
            return { ok: false, reason: 'Falta el modelo de segmentación de voces incluido con el programa.' };
        return { ok: true };
    }
    async getEngine() {
        if (this.engine)
            return this.engine;
        if (this.d.engine)
            return (this.engine = this.d.engine());
        const a = this.available();
        if (!a.ok)
            throw new Error(a.reason);
        if (!(0, diarize_1.embeddingInstalled)(this.d.modelsDir)) {
            this.d.log.info('Descargando el modelo de voz (40 MB) para identificar hablantes…');
            await (0, diarize_1.downloadEmbeddingModel)(this.d.modelsDir, () => undefined, this.d.fetchFn);
        }
        this.engine = (0, diarize_1.sherpaEngine)(this.d.segmentationModel, (0, diarize_1.embeddingPath)(this.d.modelsDir));
        return this.engine;
    }
    /** Partes de `ranges` que todavía no se han analizado, unidas si están cerca y partidas en trozos manejables. */
    pending(vodId, ranges) {
        const cov = this.read(vodId).covered;
        let todo = ranges.map((r) => ({ start: Math.max(0, r.start), end: r.end })).filter((r) => r.end > r.start);
        for (const c of cov) {
            todo = todo.flatMap((p) => {
                if (c.end <= p.start || c.start >= p.end)
                    return [p];
                const parts = [];
                if (c.start > p.start)
                    parts.push({ start: p.start, end: c.start });
                if (c.end < p.end)
                    parts.push({ start: c.end, end: p.end });
                return parts;
            });
        }
        todo = todo.filter((r) => r.end - r.start >= 3).sort((a, b) => a.start - b.start);
        const merged = [];
        for (const r of todo) {
            const last = merged[merged.length - 1];
            if (last && r.start - last.end <= JOIN_GAP_SEC && r.end - last.start <= CHUNK_SEC)
                last.end = Math.max(last.end, r.end);
            else
                merged.push({ ...r });
        }
        return merged.flatMap((r) => {
            const out = [];
            for (let s = r.start; s < r.end; s += CHUNK_SEC)
                out.push({ start: s, end: Math.min(r.end, s + CHUNK_SEC) });
            return out;
        });
    }
    /** Segundos de audio que faltan por analizar (para estimar el tiempo). */
    pendingSeconds(vodId, ranges) {
        return this.pending(vodId, ranges).reduce((a, r) => a + (r.end - r.start), 0);
    }
    /**
     * Identifica quién habla en los tramos indicados (solo los que faltan) y lo recuerda: las voces conocidas se reconocen, las
     * nuevas pasan a ser «Hablante N». Las llamadas se hacen de una en una para que la memoria de voces sea coherente.
     */
    diarize(vodId, ranges, onProgress) {
        const job = this.chain.then(() => this.doDiarize(vodId, ranges, onProgress));
        this.chain = job.catch(() => undefined);
        return job;
    }
    async doDiarize(vodId, ranges, onProgress) {
        const todo = this.pending(vodId, ranges);
        const total = todo.reduce((a, r) => a + (r.end - r.start), 0);
        if (!todo.length)
            return { voices: 0, sec: 0 };
        const engine = await this.getEngine();
        const file = await this.d.source(vodId);
        let done = 0;
        const ids = new Set();
        for (const r of todo) {
            const res = await (0, diarize_1.diarizeRange)(this.d.tools(), engine, file, r);
            const book = this.d.store.data.speakers;
            const known = (0, speakers_1.resolveVoices)(res.embeddings, book.profiles, { minSimilarity: KNOWN_VOICE });
            const map = new Map();
            for (const [voice, emb] of res.embeddings) {
                const sec = res.seconds.get(voice) ?? 0;
                const p = known.get(voice);
                if (p) {
                    const i = book.profiles.findIndex((x) => x.id === p.id);
                    book.profiles[i] = (0, speakers_1.updateProfile)(p, emb, Math.min(sec, 60) / 60);
                    map.set(voice, p.id);
                }
                else if (sec >= MIN_VOICE_SEC) {
                    const np = { id: book.nextId++, embedding: emb, n: Math.min(sec, 60) / 60 };
                    book.profiles.push(np);
                    map.set(voice, np.id);
                }
            }
            const cur = this.read(vodId);
            const segs = res.segs.flatMap((s) => (map.has(s.speaker) ? [{ ...s, speaker: map.get(s.speaker) }] : []));
            for (const s of segs)
                ids.add(s.speaker);
            // lo ya analizado de este mismo tramo se sustituye
            const kept = cur.segs.filter((s) => s.end <= r.start || s.start >= r.end);
            this.write(vodId, { segs: [...kept, ...segs].sort((a, b) => a.start - b.start), covered: [...cur.covered, { start: r.start, end: r.end }] });
            this.d.store.save();
            done += r.end - r.start;
            onProgress?.(done, total);
        }
        this.d.notifier.changed();
        return { voices: ids.size, sec: total };
    }
    profiles() {
        return this.d.store.data.speakers.profiles.map((p) => ({ id: p.id, alias: p.alias || (0, speakers_1.defaultAlias)(p.id), self: p.self === true, named: Boolean(p.alias) }));
    }
    profile(id) {
        const p = this.d.store.data.speakers.profiles.find((x) => x.id === id);
        if (!p)
            throw new Error('Ese hablante no existe.');
        return p;
    }
    /** Pone o quita el nombre de un hablante (se conserva en los próximos directos). */
    rename(id, alias) {
        const p = this.profile(id);
        const a = String(alias ?? '').replace(/[<>]/g, '').trim().slice(0, 40);
        if (a)
            p.alias = a;
        else
            delete p.alias;
        this.d.store.save();
        this.d.notifier.changed();
    }
    /** Marca qué voz es la del propio streamer (null = ninguna). */
    setSelf(id) {
        for (const p of this.d.store.data.speakers.profiles)
            delete p.self;
        if (id !== null)
            this.profile(id).self = true;
        this.d.store.save();
        this.d.notifier.changed();
    }
    /** Une dos hablantes que en realidad son la misma persona: `from` desaparece y sus frases pasan a `into`. */
    merge(from, into) {
        if (from === into)
            throw new Error('Elige dos hablantes distintos.');
        const a = this.profile(from);
        const b = this.profile(into);
        const book = this.d.store.data.speakers;
        const merged = (0, speakers_1.updateProfile)(b, a.embedding, a.n);
        merged.self = a.self || b.self ? true : undefined;
        if (!merged.self)
            delete merged.self;
        if (!b.alias && a.alias)
            merged.alias = a.alias;
        book.profiles = book.profiles.filter((p) => p.id !== from).map((p) => (p.id === into ? merged : p));
        if (node_fs_1.default.existsSync(this.dir)) {
            for (const f of node_fs_1.default.readdirSync(this.dir)) {
                if (!f.endsWith('.json'))
                    continue;
                const id = f.slice(0, -5);
                const cur = this.read(id);
                if (cur.segs.some((s) => s.speaker === from))
                    this.write(id, { ...cur, segs: cur.segs.map((s) => (s.speaker === from ? { ...s, speaker: into } : s)) });
            }
        }
        this.d.store.save();
        this.d.notifier.changed();
    }
    /** Colores de las voces que aparecen en unas palabras; undefined si hay una sola voz (no hace falta colorear). */
    colorsFor(words) {
        const ids = [];
        for (const w of words)
            if (w.spk !== undefined && !ids.includes(w.spk))
                ids.push(w.spk);
        if (ids.length < 2)
            return undefined;
        const self = this.d.store.data.speakers.profiles.find((p) => p.self)?.id;
        const palette = this.d.store.data.settings.autopilot.speakerColors;
        return (0, speakers_1.colorMap)(ids, self, palette?.length ? palette : speakers_1.DEFAULT_SPEAKER_COLORS);
    }
}
exports.SpeakerService = SpeakerService;

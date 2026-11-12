"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Autopilot = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const autoEdit_1 = require("../../shared/autoEdit");
const styleProfile_1 = require("../../shared/styleProfile");
const chapters_1 = require("../../shared/chapters");
const highlights_1 = require("../../shared/highlights");
const momentJudge_1 = require("../services/momentJudge");
const momentEdits_1 = require("../../shared/momentEdits");
const momentStore_1 = require("../services/momentStore");
const preferences_1 = require("../../shared/preferences");
const judge_1 = require("../../shared/judge");
const slots_1 = require("../../shared/slots");
const series_1 = require("../../shared/series");
const chatlog_1 = require("../services/chatlog");
const abort_1 = require("../services/abort");
const audioEnergy_1 = require("../services/audioEnergy");
const llm_1 = require("../services/llm");
const categories_1 = require("../../shared/categories");
/** Notas mínimas (0-10) para que un momento entre: el modelo puntúa 5 lo normal, 7 lo bueno. Antes un vídeo corto y bueno que uno largo con relleno. */
const DEFAULT_QUALITY = 6.5;
/** Un resumen de menos de esto no merece publicarse. */
const MIN_SUMMARY_SEC = 150;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/**
 * Cuando termina un directo y su VOD está descargado: lo transcribe, busca los mejores momentos y
 * monta resumen, vídeo principal y clips. Los deja pendientes de tu visto bueno (o los programa si lo desactivas).
 * Lo que decide los tramos son siempre las señales locales; el modelo de lenguaje solo pone títulos y descripciones.
 */
class Autopilot {
    d;
    constructor(d) {
        this.d = d;
    }
    get cfg() {
        return this.d.store.data.settings.autopilot;
    }
    get now() {
        return (this.d.now ?? Date.now)();
    }
    mark(vod, status, note) {
        vod.autopilot = { status, ...(note ? { note } : {}), at: new Date(this.now).toISOString() };
        this.d.store.save();
        this.d.notifier.vod(vod);
        this.d.notifier.changed();
    }
    /** Lo llama el vigilante al terminar de descargar el VOD de un directo. */
    onLiveVod(vod) {
        if (!this.cfg.enabled)
            return;
        this.mark(vod, 'waiting', 'En cola para analizarse.');
        void this.run(vod.id).catch((e) => this.d.log.error('Piloto automático', e));
    }
    /**
     * Ejecuta todo el proceso sobre un VOD descargado. Una vez por VOD a la vez; con `restart` cancela el que esté en marcha
     * y empieza de nuevo (así nunca se queda bloqueado un análisis que se colgó).
     */
    async run(vodId, o = {}) {
        const vod = this.d.store.data.vods.find((v) => v.id === vodId);
        if (!vod)
            throw new Error('El VOD no existe.');
        const prev = this.running.get(vodId);
        if (prev) {
            if (!o.restart)
                throw new Error('El piloto automático ya está trabajando en este VOD.');
            prev.ctrl.abort();
            await prev.done.catch(() => undefined);
        }
        if (vod.status !== 'downloaded')
            throw new Error('El VOD todavía no está descargado.');
        const missing = !vod.filePath || !node_fs_1.default.existsSync(vod.filePath);
        if (missing && !(this.d.restore && vod.url && vod.origin !== 'clip'))
            throw new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).');
        const ctrl = new AbortController();
        this.mark(vod, 'waiting', missing ? 'Volviendo a descargar el directo para analizarlo…' : 'En cola para analizarse.');
        const done = this.d.queue.run(() => (0, abort_1.withAbort)(ctrl.signal, async () => {
            if (ctrl.signal.aborted)
                throw new abort_1.CancelledError();
            if (missing)
                await this.d.restore(vodId);
            return this.process(vod);
        }));
        const entry = { ctrl, done };
        this.running.set(vodId, entry);
        // al terminar (bien, mal o cancelado) se libera, salvo que otra ejecución ya haya ocupado su sitio
        void done.then(() => undefined, () => undefined).finally(() => {
            if (this.running.get(vodId) === entry)
                this.running.delete(vodId);
            // pausado antes de empezar (esperando en la cola): el estado se ajusta aquí
            if (this.pauseRequested.delete(vodId) && vod.autopilot?.status === 'waiting')
                this.markPaused(vod);
        });
        return done;
    }
    running = new Map();
    /** ¿Se está analizando este VOD ahora mismo (no solo marcado como tal)? */
    isRunning(vodId) {
        return this.running.has(vodId);
    }
    pauseRequested = new Set();
    /** Pausa el análisis: se detiene (Whisper y ffmpeg incluidos) conservando lo ya transcrito; «Reanudar» lo retoma. */
    pause(vodId) {
        if (!this.running.has(vodId))
            return false;
        this.pauseRequested.add(vodId);
        return this.cancel(vodId);
    }
    /** Detiene el análisis en marcha de un VOD (ffmpeg y Whisper incluidos). */
    cancel(vodId) {
        const r = this.running.get(vodId);
        if (!r)
            return false;
        r.ctrl.abort();
        return true;
    }
    /** Al arrancar: un análisis que estaba a medias cuando se cerró el programa no sigue «en marcha»: se puede relanzar. */
    recoverInterrupted() {
        let n = 0;
        for (const v of this.d.store.data.vods) {
            const st = v.autopilot?.status;
            if (st && ['waiting', 'transcribing', 'analyzing', 'rendering'].includes(st) && !this.running.has(v.id)) {
                this.markPaused(v, true);
                n++;
            }
        }
        return n;
    }
    markPaused(vod, interrupted = false) {
        const kept = this.d.transcripts.hasCheckpoint(vod.id) ? ' Lo ya transcrito se conserva.' : '';
        this.mark(vod, 'paused', `${interrupted ? 'Se interrumpió al cerrar el programa o apagar el equipo.' : 'En pausa.'}${kept} Pulsa «Reanudar» cuando quieras.`);
    }
    /**
     * Borra el directo completo del disco y los datos que ya no sirven, dejando los vídeos y clips creados con sus
     * transcripciones (solo los tramos que usan). Si el directo hace falta más tarde se vuelve a descargar solo.
     */
    discard(vodId, o = {}) {
        const vod = this.d.store.data.vods.find((v) => v.id === vodId);
        if (!vod)
            throw new Error('El VOD no existe.');
        if (!this.d.discardSource)
            throw new Error('No se puede borrar el directo en este momento.');
        if (!o.fromRun && this.running.has(vodId))
            throw new Error('Se está analizando este directo; espera a que termine o cancélalo.');
        const outs = this.d.store.data.outputs.filter((x) => x.vodId === vodId);
        const spans = [];
        let known = outs.length > 0;
        for (const x of outs) {
            if (x.kind === 'long' && x.segments?.length)
                spans.push(...x.segments);
            else if (x.start !== undefined && x.end !== undefined)
                spans.push({ start: x.start, end: x.end });
            else
                known = false; // un vídeo antiguo sin tramos guardados: no se sabe qué transcripción necesita
        }
        if (known)
            this.d.transcripts.prune(vodId, spans);
        const chat = this.chatFileFor(vod);
        if (chat)
            node_fs_1.default.rmSync(chat, { force: true });
        const freedBytes = this.d.discardSource(vodId);
        return { freedBytes, kept: outs.length };
    }
    /** Archivo con la actividad del chat de este directo, si se guardó. */
    chatFileFor(vod) {
        if (!vod.streamStartedAt || !node_fs_1.default.existsSync(this.d.chatDir))
            return undefined;
        const start = Date.parse(vod.streamStartedAt);
        for (const f of node_fs_1.default.readdirSync(this.d.chatDir)) {
            try {
                const full = node_path_1.default.join(this.d.chatDir, f);
                const j = JSON.parse(node_fs_1.default.readFileSync(full, 'utf8'));
                // el VOD de Twitch empieza con el directo: unos segundos de diferencia como mucho
                if (Math.abs(Date.parse(j.startedAt) - start) < 5 * 60_000 && Array.isArray(j.bins))
                    return full;
            }
            catch {
                /* archivo de otro directo o dañado: se ignora */
            }
        }
        return undefined;
    }
    chatFor(vod) {
        const f = this.chatFileFor(vod);
        if (!f)
            return undefined;
        try {
            return chatlog_1.ChatBins.fromArray(JSON.parse(node_fs_1.default.readFileSync(f, 'utf8')).bins).toArray();
        }
        catch {
            return undefined;
        }
    }
    async process(vod) {
        const task = this.d.tasks.start('analyze', `Piloto automático: ${vod.title || 'directo'}`, vod.id);
        const notes = [];
        try {
            const t0 = Date.now();
            const lap = (since) => {
                const s = Math.round((Date.now() - since) / 1000);
                return s >= 90 ? `${Math.round(s / 60)} min` : `${s} s`;
            };
            // El volumen del audio no depende de la transcripción: se calcula a la vez (ffmpeg y Whisper no se estorban) y se recoge después.
            const energyJob = (async () => {
                try {
                    return { v: await (this.d.energy ?? audioEnergy_1.audioEnergy)(this.d.tools(), vod.filePath, () => undefined) };
                }
                catch (e) {
                    return { e };
                }
            })();
            // 1) transcripción (si se puede)
            let words = this.d.transcripts.words(vod.id);
            let tTranscribe = '';
            let deferTranscribe = false;
            if (!this.d.transcripts.isFull(vod.id)) {
                const st = this.d.transcripts.status();
                const skip = st.engine && this.d.canTranscribe ? this.d.canTranscribe(vod.durationSec ?? (await this.d.clips.vodDuration(vod.id))) : null;
                if (skip)
                    notes.push(`Sin transcripción: ${skip}.`);
                else if (st.engine && this.cfg.fastAnalysis !== false && !this.d.transcripts.hasCheckpoint(vod.id)) {
                    // análisis rápido: primero se eligen los momentos con el volumen y el chat, y luego se transcribe solo lo elegido
                    deferTranscribe = true;
                }
                else if (st.engine) {
                    this.mark(vod, 'transcribing');
                    task.update(2, 'Transcribiendo el directo (puede tardar)…');
                    try {
                        const ts = Date.now();
                        // la transcripción ocupa del 2 % al 30 % de la barra del análisis (y es casi todo el tiempo)
                        await this.d.transcripts.transcribe(vod.id, undefined, {
                            onProgress: (pct, detail) => task.update(2 + pct * 0.28, detail ? `Transcribiendo (${detail})…` : undefined),
                            onEstimate: (sec) => task.estimate(sec / 0.28),
                        });
                        words = this.d.transcripts.words(vod.id);
                        tTranscribe = lap(ts);
                        const mins = (vod.durationSec ?? 0) / 60;
                        this.d.log.info(`Transcripción de "${vod.title}": ${tTranscribe}${mins ? ` (${(mins / Math.max(0.05, (Date.now() - ts) / 60000)).toFixed(1)}× tiempo real)` : ''}`);
                    }
                    catch (e) {
                        if ((0, abort_1.isCancelled)(e))
                            throw e;
                        notes.push(`Sin transcripción: ${e.message}`);
                    }
                }
                else
                    notes.push('Sin transcripción: Whisper no está disponible.');
            }
            // 2) señales
            this.mark(vod, 'analyzing');
            task.update(30, 'Analizando audio y chat…');
            const duration = await this.d.clips.vodDuration(vod.id);
            let energyDb;
            const er = await energyJob;
            if ('v' in er)
                energyDb = er.v;
            else {
                if ((0, abort_1.isCancelled)(er.e))
                    throw er.e;
                notes.push(`Sin análisis de volumen: ${er.e.message}`);
            }
            task.update(50);
            (0, abort_1.throwIfCancelled)();
            const chat = this.chatFor(vod);
            if (!chat && this.cfg.chatCapture)
                notes.push('Sin datos de chat de este directo.');
            const sig = { durationSec: duration, energyDb, chat, words: words.length ? words : undefined };
            if (!energyDb && !chat && !words.length)
                throw new Error('No hay ninguna señal para analizar (ni audio, ni chat, ni transcripción).');
            // 3) tramos
            let moments = this.cfg.maxClips > 0 ? (0, highlights_1.findMoments)(sig, { count: this.cfg.maxClips }) : [];
            let summary = (0, highlights_1.buildSummary)(sig, { minSec: this.cfg.summaryMinutes * 60 * 0.85, maxSec: this.cfg.summaryMinutes * 60 * 1.25 });
            // el resumen cuenta como uno de los vídeos del directo; el resto son tramos continuos distintos
            let mains = this.cfg.maxVideos > 1 ? (0, highlights_1.bestStretches)(sig, this.cfg.mainMinutes * 60, this.cfg.maxVideos - 1) : [];
            if (!this.cfg.maxVideos)
                summary.length = 0;
            // Cada clip y cada vídeo es de una sola categoría de Twitch: se recorta a la del momento y lo que no cabe se descarta.
            const cats = await this.d.categories.ensure(vod.id);
            if (new Set(cats.map((c) => c.title)).size > 1) {
                const before = moments.length + mains.length;
                moments = moments.flatMap((m) => {
                    const f = (0, categories_1.fitToCategory)(m, cats, 15);
                    return f ? [{ ...m, start: f.start, end: f.end }] : [];
                });
                mains = mains.flatMap((m) => {
                    const f = (0, categories_1.fitToCategory)(m, cats, 90);
                    return f ? [f] : [];
                });
                const dom = (0, categories_1.dominantCategory)(summary, cats, 8);
                if (dom.category && dom.segs.length !== summary.length)
                    notes.push(`Resumen solo de la categoría «${dom.category}».`);
                summary = dom.segs;
                if (before !== moments.length + mains.length)
                    notes.push('Algunos momentos se recortaron o descartaron para no mezclar categorías.');
            }
            // Selección inteligente: más candidatos de los necesarios, para que el modelo de lenguaje elija los buenos de verdad
            const llmConf = this.llmConf();
            let pool = [];
            if (llmConf && this.cfg.smartSelect !== false && (this.cfg.maxClips > 0 || this.cfg.maxVideos > 0)) {
                const need = this.cfg.maxClips + (this.cfg.maxVideos ? Math.ceil((this.cfg.summaryMinutes * 60) / 40) : 0);
                pool = (0, highlights_1.findMoments)(sig, { count: Math.min(60, Math.max(16, need * 2)), minLen: 25, maxLen: 75, gap: 45 }).flatMap((m, i) => {
                    const f = new Set(cats.map((c) => c.title)).size > 1 ? (0, categories_1.fitToCategory)(m, cats, 15) : { start: m.start, end: m.end };
                    return f ? [{ id: `c${i}`, start: f.start, end: f.end, signal: m.score }] : [];
                });
            }
            const legacy = { moments, summary, mains };
            if (pool.length) {
                // lo que se transcribe es el conjunto de candidatos; la selección por señales solo se transcribe si el modelo falla
                moments = [];
                summary = [];
            }
            /** Nombre que dio el modelo a cada momento del resumen (por su inicio), para los capítulos. */
            const chapterLabels = new Map();
            let summaryMeta;
            const meta = new Map();
            if (!moments.length && !summary.length && !mains.length && !pool.length) {
                this.mark(vod, 'skipped', ['No se encontraron momentos que destaquen en este directo.', ...notes].join(' '));
                task.done('Sin momentos destacados');
                return vod;
            }
            // 3b) análisis rápido: se transcribe solo lo elegido (tramos de clips, resumen y vídeos)
            if (deferTranscribe) {
                const spans = [...moments, ...summary, ...mains, ...pool].map((g) => ({ start: g.start, end: g.end }));
                this.mark(vod, 'transcribing');
                task.update(40, 'Transcribiendo solo lo elegido…');
                try {
                    const ts = Date.now();
                    const est = this.d.transcripts.estimate(vod.id, spans);
                    if (est.sec > 0)
                        task.estimate(est.eta / 0.15);
                    await this.d.transcripts.ensure(vod.id, spans, {
                        onProgress: (doneSec, totalSec) => task.update(40 + (totalSec ? (doneSec / totalSec) * 15 : 15), `Transcribiendo lo elegido (${Math.round(doneSec / 60)} de ${Math.round(totalSec / 60)} min)…`),
                    });
                    words = this.d.transcripts.words(vod.id);
                    tTranscribe = lap(ts);
                    this.d.log.info(`Transcripción de lo elegido en "${vod.title}": ${tTranscribe} (${Math.round(est.sec / 60)} min de audio, de ${Math.round((vod.durationSec ?? duration) / 60)} del directo)`);
                    notes.push(`Análisis rápido: se transcribieron ${Math.round(est.sec / 60)} min de ${Math.round(duration / 60)}.`);
                }
                catch (e) {
                    if ((0, abort_1.isCancelled)(e))
                        throw e;
                    notes.push(`Sin transcripción: ${e.message}`);
                }
                this.mark(vod, 'analyzing');
            }
            // 3c) valoración con el modelo de lenguaje
            if (pool.length) {
                task.update(56, 'Valorando los momentos candidatos…');
                let judged = null;
                if (!words.length)
                    notes.push('Selección inteligente omitida: no hay transcripción.');
                else {
                    try {
                        const r = await (0, momentJudge_1.judgeCandidates)(llmConf, words, pool, {
                            fetchFn: this.d.llmFetch,
                            cacheFile: this.d.judgeDir ? node_path_1.default.join(this.d.judgeDir, `${vod.id}.json`) : undefined,
                            onProgress: (done, total) => task.update(56 + (total ? (done / total) * 4 : 4), `Valorando candidatos (${done}/${total})…`),
                            signal: () => (0, abort_1.throwIfCancelled)(),
                        });
                        judged = r.judged;
                        notes.push(`Selección inteligente: ${r.judged.length} candidatos valorados${r.cached ? ` (${r.cached} ya estaban guardados)` : ''}${r.failedChunks ? `, ${r.failedChunks} lote(s) sin respuesta` : ''}.`);
                    }
                    catch (e) {
                        if ((0, abort_1.isCancelled)(e))
                            throw e;
                        notes.push(`Selección inteligente no disponible (${e.message}); se usó el volumen y el chat.`);
                    }
                }
                if (judged) {
                    const quality = this.cfg.minQuality ?? DEFAULT_QUALITY;
                    if (this.d.prefsFile) {
                        const prefs = (0, momentStore_1.loadPrefs)(this.d.prefsFile);
                        const act = (0, preferences_1.describePrefs)(prefs).filter((x) => x.active);
                        if (prefs.enabled && act.length) {
                            judged = (0, preferences_1.applyPrefs)(judged, prefs);
                            notes.push(`Preferencias aprendidas aplicadas: ${act.map((x) => `${x.kind} ${x.bias > 0 ? '+' : ''}${x.bias}`).join(', ')}.`);
                        }
                    }
                    const raw = judged;
                    if (this.d.momentsDir) {
                        const edits = (0, momentStore_1.loadEdits)(this.d.momentsDir, vod.id);
                        const n = edits.exclude.length + edits.pin.length + Object.keys(edits.trims).length + edits.extra.length;
                        if (n) {
                            judged = (0, momentEdits_1.applyEdits)(judged, edits);
                            notes.push(`Se aplicaron ${n} corrección(es) tuyas a la selección de momentos.`);
                        }
                    }
                    const textFor = (0, judge_1.textFn)(words);
                    const clips = this.cfg.maxClips > 0 ? (0, judge_1.selectBest)(judged, { maxSec: Infinity, minTotal: quality, maxCount: this.cfg.maxClips, maxLen: 60, minGap: 30, textFor }) : null;
                    const sum = this.cfg.maxVideos > 0 ? (0, judge_1.selectBest)(judged, { maxSec: this.cfg.summaryMinutes * 60 * 1.25, minTotal: quality, maxLen: 90, minGap: 20, textFor }) : null;
                    if (clips) {
                        moments = clips.chosen.map((c) => ({ start: c.seg.start, end: c.seg.end, peak: (c.seg.start + c.seg.end) / 2, score: c.total, reasons: [c.judgement.kind] }));
                        clips.chosen.forEach((c, i) => meta.set(moments[i], { score: c.total, kind: c.judgement.kind, reason: c.judgement.reason }));
                        if (clips.chosen.length < this.cfg.maxClips)
                            notes.push(`Solo ${clips.chosen.length} de ${this.cfg.maxClips} clips superan la nota mínima (${quality}/10); no se rellenó con momentos flojos.`);
                    }
                    if (this.d.momentsDir)
                        (0, momentStore_1.saveSnapshot)(this.d.momentsDir, vod.id, raw, [...(clips?.chosen ?? []), ...(sum?.chosen ?? [])].map((c) => c.start), quality);
                    if (sum && sum.chosen.length) {
                        if (sum.totalSec >= MIN_SUMMARY_SEC) {
                            summary = sum.chosen.map((c) => ({ start: c.seg.start, end: c.seg.end }));
                            const avg = sum.chosen.reduce((a, c) => a + c.total, 0) / sum.chosen.length;
                            notes.push(`Resumen de ${Math.round(sum.totalSec / 60)} min con ${sum.chosen.length} momentos (nota media ${avg.toFixed(1)}/10): ${(0, judge_1.kindSummary)(sum)}.${sum.totalSec < this.cfg.summaryMinutes * 60 * 0.85 ? ' Más corto de lo configurado: no había más momentos buenos.' : ''}`);
                            if (new Set(cats.map((c) => c.title)).size > 1) {
                                const dom = (0, categories_1.dominantCategory)(summary, cats, 8);
                                if (dom.category && dom.segs.length !== summary.length)
                                    notes.push(`Resumen solo de la categoría «${dom.category}».`);
                                summary = dom.segs;
                            }
                            for (const c of sum.chosen)
                                if (c.judgement.title)
                                    chapterLabels.set(Math.round(c.seg.start), c.judgement.title);
                            summaryMeta = { score: avg, kind: 'resumen', reason: (0, judge_1.kindSummary)(sum) };
                        }
                        else
                            notes.push(`No hay suficientes momentos buenos para un resumen (${Math.round(sum.totalSec)} s por encima de ${quality}/10).`);
                    }
                    else if (sum)
                        notes.push(`Ningún momento supera la nota mínima del resumen (${quality}/10).`);
                }
                else {
                    // el modelo no estuvo disponible: selección por señales de siempre, transcribiendo lo que haga falta
                    ({ moments, summary } = legacy);
                    try {
                        await this.d.transcripts.ensure(vod.id, [...moments, ...summary].map((g) => ({ start: g.start, end: g.end })));
                        words = this.d.transcripts.words(vod.id);
                    }
                    catch (e) {
                        if ((0, abort_1.isCancelled)(e))
                            throw e;
                    }
                }
                if (!moments.length && !summary.length && !mains.length) {
                    this.mark(vod, 'skipped', ['Ningún momento supera la nota mínima de calidad: no se genera nada para no publicar relleno.', ...notes].join(' '));
                    task.done('Sin momentos con la calidad mínima');
                    return vod;
                }
            }
            // 3d) hablantes: quién habla en lo elegido (para colorear los subtítulos por voz)
            if (this.cfg.speakers !== false && words.length) {
                const avail = this.d.speakers.available();
                if (!avail.ok)
                    notes.push(`Hablantes sin identificar: ${avail.reason}`);
                else {
                    const spans = [...moments, ...summary, ...mains].map((g) => ({ start: g.start, end: g.end }));
                    const need = this.d.speakers.pendingSeconds(vod.id, spans);
                    if (need > 0) {
                        task.update(60, 'Identificando hablantes…');
                        try {
                            const ts = Date.now();
                            const r = await this.d.speakers.diarize(vod.id, spans, (done, total) => task.update(60 + (total ? (done / total) * 14 : 14), `Identificando hablantes (${Math.round(done / 60)} de ${Math.round(total / 60)} min)…`));
                            words = this.d.transcripts.words(vod.id);
                            notes.push(`Hablantes: ${r.voices} voz/voces en ${Math.round(r.sec / 60)} min de audio (${lap(ts)}).`);
                        }
                        catch (e) {
                            if ((0, abort_1.isCancelled)(e))
                                throw e;
                            notes.push(`Hablantes sin identificar: ${e.message}`);
                        }
                    }
                }
            }
            // 4) títulos
            task.update(75, 'Poniendo títulos…');
            const titles = await this.titles(vod, words, moments, mains, notes);
            // serie de varios días: «Minecraft extremo Día 1»; el tema concreto de cada vídeo pasa a la descripción
            const ser = this.cfg.maxVideos > 0 ? (0, series_1.seriesFor)(vod.title ?? '', { ...this.cfg.series, nextDay: vod.seriesDay ?? this.cfg.series.nextDay }) : null;
            if (ser) {
                const st = (0, series_1.seriesTitles)(ser, mains.length);
                titles.summary = { title: clean(st.summary, 100), description: titles.summary.description };
                titles.mains = titles.mains.map((t, i) => ({ title: clean(st.mains[i], 100), description: t.description || `En este vídeo: ${t.title}` }));
                notes.push(`Serie «${ser.name}», día ${ser.day}.`);
                if (!ser.fromTitle) {
                    // el día se reserva ya: con varios directos a la vez, dos no pueden coger el mismo número; al repetir este directo conserva el suyo
                    vod.seriesDay = ser.day;
                    this.cfg.series.nextDay = Math.max(this.cfg.series.nextDay, ser.day + 1);
                    this.d.store.save();
                }
            }
            // 5) montaje
            const tr = Date.now();
            this.mark(vod, 'rendering');
            const created = [];
            const errors = [];
            const total = (summary.length ? 1 : 0) + mains.length + moments.length;
            let doneCount = 0;
            const step = async (role, label, fn, t, m) => {
                try {
                    const item = await fn();
                    item.auto = { role, review: 'pending', ...(m ? { score: Math.round(m.score * 10) / 10, kind: m.kind, reason: m.reason } : {}) };
                    item.titleSource = 'auto';
                    item.visibility = this.cfg.visibility;
                    const ch = chapterOf.get(item.id);
                    if (t.description || item.category || ch) {
                        const base = (0, categories_1.withCategoryLine)(t.description, item.category);
                        this.d.library.setAutoDescription(item.id, ch ? `${base}${base ? '\n\n' : ''}${ch}` : base);
                    }
                    this.d.store.save();
                    created.push(item);
                }
                catch (e) {
                    if ((0, abort_1.isCancelled)(e))
                        throw e;
                    errors.push(`${label}: ${e.message}`);
                }
                task.update(76 + (++doneCount / total) * 19, `Montando (${doneCount}/${total})…`);
            };
            const pro = this.cfg.proEdit !== false && words.length > 0;
            if (this.cfg.proEdit !== false && !words.length)
                notes.push('Edición profesional omitida: no hay transcripción.');
            const subs = this.cfg.subtitles ? { subtitles: this.cfg.subtitles } : {};
            // si la edición profesional falla (efecto no válido, ffmpeg…), el vídeo se monta igualmente sin ella
            const safely = async (edited, withEdit, plain) => {
                if (!edited)
                    return plain();
                try {
                    return await withEdit();
                }
                catch (err) {
                    if ((0, abort_1.isCancelled)(err))
                        throw err;
                    this.d.log.warn(`Edición profesional falló, se monta sin ella: ${err.message.split('\n')[0]}`);
                    return plain();
                }
            };
            // los silencios de más de lo que dijo el creador (2 s por defecto) se cortan; su estilo manda sobre el criterio general
            const style = this.d.style?.() ?? (0, styleProfile_1.defaultStyle)();
            const editOpts = { minGap: style.silenceMaxSec };
            // capítulos con marca de tiempo para la descripción del resumen (como los vídeos de los canales grandes)
            const chapterOf = new Map();
            const longMake = async (title, segs, chapters = false) => {
                const e = pro ? (0, autoEdit_1.planLong)(words, segs, editOpts) : null;
                const item = await safely(Boolean(e), () => this.d.clips.createLong(vod.id, { title, segments: e.segments, effects: e.effects, ...subs }), () => this.d.clips.createLong(vod.id, { title, segments: segs, ...subs }));
                if (chapters && segs.length >= 3) {
                    try {
                        const starts = (0, chapters_1.outputStarts)(segs, item.segments ?? segs);
                        const block = (0, chapters_1.chapterBlock)(segs.map((g, i) => ({ at: starts[i], label: chapterLabels.get(Math.round(g.start)) ?? (i === 0 ? 'Inicio' : (0, highlights_1.shortTitle)(words, g, i) || `Momento ${i + 1}`) })), item.durationSec);
                        if (block)
                            chapterOf.set(item.id, block);
                    }
                    catch (err) {
                        this.d.log.warn(`Sin capítulos en "${title}": ${err.message}`);
                    }
                }
                return item;
            };
            if (summary.length)
                await step('summary', 'resumen', () => longMake(titles.summary.title, summary, true), titles.summary, summaryMeta);
            for (const [i, m] of mains.entries()) {
                const t = titles.mains[i];
                await step('main', `vídeo ${i + 1}`, () => longMake(t.title, [m]), t);
            }
            for (const [i, m] of moments.entries()) {
                const t = titles.clips[i];
                const e = pro ? (0, autoEdit_1.planEdit)(words, m, editOpts) : null;
                await step('clip', `clip ${i + 1}`, () => safely(Boolean(e), () => this.d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, cuts: e.cuts, effects: e.effects, ...subs }), () => this.d.clips.createClip(vod.id, { start: m.start, end: m.end, title: t.title, ...subs })), t, meta.get(m));
            }
            if (!created.length)
                throw new Error(`No se pudo montar ningún vídeo. ${errors.join(' ')}`);
            // un análisis repetido sustituye a los vídeos del anterior que seguían pendientes de revisión (sin publicar ni tocar por ti)
            const prior = this.d.store.data.outputs.filter((x) => x.vodId === vod.id && x.auto?.review === 'pending' && !created.includes(x) && x.titleSource !== 'manual' && x.descSource !== 'manual' && !this.d.store.data.publications.some((p) => p.outputId === x.id));
            if (prior.length) {
                const r = this.d.library.removeMany(prior.map((x) => x.id));
                if (r.removed)
                    notes.push(`Se sustituyeron ${r.removed} vídeo(s) pendientes de revisión de un análisis anterior.`);
            }
            // 6) visto bueno o programación
            let scheduled = 0;
            if (!this.cfg.requireApproval) {
                for (const o of created) {
                    try {
                        this.approve(o.id);
                        scheduled++;
                    }
                    catch (e) {
                        errors.push(`${o.title}: ${e.message}`); // se queda para revisar a mano
                    }
                }
            }
            // ya están los vídeos y los clips: el directo completo y lo que solo servía para sacarlos se borra
            if (this.cfg.cleanup !== false && this.d.discardSource) {
                try {
                    const r = this.discard(vod.id, { fromRun: true });
                    notes.push(`Directo completo borrado del disco (${(r.freedBytes / 1024 ** 3).toFixed(1)} GB liberados); se conservan ${r.kept} vídeo(s) y clip(s) con sus transcripciones.`);
                }
                catch (e) {
                    notes.push(`No se pudo borrar el directo completo: ${e.message}`);
                }
            }
            notes.push(`Tiempos: ${tTranscribe ? `transcripción ${tTranscribe}, ` : ''}montaje ${lap(tr)}, total ${lap(t0)}.`);
            this.d.log.info(`Análisis de "${vod.title}": ${notes[notes.length - 1]}`);
            const msg = `${created.length} vídeo(s) listos${this.cfg.requireApproval ? ' para revisar' : ` (${scheduled} programados)`}.`;
            this.mark(vod, 'done', [msg, ...errors, ...notes].join(' '));
            task.done(msg);
            return vod;
        }
        catch (e) {
            if ((0, abort_1.isCancelled)(e)) {
                const paused = this.pauseRequested.delete(vod.id);
                if (paused)
                    this.markPaused(vod);
                else
                    this.mark(vod, 'error', 'Análisis cancelado.');
                task.fail(paused ? 'En pausa' : 'Cancelado');
                this.d.log.info(`Análisis ${paused ? 'en pausa' : 'cancelado'}: "${vod.title}".`);
                throw e;
            }
            this.mark(vod, 'error', e.message);
            task.fail(e.message);
            this.d.log.error('Piloto automático fallido', e);
            throw e;
        }
    }
    /** Configuración del modelo de lenguaje si hay uno elegido y con clave; si no, null. */
    /** ¿Está analizando algún directo? (El trabajo en segundo plano se aparta mientras tanto.) */
    isBusy() {
        return this.running.size > 0;
    }
    /** Modelo de lenguaje configurado (clave incluida), o null si no hay. */
    llmConf() {
        const llm = this.cfg.llm;
        const key = this.d.llmKey();
        if (llm.provider === 'none' || !key)
            return null;
        return { provider: llm.provider, model: (0, llm_1.resolveModel)(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl };
    }
    async titles(vod, words, moments, mains, notes) {
        const base = {
            summary: { title: `Resumen del directo - ${this.dateLabel(vod)}`, description: '' },
            mains: mains.map((m, i) => ({ title: clean(words.length ? (0, highlights_1.shortTitle)(words, m, i) : `Directo del ${this.dateLabel(vod)} (parte ${i + 1})`, 100), description: clean((0, highlights_1.shortDescription)(words, m), 500) })),
            clips: moments.map((m, i) => ({ title: clean(words.length ? (0, highlights_1.shortTitle)(words, m, i) : `Momento ${i + 1}`, 100), description: clean((0, highlights_1.shortDescription)(words, m), 500) })),
        };
        const uniq = () => {
            const u = (0, highlights_1.dedupeTitles)([...base.mains.map((t) => t.title), ...base.clips.map((t) => t.title)]);
            base.mains.forEach((t, i) => (t.title = u[i]));
            base.clips.forEach((t, i) => (t.title = u[base.mains.length + i]));
        };
        const llm = this.cfg.llm;
        const key = this.d.llmKey();
        if (llm.provider === 'none' || !key || !words.length) {
            if (llm.provider !== 'none' && !words.length)
                notes.push('Títulos sin modelo de lenguaje: no hay transcripción.');
            uniq();
            return base;
        }
        const conf = { provider: llm.provider, model: (0, llm_1.resolveModel)(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl };
        const items = [
            ...mains.map((m, i) => ({ id: `video${i + 1}`, texto: (0, highlights_1.textOf)(words, m.start, Math.min(m.end, m.start + 240), 900) })),
            ...moments.map((m, i) => ({ id: `clip${i + 1}`, texto: (0, highlights_1.textOf)(words, m.start, m.end, 600) })),
        ];
        try {
            const raw = (await (0, llm_1.askJson)(conf, 'Eres editor de contenido de un streamer que habla en español de España (castellano). Escribes en castellano de España, sin latinismos ni modismos de otros países. Escribes nombres muy cortos para cada fragmento (2 a 5 palabras, máximo 40 caracteres, que digan qué pasa en él, distintos entre sí, sin clickbait falso, sin emojis) y descripciones para YouTube de 1-3 frases (60 a 280 caracteres) que cuenten de qué trata y qué pasa, sin hashtags ni emojis ni enlaces. Responde SOLO con JSON.', `Estos son fragmentos transcritos de un directo. Devuelve {"resumen":{"titulo":"","descripcion":""},"videos":[{"id":"video1","titulo":"","descripcion":""}],"clips":[{"id":"clip1","titulo":"","descripcion":""}]}.\n"resumen" es el resumen de todo el directo (no tienes su texto: titúlalo a partir de los demás fragmentos). Fragmentos:\n${JSON.stringify(items)}`, { fetchFn: this.d.llmFetch }));
            const pick = (o, fb) => ({ title: clean(o?.titulo, 100) || fb.title, description: clean(o?.descripcion, 500) || fb.description });
            base.summary = pick(raw.resumen, base.summary);
            const byVideo = new Map((Array.isArray(raw.videos) ? raw.videos : []).map((c) => [String(c.id), c]));
            base.mains = base.mains.map((fb, i) => pick(byVideo.get(`video${i + 1}`), fb));
            const byId = new Map((Array.isArray(raw.clips) ? raw.clips : []).map((c) => [String(c.id), c]));
            base.clips = base.clips.map((fb, i) => pick(byId.get(`clip${i + 1}`), fb));
        }
        catch (e) {
            notes.push(`Títulos sin modelo de lenguaje: ${e.message}`);
        }
        uniq();
        return base;
    }
    /**
     * Título provisional para un tramo (clip o vídeo) a partir de lo que se dice en él. Con un modelo de lenguaje configurado
     * lo redacta él; si no, sale de la frase más llamativa. Sin transcripción no hay de qué sacarlo y devuelve null.
     */
    async suggestTitle(vodId, start, end) {
        let failure = null;
        await this.d.transcripts.ensure(vodId, [{ start, end }]).catch((e) => {
            failure = e;
            this.d.log.warn(`Sin transcripción para sugerir título: ${failure.message.split('\n')[0]}`);
        });
        const r = await this.nameFor(vodId, [{ start, end }]);
        if (!r && failure)
            throw failure; // el motivo real (Whisper, modelo, VOD sin descargar…) llega a la pantalla
        return r && r.title ? { title: r.title, source: r.source } : null;
    }
    /**
     * Nombre corto y descripción de YouTube para uno o varios tramos de un VOD: con modelo de lenguaje los redacta él; si no,
     * salen de lo que se dice. Sin transcripción de esos tramos devuelve null.
     */
    async nameFor(vodId, segs) {
        const words = this.d.transcripts.words(vodId);
        if (!words.some((w) => segs.some((g) => w.start >= g.start && w.end <= g.end + 0.5)))
            return null;
        const fbTitle = clean((0, highlights_1.shortTitle)(words, segs, 0), 100);
        const fbDesc = clean((0, highlights_1.shortDescription)(words, segs), 500);
        const local = { title: /^Momento \d+$/.test(fbTitle) ? '' : fbTitle, description: fbDesc, source: 'transcript' };
        const llm = this.cfg.llm;
        const key = this.d.llmKey();
        if (llm.provider !== 'none' && key) {
            try {
                const conf = { provider: llm.provider, model: (0, llm_1.resolveModel)(llm.provider, llm.model), apiKey: key, baseUrl: this.d.llmBaseUrl };
                const text = segs.map((g) => (0, highlights_1.textOf)(words, g.start, Math.min(g.end, g.start + 240), 900)).join(' / ').slice(0, 1400);
                const raw = (await (0, llm_1.askJson)(conf, 'Eres editor de contenido de un streamer que habla en español de España (castellano). Escribes en castellano de España. Para el fragmento escribes un nombre muy corto (2 a 5 palabras, máximo 40 caracteres, que diga qué pasa en él, sin clickbait falso, sin emojis) y una descripción para YouTube de 1 a 3 frases (60 a 280 caracteres) que cuente de qué trata y qué ocurre, sin hashtags, sin emojis y sin enlaces. Responde SOLO con JSON.', `Texto transcrito de un fragmento. Devuelve {"titulo":"","descripcion":""}.\n${text}`, { fetchFn: this.d.llmFetch }));
                const t = clean(raw.titulo, 100);
                const d = clean(raw.descripcion, 500);
                if (t || d)
                    return { title: t || local.title, description: d || local.description, source: 'llm' };
            }
            catch {
                /* se usa lo local */
            }
        }
        return local.title || local.description ? local : null;
    }
    /**
     * Pone un nombre corto y, si no la tiene, una descripción de YouTube a los clips y vídeos de la Biblioteca (con `onlyVodId`,
     * solo a los de ese VOD). No toca lo que escribió el usuario ni los nombres que ya son cortos. Evita repetir nombres.
     * `generic`: regla del arranque, solo se renombran los nombres genéricos («Momento 3», «Directo del…», «Resumen del directo…»).
     */
    async autoNameLibrary(onlyVodId, o2 = {}) {
        const res = { renamed: 0, described: 0, noTranscript: 0, kept: 0 };
        const outs = this.d.store.data.outputs;
        const used = new Set(outs.map((o) => o.title.toLowerCase()));
        for (const o of outs) {
            if (onlyVodId && o.vodId !== onlyVodId)
                continue;
            // categoría de Twitch del momento (también para lo que ya existía) y su línea en la descripción hecha por el programa
            if (o.vodId && !o.category) {
                const segs = o.kind === 'long' ? (o.segments ?? []) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : [];
                const cat = segs.length ? (0, categories_1.categoryOf)(await this.d.categories.ensure(o.vodId), segs) : undefined;
                if (cat)
                    o.category = cat;
            }
            if (o.category && o.descSource === 'auto' && o.description && !(0, categories_1.hasCategoryLine)(o.description))
                this.d.library.setAutoDescription(o.id, (0, categories_1.withCategoryLine)(o.description, o.category));
            const wantTitle = o2.generic ? (0, highlights_1.isGenericAutoTitle)(o) : (0, highlights_1.isAutoNameable)(o);
            const wantDesc = o.descSource !== 'manual' && !(0, categories_1.withCategoryLine)(o.description, undefined);
            if (!wantTitle && !wantDesc) {
                res.kept++;
                continue;
            }
            const segs = o.kind === 'long' ? (o.segments?.length ? o.segments.map((g) => ({ start: g.start, end: g.end })) : null) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : null;
            const r = o.vodId && segs ? await this.nameFor(o.vodId, segs) : null;
            if (!r) {
                res.noTranscript++;
                continue;
            }
            if (wantDesc && r.description) {
                try {
                    this.d.library.setAutoDescription(o.id, (0, categories_1.withCategoryLine)(r.description, o.category));
                    res.described++;
                }
                catch (e) {
                    this.d.log.warn(`No se pudo poner descripción a "${o.title}": ${e.message}`);
                }
            }
            if (!wantTitle || !r.title) {
                res.kept++;
                continue;
            }
            let t = r.title;
            if (t.toLowerCase() === o.title.toLowerCase()) {
                o.titleSource = 'auto';
                res.kept++;
                continue;
            }
            for (let n = 2; used.has(t.toLowerCase()); n++)
                t = `${r.title} ${n}`;
            used.delete(o.title.toLowerCase());
            used.add(t.toLowerCase());
            try {
                this.d.library.setAutoTitle(o.id, t);
                res.renamed++;
            }
            catch (e) {
                this.d.log.warn(`No se pudo renombrar "${o.title}": ${e.message}`);
            }
        }
        if (res.renamed || res.described)
            this.d.log.info(`Nombres y descripciones automáticos: ${res.renamed} nombre(s), ${res.described} descripción(es)`);
        return res;
    }
    /**
     * Al abrir el programa: revisa la Biblioteca y, a los clips y vídeos que siguen con un nombre genérico (o sin descripción)
     * y no son del usuario, les pone nombre y descripción según de qué se habla. Si el VOD no tiene transcripción y está
     * descargado, la hace antes con Whisper (una por VOD, una detrás de otra). Nunca lanza: lo que falle se anota en el registro.
     */
    async refreshLibraryAtStart(o3 = {}) {
        const generic = o3.generic ?? true;
        try {
            const need = this.d.store.data.outputs.filter((o) => o.vodId && ((generic ? (0, highlights_1.isGenericAutoTitle)(o) : (0, highlights_1.isAutoNameable)(o)) || (o.descSource !== 'manual' && !(0, categories_1.withCategoryLine)(o.description, undefined))));
            if (!need.length)
                return null;
            // se transcribe solo lo de cada clip o vídeo (sus tramos), no el directo entero
            const failed = new Set();
            for (const o of need) {
                const id = o.vodId;
                if (failed.has(id))
                    continue;
                const vod = this.d.store.data.vods.find((v) => v.id === id);
                if (!vod || vod.status !== 'downloaded' || !vod.filePath || !node_fs_1.default.existsSync(vod.filePath))
                    continue;
                if (!this.d.transcripts.status().engine)
                    break; // sin Whisper no se puede transcribir
                const segs = o.kind === 'long' ? (o.segments ?? []) : o.start !== undefined && o.end !== undefined ? [{ start: o.start, end: o.end }] : [];
                if (!segs.length)
                    continue;
                try {
                    await this.d.transcripts.ensure(id, segs);
                }
                catch (e) {
                    failed.add(id);
                    this.d.log.warn(`Nombres automáticos: no se pudo transcribir "${o.title}": ${e.message.split('\n')[0]}`);
                }
            }
            return await this.autoNameLibrary(undefined, { generic });
        }
        catch (e) {
            this.d.log.warn(`Nombres automáticos al arrancar: ${e.message}`);
            return null;
        }
    }
    dateLabel(vod) {
        const d = new Date(vod.streamStartedAt ?? vod.createdAt);
        return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
    }
    /** Visto bueno: programa el vídeo en su hora en las redes elegidas. */
    approve(outputId) {
        const o = this.d.store.data.outputs.find((x) => x.id === outputId);
        if (!o)
            throw new Error('El vídeo no existe.');
        const role = o.auto?.role ?? (o.kind === 'long' ? 'main' : 'clip');
        // TikTok e Instagram solo admiten clips: los vídeos largos van solo a YouTube
        const platforms = role === 'clip' ? this.cfg.platforms : this.cfg.platforms.filter((p) => p === 'youtube');
        if (!platforms.length) {
            throw new Error(role === 'clip' ? 'Elige en Ajustes en qué redes se publica lo automático.' : 'Los vídeos largos solo se publican en YouTube: actívalo en Ajustes > Piloto automático.');
        }
        const taken = new Set(this.d.store.data.publications.filter((p) => p.status !== 'failed').map((p) => Date.parse(p.scheduledAt)));
        const now = new Date(this.now + 5 * 60_000);
        // cada hora configurada es un hueco al día: los vídeos van a los de vídeos y los clips a los de clips
        const at = (0, slots_1.nextFreeSlot)(now, role === 'clip' ? this.cfg.clipTimes : this.cfg.videoTimes, taken);
        this.d.pubs.schedule(outputId, platforms, at.toISOString());
        o.auto = { role, review: 'approved' };
        this.d.store.save();
        this.d.notifier.changed();
        return o;
    }
}
exports.Autopilot = Autopilot;

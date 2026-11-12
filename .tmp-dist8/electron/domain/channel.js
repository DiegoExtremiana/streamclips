"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChannelMonitor = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const chatlog_1 = require("../services/chatlog");
/** Margen para reconocer el VOD del directo en curso: Twitch lo crea unos segundos antes que `started_at`. */
const LIVE_VOD_SLACK_MS = 5 * 60_000;
/** Lecturas seguidas «sin directo» antes de recoger el VOD (evita recoger a medias si se corta un momento la conexión). */
const OFFLINE_CONFIRMATIONS = 2;
const MIN_IMPORT_SEC = 60;
/** Cada cuánto se repasa todo el historial de clips, y cuánto atrás se mira en las vueltas rápidas. */
const CLIPS_FULL_MS = 20 * 60_000;
const CLIPS_RECENT_MS = 3 * 86_400_000;
/**
 * Vigila el canal de Twitch: sabe si estás en directo, recoge solo el VOD cuando el directo termina
 * y ofrece los clips del canal. No hace nada pesado por su cuenta: encola descargas en el VodService.
 */
class ChannelMonitor {
    d;
    timer = null;
    lastWarn = { msg: '', at: 0 };
    busy = false;
    stream = null;
    lastCheck = null;
    error = null;
    offlineStreak = 0;
    lastImported;
    liveListeners = [];
    analyzeListeners = [];
    /** VODs que el usuario ha pedido analizar y aún se están descargando. */
    analyzeAfter = new Set();
    chatLogger = null;
    chatBins = new chatlog_1.ChatBins();
    chatStart = null;
    chatSaved = 0;
    clipCache;
    clipOutputs = new Map();
    constructor(d) {
        this.d = d;
        d.vods.onDownloaded((job) => this.afterDownload(job));
    }
    get now() {
        return (this.d.now ?? Date.now)();
    }
    get state() {
        return this.d.store.data.channel;
    }
    /** Se avisa cuando el VOD de un directo recién terminado ya está descargado (aquí engancha el piloto automático). */
    onLiveVodReady(cb) {
        this.liveListeners.push(cb);
    }
    /** Se avisa cuando un directo que pediste analizar ya está descargado (se analiza aunque el piloto automático esté apagado). */
    onAnalyzeReady(cb) {
        this.analyzeListeners.push(cb);
    }
    /**
     * «Analizar» un directo de Twitch cuando quieras: si no está en la aplicación lo descarga, y en cuanto está listo
     * lanza el piloto automático. Si ya estaba descargado, lo analiza ya. Un directo aún en curso no se puede.
     */
    async analyze(twitchId) {
        const creds = this.d.creds();
        const mine = () => this.d.store.data.vods.find((v) => v.twitchId === twitchId && v.status !== 'error');
        let job = mine();
        if (!job) {
            if (!creds.clientId || !creds.clientSecret || !creds.login)
                throw new Error('Falta conectar tu canal de Twitch (pestaña Conexiones).');
            const v = (await this.d.twitch.listVods(creds)).find((x) => x.id === twitchId);
            if (!v)
                throw new Error('Twitch ya no tiene ese directo (los directos guardados se borran pasado un tiempo).');
            if (this.stream?.live && this.stream.startedAt && Date.parse(v.createdAt) >= Date.parse(this.stream.startedAt) - LIVE_VOD_SLACK_MS) {
                throw new Error('Ese directo sigue en curso. Podrás analizarlo en cuanto termine.');
            }
            if (!this.state.seenVodIds.includes(v.id))
                this.state.seenVodIds.push(v.id); // la recogida automática no lo vuelve a tocar
            job = this.d.vods.add(v.url, v.title, { origin: 'live', twitchId: v.id, streamStartedAt: v.createdAt, durationSec: v.durationSec });
            this.d.log.info(`Análisis pedido del directo "${v.title}" (${v.url}).`);
        }
        if (job.status === 'downloaded')
            this.fireAnalyze(job);
        else
            this.analyzeAfter.add(job.id);
        return job;
    }
    fireAnalyze(job) {
        for (const cb of this.analyzeListeners) {
            try {
                cb(job);
            }
            catch (e) {
                this.d.log.error('No se pudo analizar el directo', e);
            }
        }
    }
    status() {
        const c = this.d.creds();
        return {
            configured: !!(c.clientId && c.clientSecret && c.login),
            autoImport: this.state.autoImport,
            stream: this.stream,
            lastCheck: this.lastCheck,
            error: this.error,
            ...(this.lastImported ? { lastImported: this.lastImported } : {}),
        };
    }
    setAutoImport(on) {
        this.state.autoImport = on;
        if (on)
            this.state.autoSince = null; // al volver a activarlo no se recoge lo que pasó mientras estaba apagado
        this.d.store.save();
        this.d.notifier.channel(this.status());
        return this.status();
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => void this.poll(), this.d.intervalMs);
        this.timer.unref?.();
        void this.poll();
    }
    stop() {
        this.saveChat();
        this.stopChat();
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    /** Una vuelta de vigilancia. Nunca lanza: los fallos quedan en `error`. */
    async poll() {
        if (this.busy)
            return this.status();
        this.busy = true;
        try {
            const creds = this.d.creds();
            if (!creds.clientId || !creds.clientSecret || !creds.login) {
                this.stream = null;
                this.error = null;
                return this.status();
            }
            const stream = await this.d.twitch.streamStatus(creds);
            this.stream = stream;
            this.offlineStreak = stream.live ? 0 : this.offlineStreak + 1;
            this.syncChat(creds, stream);
            if (this.state.autoImport)
                await this.collect(creds, stream);
            this.error = null;
        }
        catch (e) {
            this.error = e.message;
            // sin conexión el mismo fallo se repetiría cada minuto: se anota la primera vez y luego cada media hora
            if (this.error !== this.lastWarn.msg || this.now - this.lastWarn.at > 30 * 60_000) {
                this.d.log.warn(`Vigilancia del canal: ${this.error}`);
                this.lastWarn = { msg: this.error, at: this.now };
            }
        }
        finally {
            this.lastCheck = new Date(this.now).toISOString();
            this.busy = false;
            this.d.notifier.channel(this.status());
        }
        return this.status();
    }
    /** Mientras estás en directo guarda cuántos mensajes hay cada segundo; al terminar, deja el archivo definitivo. */
    syncChat(creds, stream) {
        const c = this.d.chat;
        if (!c)
            return;
        if (stream.live && stream.startedAt && c.enabled()) {
            if (!this.chatLogger || this.chatStart !== stream.startedAt) {
                this.stopChat();
                const startSec = Date.parse(stream.startedAt) / 1000;
                this.chatStart = stream.startedAt;
                this.chatBins = new chatlog_1.ChatBins();
                this.chatLogger = new chatlog_1.ChatLogger({ channel: creds.login, host: c.host, port: c.port, onMessage: (t) => this.chatBins.add(t, startSec) });
                this.chatLogger.start();
            }
            this.saveChat(); // cada vuelta: si la app se cierra a mitad, no se pierde todo
        }
        else if (this.chatLogger && this.offlineStreak >= OFFLINE_CONFIRMATIONS) {
            this.saveChat();
            this.stopChat();
        }
    }
    saveChat() {
        const c = this.d.chat;
        if (!c || !this.chatStart)
            return;
        const bins = this.chatBins.toArray();
        if (!bins.length)
            return;
        try {
            node_fs_1.default.mkdirSync(c.dir, { recursive: true });
            const file = node_path_1.default.join(c.dir, `${this.chatStart.replace(/[^\w-]/g, '_')}.json`);
            node_fs_1.default.writeFileSync(`${file}.tmp`, JSON.stringify({ startedAt: this.chatStart, bins }));
            node_fs_1.default.renameSync(`${file}.tmp`, file);
            this.chatSaved = bins.length;
        }
        catch (e) {
            this.d.log.warn(`No se pudo guardar el chat: ${e.message}`);
        }
    }
    stopChat() {
        this.chatLogger?.stop();
        this.chatLogger = null;
        this.chatStart = null;
    }
    /** Segundos de chat guardados del directo en curso (para el Panel). */
    chatSeconds() {
        return this.chatSaved;
    }
    /** Recoge los VODs nuevos de directos ya terminados. */
    async collect(creds, stream) {
        const vods = await this.d.twitch.listVods(creds);
        const st = this.state;
        if (!st.autoSince) {
            // primera vigilancia: lo que ya existe no se toca
            st.autoSince = new Date(this.now).toISOString();
            for (const v of vods)
                if (!st.seenVodIds.includes(v.id))
                    st.seenVodIds.push(v.id);
            this.d.store.save();
            return;
        }
        if (!stream.live && this.offlineStreak < OFFLINE_CONFIRMATIONS)
            return;
        const since = Date.parse(st.autoSince) - LIVE_VOD_SLACK_MS;
        const liveStart = stream.live && stream.startedAt ? Date.parse(stream.startedAt) - LIVE_VOD_SLACK_MS : Infinity;
        // los más antiguos primero, para que salgan en orden
        for (const v of [...vods].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
            if (st.seenVodIds.includes(v.id))
                continue;
            const created = Date.parse(v.createdAt);
            if (created < since) {
                st.seenVodIds.push(v.id);
                continue;
            }
            if (stream.live && created >= liveStart)
                continue; // es el directo en curso
            if (v.durationSec < MIN_IMPORT_SEC)
                continue; // Twitch aún lo está cerrando
            st.seenVodIds.push(v.id);
            this.d.store.save();
            const job = this.d.vods.add(v.url, v.title, { origin: 'live', twitchId: v.id, streamStartedAt: v.createdAt, durationSec: v.durationSec });
            this.lastImported = { vodId: job.id, title: v.title, at: new Date(this.now).toISOString() };
            this.d.log.info(`Directo terminado: recogiendo el VOD "${v.title}" (${v.url}).`);
        }
        if (st.seenVodIds.length > 500)
            st.seenVodIds.splice(0, st.seenVodIds.length - 500);
        this.d.store.save();
    }
    clipLoad = null;
    clipWarning = '';
    /** Lee todo el historial en segundo plano; la promesa devuelta se cumple en cuanto hay algo que enseñar (o falla si no hay nada). */
    startFull() {
        this.clipWarning = '';
        let firstDone;
        let firstFail;
        const first = new Promise((res, rej) => {
            firstDone = res;
            firstFail = rej;
        });
        first.catch(() => undefined);
        const merge = (list, complete) => {
            const byId = complete ? new Map() : (this.clipCache?.byId ?? new Map());
            for (const c of list)
                byId.set(c.id, c);
            this.clipCache = { fullAt: complete ? this.now : (this.clipCache?.fullAt ?? 0), byId };
        };
        this.clipLoad = this.d.twitch
            .listClips(this.d.creds(), { onProgress: (list) => { merge(list, false); firstDone(); }, onWarning: (m) => { this.clipWarning = m; } })
            .then((all) => {
            merge(all, true);
            firstDone();
        })
            .catch((e) => {
            this.clipWarning = this.clipCache ? `No se pudo actualizar el historial: ${e.message}` : '';
            firstFail(e);
        })
            .finally(() => {
            this.clipLoad = null;
        });
        return first;
    }
    /**
     * Clips del canal, más recientes primero. Lo reciente sale enseguida; el historial se sigue leyendo en segundo plano
     * (`loading`). Se pide entero de vez en cuando; entre medias solo lo reciente.
     */
    async clips(force = false) {
        const now = this.now;
        const fresh = this.clipCache !== undefined && this.clipCache.fullAt > 0 && now - this.clipCache.fullAt < CLIPS_FULL_MS;
        if ((force || !fresh) && !this.clipLoad) {
            const first = this.startFull();
            if (!this.clipCache)
                await first;
        }
        else if (fresh && !this.clipLoad) {
            try {
                const recent = await this.d.twitch.listClips(this.d.creds(), { sinceMs: now - CLIPS_RECENT_MS });
                for (const c of recent)
                    this.clipCache.byId.set(c.id, c);
            }
            catch (e) {
                this.clipWarning = `No se pudieron buscar clips nuevos: ${e.message}`;
            }
        }
        else if (!this.clipCache && this.clipLoad) {
            await this.clipLoad;
        }
        const list = [...(this.clipCache?.byId.values() ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => ({ ...c, imported: this.state.importedClipIds.includes(c.id) }));
        return { clips: list, loading: this.clipLoad !== null, warning: this.clipWarning };
    }
    async clipById(clipId) {
        const known = this.clipCache?.byId.get(clipId) ?? (await this.clips()).clips.find((c) => c.id === clipId);
        return known;
    }
    /** Dirección directa para ver un clip en el programa sin descargarlo ni añadirlo a la Biblioteca. */
    async clipStream(clipId) {
        const clip = await this.clipById(clipId);
        if (!clip)
            throw new Error('Ese clip ya no está en la lista de Twitch. Actualiza la lista.');
        if (!this.d.streamUrl)
            throw new Error('No se puede ver el clip desde aquí.');
        const url = await this.d.streamUrl(clip.url);
        if (!/^https?:\/\//.test(url))
            throw new Error('Twitch no dio una dirección válida para ver el clip.');
        return url;
    }
    /** Descarga un clip de Twitch; al terminar se renderiza en vertical y horizontal. */
    async importClip(clipId) {
        const clip = await this.clipById(clipId);
        if (!clip)
            throw new Error('Ese clip ya no está en la lista de Twitch. Actualiza la lista.');
        if (this.state.importedClipIds.includes(clip.id)) {
            const prev = this.d.store.data.vods.find((v) => v.twitchId === clip.id && v.status !== 'error');
            if (prev)
                return prev;
        }
        const job = this.d.vods.add(clip.url, clip.title, { origin: 'clip', twitchId: clip.id });
        if (!this.state.importedClipIds.includes(clip.id))
            this.state.importedClipIds.push(clip.id);
        this.d.store.save();
        return job;
    }
    afterDownload(job) {
        if (job.origin === 'clip') {
            void this.renderClip(job).catch((e) => this.d.log.error(`No se pudo preparar el clip "${job.title}"`, e));
        }
        else if (this.analyzeAfter.delete(job.id)) {
            this.fireAnalyze(job);
        }
        else if (job.origin === 'live') {
            for (const cb of this.liveListeners) {
                try {
                    cb(job);
                }
                catch (e) {
                    this.d.log.error('Fallo en el piloto automático', e);
                }
            }
        }
    }
    /** Un clip de Twitch entero, en las dos versiones. */
    renderClip(job) {
        const existing = this.clipOutputs.get(job.id);
        if (existing)
            return existing;
        const p = (async () => {
            const dur = await this.d.clips.vodDuration(job.id);
            const end = Math.floor(dur * 10) / 10;
            return this.d.clips.createClip(job.id, { start: 0, end, title: job.title || 'Clip de Twitch' });
        })();
        this.clipOutputs.set(job.id, p);
        p.catch(() => this.clipOutputs.delete(job.id));
        return p;
    }
}
exports.ChannelMonitor = ChannelMonitor;

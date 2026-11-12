"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VodService = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const downloader_1 = require("../services/downloader");
const files_1 = require("../services/files");
class VodService {
    d;
    download;
    listeners = [];
    constructor(d) {
        this.d = d;
        this.download = d.download ?? downloader_1.downloadVod;
    }
    /** Avisa cuando un VOD acaba de descargarse bien (lo usan la recogida automática y los clips de Twitch). */
    onDownloaded(cb) {
        this.listeners.push(cb);
    }
    get vodsDir() {
        return node_path_1.default.join(this.d.store.data.settings.outputDir, 'vods');
    }
    /** Añade un VOD a la cola de descarga. El mismo VOD (misma URL) no se descarga dos veces. */
    add(rawUrl, title, meta = {}) {
        const url = (0, downloader_1.parseVodUrl)(rawUrl);
        if (!url)
            throw new Error('La URL no es válida. Debe empezar por https:// (por ejemplo https://www.twitch.tv/videos/123456789).');
        const existing = this.d.store.data.vods.find((v) => v.url === url && v.status !== 'error');
        if (existing)
            return existing;
        const job = {
            id: node_crypto_1.default.randomUUID(),
            url,
            origin: meta.origin ?? 'manual',
            ...(meta.twitchId ? { twitchId: meta.twitchId } : {}),
            ...(meta.streamStartedAt ? { streamStartedAt: meta.streamStartedAt } : {}),
            ...(meta.durationSec ? { durationSec: meta.durationSec } : {}),
            title: title?.trim() ?? '',
            status: 'queued',
            progress: 0,
            createdAt: new Date().toISOString(),
        };
        this.d.store.data.vods.unshift(job);
        this.d.store.save();
        this.d.notifier.changed();
        void this.d.queue.run(() => this.runDownload(job));
        return job;
    }
    restores = new Map();
    /**
     * Ruta del archivo del directo. Si se borró para liberar espacio (o ya no está en su sitio) y se conoce su dirección,
     * se vuelve a descargar. Quien lo necesite lo pide antes de ocupar su cola de trabajo.
     */
    ensureFile(vodId) {
        const job = this.d.store.data.vods.find((v) => v.id === vodId);
        if (!job)
            return Promise.reject(new Error('El VOD no existe.'));
        if (job.status === 'downloaded' && job.filePath && node_fs_1.default.existsSync(job.filePath))
            return Promise.resolve(job.filePath);
        const running = this.restores.get(vodId);
        if (running)
            return running;
        if (job.origin === 'clip' || !job.url)
            return Promise.reject(new Error('El archivo del VOD ya no está en su sitio (¿lo has movido o borrado?).'));
        if (job.status === 'queued' || job.status === 'downloading')
            return Promise.reject(new Error('El VOD todavía no está descargado (se está descargando).'));
        if (job.status === 'error' && !job.cleaned && !job.filePath)
            return Promise.reject(new Error(`El VOD no se pudo descargar: ${job.error ?? 'error desconocido'}`));
        this.d.log.info(`Volviendo a descargar el directo "${job.title}" (${job.url}).`);
        job.status = 'queued';
        job.progress = 0;
        job.error = undefined;
        job.filePath = undefined;
        this.d.store.save();
        this.d.notifier.vod(job);
        const p = this.d.queue
            .run(() => this.runDownload(job, true))
            .then(() => {
            if (job.status !== 'downloaded' || !job.filePath)
                throw new Error(`No se pudo volver a descargar el directo: ${job.error ?? 'error desconocido'}`);
            return job.filePath;
        })
            .finally(() => this.restores.delete(vodId));
        this.restores.set(vodId, p);
        return p;
    }
    /** Borra del disco el directo completo (y lo que dejó la descarga junto a él). Devuelve los bytes liberados. */
    discardSource(vodId) {
        const job = this.d.store.data.vods.find((v) => v.id === vodId);
        if (!job)
            throw new Error('El VOD no existe.');
        if (job.origin === 'clip')
            throw new Error('Los clips de Twitch descargados no se borran: son el origen de su vídeo.');
        if (job.status === 'queued' || job.status === 'downloading')
            throw new Error('El VOD todavía no está descargado (se está descargando).');
        let freed = 0;
        if (job.filePath) {
            const dir = node_path_1.default.dirname(job.filePath);
            const stem = node_path_1.default.basename(job.filePath, node_path_1.default.extname(job.filePath));
            const files = node_fs_1.default.existsSync(dir) ? node_fs_1.default.readdirSync(dir).filter((f) => f === node_path_1.default.basename(job.filePath) || f.startsWith(`${stem}.`)) : [];
            for (const f of files) {
                const full = node_path_1.default.join(dir, f);
                try {
                    freed += node_fs_1.default.statSync(full).size;
                    node_fs_1.default.rmSync(full, { force: true });
                }
                catch (e) {
                    this.d.log.warn(`No se pudo borrar ${full}: ${e.message}`);
                }
            }
        }
        job.filePath = undefined;
        job.status = 'downloaded';
        job.cleaned = { at: new Date().toISOString(), freedBytes: freed };
        this.d.store.save();
        this.d.notifier.vod(job);
        this.d.notifier.changed();
        return freed;
    }
    /** Al arrancar: lo que estaba descargándose cuando se cerró la app no se puede dar por bueno. */
    recoverInterrupted() {
        let n = 0;
        for (const v of this.d.store.data.vods) {
            if (v.status === 'queued' || v.status === 'downloading') {
                v.status = 'error';
                v.error = 'La descarga se interrumpió al cerrar la aplicación. Vuelve a añadir el VOD.';
                n++;
            }
        }
        if (n)
            this.d.store.save();
        return n;
    }
    async runDownload(job, silent = false) {
        try {
            (0, files_1.ensureFreeSpace)(this.d.store.data.settings.outputDir, (0, files_1.vodBytesEstimate)(job.durationSec), 'descargar el VOD', this.d.freeBytes ?? files_1.freeBytes);
            job.status = 'downloading';
            job.error = undefined;
            this.d.notifier.vod(job);
            this.d.log.info(`Descarga iniciada: ${job.url}`);
            let lastSent = -1;
            const res = await this.download(this.d.tools(), job.url, this.vodsDir, (pct) => {
                job.progress = pct;
                // se avisa como mucho una vez por cada 1 % para no saturar la interfaz
                if (Math.floor(pct) !== lastSent) {
                    lastSent = Math.floor(pct);
                    this.d.notifier.vod(job);
                }
            });
            // si yt-dlp devolvió un título con caracteres rotos, se conserva el que ya teníamos (el de Twitch)
            job.title = res.title && !(res.title.includes('\uFFFD') && job.title && !job.title.includes('\uFFFD')) ? res.title : job.title;
            job.filePath = res.filePath;
            job.cleaned = undefined;
            job.status = 'downloaded';
            job.progress = 100;
            this.d.log.info(`Descarga completada: ${res.filePath}`);
        }
        catch (e) {
            job.status = 'error';
            job.error = e.message;
            this.d.log.error(`Descarga fallida: ${job.url}`, e);
        }
        this.d.store.save();
        this.d.notifier.vod(job);
        this.d.notifier.changed();
        if (job.status === 'downloaded' && !silent) {
            for (const cb of this.listeners) {
                try {
                    cb(job);
                }
                catch (e) {
                    this.d.log.error('Fallo al reaccionar a una descarga terminada', e);
                }
            }
        }
    }
}
exports.VodService = VodService;

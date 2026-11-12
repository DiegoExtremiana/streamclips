"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudService = void 0;
exports.parseRepo = parseRepo;
exports.sealSecret = sealSecret;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const libsodium_wrappers_1 = __importDefault(require("libsodium-wrappers"));
const types_1 = require("../../shared/types");
const github_1 = require("../services/cloud/github");
const jobs_1 = require("../services/cloud/jobs");
const workflow_1 = require("../services/cloud/workflow");
const youtube_1 = require("../services/social/youtube");
const tiktok_1 = require("../services/social/tiktok");
const instagram_1 = require("../services/social/instagram");
const WORKFLOW = '.github/workflows/publish.yml';
const RUNNER = 'runner/runner.js';
const SECRET = 'STREAMCLIPS_CREDS';
/** Nombre «usuario/repositorio»; acepta también la URL de GitHub. */
function parseRepo(raw) {
    const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(raw.trim());
    return m ? `${m[1]}/${m[2]}` : null;
}
/** Cifra un secreto como pide GitHub (caja sellada con la clave pública del repositorio). */
async function sealSecret(publicKeyB64, value) {
    await libsodium_wrappers_1.default.ready;
    const key = libsodium_wrappers_1.default.from_base64(publicKeyB64, libsodium_wrappers_1.default.base64_variants.ORIGINAL);
    const enc = libsodium_wrappers_1.default.crypto_box_seal(libsodium_wrappers_1.default.from_string(value), key);
    return libsodium_wrappers_1.default.to_base64(enc, libsodium_wrappers_1.default.base64_variants.ORIGINAL);
}
/**
 * Publicar con el PC apagado: lo programado se sube a un repositorio PRIVADO de tu GitHub y una ejecución programada
 * (GitHub Actions) lo publica a su hora. Al publicarse se borra la copia de la nube; la tuya sigue en tu PC.
 */
class CloudService {
    d;
    timer = null;
    syncing = false;
    error = null;
    credsAt = 0;
    constructor(d) {
        this.d = d;
    }
    get st() {
        return this.d.store.data.cloud;
    }
    now() {
        return (this.d.now ?? Date.now)();
    }
    gh() {
        if (!this.st.repo || !this.st.token)
            throw new Error('El modo nube no está configurado.');
        return new github_1.Github({ token: this.d.secrets.decode(this.st.token), repo: this.st.repo, ...this.d.github });
    }
    status() {
        return {
            enabled: this.st.enabled,
            repo: this.st.repo,
            hasToken: !!this.st.token,
            lastSync: this.st.lastSync,
            error: this.error,
            queued: this.d.store.data.publications.filter((p) => p.cloud && (p.cloud.state === 'queued' || p.cloud.state === 'publishing')).length,
            syncing: this.syncing,
        };
    }
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => void this.sync(), this.d.intervalMs ?? 2 * 60_000);
        this.timer.unref?.();
        if (this.st.enabled)
            void this.sync();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
    }
    /** Configura el repositorio: comprueba que es privado, instala el publicador y sube los permisos de tus redes. */
    async setup(repoRaw, token) {
        const repo = parseRepo(repoRaw);
        if (!repo)
            throw new Error('El repositorio debe ser «usuario/nombre» (por ejemplo diego/streamclips-nube).');
        const tok = token === types_1.MASKED_SECRET ? this.d.secrets.decode(this.st.token) : token.trim();
        if (!tok)
            throw new Error('Pega el token de GitHub.');
        const gh = new github_1.Github({ token: tok, repo, ...this.d.github });
        const info = await gh.repoInfo();
        if (!info.private)
            throw new Error('El repositorio es PÚBLICO: tus vídeos quedarían a la vista de todos. Crea uno privado y vuelve a intentarlo.');
        this.st.repo = info.fullName;
        this.st.token = this.d.secrets.encode(tok);
        this.st.enabled = true;
        this.st.workflowCrons = '';
        this.d.store.save();
        try {
            await this.installRunner(gh, info.defaultBranch);
            await this.syncCreds(gh);
            this.credsAt = this.now();
        }
        catch (e) {
            this.st.enabled = false;
            this.d.store.save();
            throw e;
        }
        this.d.log.info(`Modo nube activado en ${this.st.repo}`);
        await this.sync();
        return this.status();
    }
    async installRunner(gh, branch) {
        const put = async (p, text, msg) => {
            const cur = await gh.getContent(p);
            if (cur?.text === text)
                return;
            const sha = await gh.putContent(p, text, msg, cur?.sha);
            if (!sha)
                throw new Error(`No se pudo escribir ${p} en GitHub (cambió a la vez). Inténtalo de nuevo.`);
        };
        await put(RUNNER, this.d.runnerSource(), 'StreamClips: publicador');
        await put('README.md', '# StreamClips (nube)\n\nRepositorio privado de StreamClips: cola de vídeos y publicador. No lo edites a mano.\n', 'StreamClips: leeme');
        await this.syncWorkflow(gh, true);
        void branch;
    }
    /** Reescribe el flujo con las horas que hacen falta. */
    async syncWorkflow(gh, force = false) {
        const times = this.d.store.data.publications
            .filter((p) => p.cloud?.state === 'queued')
            .map((p) => new Date(p.scheduledAt))
            .filter((d) => d.getTime() > this.now() - 60_000);
        const a = this.d.store.data.settings.autopilot;
        for (const hhmm of [...a.videoTimes, ...a.clipTimes]) {
            const [h, m] = hhmm.split(':').map(Number);
            const d = new Date(this.now());
            d.setHours(h, m, 0, 0);
            times.push(d);
        }
        const crons = (0, workflow_1.cronLines)(times);
        const key = crons.join('|');
        if (!force && key === this.st.workflowCrons)
            return;
        const text = (0, workflow_1.workflowYaml)(crons);
        const cur = await gh.getContent(WORKFLOW);
        if (cur?.text !== text) {
            const sha = await gh.putContent(WORKFLOW, text, 'StreamClips: horas de publicación', cur?.sha);
            if (!sha)
                throw new Error('No se pudo escribir el flujo de publicación en GitHub.');
        }
        this.st.workflowCrons = key;
        this.d.store.save();
    }
    /** Sube las claves de tus redes como secreto cifrado del repositorio. */
    async syncCreds(gh = this.gh()) {
        const creds = {};
        const raw = this.d.store.data.connections;
        for (const p of ['youtube', 'tiktok']) {
            const c = raw[p];
            const t = c?.tokens ? await this.d.connections.accessToken(p) : null;
            if (c && t?.refreshToken)
                creds[p] = { clientId: c.clientId, clientSecret: this.d.secrets.decode(c.clientSecret), refreshToken: t.refreshToken };
        }
        const ig = raw.instagram;
        const igt = ig?.tokens ? await this.d.connections.accessToken('instagram') : null;
        if (ig && igt?.extra?.igUserId)
            creds.instagram = { clientId: ig.clientId, clientSecret: this.d.secrets.decode(ig.clientSecret), accessToken: igt.accessToken, igUserId: igt.extra.igUserId };
        const pk = await gh.publicKey();
        await gh.putSecret(SECRET, await sealSecret(pk.key, JSON.stringify(creds)), pk.keyId);
    }
    filesFor(o, platform) {
        const video = platform === 'youtube' ? (0, youtube_1.youtubeFile)(o).file : platform === 'tiktok' ? (0, tiktok_1.tiktokFile)(o) : (0, instagram_1.instagramFile)(o);
        return { video, ...(platform === 'youtube' && o.kind === 'long' && o.thumbnail && node_fs_1.default.existsSync(o.thumbnail) ? { thumb: o.thumbnail } : {}) };
    }
    /** Una pasada: sube lo nuevo, trae el estado de lo ya subido y limpia lo cancelado. Nunca lanza. */
    sync() {
        if (!this.st.enabled || this.syncing)
            return Promise.resolve(this.status());
        return this.d.queue.run(async () => {
            this.syncing = true;
            this.error = null;
            try {
                const gh = this.gh();
                if (!this.d.headless && this.now() - this.credsAt > 12 * 3600_000) {
                    await this.syncCreds(gh); // las claves de tus redes se renuevan: la nube necesita las vigentes
                    this.credsAt = this.now();
                }
                await this.pull(gh);
                await this.adopt(gh);
                await this.push(gh);
                await this.cleanOrphans(gh);
                await this.syncWorkflow(gh);
                this.st.lastSync = new Date(this.now()).toISOString();
                this.d.store.save();
            }
            catch (e) {
                this.error = e.message;
                this.d.log.warn(`Nube: ${this.error}`);
            }
            finally {
                this.syncing = false;
                this.d.notifier.changed();
            }
            return this.status();
        });
    }
    /** Trae el estado de lo ya subido. */
    async pull(gh) {
        const publishedNow = [];
        for (const pub of this.d.store.data.publications.filter((p) => p.cloud && (p.cloud.state === 'queued' || p.cloud.state === 'publishing'))) {
            const c = await gh.getContent((0, jobs_1.jobPath)(pub.key));
            const job = c && (0, jobs_1.parseJob)(c.text);
            if (!c || !job) {
                pub.cloud = undefined; // el trabajo desapareció: lo recoge de nuevo el programador del PC o se vuelve a subir
                continue;
            }
            if (job.status === 'published') {
                pub.status = 'published';
                pub.cloud = { state: 'published' };
                pub.note = undefined;
                this.d.log.info(`Publicado desde la nube: ${pub.key}`);
                publishedNow.push(pub.outputId);
            }
            else if (job.status === 'failed') {
                pub.status = 'failed';
                pub.cloud = { state: 'failed' };
                pub.note = job.note ?? 'Falló la publicación desde la nube.';
                await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
            }
            else if (job.status === 'publishing') {
                pub.cloud = { state: 'publishing' };
            }
            else {
                // lo que cambias en el programa (hora, nombre, descripción…) se refleja en el trabajo que espera en la nube
                const o = this.d.store.data.outputs.find((x) => x.id === pub.outputId);
                let changed = false;
                if (Date.parse(job.scheduledAt) !== Date.parse(pub.scheduledAt)) {
                    job.scheduledAt = new Date(pub.scheduledAt).toISOString();
                    changed = true;
                }
                if (o) {
                    const same = (a, b) => (a ?? '') === (b ?? '');
                    if (job.title !== o.title) {
                        job.title = o.title;
                        changed = true;
                    }
                    if (!same(job.description, o.description)) {
                        job.description = o.description || undefined;
                        changed = true;
                    }
                    if (!same(job.playlist, o.playlist)) {
                        job.playlist = o.playlist || undefined;
                        changed = true;
                    }
                    if (o.visibility !== job.visibility) {
                        job.visibility = o.visibility;
                        changed = true;
                    }
                }
                if (changed) {
                    job.updatedAt = new Date(this.now()).toISOString();
                    await gh.putContent((0, jobs_1.jobPath)(pub.key), (0, jobs_1.serializeJob)(job), `Cambios: ${pub.key}`, c.sha);
                }
            }
        }
        this.d.store.save();
        for (const id of new Set(publishedNow)) {
            try {
                this.d.onPublished?.(id);
            }
            catch (e) {
                this.d.log.warn(`Tras publicar desde la nube: ${e.message}`);
            }
        }
        this.d.notifier.changed();
    }
    /**
     * Trae al programa lo que el motor nocturno dejó en la cola mientras el PC estaba apagado: aparece en el calendario
     * y se puede cambiar (nombre, descripción, hora, redes). Los vídeos viven en la nube; aquí solo están sus datos.
     */
    async adopt(gh) {
        const st = this.d.store.data;
        const known = new Set(st.publications.map((p) => (0, jobs_1.jobPath)(p.key).split('/')[1]));
        for (const p of st.publications)
            if (p.cloud && !this.st.known.includes(p.key))
                this.st.known.push(p.key); // lo que ya está en la nube y es tuyo
        const seen = new Set(this.st.known);
        let added = 0;
        for (const f of await gh.listDir('queue')) {
            if (!f.name.endsWith('.json') || known.has(f.name))
                continue;
            const c = await gh.getContent(`queue/${f.name}`);
            const job = c && (0, jobs_1.parseJob)(c.text);
            if (!job)
                continue;
            const outputId = job.key.slice(0, job.key.lastIndexOf(':'));
            if (!outputId || st.publications.some((p) => p.key === job.key) || seen.has(job.key))
                continue;
            this.st.known.push(job.key);
            if (!st.outputs.some((o) => o.id === outputId)) {
                st.outputs.push({
                    id: outputId,
                    kind: job.kind,
                    title: job.title,
                    ...(job.description ? { description: job.description } : {}),
                    ...(job.playlist ? { playlist: job.playlist } : {}),
                    ...(job.visibility ? { visibility: job.visibility } : {}),
                    files: {},
                    durationSec: 0,
                    createdAt: job.updatedAt,
                    remote: true,
                });
            }
            const status = job.status === 'published' ? 'published' : job.status === 'failed' ? 'failed' : 'scheduled';
            st.publications.push({
                key: job.key,
                outputId,
                platform: job.platform,
                scheduledAt: job.scheduledAt,
                status,
                ...(job.note ? { note: job.note } : {}),
                cloud: { state: job.status },
            });
            added++;
        }
        if (added) {
            this.d.log.info(`Nube: ${added} subida(s) preparadas en la nube se han añadido al programa.`);
            this.d.store.save();
            this.d.notifier.changed();
        }
    }
    /** Sube lo programado que aún no está en la nube. */
    async push(gh) {
        const todo = this.d.store.data.publications.filter((p) => p.status === 'scheduled' && !p.cloud);
        for (const pub of todo) {
            const o = this.d.store.data.outputs.find((x) => x.id === pub.outputId);
            if (!o)
                continue;
            if (o.remote) {
                // el vídeo solo existe en la nube: si su trabajo se quitó (o nunca existió para esta red) no hay archivo que subir
                pub.status = 'failed';
                pub.note = 'Este vídeo vive en la nube y esa red ya no está en su cola, así que no se puede volver a añadir desde aquí.';
                continue;
            }
            let files;
            try {
                files = this.filesFor(o, pub.platform);
            }
            catch (e) {
                pub.status = 'failed';
                pub.note = e.message;
                continue;
            }
            if (!node_fs_1.default.existsSync(files.video)) {
                pub.status = 'failed';
                pub.note = 'El archivo del vídeo ya no está en su sitio.';
                continue;
            }
            const existing = await gh.getContent((0, jobs_1.jobPath)(pub.key));
            const prev = existing && (0, jobs_1.parseJob)(existing.text);
            if (prev && prev.status !== 'failed') {
                pub.cloud = { state: prev.status }; // ya estaba subido (p. ej. la app se cerró justo después)
                continue;
            }
            const task = this.d.tasks.start('cloud', `Subiendo a la nube: ${o.title} (${pub.platform})`);
            const tag = (0, jobs_1.releaseTag)(pub.key);
            let rel = null;
            try {
                rel = await gh.createRelease(tag, `${o.title} (${pub.platform})`).catch(async (e) => {
                    if (e.status !== 422)
                        throw e;
                    // quedó una subida a medias de un intento anterior: se limpia y se rehace
                    throw new github_1.GithubError(`Hay una subida anterior a medias de «${o.title}». Pulsa «Sincronizar» para reintentar.`, 422);
                });
                const size = node_fs_1.default.statSync(files.video).size;
                const asset = await gh.uploadAsset(rel.id, node_path_1.default.basename(files.video), files.video, 'video/mp4');
                task.update(90);
                const thumb = files.thumb ? await gh.uploadAsset(rel.id, node_path_1.default.basename(files.thumb), files.thumb, 'image/jpeg').catch(() => null) : null;
                const job = {
                    v: 1,
                    key: pub.key,
                    platform: pub.platform,
                    scheduledAt: new Date(pub.scheduledAt).toISOString(),
                    status: 'queued',
                    title: o.title,
                    ...(o.description ? { description: o.description } : {}),
                    ...(o.playlist ? { playlist: o.playlist } : {}),
                    ...(o.visibility ? { visibility: o.visibility } : {}),
                    kind: o.kind,
                    releaseId: rel.id,
                    releaseTag: tag,
                    file: { name: node_path_1.default.basename(files.video), assetId: asset.id, size },
                    ...(thumb ? { thumb: { name: node_path_1.default.basename(files.thumb), assetId: thumb.id } } : {}),
                    updatedAt: new Date(this.now()).toISOString(),
                };
                const sha = await gh.putContent((0, jobs_1.jobPath)(pub.key), (0, jobs_1.serializeJob)(job), `En cola: ${pub.key}`, prev ? existing.sha : undefined);
                if (!sha)
                    throw new Error('No se pudo registrar el trabajo en la cola de GitHub.');
                pub.cloud = { state: 'queued' };
                pub.note = undefined;
                if (!this.st.known.includes(pub.key))
                    this.st.known.push(pub.key);
                this.d.store.save();
                task.done('En la cola de la nube');
                rel = null;
            }
            catch (e) {
                task.fail(e.message);
                if (rel)
                    await gh.deleteRelease(rel.id, tag).catch(() => undefined);
                if (e instanceof github_1.GithubError && e.status === 422) {
                    pub.status = 'failed'; // no tiene arreglo reintentando (p. ej. pasa de 2 GB)
                    pub.note = e.message;
                    this.d.store.save();
                }
                else {
                    this.error = e.message; // se reintenta en la siguiente pasada
                    this.d.log.warn(`Nube: ${this.error}`);
                }
                continue;
            }
            // si ya es la hora (o casi), se pide una ejecución ahora mismo en vez de esperar al cron
            if (Date.parse(pub.scheduledAt) <= this.now() + 60_000) {
                const info = await gh.repoInfo();
                await gh.dispatch('publish.yml', info.defaultBranch).catch((e) => this.d.log.warn(`No se pudo lanzar la publicación: ${e.message}`));
            }
        }
    }
    /** Quita de la nube lo que ya no está programado en el programa. */
    async cleanOrphans(gh) {
        const keep = new Set(this.d.store.data.publications.filter((p) => p.cloud && p.cloud.state !== 'published').map((p) => (0, jobs_1.jobPath)(p.key).split('/')[1]));
        for (const f of await gh.listDir('queue')) {
            if (keep.has(f.name) || !f.name.endsWith('.json'))
                continue;
            const c = await gh.getContent(`queue/${f.name}`);
            const job = c && (0, jobs_1.parseJob)(c.text);
            if (!c || !job)
                continue;
            if (job.status === 'queued' || job.status === 'failed') {
                await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
                await gh.deleteContent(`queue/${f.name}`, c.sha, `Cancelado: ${job.key}`);
            }
            else if (job.status === 'published') {
                await gh.deleteContent(`queue/${f.name}`, c.sha, `Archivado: ${job.key}`); // el registro ya está en el programa
            }
        }
    }
    /** Quita la copia de la nube de una publicación cancelada o reprogramada. */
    async forget(pub) {
        if (!pub.cloud || !this.st.enabled)
            return;
        await this.sync();
    }
    /** Apaga el modo nube: borra lo subido y deja que el PC publique. */
    async disable() {
        if (this.st.enabled) {
            try {
                const gh = this.gh();
                for (const f of await gh.listDir('queue')) {
                    const c = await gh.getContent(`queue/${f.name}`);
                    const job = c && (0, jobs_1.parseJob)(c.text);
                    if (!c || !job)
                        continue;
                    if (job.status === 'queued' || job.status === 'failed') {
                        await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
                        await gh.deleteContent(`queue/${f.name}`, c.sha, `Desactivado: ${job.key}`);
                    }
                }
            }
            catch (e) {
                this.d.log.warn(`Nube: no se pudo limpiar al desactivar: ${e.message}`);
            }
        }
        for (const p of this.d.store.data.publications)
            if (p.cloud && (p.cloud.state === 'queued' || p.cloud.state === 'failed'))
                p.cloud = undefined;
        this.st.enabled = false;
        this.d.store.save();
        this.d.notifier.changed();
        return this.status();
    }
}
exports.CloudService = CloudService;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobPath = void 0;
exports.runQueue = runQueue;
exports.main = main;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const oauth_1 = require("../oauth");
const youtube_1 = require("../social/youtube");
const tiktok_1 = require("../social/tiktok");
const instagram_1 = require("../social/instagram");
const github_1 = require("./github");
const jobs_1 = require("./jobs");
Object.defineProperty(exports, "jobPath", { enumerable: true, get: function () { return jobs_1.jobPath; } });
const log = (m) => console.log(`[streamclips] ${m}`);
async function tokenFor(platform, c, env) {
    const prov = env.providers ?? oauth_1.PROVIDERS;
    const d = { fetchFn: env.fetchFn };
    if (platform === 'youtube' || platform === 'tiktok') {
        const cred = c[platform];
        if (!cred)
            throw new Error(`Falta la conexión de ${platform} en la nube. Sincronízala desde el programa.`);
        const t = await (0, oauth_1.refreshToken)(platform === 'youtube' ? prov.google : prov.tiktok, { clientId: cred.clientId, clientSecret: cred.clientSecret }, { accessToken: '', refreshToken: cred.refreshToken, expiresAt: 0 }, d);
        return { accessToken: t.accessToken };
    }
    const cred = c.instagram;
    if (!cred)
        throw new Error('Falta la conexión de Instagram en la nube. Sincronízala desde el programa.');
    const t = await (0, oauth_1.refreshToken)(prov.meta, { clientId: cred.clientId, clientSecret: cred.clientSecret }, { accessToken: cred.accessToken, expiresAt: 0 }, d);
    return { accessToken: t.accessToken, igUserId: cred.igUserId };
}
async function publishJob(job, gh, creds, env, tmp) {
    const file = node_path_1.default.join(tmp, job.file.name);
    await gh.downloadAsset(job.file.assetId, file);
    if (node_fs_1.default.statSync(file).size !== job.file.size)
        throw new Error('El vídeo descargado de la nube está incompleto.');
    let thumbnail;
    if (job.thumb) {
        thumbnail = node_path_1.default.join(tmp, job.thumb.name);
        await gh.downloadAsset(job.thumb.assetId, thumbnail).catch(() => (thumbnail = undefined));
    }
    const out = {
        id: job.key,
        kind: job.kind,
        title: job.title,
        description: job.description,
        playlist: job.playlist,
        visibility: job.visibility,
        files: job.kind === 'long' ? { long: file } : { vertical: file },
        durationSec: 0,
        createdAt: job.updatedAt,
        ...(thumbnail ? { thumbnail } : {}),
    };
    const base = { fetchFn: env.fetchFn, sleep: env.sleep, warn: (m) => log(m) };
    if (job.platform === 'youtube') {
        // los clips de YouTube se suben en vertical (Shorts); el archivo ya es el correcto
        await (0, youtube_1.publishYoutube)({ ...base, token: async () => (await tokenFor('youtube', creds, env)).accessToken, endpoints: env.youtube, chunkSize: env.chunkSize }, out);
    }
    else if (job.platform === 'tiktok') {
        await (0, tiktok_1.publishTiktok)({ ...base, token: async () => (await tokenFor('tiktok', creds, env)).accessToken, api: env.tiktokApi, chunkSize: env.chunkSize, pollMs: env.pollMs }, out);
    }
    else {
        await (0, instagram_1.publishInstagram)({ ...base, graph: env.graph, pollMs: env.pollMs, token: async () => {
                const t = await tokenFor('instagram', creds, env);
                return { accessToken: t.accessToken, igUserId: t.igUserId ?? '' };
            } }, out);
    }
}
/**
 * Se ejecuta en GitHub Actions: publica lo vencido de la cola. Cada trabajo se «reserva» con una escritura
 * condicionada al sha del archivo, así dos ejecuciones nunca publican lo mismo; lo que se quedó a medias
 * se marca como fallido y no se reintenta solo.
 */
async function runQueue(gh, creds, env = {}, now = Date.now) {
    const res = { published: [], failed: [], skipped: [] };
    const files = await gh.listDir('queue');
    for (const f of files.filter((x) => x.name.endsWith('.json'))) {
        const p = `queue/${f.name}`;
        const c = await gh.getContent(p);
        const job = c && (0, jobs_1.parseJob)(c.text);
        if (!c || !job)
            continue;
        const stamp = () => new Date(now()).toISOString();
        if (job.status === 'publishing') {
            // una ejecución anterior murió a mitad: no sabemos si llegó a publicarse
            job.status = 'failed';
            job.note = 'Se interrumpió a mitad de publicar: comprueba en la red si salió antes de reprogramarlo.';
            job.updatedAt = stamp();
            await gh.putContent(p, (0, jobs_1.serializeJob)(job), `Interrumpido: ${job.key}`, c.sha);
            res.failed.push(job.key);
            continue;
        }
        if (job.status !== 'queued' || Date.parse(job.scheduledAt) > now()) {
            res.skipped.push(job.key);
            continue;
        }
        // reserva atómica
        job.status = 'publishing';
        job.updatedAt = stamp();
        const sha = await gh.putContent(p, (0, jobs_1.serializeJob)(job), `Publicando: ${job.key}`, c.sha);
        if (!sha) {
            res.skipped.push(job.key);
            continue;
        }
        const tmp = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'streamclips-cloud-'));
        try {
            await publishJob(job, gh, creds, env, tmp);
            job.status = 'published';
            job.note = undefined;
            log(`Publicado: ${job.key}`);
            res.published.push(job.key);
        }
        catch (e) {
            job.status = 'failed';
            job.note = e.message.slice(0, 400);
            log(`Fallo en ${job.key}: ${job.note}`);
            res.failed.push(job.key);
        }
        finally {
            node_fs_1.default.rmSync(tmp, { recursive: true, force: true });
        }
        job.updatedAt = stamp();
        const latest = await gh.getContent(p);
        await gh.putContent(p, (0, jobs_1.serializeJob)(job), `${job.status === 'published' ? 'Publicado' : 'Fallido'}: ${job.key}`, latest?.sha);
        // una vez publicado, la copia en la nube sobra (la tuya sigue en tu PC)
        if (job.status === 'published')
            await gh.deleteRelease(job.releaseId, job.releaseTag).catch((e) => log(`No se pudo borrar la copia de la nube: ${e.message}`));
    }
    return res;
}
/** Punto de entrada en Actions. */
async function main() {
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GITHUB_TOKEN;
    if (!repo || !token)
        throw new Error('Faltan GITHUB_REPOSITORY o GITHUB_TOKEN.');
    const creds = JSON.parse(process.env.STREAMCLIPS_CREDS || '{}');
    const gh = new github_1.Github({ token, repo, api: process.env.STREAMCLIPS_GITHUB_API || undefined, uploads: process.env.STREAMCLIPS_GITHUB_UPLOADS || undefined });
    const r = await runQueue(gh, creds);
    log(`Publicados: ${r.published.length}, fallidos: ${r.failed.length}, en espera: ${r.skipped.length}`);
}

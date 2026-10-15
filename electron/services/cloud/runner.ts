import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { OutputItem, Platform } from '../../../shared/types';
import { PROVIDERS, refreshToken, type OAuthProvider, type TokenSet } from '../oauth';
import { publishYoutube, type YoutubeEndpoints } from '../social/youtube';
import { publishTiktok } from '../social/tiktok';
import { publishInstagram } from '../social/instagram';
import { Github } from './github';
import { jobPath, parseJob, serializeJob, type CloudJob } from './jobs';

export interface CloudCreds {
  youtube?: { clientId: string; clientSecret: string; refreshToken: string };
  tiktok?: { clientId: string; clientSecret: string; refreshToken: string };
  instagram?: { clientId: string; clientSecret: string; accessToken: string; igUserId: string };
}

export interface RunnerEnv {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  youtube?: YoutubeEndpoints;
  tiktokApi?: string;
  graph?: string;
  providers?: Record<keyof typeof PROVIDERS, OAuthProvider>;
  chunkSize?: number;
  pollMs?: number;
}

export interface RunnerResult {
  published: string[];
  failed: string[];
  skipped: string[];
}

const log = (m: string) => console.log(`[streamclips] ${m}`);

async function tokenFor(platform: Platform, c: CloudCreds, env: RunnerEnv): Promise<{ accessToken: string; igUserId?: string }> {
  const prov = env.providers ?? PROVIDERS;
  const d = { fetchFn: env.fetchFn };
  if (platform === 'youtube' || platform === 'tiktok') {
    const cred = c[platform];
    if (!cred) throw new Error(`Falta la conexión de ${platform} en la nube. Sincronízala desde el programa.`);
    const t = await refreshToken(platform === 'youtube' ? prov.google : prov.tiktok, { clientId: cred.clientId, clientSecret: cred.clientSecret }, { accessToken: '', refreshToken: cred.refreshToken, expiresAt: 0 } satisfies TokenSet, d);
    return { accessToken: t.accessToken };
  }
  const cred = c.instagram;
  if (!cred) throw new Error('Falta la conexión de Instagram en la nube. Sincronízala desde el programa.');
  const t = await refreshToken(prov.meta, { clientId: cred.clientId, clientSecret: cred.clientSecret }, { accessToken: cred.accessToken, expiresAt: 0 }, d);
  return { accessToken: t.accessToken, igUserId: cred.igUserId };
}

async function publishJob(job: CloudJob, gh: Github, creds: CloudCreds, env: RunnerEnv, tmp: string): Promise<void> {
  const file = path.join(tmp, job.file.name);
  await gh.downloadAsset(job.file.assetId, file);
  if (fs.statSync(file).size !== job.file.size) throw new Error('El vídeo descargado de la nube está incompleto.');
  let thumbnail: string | undefined;
  if (job.thumb) {
    thumbnail = path.join(tmp, job.thumb.name);
    await gh.downloadAsset(job.thumb.assetId, thumbnail).catch(() => (thumbnail = undefined));
  }
  const out: OutputItem = {
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
  const base = { fetchFn: env.fetchFn, sleep: env.sleep, warn: (m: string) => log(m) };
  if (job.platform === 'youtube') {
    // los clips de YouTube se suben en vertical (Shorts); el archivo ya es el correcto
    await publishYoutube({ ...base, token: async () => (await tokenFor('youtube', creds, env)).accessToken, endpoints: env.youtube, chunkSize: env.chunkSize }, out);
  } else if (job.platform === 'tiktok') {
    await publishTiktok({ ...base, token: async () => (await tokenFor('tiktok', creds, env)).accessToken, api: env.tiktokApi, chunkSize: env.chunkSize, pollMs: env.pollMs }, out);
  } else {
    await publishInstagram({ ...base, graph: env.graph, pollMs: env.pollMs, token: async () => {
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
export async function runQueue(gh: Github, creds: CloudCreds, env: RunnerEnv = {}, now: () => number = Date.now): Promise<RunnerResult> {
  const res: RunnerResult = { published: [], failed: [], skipped: [] };
  const files = await gh.listDir('queue');
  for (const f of files.filter((x) => x.name.endsWith('.json'))) {
    const p = `queue/${f.name}`;
    const c = await gh.getContent(p);
    const job = c && parseJob(c.text);
    if (!c || !job) continue;
    const stamp = () => new Date(now()).toISOString();

    if (job.status === 'publishing') {
      // una ejecución anterior murió a mitad: no sabemos si llegó a publicarse
      job.status = 'failed';
      job.note = 'Se interrumpió a mitad de publicar: comprueba en la red si salió antes de reprogramarlo.';
      job.updatedAt = stamp();
      await gh.putContent(p, serializeJob(job), `Interrumpido: ${job.key}`, c.sha);
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
    const sha = await gh.putContent(p, serializeJob(job), `Publicando: ${job.key}`, c.sha);
    if (!sha) {
      res.skipped.push(job.key);
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'streamclips-cloud-'));
    try {
      await publishJob(job, gh, creds, env, tmp);
      job.status = 'published';
      job.note = undefined;
      log(`Publicado: ${job.key}`);
      res.published.push(job.key);
    } catch (e) {
      job.status = 'failed';
      job.note = (e as Error).message.slice(0, 400);
      log(`Fallo en ${job.key}: ${job.note}`);
      res.failed.push(job.key);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    job.updatedAt = stamp();
    const latest = await gh.getContent(p);
    await gh.putContent(p, serializeJob(job), `${job.status === 'published' ? 'Publicado' : 'Fallido'}: ${job.key}`, latest?.sha);
    // una vez publicado, la copia en la nube sobra (la tuya sigue en tu PC)
    if (job.status === 'published') await gh.deleteRelease(job.releaseId, job.releaseTag).catch((e) => log(`No se pudo borrar la copia de la nube: ${(e as Error).message}`));
  }
  return res;
}

export { jobPath };

/** Punto de entrada en Actions. */
export async function main(): Promise<void> {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('Faltan GITHUB_REPOSITORY o GITHUB_TOKEN.');
  const creds = JSON.parse(process.env.STREAMCLIPS_CREDS || '{}') as CloudCreds;
  const gh = new Github({ token, repo, api: process.env.STREAMCLIPS_GITHUB_API || undefined, uploads: process.env.STREAMCLIPS_GITHUB_UPLOADS || undefined });
  const r = await runQueue(gh, creds);
  log(`Publicados: ${r.published.length}, fallidos: ${r.failed.length}, en espera: ${r.skipped.length}`);
}

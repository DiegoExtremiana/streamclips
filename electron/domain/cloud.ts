import fs from 'node:fs';
import path from 'node:path';
import sodium from 'libsodium-wrappers';
import type { CloudStatus, OutputItem, Platform, Publication } from '../../shared/types';
import { MASKED_SECRET } from '../../shared/types';
import type { Store } from '../services/store';
import type { Secrets } from '../services/secrets';
import type { Logger } from '../services/logger';
import type { SerialQueue } from '../services/queue';
import { Github, GithubError, type GithubOpts } from '../services/cloud/github';
import { jobPath, parseJob, releaseTag, serializeJob, type CloudJob } from '../services/cloud/jobs';
import { cronLines, workflowYaml } from '../services/cloud/workflow';
import type { CloudCreds } from '../services/cloud/runner';
import type { ConnectionService } from './connections';
import type { TaskTracker } from './tasks';
import type { Notifier } from './notifier';
import { youtubeFile } from '../services/social/youtube';
import { tiktokFile } from '../services/social/tiktok';
import { instagramFile } from '../services/social/instagram';

export interface CloudDeps {
  store: Store;
  secrets: Secrets;
  log: Logger;
  notifier: Notifier;
  tasks: TaskTracker;
  queue: SerialQueue;
  connections: ConnectionService;
  /** Contenido del publicador (runner.js) que se instala en el repositorio. */
  runnerSource: () => string;
  github?: Partial<GithubOpts>;
  intervalMs?: number;
  now?: () => number;
}

const WORKFLOW = '.github/workflows/publish.yml';
const RUNNER = 'runner/runner.js';
const SECRET = 'STREAMCLIPS_CREDS';

/** Nombre «usuario/repositorio»; acepta también la URL de GitHub. */
export function parseRepo(raw: string): string | null {
  const m = /^(?:https?:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(raw.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Cifra un secreto como pide GitHub (caja sellada con la clave pública del repositorio). */
export async function sealSecret(publicKeyB64: string, value: string): Promise<string> {
  await sodium.ready;
  const key = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const enc = sodium.crypto_box_seal(sodium.from_string(value), key);
  return sodium.to_base64(enc, sodium.base64_variants.ORIGINAL);
}

/**
 * Publicar con el PC apagado: lo programado se sube a un repositorio PRIVADO de tu GitHub y una ejecución programada
 * (GitHub Actions) lo publica a su hora. Al publicarse se borra la copia de la nube; la tuya sigue en tu PC.
 */
export class CloudService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private error: string | null = null;
  private credsAt = 0;

  constructor(private d: CloudDeps) {}

  private get st() {
    return this.d.store.data.cloud;
  }
  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  private gh(): Github {
    if (!this.st.repo || !this.st.token) throw new Error('El modo nube no está configurado.');
    return new Github({ token: this.d.secrets.decode(this.st.token), repo: this.st.repo, ...this.d.github });
  }

  status(): CloudStatus {
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

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), this.d.intervalMs ?? 2 * 60_000);
    this.timer.unref?.();
    if (this.st.enabled) void this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Configura el repositorio: comprueba que es privado, instala el publicador y sube los permisos de tus redes. */
  async setup(repoRaw: string, token: string): Promise<CloudStatus> {
    const repo = parseRepo(repoRaw);
    if (!repo) throw new Error('El repositorio debe ser «usuario/nombre» (por ejemplo diego/streamclips-nube).');
    const tok = token === MASKED_SECRET ? this.d.secrets.decode(this.st.token) : token.trim();
    if (!tok) throw new Error('Pega el token de GitHub.');
    const gh = new Github({ token: tok, repo, ...this.d.github });
    const info = await gh.repoInfo();
    if (!info.private) throw new Error('El repositorio es PÚBLICO: tus vídeos quedarían a la vista de todos. Crea uno privado y vuelve a intentarlo.');
    this.st.repo = info.fullName;
    this.st.token = this.d.secrets.encode(tok);
    this.st.enabled = true;
    this.st.workflowCrons = '';
    this.d.store.save();
    try {
      await this.installRunner(gh, info.defaultBranch);
      await this.syncCreds(gh);
      this.credsAt = this.now();
    } catch (e) {
      this.st.enabled = false;
      this.d.store.save();
      throw e;
    }
    this.d.log.info(`Modo nube activado en ${this.st.repo}`);
    await this.sync();
    return this.status();
  }

  private async installRunner(gh: Github, branch: string): Promise<void> {
    const put = async (p: string, text: string, msg: string) => {
      const cur = await gh.getContent(p);
      if (cur?.text === text) return;
      const sha = await gh.putContent(p, text, msg, cur?.sha);
      if (!sha) throw new Error(`No se pudo escribir ${p} en GitHub (cambió a la vez). Inténtalo de nuevo.`);
    };
    await put(RUNNER, this.d.runnerSource(), 'StreamClips: publicador');
    await put('README.md', '# StreamClips (nube)\n\nRepositorio privado de StreamClips: cola de vídeos y publicador. No lo edites a mano.\n', 'StreamClips: leeme');
    await this.syncWorkflow(gh, true);
    void branch;
  }

  /** Reescribe el flujo con las horas que hacen falta. */
  private async syncWorkflow(gh: Github, force = false): Promise<void> {
    const times = this.d.store.data.publications
      .filter((p) => p.cloud?.state === 'queued')
      .map((p) => new Date(p.scheduledAt))
      .filter((d) => d.getTime() > this.now() - 60_000);
    const a = this.d.store.data.settings.autopilot.slots;
    for (const hhmm of [a.summary, a.main, a.clips]) {
      const [h, m] = hhmm.split(':').map(Number);
      const d = new Date(this.now());
      d.setHours(h, m, 0, 0);
      times.push(d);
    }
    const crons = cronLines(times);
    const key = crons.join('|');
    if (!force && key === this.st.workflowCrons) return;
    const text = workflowYaml(crons);
    const cur = await gh.getContent(WORKFLOW);
    if (cur?.text !== text) {
      const sha = await gh.putContent(WORKFLOW, text, 'StreamClips: horas de publicación', cur?.sha);
      if (!sha) throw new Error('No se pudo escribir el flujo de publicación en GitHub.');
    }
    this.st.workflowCrons = key;
    this.d.store.save();
  }

  /** Sube las claves de tus redes como secreto cifrado del repositorio. */
  async syncCreds(gh: Github = this.gh()): Promise<void> {
    const creds: CloudCreds = {};
    const raw = this.d.store.data.connections;
    for (const p of ['youtube', 'tiktok'] as const) {
      const c = raw[p];
      const t = c?.tokens ? await this.d.connections.accessToken(p) : null;
      if (c && t?.refreshToken) creds[p] = { clientId: c.clientId, clientSecret: this.d.secrets.decode(c.clientSecret), refreshToken: t.refreshToken };
    }
    const ig = raw.instagram;
    const igt = ig?.tokens ? await this.d.connections.accessToken('instagram') : null;
    if (ig && igt?.extra?.igUserId) creds.instagram = { clientId: ig.clientId, clientSecret: this.d.secrets.decode(ig.clientSecret), accessToken: igt.accessToken, igUserId: igt.extra.igUserId };
    const pk = await gh.publicKey();
    await gh.putSecret(SECRET, await sealSecret(pk.key, JSON.stringify(creds)), pk.keyId);
  }

  private filesFor(o: OutputItem, platform: Platform): { video: string; thumb?: string } {
    const video = platform === 'youtube' ? youtubeFile(o).file : platform === 'tiktok' ? tiktokFile(o) : instagramFile(o);
    return { video, ...(platform === 'youtube' && o.kind === 'long' && o.thumbnail && fs.existsSync(o.thumbnail) ? { thumb: o.thumbnail } : {}) };
  }

  /** Una pasada: sube lo nuevo, trae el estado de lo ya subido y limpia lo cancelado. Nunca lanza. */
  sync(): Promise<CloudStatus> {
    if (!this.st.enabled || this.syncing) return Promise.resolve(this.status());
    return this.d.queue.run(async () => {
      this.syncing = true;
      this.error = null;
      try {
        const gh = this.gh();
        if (this.now() - this.credsAt > 12 * 3600_000) {
          await this.syncCreds(gh); // las claves de tus redes se renuevan: la nube necesita las vigentes
          this.credsAt = this.now();
        }
        await this.pull(gh);
        await this.push(gh);
        await this.cleanOrphans(gh);
        await this.syncWorkflow(gh);
        this.st.lastSync = new Date(this.now()).toISOString();
        this.d.store.save();
      } catch (e) {
        this.error = (e as Error).message;
        this.d.log.warn(`Nube: ${this.error}`);
      } finally {
        this.syncing = false;
        this.d.notifier.changed();
      }
      return this.status();
    });
  }

  /** Trae el estado de lo ya subido. */
  private async pull(gh: Github): Promise<void> {
    for (const pub of this.d.store.data.publications.filter((p) => p.cloud && (p.cloud.state === 'queued' || p.cloud.state === 'publishing'))) {
      const c = await gh.getContent(jobPath(pub.key));
      const job = c && parseJob(c.text);
      if (!c || !job) {
        pub.cloud = undefined; // el trabajo desapareció: lo recoge de nuevo el programador del PC o se vuelve a subir
        continue;
      }
      if (job.status === 'published') {
        pub.status = 'published';
        pub.cloud = { state: 'published' };
        pub.note = undefined;
        this.d.log.info(`Publicado desde la nube: ${pub.key}`);
      } else if (job.status === 'failed') {
        pub.status = 'failed';
        pub.cloud = { state: 'failed' };
        pub.note = job.note ?? 'Falló la publicación desde la nube.';
        await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
      } else if (job.status === 'publishing') {
        pub.cloud = { state: 'publishing' };
      } else if (Date.parse(job.scheduledAt) !== Date.parse(pub.scheduledAt)) {
        job.scheduledAt = new Date(pub.scheduledAt).toISOString();
        job.updatedAt = new Date(this.now()).toISOString();
        await gh.putContent(jobPath(pub.key), serializeJob(job), `Nueva hora: ${pub.key}`, c.sha);
      }
    }
    this.d.store.save();
    this.d.notifier.changed();
  }

  /** Sube lo programado que aún no está en la nube. */
  private async push(gh: Github): Promise<void> {
    const todo = this.d.store.data.publications.filter((p) => p.status === 'scheduled' && !p.cloud);
    for (const pub of todo) {
      const o = this.d.store.data.outputs.find((x) => x.id === pub.outputId);
      if (!o) continue;
      let files: { video: string; thumb?: string };
      try {
        files = this.filesFor(o, pub.platform);
      } catch (e) {
        pub.status = 'failed';
        pub.note = (e as Error).message;
        continue;
      }
      if (!fs.existsSync(files.video)) {
        pub.status = 'failed';
        pub.note = 'El archivo del vídeo ya no está en su sitio.';
        continue;
      }
      const existing = await gh.getContent(jobPath(pub.key));
      const prev = existing && parseJob(existing.text);
      if (prev && prev.status !== 'failed') {
        pub.cloud = { state: prev.status }; // ya estaba subido (p. ej. la app se cerró justo después)
        continue;
      }
      const task = this.d.tasks.start('cloud', `Subiendo a la nube: ${o.title} (${pub.platform})`);
      const tag = releaseTag(pub.key);
      let rel: { id: number } | null = null;
      try {
        rel = await gh.createRelease(tag, `${o.title} (${pub.platform})`).catch(async (e: GithubError) => {
          if (e.status !== 422) throw e;
          // quedó una subida a medias de un intento anterior: se limpia y se rehace
          throw new GithubError(`Hay una subida anterior a medias de «${o.title}». Pulsa «Sincronizar» para reintentar.`, 422);
        });
        const size = fs.statSync(files.video).size;
        const asset = await gh.uploadAsset(rel.id, path.basename(files.video), files.video, 'video/mp4');
        task.update(90);
        const thumb = files.thumb ? await gh.uploadAsset(rel.id, path.basename(files.thumb), files.thumb, 'image/jpeg').catch(() => null) : null;
        const job: CloudJob = {
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
          file: { name: path.basename(files.video), assetId: asset.id, size },
          ...(thumb ? { thumb: { name: path.basename(files.thumb!), assetId: thumb.id } } : {}),
          updatedAt: new Date(this.now()).toISOString(),
        };
        const sha = await gh.putContent(jobPath(pub.key), serializeJob(job), `En cola: ${pub.key}`, prev ? existing!.sha : undefined);
        if (!sha) throw new Error('No se pudo registrar el trabajo en la cola de GitHub.');
        pub.cloud = { state: 'queued' };
        pub.note = undefined;
        this.d.store.save();
        task.done('En la cola de la nube');
        rel = null;
      } catch (e) {
        task.fail((e as Error).message);
        if (rel) await gh.deleteRelease(rel.id, tag).catch(() => undefined);
        if (e instanceof GithubError && e.status === 422) {
          pub.status = 'failed'; // no tiene arreglo reintentando (p. ej. pasa de 2 GB)
          pub.note = e.message;
          this.d.store.save();
        } else {
          this.error = (e as Error).message; // se reintenta en la siguiente pasada
          this.d.log.warn(`Nube: ${this.error}`);
        }
        continue;
      }
      // si ya es la hora (o casi), se pide una ejecución ahora mismo en vez de esperar al cron
      if (Date.parse(pub.scheduledAt) <= this.now() + 60_000) {
        const info = await gh.repoInfo();
        await gh.dispatch('publish.yml', info.defaultBranch).catch((e) => this.d.log.warn(`No se pudo lanzar la publicación: ${(e as Error).message}`));
      }
    }
  }

  /** Quita de la nube lo que ya no está programado en el programa. */
  private async cleanOrphans(gh: Github): Promise<void> {
    const keep = new Set(this.d.store.data.publications.filter((p) => p.cloud && p.cloud.state !== 'published').map((p) => jobPath(p.key).split('/')[1]));
    for (const f of await gh.listDir('queue')) {
      if (keep.has(f.name) || !f.name.endsWith('.json')) continue;
      const c = await gh.getContent(`queue/${f.name}`);
      const job = c && parseJob(c.text);
      if (!c || !job) continue;
      if (job.status === 'queued' || job.status === 'failed') {
        await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
        await gh.deleteContent(`queue/${f.name}`, c.sha, `Cancelado: ${job.key}`);
      } else if (job.status === 'published') {
        await gh.deleteContent(`queue/${f.name}`, c.sha, `Archivado: ${job.key}`); // el registro ya está en el programa
      }
    }
  }

  /** Quita la copia de la nube de una publicación cancelada o reprogramada. */
  async forget(pub: Publication): Promise<void> {
    if (!pub.cloud || !this.st.enabled) return;
    await this.sync();
  }

  /** Apaga el modo nube: borra lo subido y deja que el PC publique. */
  async disable(): Promise<CloudStatus> {
    if (this.st.enabled) {
      try {
        const gh = this.gh();
        for (const f of await gh.listDir('queue')) {
          const c = await gh.getContent(`queue/${f.name}`);
          const job = c && parseJob(c.text);
          if (!c || !job) continue;
          if (job.status === 'queued' || job.status === 'failed') {
            await gh.deleteRelease(job.releaseId, job.releaseTag).catch(() => undefined);
            await gh.deleteContent(`queue/${f.name}`, c.sha, `Desactivado: ${job.key}`);
          }
        }
      } catch (e) {
        this.d.log.warn(`Nube: no se pudo limpiar al desactivar: ${(e as Error).message}`);
      }
    }
    for (const p of this.d.store.data.publications) if (p.cloud && (p.cloud.state === 'queued' || p.cloud.state === 'failed')) p.cloud = undefined;
    this.st.enabled = false;
    this.d.store.save();
    this.d.notifier.changed();
    return this.status();
  }
}

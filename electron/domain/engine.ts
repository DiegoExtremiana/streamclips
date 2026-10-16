import crypto from 'node:crypto';
import type { EngineStatus } from '../../shared/types';
import { MASKED_SECRET } from '../../shared/types';
import type { Store } from '../services/store';
import type { Secrets } from '../services/secrets';
import type { Logger } from '../services/logger';
import type { TwitchCreds } from '../services/twitch';
import { Github, type GithubOpts } from '../services/cloud/github';
import { engineCrons, engineWorkflowYaml } from '../engine/workflow';
import { ENGINE_STATE_PATH, parseRunState, type EnginePayload } from '../engine/payload';
import type { Notifier } from './notifier';
import { parseRepo, sealSecret } from './cloud';

export interface EngineDeps {
  store: Store;
  secrets: Secrets;
  log: Logger;
  notifier: Notifier;
  /** Contenido de engine.js (el motor empaquetado). */
  engineSource: () => string;
  twitchCreds: () => TwitchCreds;
  llmKey: () => string;
  github?: Partial<GithubOpts>;
  intervalMs?: number;
  now?: () => number;
  /** Solo pruebas: huso horario (minutos, como Date.getTimezoneOffset). */
  tzOffset?: () => number;
}

const WORKFLOW = '.github/workflows/motor.yml';
const ENGINE_FILE = 'engine/engine.js';
const SECRET = 'STREAMCLIPS_ENGINE';

/**
 * Motor nocturno: instala en un repositorio PÚBLICO tuyo (los minutos de GitHub Actions son gratis e ilimitados en los públicos)
 * un flujo que, al terminar tu directo, descarga el VOD, lo edita y deja los vídeos listos en tu repositorio PRIVADO (la cola de la nube).
 * Todo lo sensible va en un secreto cifrado; en el repositorio público solo hay código.
 */
export class EngineService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private error: string | null = null;
  private last: EngineStatus['last'];

  constructor(private d: EngineDeps) {}

  private get st() {
    return this.d.store.data.engine;
  }
  private now(): number {
    return (this.d.now ?? Date.now)();
  }
  private cloudReady(): boolean {
    const c = this.d.store.data.cloud;
    return c.enabled && !!c.repo && !!c.token;
  }

  status(): EngineStatus {
    return {
      enabled: this.st.enabled,
      repo: this.st.repo,
      hasToken: !!this.st.token,
      lastSync: this.st.lastSync,
      error: this.error,
      since: this.st.since,
      cloudReady: this.cloudReady(),
      ...(this.last ? { last: this.last } : {}),
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sync(), this.d.intervalMs ?? 10 * 60_000);
    this.timer.unref?.();
    if (this.st.enabled) void this.sync();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private gh(): Github {
    if (!this.st.repo || !this.st.token) throw new Error('El motor nocturno no está configurado.');
    return new Github({ token: this.d.secrets.decode(this.st.token), repo: this.st.repo, ...this.d.github });
  }

  /** Todo lo que el motor necesita, sacado de los Ajustes de ahora mismo. */
  payload(): EnginePayload {
    const s = this.d.store.data.settings;
    const t = this.d.twitchCreds();
    if (!t.clientId || !t.clientSecret || !t.login) throw new Error('Rellena Twitch (id, secreto y canal) en Ajustes: el motor lo necesita para saber cuándo termina tu directo.');
    const c = this.d.store.data.cloud;
    if (!this.cloudReady()) throw new Error('Activa antes la publicación en la nube (repositorio privado): ahí deja el motor los vídeos listos.');
    const a = s.autopilot;
    return {
      v: 1,
      twitch: t,
      llm: { provider: a.llm.provider, model: a.llm.model, apiKey: a.llm.provider === 'none' ? '' : this.d.llmKey() },
      cloud: { repo: c.repo, token: this.d.secrets.decode(c.token) },
      autopilot: { maxClips: a.maxClips, maxVideos: a.maxVideos, subtitles: a.subtitles, platforms: a.platforms, videoTimes: a.videoTimes, clipTimes: a.clipTimes, summaryMinutes: a.summaryMinutes, mainMinutes: a.mainMinutes, visibility: a.visibility },
      whisper: { model: s.whisperModel, language: s.whisperLanguage || 'es' },
      since: this.st.since ?? new Date(this.now()).toISOString(),
    };
  }

  private hash(payload: EnginePayload, crons: string[]): string {
    return crypto.createHash('sha256').update(JSON.stringify([payload, crons, this.d.engineSource()])).digest('hex');
  }

  private async put(gh: Github, path: string, text: string, msg: string): Promise<void> {
    const cur = await gh.getContent(path);
    if (cur?.text === text) return;
    const sha = await gh.putContent(path, text, msg, cur?.sha);
    if (!sha) throw new Error(`No se pudo escribir ${path} en GitHub (cambió a la vez). Inténtalo de nuevo.`);
  }

  /** Sube el motor, el flujo y la configuración. */
  private async push(gh: Github, payload: EnginePayload, crons: string[]): Promise<void> {
    await this.put(gh, ENGINE_FILE, this.d.engineSource(), 'StreamClips: motor nocturno');
    await this.put(gh, 'README.md', '# StreamClips (motor)\n\nRepositorio público de StreamClips: solo código. Edita tus directos de noche en GitHub Actions; no guarda vídeos ni claves (van cifradas en un secreto). No lo edites a mano.\n', 'StreamClips: leeme');
    await this.put(gh, WORKFLOW, engineWorkflowYaml(crons), 'StreamClips: horario del motor');
    const pk = await gh.publicKey();
    await gh.putSecret(SECRET, await sealSecret(pk.key, JSON.stringify(payload)), pk.keyId);
  }

  async setup(repoRaw: string, token: string): Promise<EngineStatus> {
    const repo = parseRepo(repoRaw);
    if (!repo) throw new Error('El repositorio debe ser «usuario/nombre» (por ejemplo diego/streamclips-motor).');
    const tok = token === MASKED_SECRET ? this.d.secrets.decode(this.st.token) : token.trim();
    if (!tok) throw new Error('Pega el token de GitHub.');
    if (!this.cloudReady()) throw new Error('Activa antes la publicación en la nube (repositorio privado): ahí deja el motor los vídeos listos.');
    if (repo.toLowerCase() === this.d.store.data.cloud.repo.toLowerCase()) throw new Error('El motor necesita su propio repositorio PÚBLICO, distinto del privado de la nube.');
    const gh = new Github({ token: tok, repo, ...this.d.github });
    const info = await gh.repoInfo();
    if (info.private) throw new Error('El repositorio del motor tiene que ser PÚBLICO: en los privados GitHub solo regala 2.000 minutos al mes y una noche de edición los gasta casi todos. En él solo hay código, tus vídeos y claves no.');
    const prev = { ...this.st };
    this.st.repo = info.fullName;
    this.st.token = this.d.secrets.encode(tok);
    this.st.enabled = true;
    this.st.since = prev.enabled && prev.since ? prev.since : new Date(this.now()).toISOString();
    this.st.payloadHash = '';
    this.d.store.save();
    try {
      const payload = this.payload();
      const crons = engineCrons(this.d.tzOffset?.());
      await this.push(gh, payload, crons);
      this.st.payloadHash = this.hash(payload, crons);
      this.st.lastSync = new Date(this.now()).toISOString();
      this.error = null;
    } catch (e) {
      Object.assign(this.st, prev);
      this.d.store.save();
      throw e;
    }
    this.d.store.save();
    this.d.log.info(`Motor nocturno activado en ${this.st.repo}`);
    await this.readLast();
    this.d.notifier.changed();
    return this.status();
  }

  /** Vuelve a subir la configuración si ha cambiado algo (ajustes, huso horario, versión del motor). Nunca lanza. */
  async sync(): Promise<EngineStatus> {
    if (!this.st.enabled || this.syncing) return this.status();
    this.syncing = true;
    try {
      this.error = null;
      const gh = this.gh();
      const payload = this.payload();
      const crons = engineCrons(this.d.tzOffset?.());
      const h = this.hash(payload, crons);
      if (h !== this.st.payloadHash) {
        await this.push(gh, payload, crons);
        this.st.payloadHash = h;
        this.st.lastSync = new Date(this.now()).toISOString();
        this.d.store.save();
        this.d.log.info('Motor nocturno: configuración actualizada en GitHub.');
      }
      await this.readLast();
    } catch (e) {
      this.error = (e as Error).message;
      this.d.log.warn(`Motor nocturno: ${this.error}`);
    } finally {
      this.syncing = false;
      this.d.notifier.changed();
    }
    return this.status();
  }

  /** Lo que dejó la última ejecución del motor (está en el repositorio privado). */
  private async readLast(): Promise<void> {
    try {
      const c = this.d.store.data.cloud;
      const gh = new Github({ token: this.d.secrets.decode(c.token), repo: c.repo, ...this.d.github });
      const st = parseRunState((await gh.getContent(ENGINE_STATE_PATH))?.text ?? null);
      this.last = st.last;
    } catch {
      /* solo informativo */
    }
  }

  /** Apaga el motor: quita el flujo, el código y el secreto. Lo ya subido a la cola no se toca. */
  async disable(): Promise<EngineStatus> {
    if (this.st.enabled) {
      try {
        const gh = this.gh();
        for (const f of [WORKFLOW, ENGINE_FILE]) {
          const cur = await gh.getContent(f);
          if (cur) await gh.deleteContent(f, cur.sha, 'StreamClips: motor desactivado');
        }
        await gh.deleteSecret(SECRET);
      } catch (e) {
        this.d.log.warn(`Motor nocturno: no se pudo limpiar GitHub al desactivar: ${(e as Error).message}`);
      }
    }
    this.st.enabled = false;
    this.st.payloadHash = '';
    this.error = null;
    this.d.store.save();
    this.d.notifier.changed();
    return this.status();
  }
}

import path from 'node:path';
import { Store } from '../services/store';
import { Logger } from '../services/logger';
import { Secrets, type Cipher } from '../services/secrets';
import { SerialQueue } from '../services/queue';
import { resolveToolPaths, run, type BundledTools, type ToolPaths } from '../services/tools';
import { TwitchClient } from '../services/twitch';
import type { audioEnergy } from '../services/audioEnergy';
import type { downloadVod } from '../services/downloader';
import { SettingsService } from '../domain/settings';
import { VodService } from '../domain/vods';
import { ClipService } from '../domain/clips';
import { CategoryService } from '../domain/categories';
import type { Chapter } from '../../shared/categories';
import { LibraryService } from '../domain/library';
import { TranscriptService } from '../domain/transcripts';
import { GroupService } from '../domain/groups';
import { TaskTracker } from '../domain/tasks';
import { CloudService } from '../domain/cloud';
import type { GithubOpts } from '../services/cloud/github';
import { UpdateService, type UpdaterLike } from '../services/updater';
import { Autopilot } from '../domain/autopilot';
import { ChannelMonitor } from '../domain/channel';
import { PublicationService } from '../domain/publications';
import { Scheduler } from '../domain/scheduler';
import { EngineService } from '../domain/engine';
import { ConnectionService } from '../domain/connections';
import { lookupAccount, type AccountEnv } from '../services/social/accounts';
import type { PROVIDERS, OAuthProvider } from '../services/oauth';
import { realPublishers, youtubePlaylists, type PublisherEnv, type Publishers } from '../domain/publishers';
import type { Notifier } from '../domain/notifier';

export interface ContextOptions {
  /** Solo pruebas: categorías del VOD. */
  fetchChapters?: (url: string) => Promise<Chapter[]>;
  userDataDir: string;
  defaultOutputDir: string;
  cipher: Cipher;
  notifier: Notifier;
  publishers?: Publishers;
  schedulerIntervalMs?: number;
  download?: typeof downloadVod;
  /** Solo para pruebas: espacio libre del disco. */
  freeBytes?: (dir: string) => number | null;
  twitch?: TwitchClient;
  /** Cada cuánto se vigila el canal (ms). */
  channelIntervalMs?: number;
  bundled?: BundledTools;
  /** Carpeta con las fuentes que usan los subtítulos grabados. */
  fontsDir?: string;
  /** Solo para pruebas: servidor de modelos de Whisper. */
  modelBaseUrl?: string;
  /** Solo para pruebas: servidor del modelo de lenguaje. */
  llmBaseUrl?: string;
  /** Solo pruebas: servidor IRC del chat. */
  chatHost?: string;
  /** Abre una dirección en el navegador del sistema (Electron: shell.openExternal). */
  /** electron-updater (null/ausente en desarrollo y en pruebas). */
  runnerSource?: () => string;
  /** Contenido del motor nocturno (engine.js) que se instala en el repositorio público. */
  engineSource?: () => string;
  engineIntervalMs?: number;
  /** Solo pruebas: GitHub. */
  github?: Partial<GithubOpts>;
  cloudIntervalMs?: number;
  updater?: UpdaterLike | null;
  appVersion?: string;
  openUrl?: (url: string) => Promise<void> | void;
  /** Solo pruebas: direcciones de las redes sociales. */
  oauthProviders?: Record<keyof typeof PROVIDERS, OAuthProvider>;
  socialEnv?: PublisherEnv & AccountEnv;
  chatPort?: number;
  energy?: typeof audioEnergy;
  echoLog?: boolean;
  /** Sin interfaz (motor nocturno en GitHub Actions): la nube no toca las claves de tus redes. */
  headless?: boolean;
  /** Solo el motor nocturno: motivo para no transcribir un directo de esta duración. */
  canTranscribe?: (durationSec: number) => string | null;
}

/**
 * Composición de todos los servicios. No importa nada de Electron: así toda la lógica
 * se puede probar de principio a fin sin abrir una ventana.
 */
export class AppContext {
  readonly store: Store;
  readonly log: Logger;
  readonly settings: SettingsService;
  readonly twitch: TwitchClient;
  readonly vods: VodService;
  readonly clips: ClipService;
  readonly categories: CategoryService;
  readonly library: LibraryService;
  readonly transcripts: TranscriptService;
  readonly tasks: TaskTracker;
  readonly groups: GroupService;
  readonly pubs: PublicationService;
  readonly scheduler: Scheduler;
  readonly channel: ChannelMonitor;
  readonly autopilot: Autopilot;
  readonly connections: ConnectionService;
  readonly updates: UpdateService;
  readonly cloud: CloudService;
  readonly engine: EngineService;
  readonly cloudQueue = new SerialQueue();
  readonly autopilotQueue = new SerialQueue();
  /** Las descargas y los renders van en colas distintas, cada una de una en una. */
  private readonly bundled: BundledTools;
  private readonly socialEnv: PublisherEnv | undefined;
  readonly downloadQueue = new SerialQueue();
  readonly renderQueue = new SerialQueue();
  readonly transcribeQueue = new SerialQueue();

  constructor(o: ContextOptions) {
    this.bundled = o.bundled ?? {};
    this.socialEnv = o.socialEnv;
    this.log = new Logger(path.join(o.userDataDir, 'logs'), 1_000_000, o.echoLog ?? false);
    this.store = new Store(o.userDataDir, o.defaultOutputDir);
    if (this.store.recoveredFrom) {
      this.log.warn(`data.json estaba dañado; copia conservada en ${this.store.recoveredFrom}${this.store.restoredFromBackup ? ' (se recuperó la última copia buena)' : ' (se empezó con datos vacíos)'}`);
    }
    const secrets = new Secrets(o.cipher);
    this.settings = new SettingsService(this.store, secrets);
    this.twitch = o.twitch ?? new TwitchClient();

    const tools = () => this.tools();
    this.vods = new VodService({
      store: this.store,
      log: this.log,
      notifier: o.notifier,
      queue: this.downloadQueue,
      tools,
      download: o.download,
      freeBytes: o.freeBytes,
    });
    this.tasks = new TaskTracker(o.notifier);
    this.transcripts = new TranscriptService({
      store: this.store,
      log: this.log,
      notifier: o.notifier,
      queue: this.transcribeQueue,
      tools,
      tasks: this.tasks,
      whisperExe: () => this.whisperExe(),
      modelBaseUrl: o.modelBaseUrl,
    });
    const subtitles = { words: (vodId: string) => this.transcripts.words(vodId), ensure: (vodId: string, ranges?: { start: number; end: number }[]) => this.transcripts.ensure(vodId, ranges), fontsDir: o.fontsDir };
    this.categories = new CategoryService({ store: this.store, log: this.log, tools, fetch: o.fetchChapters });
    this.clips = new ClipService({ categories: this.categories, store: this.store, log: this.log, notifier: o.notifier, queue: this.renderQueue, tools, subtitles, freeBytes: o.freeBytes });
    this.library = new LibraryService({ store: this.store, log: this.log, notifier: o.notifier, queue: this.renderQueue, tools, subtitles });
    this.groups = new GroupService(this.store, o.notifier);
    this.pubs = new PublicationService(this.store, o.notifier);
    this.channel = new ChannelMonitor({
      store: this.store,
      log: this.log,
      notifier: o.notifier,
      twitch: this.twitch,
      creds: () => this.settings.twitchCreds(),
      vods: this.vods,
      clips: this.clips,
      intervalMs: o.channelIntervalMs ?? 60_000,
      streamUrl: async (pageUrl) => {
        const r = await run(this.tools().ytdlp, ['--no-warnings', '--no-playlist', '-g', '-f', 'b[height<=720]/b', '--', pageUrl], 60_000);
        return r.stdout.trim().split('\n')[0] ?? '';
      },
      chat: { dir: path.join(o.userDataDir, 'chat'), enabled: () => this.store.data.settings.autopilot.chatCapture, host: o.chatHost, port: o.chatPort },
    });
    this.autopilot = new Autopilot({
      store: this.store,
      log: this.log,
      notifier: o.notifier,
      tasks: this.tasks,
      queue: this.autopilotQueue,
      tools,
      transcripts: this.transcripts,
      clips: this.clips,
      categories: this.categories,
      library: this.library,
      pubs: this.pubs,
      chatDir: path.join(o.userDataDir, 'chat'),
      llmKey: () => this.settings.llmKey(),
      llmBaseUrl: o.llmBaseUrl,
      energy: o.energy,
      canTranscribe: o.canTranscribe,
    });
    this.channel.onLiveVodReady((job) => this.autopilot.onLiveVod(job));
    this.channel.onAnalyzeReady((job) => void this.autopilot.run(job.id).catch((e) => this.log.error('Piloto automático', e)));
    this.transcripts.onSaved = (vodId) => void this.autopilot.autoNameLibrary(vodId, { generic: false }).catch((e) => this.log.warn(`Nombres automáticos: ${(e as Error).message}`));
    this.connections = new ConnectionService({
      store: this.store,
      secrets,
      log: this.log,
      notifier: o.notifier,
      openUrl: o.openUrl ?? (() => { throw new Error('No hay navegador disponible.'); }),
      providers: o.oauthProviders,
      fetchFn: o.socialEnv?.fetchFn,
      afterConnect: (platform, tokens) => lookupAccount(platform, tokens, { ...o.socialEnv, ytApi: o.socialEnv?.youtube?.api }),
    });
    this.updates = new UpdateService({
      updater: o.updater ?? null,
      currentVersion: o.appVersion ?? '0.0.0',
      canRestart: () => !this.isBusy(),
      onStatus: (u) => o.notifier.update(u),
      log: this.log,
    });
    this.cloud = new CloudService({
      store: this.store,
      secrets,
      log: this.log,
      notifier: o.notifier,
      tasks: this.tasks,
      queue: this.cloudQueue,
      connections: this.connections,
      runnerSource: o.runnerSource ?? (() => { throw new Error('El publicador de la nube no está incluido en esta instalación.'); }),
      github: o.github,
      intervalMs: o.cloudIntervalMs,
      headless: o.headless,
    });
    this.engine = new EngineService({
      store: this.store,
      secrets,
      log: this.log,
      notifier: o.notifier,
      engineSource: o.engineSource ?? (() => { throw new Error('El motor nocturno no está incluido en esta instalación.'); }),
      twitchCreds: () => this.settings.twitchCreds(),
      llmKey: () => this.settings.llmKey(),
      github: o.github,
      intervalMs: o.engineIntervalMs,
    });
    this.scheduler = new Scheduler(
      this.store,
      o.notifier,
      this.log,
      o.publishers ?? realPublishers(this.connections, this.log, o.socialEnv),
      o.schedulerIntervalMs ?? 30_000,
    );
  }

  /** whisper-cli: la ruta de Ajustes, si no la incluida con el programa. */
  whisperExe(): string | null {
    return this.store.data.settings.whisperPath.trim() || this.bundled.whisper || null;
  }

  /** ¿Hay algo en marcha que un reinicio estropearía? */
  isBusy(): boolean {
    return (
      this.downloadQueue.size + this.renderQueue.size + this.transcribeQueue.size + this.autopilotQueue.size + this.cloudQueue.size > 0 ||
      this.tasks.list().some((t) => t.status === 'running') ||
      this.store.data.publications.some((p) => p.status === 'publishing') ||
      this.channel.status().stream?.live === true ||
      this.store.data.vods.some((v) => v.status === 'queued' || v.status === 'downloading')
    );
  }

  playlists() {
    return youtubePlaylists(this.connections, this.socialEnv);
  }

  tools(): ToolPaths {
    const s = this.store.data.settings;
    return resolveToolPaths(s.ffmpegPath, s.ytdlpPath, this.bundled);
  }

  /** Tras crear la ventana: recupera lo que quedó a medias y arranca el programador. */
  start(): void {
    const n = this.vods.recoverInterrupted();
    if (n) this.log.warn(`${n} descarga(s) interrumpida(s) marcadas como error.`);
    this.scheduler.start();
    this.channel.start();
    this.updates.start();
    this.cloud.start();
    this.engine.start();
    void this.library.backfillThumbnails().catch((e) => this.log.warn(`Miniaturas pendientes: ${(e as Error).message}`));
    void this.autopilot.refreshLibraryAtStart();
    this.log.info('Aplicación iniciada.');
  }

  stop(): void {
    this.scheduler.stop();
    this.channel.stop();
    this.updates.stop();
    this.cloud.stop();
    this.engine.stop();
  }
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppContext = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("../services/store");
const logger_1 = require("../services/logger");
const secrets_1 = require("../services/secrets");
const queue_1 = require("../services/queue");
const tools_1 = require("../services/tools");
const twitch_1 = require("../services/twitch");
const settings_1 = require("../domain/settings");
const vods_1 = require("../domain/vods");
const clips_1 = require("../domain/clips");
const categories_1 = require("../domain/categories");
const library_1 = require("../domain/library");
const transcripts_1 = require("../domain/transcripts");
const speakers_1 = require("../domain/speakers");
const moments_1 = require("../domain/moments");
const clipScores_1 = require("../domain/clipScores");
const llm_1 = require("../services/llm");
const clipCriteria_1 = require("../../shared/clipCriteria");
const audioEnergy_1 = require("../services/audioEnergy");
const style_1 = require("../domain/style");
const covers_1 = require("../domain/covers");
const groups_1 = require("../domain/groups");
const tasks_1 = require("../domain/tasks");
const cloud_1 = require("../domain/cloud");
const updater_1 = require("../services/updater");
const autopilot_1 = require("../domain/autopilot");
const channel_1 = require("../domain/channel");
const publications_1 = require("../domain/publications");
const scheduler_1 = require("../domain/scheduler");
const engine_1 = require("../domain/engine");
const connections_1 = require("../domain/connections");
const accounts_1 = require("../services/social/accounts");
const publishers_1 = require("../domain/publishers");
/**
 * Composición de todos los servicios. No importa nada de Electron: así toda la lógica
 * se puede probar de principio a fin sin abrir una ventana.
 */
class AppContext {
    store;
    log;
    settings;
    twitch;
    vods;
    clips;
    categories;
    library;
    transcripts;
    speakers;
    moments;
    clipScores;
    style;
    covers;
    tasks;
    groups;
    pubs;
    scheduler;
    channel;
    autopilot;
    connections;
    updates;
    cloud;
    engine;
    cloudQueue = new queue_1.SerialQueue();
    /** Cuántos directos se analizan a la vez (Ajustes › Piloto automático). */
    parallel = () => this.store.data.settings.autopilot.parallel ?? 2;
    autopilotQueue = new queue_1.SerialQueue(() => this.parallel());
    /** Las descargas y los renders van en colas distintas, cada una de una en una. */
    bundled;
    socialEnv;
    downloadQueue = new queue_1.SerialQueue();
    renderQueue = new queue_1.SerialQueue();
    transcribeQueue = new queue_1.SerialQueue(() => this.parallel());
    constructor(o) {
        this.bundled = o.bundled ?? {};
        this.socialEnv = o.socialEnv;
        this.log = new logger_1.Logger(node_path_1.default.join(o.userDataDir, 'logs'), 1_000_000, o.echoLog ?? false);
        this.store = new store_1.Store(o.userDataDir, o.defaultOutputDir);
        if (this.store.recoveredFrom) {
            this.log.warn(`data.json estaba dañado; copia conservada en ${this.store.recoveredFrom}${this.store.restoredFromBackup ? ' (se recuperó la última copia buena)' : ' (se empezó con datos vacíos)'}`);
        }
        const secrets = new secrets_1.Secrets(o.cipher);
        this.settings = new settings_1.SettingsService(this.store, secrets);
        this.twitch = o.twitch ?? new twitch_1.TwitchClient();
        const tools = () => this.tools();
        this.vods = new vods_1.VodService({
            store: this.store,
            log: this.log,
            notifier: o.notifier,
            queue: this.downloadQueue,
            tools,
            download: o.download,
            freeBytes: o.freeBytes,
        });
        this.tasks = new tasks_1.TaskTracker(o.notifier);
        this.transcripts = new transcripts_1.TranscriptService({
            store: this.store,
            log: this.log,
            notifier: o.notifier,
            queue: this.transcribeQueue,
            concurrency: () => this.parallel(),
            tools,
            tasks: this.tasks,
            whisperExe: () => this.whisperExe(),
            modelBaseUrl: o.modelBaseUrl,
            source: (id) => this.vods.ensureFile(id),
        });
        this.speakers = new speakers_1.SpeakerService({
            store: this.store,
            log: this.log,
            notifier: o.notifier,
            tools,
            source: (id) => this.vods.ensureFile(id),
            segmentationModel: o.diarizationModel ?? '',
            modelsDir: node_path_1.default.join(o.userDataDir, 'models'),
            engine: o.diarizationEngine,
        });
        this.style = new style_1.StyleService(node_path_1.default.join(o.userDataDir, 'style-profile.json'));
        this.covers = new covers_1.CoverService({ dir: node_path_1.default.join(o.userDataDir, 'covers'), tools, fontsDir: o.fontsDir });
        this.moments = new moments_1.MomentsService({
            dir: node_path_1.default.join(o.userDataDir, 'moments'),
            prefsFile: node_path_1.default.join(o.userDataDir, 'preferences.json'),
            words: (id) => this.transcripts.words(id),
            duration: (id) => this.store.data.vods.find((v) => v.id === id)?.durationSec,
            exists: (id) => this.store.data.vods.some((v) => v.id === id),
        });
        this.transcripts.speakerOverlay = (id) => this.speakers.overlay(id);
        const subtitles = { speakerColors: (words) => this.speakers.colorsFor(words), words: (vodId) => this.transcripts.words(vodId), ensure: (vodId, ranges) => this.transcripts.ensure(vodId, ranges), fontsDir: o.fontsDir };
        this.categories = new categories_1.CategoryService({ store: this.store, log: this.log, tools, fetch: o.fetchChapters });
        this.clips = new clips_1.ClipService({ categories: this.categories, store: this.store, log: this.log, notifier: o.notifier, queue: this.renderQueue, tools, subtitles, freeBytes: o.freeBytes, source: (id) => this.vods.ensureFile(id) });
        this.library = new library_1.LibraryService({ store: this.store, log: this.log, notifier: o.notifier, queue: this.renderQueue, tools, subtitles, source: (id) => this.vods.ensureFile(id) });
        this.groups = new groups_1.GroupService(this.store, o.notifier);
        this.pubs = new publications_1.PublicationService(this.store, o.notifier);
        this.channel = new channel_1.ChannelMonitor({
            store: this.store,
            log: this.log,
            notifier: o.notifier,
            twitch: this.twitch,
            creds: () => this.settings.twitchCreds(),
            vods: this.vods,
            clips: this.clips,
            intervalMs: o.channelIntervalMs ?? 60_000,
            streamUrl: async (pageUrl) => {
                const r = await (0, tools_1.run)(this.tools().ytdlp, ['--no-warnings', '--no-playlist', '-g', '-f', 'b[height<=720]/b', '--', pageUrl], 60_000);
                return r.stdout.trim().split('\n')[0] ?? '';
            },
            chat: { dir: node_path_1.default.join(o.userDataDir, 'chat'), enabled: () => this.store.data.settings.autopilot.chatCapture, host: o.chatHost, port: o.chatPort },
        });
        this.autopilot = new autopilot_1.Autopilot({
            store: this.store,
            log: this.log,
            notifier: o.notifier,
            tasks: this.tasks,
            queue: this.autopilotQueue,
            tools,
            transcripts: this.transcripts,
            speakers: this.speakers,
            clips: this.clips,
            categories: this.categories,
            library: this.library,
            pubs: this.pubs,
            chatDir: node_path_1.default.join(o.userDataDir, 'chat'),
            judgeDir: node_path_1.default.join(o.userDataDir, 'judgements'),
            momentsDir: node_path_1.default.join(o.userDataDir, 'moments'),
            prefsFile: node_path_1.default.join(o.userDataDir, 'preferences.json'),
            style: () => this.style.get(),
            llmKey: () => this.settings.llmKey(),
            llmBaseUrl: o.llmBaseUrl,
            energy: o.energy,
            canTranscribe: o.canTranscribe,
            restore: (id) => this.vods.ensureFile(id),
            discardSource: (id) => this.vods.discardSource(id),
        });
        this.clipScores = new clipScores_1.ClipScoreService({
            file: node_path_1.default.join(o.userDataDir, 'clip-scores.json'),
            log: this.log,
            enabled: () => this.store.data.settings.autopilot.scoreClips !== false,
            canRun: () => !this.channel.isLive() && !this.autopilot.isBusy() && this.store.data.settings.autopilot.scoreClips !== false,
            hasJudge: () => Boolean(this.autopilot.llmConf()),
            analyze: async (clip) => {
                const t = this.tools();
                const url = (await (0, tools_1.run)(t.ytdlp, ['--no-warnings', '--no-playlist', '-g', '-f', 'b[height<=480]/b', '--', clip.url], 60_000)).stdout.trim().split('\n')[0] ?? '';
                if (!/^https?:\/\//.test(url))
                    throw new Error('Twitch no dio una dirección válida para el clip.');
                const wav = node_path_1.default.join(node_os_1.default.tmpdir(), `streamclips-score-${clip.id.replace(/[^A-Za-z0-9_-]/g, '_')}.wav`);
                try {
                    await (0, tools_1.run)(t.ffmpeg, ['-y', '-v', 'error', '-nostdin', '-i', url, '-vn', '-ac', '1', '-ar', '16000', '-t', '180', '-c:a', 'pcm_s16le', wav], 180_000);
                    const energyDb = await (o.energy ?? audioEnergy_1.audioEnergy)(t, wav).catch(() => undefined);
                    const words = await this.transcripts.transcribeAudio(wav, [clip.title]).catch(() => []);
                    return { durationSec: clip.durationSec, words, energyDb };
                }
                finally {
                    node_fs_1.default.rmSync(wav, { force: true });
                }
            },
            judge: async (clip, words) => {
                const conf = this.autopilot.llmConf();
                if (!conf)
                    return null;
                const raw = await (0, llm_1.askJson)(conf, clipCriteria_1.CLIP_JUDGE_SYSTEM, (0, clipCriteria_1.clipJudgePrompt)(clip.title, words, clip.durationSec), { temperature: 0.2 });
                return (0, clipCriteria_1.parseClipJudgement)(raw);
            },
        });
        this.channel.scores = this.clipScores;
        this.channel.onLiveVodReady((job) => this.autopilot.onLiveVod(job));
        this.channel.onAnalyzeReady((job) => void this.autopilot.run(job.id).catch((e) => this.log.error('Piloto automático', e)));
        this.transcripts.onSaved = (vodId) => void this.autopilot.autoNameLibrary(vodId, { generic: false }).catch((e) => this.log.warn(`Nombres automáticos: ${e.message}`));
        this.connections = new connections_1.ConnectionService({
            store: this.store,
            secrets,
            log: this.log,
            notifier: o.notifier,
            openUrl: o.openUrl ?? (() => { throw new Error('No hay navegador disponible.'); }),
            providers: o.oauthProviders,
            fetchFn: o.socialEnv?.fetchFn,
            afterConnect: (platform, tokens) => (0, accounts_1.lookupAccount)(platform, tokens, { ...o.socialEnv, ytApi: o.socialEnv?.youtube?.api }),
        });
        this.updates = new updater_1.UpdateService({
            updater: o.updater ?? null,
            currentVersion: o.appVersion ?? '0.0.0',
            canRestart: () => !this.isBusy(),
            onStatus: (u) => o.notifier.update(u),
            log: this.log,
        });
        this.cloud = new cloud_1.CloudService({
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
            onPublished: (id) => this.library.purgeIfPublished(id),
        });
        this.engine = new engine_1.EngineService({
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
        this.scheduler = new scheduler_1.Scheduler(this.store, o.notifier, this.log, o.publishers ?? (0, publishers_1.realPublishers)(this.connections, this.log, o.socialEnv), o.schedulerIntervalMs ?? 30_000, undefined, (id) => this.library.purgeIfPublished(id));
    }
    /** whisper-cli: la ruta de Ajustes, si no la incluida con el programa. */
    whisperExe() {
        return this.store.data.settings.whisperPath.trim() || this.bundled.whisper || null;
    }
    /** ¿Hay algo en marcha que un reinicio estropearía? */
    isBusy() {
        return (this.downloadQueue.size + this.renderQueue.size + this.transcribeQueue.size + this.autopilotQueue.size + this.cloudQueue.size > 0 ||
            this.tasks.list().some((t) => t.status === 'running') ||
            this.store.data.publications.some((p) => p.status === 'publishing') ||
            this.channel.status().stream?.live === true ||
            this.store.data.vods.some((v) => v.status === 'queued' || v.status === 'downloading'));
    }
    playlists() {
        return (0, publishers_1.youtubePlaylists)(this.connections, this.socialEnv);
    }
    tools() {
        const s = this.store.data.settings;
        return (0, tools_1.resolveToolPaths)(s.ffmpegPath, s.ytdlpPath, this.bundled);
    }
    /** Tras crear la ventana: recupera lo que quedó a medias y arranca el programador. */
    start() {
        const n = this.vods.recoverInterrupted();
        if (n)
            this.log.warn(`${n} descarga(s) interrumpida(s) marcadas como error.`);
        const ap = this.autopilot.recoverInterrupted();
        if (ap)
            this.log.warn(`${ap} análisis interrumpido(s) marcados como error: se pueden relanzar.`);
        this.scheduler.start();
        this.channel.start();
        this.updates.start();
        this.cloud.start();
        this.engine.start();
        void this.library.backfillThumbnails().catch((e) => this.log.warn(`Miniaturas pendientes: ${e.message}`));
        void this.autopilot.refreshLibraryAtStart();
        this.log.info('Aplicación iniciada.');
    }
    stop() {
        this.scheduler.stop();
        this.channel.stop();
        this.updates.stop();
        this.cloud.stop();
        this.engine.stop();
    }
}
exports.AppContext = AppContext;

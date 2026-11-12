"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Store = exports.STORE_VERSION = void 0;
exports.normalizeOutput = normalizeOutput;
const speakers_1 = require("../../shared/speakers");
const vocab_1 = require("../../shared/vocab");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.STORE_VERSION = 2;
/**
 * Versión 1 guardaba cada render como un elemento suelto (kind vertical/horizontal/long con un solo `file`).
 * Desde la versión 2 un clip reúne sus versiones en `files`. Lo que no se pueda interpretar se descarta.
 */
function normalizeOutput(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const o = raw;
    if (typeof o.id !== 'string' || typeof o.title !== 'string')
        return null;
    const files = {};
    if (typeof o.files === 'object' && o.files !== null) {
        for (const k of ['vertical', 'horizontal', 'long']) {
            const f = o.files[k];
            if (typeof f === 'string' && f)
                files[k] = f;
        }
    }
    else if (typeof o.file === 'string' && o.file) {
        const legacy = o.kind;
        if (legacy === 'vertical' || legacy === 'horizontal' || legacy === 'long')
            files[legacy] = o.file;
    }
    const kind = o.kind === 'long' || files.long ? 'long' : 'clip';
    if (!Object.keys(files).length && o.remote !== true)
        return null; // sin archivos solo valen los que viven en la nube
    const { file: _legacyFile, ...rest } = o;
    void _legacyFile;
    return { ...rest, kind, files };
}
/** Velocidades medidas (segundos de audio por segundo de reloj), solo números válidos. */
function ratios(x) {
    const out = {};
    if (typeof x === 'object' && x !== null && !Array.isArray(x)) {
        for (const [k, v] of Object.entries(x))
            if (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000)
                out[k] = v;
    }
    return out;
}
function defaults(defaultOutputDir) {
    return {
        schemaVersion: exports.STORE_VERSION,
        settings: {
            outputDir: defaultOutputDir,
            ffmpegPath: '',
            ytdlpPath: '',
            twitch: { clientId: '', clientSecret: '', login: '' },
            whisperPath: '',
            whisperModel: 'small',
            whisperLanguage: 'es',
            autopilot: {
                enabled: true,
                requireApproval: false,
                maxClips: 3,
                maxVideos: 4,
                visibility: 'public',
                subtitles: '',
                platforms: ['youtube', 'tiktok', 'instagram'],
                videoTimes: ['08:00', '12:00', '16:00', '21:30'],
                clipTimes: ['10:00', '14:00', '19:00'],
                series: { name: '', nextDay: 1 },
                summaryMinutes: 12,
                mainMinutes: 10,
                chatCapture: true,
                llm: { provider: 'none', model: '', apiKey: '' },
            },
        },
        stats: { transcribeRatio: {} },
        vocab: (0, vocab_1.emptyVocabulary)(),
        speakers: (0, speakers_1.emptyBook)(),
        vods: [],
        outputs: [],
        groups: [],
        publications: [],
        channel: { autoImport: true, autoSince: null, seenVodIds: [], importedClipIds: [] },
        connections: {},
        cloud: { enabled: false, repo: '', token: '', lastSync: null, workflowCrons: '', known: [] },
        engine: { enabled: false, repo: '', token: '', since: null, lastSync: null, payloadHash: '' },
    };
}
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Lista de horas HH:MM válida (sin repetidas y ordenada); si no hay ninguna válida, la de por defecto. */
function times(v, fallback) {
    const ok = Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && HHMM_RE.test(x)))].sort() : [];
    return ok.length ? ok : [...fallback];
}
/** Cuántos identificadores antiguos se recuerdan (evita que el archivo crezca sin límite). */
const MAX_SEEN = 2000;
const BACKUP_EVERY_MS = 10 * 60_000;
const arr = (v) => (Array.isArray(v) ? v : []);
/**
 * Almacén en un único JSON con escritura atómica (archivo temporal + renombrado).
 * Pensado para un solo proceso (la app impide una segunda instancia). La interfaz es
 * pequeña a propósito para poder sustituirlo por SQLite o por una base de datos en la nube.
 */
class Store {
    file;
    data;
    /** Si el archivo estaba corrupto, ruta de la copia del archivo dañado. */
    recoveredFrom;
    /** Verdadero si, estando dañado, se recuperó la última copia buena (.bak). */
    restoredFromBackup = false;
    backupFile;
    lastBackup = 0;
    constructor(dir, defaultOutputDir) {
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        this.file = node_path_1.default.join(dir, 'data.json');
        const base = defaults(defaultOutputDir);
        this.data = base;
        this.backupFile = `${this.file}.bak`;
        if (!node_fs_1.default.existsSync(this.file))
            return;
        try {
            this.data = Store.parse(this.file, base);
        }
        catch {
            // No se pierde nada: se conserva el archivo dañado y se intenta la última copia buena.
            this.recoveredFrom = `${this.file}.corrupto-${Date.now()}`;
            node_fs_1.default.copyFileSync(this.file, this.recoveredFrom);
            try {
                this.data = Store.parse(this.backupFile, base);
                this.restoredFromBackup = true;
                this.lastBackup = Date.now(); // la copia buena no se pisa con el archivo dañado
            }
            catch {
                this.data = base;
            }
        }
    }
    /** Lee y normaliza un archivo de datos. Lanza si no se puede interpretar. */
    static parse(file, base) {
        const saved = JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
        if (typeof saved !== 'object' || saved === null || Array.isArray(saved))
            throw new Error('formato inesperado');
        return {
            schemaVersion: exports.STORE_VERSION,
            settings: {
                ...base.settings,
                ...saved.settings,
                // el programa edita en español de España: un ajuste antiguo «detectar» pasa a «es»
                whisperLanguage: saved.settings?.whisperLanguage || base.settings.whisperLanguage,
                twitch: { ...base.settings.twitch, ...saved.settings?.twitch },
                autopilot: {
                    ...base.settings.autopilot,
                    ...saved.settings?.autopilot,
                    llm: { ...base.settings.autopilot.llm, ...saved.settings?.autopilot?.llm },
                    series: { ...base.settings.autopilot.series, ...saved.settings?.autopilot?.series },
                    videoTimes: times(saved.settings?.autopilot?.videoTimes, base.settings.autopilot.videoTimes),
                    clipTimes: times(saved.settings?.autopilot?.clipTimes, base.settings.autopilot.clipTimes),
                },
            },
            stats: { transcribeRatio: ratios(saved.stats?.transcribeRatio) },
            vocab: (0, vocab_1.cleanVocabulary)(saved.vocab),
            speakers: (0, speakers_1.cleanBook)(saved.speakers),
            vods: arr(saved.vods),
            outputs: arr(saved.outputs).map(normalizeOutput).filter((x) => x !== null),
            groups: arr(saved.groups),
            publications: arr(saved.publications),
            cloud: { ...base.cloud, ...(typeof saved.cloud === 'object' && saved.cloud !== null ? saved.cloud : {}), known: arr(saved.cloud?.known).slice(-MAX_SEEN) },
            engine: { ...base.engine, ...(typeof saved.engine === 'object' && saved.engine !== null ? saved.engine : {}) },
            connections: typeof saved.connections === 'object' && saved.connections !== null && !Array.isArray(saved.connections) ? saved.connections : {},
            channel: {
                ...base.channel,
                ...(typeof saved.channel === 'object' && saved.channel !== null ? saved.channel : {}),
                seenVodIds: arr(saved.channel?.seenVodIds).slice(-MAX_SEEN),
                importedClipIds: arr(saved.channel?.importedClipIds).slice(-MAX_SEEN),
            },
        };
    }
    /**
     * Escritura atómica (temporal + renombrado). Como mucho cada 10 minutos, antes de sustituir el archivo
     * se guarda la versión anterior como .bak: si algún día se daña, se recupera casi todo.
     */
    save(now = Date.now()) {
        const tmp = `${this.file}.tmp`;
        node_fs_1.default.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
        if (now - this.lastBackup > BACKUP_EVERY_MS && node_fs_1.default.existsSync(this.file)) {
            try {
                node_fs_1.default.copyFileSync(this.file, this.backupFile);
                this.lastBackup = now;
            }
            catch {
                // la copia es un extra: nunca debe impedir guardar
            }
        }
        node_fs_1.default.renameSync(tmp, this.file);
    }
}
exports.Store = Store;

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClipScoreService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const clipScore_1 = require("../../shared/clipScore");
const clipCriteria_1 = require("../../shared/clipCriteria");
/** Con menos palabras que esto no hay nada que leer para el modelo. */
const MIN_WORDS_TO_JUDGE = 4;
const MAX_FAILS = 2;
const RETRY_AFTER_MS = 24 * 3600_000;
/** Un clip valorado sin modelo se repite con modelo, pero no más a menudo que esto (límites gratuitos). */
const MODEL_RETRY_MS = 30 * 60_000;
const WAIT_MS = 60_000;
/** Más largos que esto no son «clips» normales y no se analizan. */
const MAX_CLIP_SEC = 180;
/**
 * Puntúa en segundo plano los clips del canal (de uno en uno, solo con el equipo libre) y recuerda la nota con sus cuatro
 * criterios y el motivo. Un clip es «dorado» con 8/10 o más. Lo ya puntuado no se vuelve a analizar.
 */
class ClipScoreService {
    d;
    scores = new Map();
    queue = [];
    running = null;
    stopped = false;
    sleep;
    now;
    constructor(d) {
        this.d = d;
        this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        this.now = d.now ?? Date.now;
        try {
            const j = JSON.parse(node_fs_1.default.readFileSync(d.file, 'utf8'));
            for (const [id, v] of Object.entries(j))
                if (v && typeof v === 'object' && v.v === clipScore_1.SCORE_VERSION)
                    this.scores.set(id, v);
        }
        catch {
            /* sin puntuaciones guardadas */
        }
    }
    save() {
        try {
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.d.file), { recursive: true });
            const tmp = `${this.d.file}.tmp`;
            node_fs_1.default.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.scores)));
            node_fs_1.default.renameSync(tmp, this.d.file);
        }
        catch {
            /* si no se guarda, se vuelve a puntuar la próxima vez */
        }
    }
    /** Nota de un clip (0-10, un decimal) si ya está valorado. */
    scoreOf(id) {
        const s = this.scores.get(id)?.score;
        return typeof s === 'number' ? Math.round(s * 10) / 10 : undefined;
    }
    /** Los criterios, el motivo y cómo se valoró un clip (si ya está valorado). */
    detailOf(id) {
        const s = this.scores.get(id);
        return s?.crit && s.score !== undefined ? { criteria: s.crit, reason: s.reason ?? '', by: s.by ?? 'signals' } : undefined;
    }
    /** ¿Pasa de 8/10? */
    gold(id) {
        return (0, clipScore_1.isGold)(this.scores.get(id)?.score);
    }
    /** El análisis en segundo plano está activado (Ajustes). */
    enabled() {
        return this.d.enabled ? this.d.enabled() : true;
    }
    /** Clips por puntuar (los que quedan en cola). */
    pending() {
        return this.queue.length;
    }
    needs(c) {
        if (c.durationSec > MAX_CLIP_SEC || c.durationSec < 3)
            return false;
        const s = this.scores.get(c.id);
        if (!s)
            return true;
        if (s.score !== undefined)
            return Boolean(s.noModel && this.d.hasJudge?.() && this.now() - s.at > MODEL_RETRY_MS);
        return (s.fails ?? 0) < MAX_FAILS || this.now() - s.at > RETRY_AFTER_MS;
    }
    /** Añade a la cola los clips sin puntuar (los más recientes primero) y arranca el trabajo si no estaba en marcha. */
    enqueue(clips) {
        const queued = new Set(this.queue.map((c) => c.id));
        const add = clips.filter((c) => this.needs(c) && !queued.has(c.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        if (!add.length)
            return;
        this.queue.push(...add);
        this.start();
    }
    start() {
        if (this.running || this.stopped)
            return;
        this.running = this.loop().finally(() => {
            this.running = null;
            if (this.queue.length && !this.stopped)
                this.start();
        });
    }
    /** Se cumple cuando la cola se vacía (para pruebas y para esperar al cerrar). */
    async idle() {
        while (this.running)
            await this.running;
    }
    stop() {
        this.stopped = true;
        this.queue = [];
    }
    async loop() {
        while (this.queue.length && !this.stopped) {
            if (!this.d.canRun()) {
                await this.sleep(WAIT_MS);
                continue;
            }
            const clip = this.queue.shift();
            if (!this.needs(clip))
                continue;
            try {
                this.scores.set(clip.id, await this.score(clip));
            }
            catch (e) {
                const prev = this.scores.get(clip.id);
                this.scores.set(clip.id, { v: clipScore_1.SCORE_VERSION, at: this.now(), fails: (prev?.fails ?? 0) + 1 });
                this.d.log?.warn(`No se pudo puntuar el clip ${clip.id}: ${e.message}`);
            }
            this.save();
        }
    }
    async score(clip) {
        const sig = await this.d.analyze(clip);
        const crit = (0, clipCriteria_1.criteriaFromSignals)(sig);
        // el modelo lee todos los clips con algo que leer: el humor que no sube el volumen solo lo puede ver él
        let noModel = false;
        if (sig.words.length >= MIN_WORDS_TO_JUDGE) {
            noModel = true;
            if (this.d.judge) {
                try {
                    const j = await this.d.judge(clip, sig.words);
                    if (j)
                        return { score: (0, clipCriteria_1.overall)(j.criteria), crit: j.criteria, reason: j.reason || (0, clipCriteria_1.reasonFromCriteria)(j.criteria, 'model'), v: clipScore_1.SCORE_VERSION, at: this.now(), by: 'model' };
                }
                catch (e) {
                    this.d.log?.warn(`El modelo no valoró el clip ${clip.id}; se usan las señales del propio clip: ${e.message}`);
                }
            }
        }
        return { score: (0, clipCriteria_1.overall)(crit), crit, reason: (0, clipCriteria_1.reasonFromCriteria)(crit, 'signals'), v: clipScore_1.SCORE_VERSION, at: this.now(), by: 'signals', ...(noModel ? { noModel: true } : {}) };
    }
}
exports.ClipScoreService = ClipScoreService;

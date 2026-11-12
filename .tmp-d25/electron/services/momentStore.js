"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.savePrefs = exports.loadPrefs = exports.saveEdits = exports.loadEdits = void 0;
exports.loadSnapshot = loadSnapshot;
exports.saveSnapshot = saveSnapshot;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const momentEdits_1 = require("../../shared/momentEdits");
const preferences_1 = require("../../shared/preferences");
const safe = (id) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const editsFile = (dir, id) => node_path_1.default.join(dir, `${safe(id)}.edits.json`);
const snapFile = (dir, id) => node_path_1.default.join(dir, `${safe(id)}.json`);
function readJson(file) {
    try {
        return JSON.parse(node_fs_1.default.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function writeJson(file, data) {
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    node_fs_1.default.writeFileSync(tmp, JSON.stringify(data));
    node_fs_1.default.renameSync(tmp, file);
}
const loadEdits = (dir, vodId) => (node_fs_1.default.existsSync(editsFile(dir, vodId)) ? (0, momentEdits_1.cleanEdits)(readJson(editsFile(dir, vodId))) : (0, momentEdits_1.emptyEdits)());
exports.loadEdits = loadEdits;
const saveEdits = (dir, vodId, e) => writeJson(editsFile(dir, vodId), (0, momentEdits_1.cleanEdits)(e));
exports.saveEdits = saveEdits;
function loadSnapshot(dir, vodId) {
    const j = readJson(snapFile(dir, vodId));
    if (!j || !Array.isArray(j.items) || !Array.isArray(j.chosen))
        return null;
    return { quality: typeof j.quality === 'number' ? j.quality : 6.5, items: j.items, chosen: j.chosen.filter((x) => typeof x === 'string') };
}
function saveSnapshot(dir, vodId, judged, chosenStarts, quality) {
    const snap = {
        quality,
        items: judged.map((j) => ({
            key: (0, momentEdits_1.momentKey)(j.start),
            start: j.start,
            end: j.end,
            total: j.total,
            kind: j.judgement.kind,
            reason: j.judgement.reason,
            ...(j.judgement.title ? { title: j.judgement.title } : {}),
            scores: j.judgement.scores,
            ...(j.judgement.trim ? { trim: j.judgement.trim } : {}),
            discard: j.judgement.discard,
        })),
        chosen: [...new Set(chosenStarts.map(momentEdits_1.momentKey))],
    };
    try {
        writeJson(snapFile(dir, vodId), snap);
    }
    catch {
        /* sin instantánea solo se pierde la pantalla de revisión de este directo */
    }
}
const loadPrefs = (file) => (0, preferences_1.cleanPrefs)(readJson(file));
exports.loadPrefs = loadPrefs;
const savePrefs = (file, p) => writeJson(file, (0, preferences_1.cleanPrefs)(p));
exports.savePrefs = savePrefs;

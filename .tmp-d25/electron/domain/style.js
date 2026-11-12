"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StyleService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const styleProfile_1 = require("../../shared/styleProfile");
/** Guarda y entrega el perfil de estilo del creador (un solo archivo, escrito de forma atómica). */
class StyleService {
    file;
    constructor(file) {
        this.file = file;
    }
    get() {
        try {
            return (0, styleProfile_1.cleanStyle)(JSON.parse(node_fs_1.default.readFileSync(this.file, 'utf8')));
        }
        catch {
            return (0, styleProfile_1.defaultStyle)();
        }
    }
    save(p) {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        node_fs_1.default.writeFileSync(tmp, JSON.stringify(p, null, 2));
        node_fs_1.default.renameSync(tmp, this.file);
        return p;
    }
    set(patch) {
        return this.save((0, styleProfile_1.patchStyle)(this.get(), patch));
    }
    addLore(name, note, triggers) {
        return this.save((0, styleProfile_1.addLore)(this.get(), name, note, triggers));
    }
    removeLore(id) {
        return this.save((0, styleProfile_1.removeLore)(this.get(), id));
    }
    reset() {
        return this.save((0, styleProfile_1.defaultStyle)());
    }
}
exports.StyleService = StyleService;

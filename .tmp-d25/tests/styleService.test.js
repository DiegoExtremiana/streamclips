"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const style_1 = require("../electron/domain/style");
const dirs = [];
(0, node_test_1.afterEach)(() => {
    while (dirs.length)
        node_fs_1.default.rmSync(dirs.pop(), { recursive: true, force: true });
});
const file = () => {
    const d = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), 'sc-style-'));
    dirs.push(d);
    return node_path_1.default.join(d, 'sub', 'style-profile.json');
};
(0, node_test_1.describe)('servicio del perfil de estilo', () => {
    (0, node_test_1.it)('sin archivo devuelve los valores de la entrevista y lo cambiado persiste', () => {
        const f = file();
        const a = new style_1.StyleService(f);
        strict_1.default.equal(a.get().silenceMaxSec, 2);
        a.set({ silenceMaxSec: 1.5, titleStyle: 'sobrio' });
        a.addLore('El pollo', 'chiste', ['pollo']);
        const b = new style_1.StyleService(f);
        strict_1.default.equal(b.get().silenceMaxSec, 1.5);
        strict_1.default.equal(b.get().titleStyle, 'sobrio');
        strict_1.default.equal(b.get().lore[0].name, 'El pollo');
        b.removeLore(b.get().lore[0].id);
        strict_1.default.equal(new style_1.StyleService(f).get().lore.length, 0);
        strict_1.default.equal(b.reset().silenceMaxSec, 2);
    });
    (0, node_test_1.it)('un archivo estropeado no rompe nada', () => {
        const f = file();
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(f), { recursive: true });
        node_fs_1.default.writeFileSync(f, '{no es json');
        strict_1.default.equal(new style_1.StyleService(f).get().shortShotMaxSec, 3);
    });
});

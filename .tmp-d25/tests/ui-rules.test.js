"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const SRC = node_path_1.default.resolve(__dirname, '../../src');
function files(dir) {
    return node_fs_1.default.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = node_path_1.default.join(dir, e.name);
        return e.isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(e.name) ? [p] : [];
    });
}
(0, node_test_1.describe)('reglas de la interfaz', () => {
    (0, node_test_1.it)('no hay emoticonos ni pictogramas en el código de la interfaz (solo iconos SVG)', () => {
        // emoticonos, flechas, símbolos varios, dingbats y signos de ancho completo usados como adorno
        const forbidden = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FF0B}\u{22EF}]/u;
        const offenders = [];
        for (const f of files(SRC)) {
            node_fs_1.default.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
                if (forbidden.test(line))
                    offenders.push(`${node_path_1.default.relative(SRC, f)}:${i + 1}: ${line.trim().slice(0, 80)}`);
            });
        }
        strict_1.default.deepEqual(offenders, []);
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
/** Registro en archivo con rotación sencilla (app.log -> app.old.log al pasar de maxBytes). */
class Logger {
    maxBytes;
    echo;
    file;
    oldFile;
    constructor(dir, maxBytes = 1_000_000, echo = false) {
        this.maxBytes = maxBytes;
        this.echo = echo;
        node_fs_1.default.mkdirSync(dir, { recursive: true });
        this.file = node_path_1.default.join(dir, 'app.log');
        this.oldFile = node_path_1.default.join(dir, 'app.old.log');
    }
    info(msg) {
        this.write('INFO', msg);
    }
    warn(msg) {
        this.write('WARN', msg);
    }
    error(msg, err) {
        const detail = err instanceof Error ? ` | ${err.message}` : err !== undefined ? ` | ${String(err)}` : '';
        this.write('ERROR', msg + detail);
    }
    write(level, msg) {
        const line = `${new Date().toISOString()} ${level} ${msg}\n`;
        if (this.echo)
            process.stderr.write(line);
        try {
            if (node_fs_1.default.existsSync(this.file) && node_fs_1.default.statSync(this.file).size > this.maxBytes) {
                node_fs_1.default.renameSync(this.file, this.oldFile);
            }
            node_fs_1.default.appendFileSync(this.file, line);
        }
        catch {
            // un fallo al escribir el log nunca debe tumbar la aplicación
        }
    }
}
exports.Logger = Logger;

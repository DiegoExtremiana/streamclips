"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatBins = exports.ChatLogger = void 0;
const node_net_1 = __importDefault(require("node:net"));
/**
 * Cuenta los mensajes del chat de tu canal para saber cuándo reacciona la gente. Entra de forma anónima
 * (solo lectura, sin cuenta ni contraseña) al IRC de Twitch. Se reconecta solo si se corta.
 */
class ChatLogger {
    o;
    sock = null;
    stopped = true;
    buf = '';
    timer = null;
    connected = false;
    constructor(o) {
        this.o = o;
    }
    start() {
        if (!this.stopped)
            return;
        this.stopped = false;
        this.connect();
    }
    stop() {
        this.stopped = true;
        this.connected = false;
        if (this.timer)
            clearTimeout(this.timer);
        this.sock?.destroy();
        this.sock = null;
    }
    connect() {
        const s = node_net_1.default.connect({ host: this.o.host ?? 'irc.chat.twitch.tv', port: this.o.port ?? 6667 });
        this.sock = s;
        s.setEncoding('utf8');
        s.on('connect', () => {
            s.write(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}\r\nJOIN #${this.o.channel.toLowerCase()}\r\n`);
            this.connected = true;
        });
        s.on('data', (chunk) => {
            this.buf += chunk;
            let i;
            while ((i = this.buf.indexOf('\r\n')) >= 0) {
                const line = this.buf.slice(0, i);
                this.buf = this.buf.slice(i + 2);
                this.line(line, s);
            }
            if (this.buf.length > 20_000)
                this.buf = '';
        });
        const retry = () => {
            this.connected = false;
            if (this.stopped || this.sock !== s)
                return;
            this.timer = setTimeout(() => this.stopped || this.connect(), this.o.reconnectMs ?? 10_000);
            this.timer.unref?.();
        };
        s.on('error', () => undefined);
        s.on('close', retry);
    }
    line(l, s) {
        if (l.startsWith('PING'))
            s.write(`PONG${l.slice(4)}\r\n`);
        else if (/^(?::[^ ]+ )?PRIVMSG /.test(l) || / PRIVMSG #/.test(l))
            this.o.onMessage(((this.o.now ?? Date.now)() / 1000));
    }
}
exports.ChatLogger = ChatLogger;
/** Mensajes por segundo desde `startSec` (marca de tiempo del inicio del directo). */
class ChatBins {
    bins = new Map();
    add(atSec, startSec) {
        const i = Math.floor(atSec - startSec);
        if (i >= 0)
            this.bins.set(i, (this.bins.get(i) ?? 0) + 1);
    }
    toArray() {
        const n = Math.max(-1, ...this.bins.keys()) + 1;
        const out = new Array(n).fill(0);
        for (const [i, c] of this.bins)
            out[i] = c;
        return out;
    }
    static fromArray(a) {
        const b = new ChatBins();
        a.forEach((c, i) => c && b.bins.set(i, c));
        return b;
    }
}
exports.ChatBins = ChatBins;

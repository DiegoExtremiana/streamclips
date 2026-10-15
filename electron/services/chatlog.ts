import net from 'node:net';

export interface ChatLoggerOpts {
  channel: string;
  host?: string;
  port?: number;
  /** Cada vez que llega un mensaje: segundo (Date.now()/1000). */
  onMessage: (atSec: number) => void;
  now?: () => number;
  reconnectMs?: number;
}

/**
 * Cuenta los mensajes del chat de tu canal para saber cuándo reacciona la gente. Entra de forma anónima
 * (solo lectura, sin cuenta ni contraseña) al IRC de Twitch. Se reconecta solo si se corta.
 */
export class ChatLogger {
  private sock: net.Socket | null = null;
  private stopped = true;
  private buf = '';
  private timer: NodeJS.Timeout | null = null;
  connected = false;

  constructor(private o: ChatLoggerOpts) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    if (this.timer) clearTimeout(this.timer);
    this.sock?.destroy();
    this.sock = null;
  }

  private connect(): void {
    const s = net.connect({ host: this.o.host ?? 'irc.chat.twitch.tv', port: this.o.port ?? 6667 });
    this.sock = s;
    s.setEncoding('utf8');
    s.on('connect', () => {
      s.write(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}\r\nJOIN #${this.o.channel.toLowerCase()}\r\n`);
      this.connected = true;
    });
    s.on('data', (chunk: string) => {
      this.buf += chunk;
      let i: number;
      while ((i = this.buf.indexOf('\r\n')) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 2);
        this.line(line, s);
      }
      if (this.buf.length > 20_000) this.buf = '';
    });
    const retry = () => {
      this.connected = false;
      if (this.stopped || this.sock !== s) return;
      this.timer = setTimeout(() => this.stopped || this.connect(), this.o.reconnectMs ?? 10_000);
      this.timer.unref?.();
    };
    s.on('error', () => undefined);
    s.on('close', retry);
  }

  private line(l: string, s: net.Socket): void {
    if (l.startsWith('PING')) s.write(`PONG${l.slice(4)}\r\n`);
    else if (/^(?::[^ ]+ )?PRIVMSG /.test(l) || / PRIVMSG #/.test(l)) this.o.onMessage(((this.o.now ?? Date.now)() / 1000));
  }
}

/** Mensajes por segundo desde `startSec` (marca de tiempo del inicio del directo). */
export class ChatBins {
  private bins = new Map<number, number>();
  add(atSec: number, startSec: number): void {
    const i = Math.floor(atSec - startSec);
    if (i >= 0) this.bins.set(i, (this.bins.get(i) ?? 0) + 1);
  }
  toArray(): number[] {
    const n = Math.max(-1, ...this.bins.keys()) + 1;
    const out = new Array<number>(n).fill(0);
    for (const [i, c] of this.bins) out[i] = c;
    return out;
  }
  static fromArray(a: number[]): ChatBins {
    const b = new ChatBins();
    a.forEach((c, i) => c && b.bins.set(i, c));
    return b;
  }
}

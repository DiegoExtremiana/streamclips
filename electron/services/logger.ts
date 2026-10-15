import fs from 'node:fs';
import path from 'node:path';

type Level = 'INFO' | 'WARN' | 'ERROR';

/** Registro en archivo con rotación sencilla (app.log -> app.old.log al pasar de maxBytes). */
export class Logger {
  private file: string;
  private oldFile: string;

  constructor(
    dir: string,
    private maxBytes = 1_000_000,
    private echo = false,
  ) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'app.log');
    this.oldFile = path.join(dir, 'app.old.log');
  }

  info(msg: string): void {
    this.write('INFO', msg);
  }
  warn(msg: string): void {
    this.write('WARN', msg);
  }
  error(msg: string, err?: unknown): void {
    const detail = err instanceof Error ? ` | ${err.message}` : err !== undefined ? ` | ${String(err)}` : '';
    this.write('ERROR', msg + detail);
  }

  private write(level: Level, msg: string): void {
    const line = `${new Date().toISOString()} ${level} ${msg}\n`;
    if (this.echo) process.stderr.write(line);
    try {
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > this.maxBytes) {
        fs.renameSync(this.file, this.oldFile);
      }
      fs.appendFileSync(this.file, line);
    } catch {
      // un fallo al escribir el log nunca debe tumbar la aplicación
    }
  }
}

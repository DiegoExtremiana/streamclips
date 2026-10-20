import type { UpdateStatus } from '../../shared/types';

/** Lo mínimo que usamos de electron-updater (así se puede probar con uno falso). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, cb: (...args: never[]) => void): unknown;
}

export interface UpdateDeps {
  updater: UpdaterLike | null;
  currentVersion: string;
  /** ¿Se puede reiniciar ahora sin perder trabajo? (nada descargando, renderizando, publicando ni en directo) */
  canRestart: () => boolean;
  onStatus: (s: UpdateStatus) => void;
  log: { info(m: string): void; warn(m: string): void };
  intervalMs?: number;
  firstCheckMs?: number;
  retryRestartMs?: number;
  now?: () => number;
}

const HOUR = 60 * 60 * 1000;

/**
 * Busca versiones nuevas cada hora, las descarga sola y, cuando no hay nada en marcha, reinicia para instalarlas.
 * Si cierras el programa antes, se instalan al cerrarlo.
 */
export class UpdateService {
  private timer: NodeJS.Timeout | null = null;
  private retry: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private state: UpdateStatus;
  private busySince = 0;

  constructor(private d: UpdateDeps) {
    this.state = { status: d.updater ? 'idle' : 'unsupported', currentVersion: d.currentVersion };
    const u = d.updater;
    if (!u) return;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.allowPrerelease = false;
    u.on('checking-for-update', () => {
      this.busySince = (this.d.now ?? Date.now)();
      this.set({ status: 'checking' });
    });
    u.on('update-available', ((info: { version: string }) => this.set({ status: 'downloading', version: info.version, progress: 0 })) as never);
    u.on('update-not-available', () => this.set({ status: 'idle', version: undefined, progress: undefined, error: undefined }));
    u.on('download-progress', ((p: { percent: number }) => this.set({ status: 'downloading', progress: Math.round(p.percent) })) as never);
    u.on('update-downloaded', ((info: { version: string }) => {
      this.set({ status: 'ready', version: info.version, progress: 100 });
      this.tryRestart();
    }) as never);
    u.on('error', ((e: Error) => {
      this.d.log.warn(`Actualizaciones: ${e.message}`);
      this.set({ status: 'error', error: friendly(e) });
    }) as never);
  }

  status(): UpdateStatus {
    return { ...this.state };
  }

  private set(p: Partial<UpdateStatus>): void {
    this.state = { ...this.state, ...p };
    this.d.onStatus(this.status());
  }

  start(): void {
    if (!this.d.updater || this.timer) return;
    this.first = setTimeout(() => void this.check(), this.d.firstCheckMs ?? 30_000);
    this.timer = setInterval(() => void this.check(), this.d.intervalMs ?? HOUR);
    this.first.unref?.();
    this.timer.unref?.();
  }

  stop(): void {
    for (const t of [this.timer, this.retry, this.first]) if (t) clearTimeout(t);
    this.timer = this.retry = this.first = null;
  }

  /** Busca ahora. Nunca lanza. */
  async check(): Promise<UpdateStatus> {
    const u = this.d.updater;
    if (!u) return this.status();
    // si ya hay una descargada esperando, no se vuelve a buscar
    const stuck = (this.d.now ?? Date.now)() - this.busySince > 15 * 60_000; // por si un evento final nunca llega
    if (this.state.status === 'ready' || ((this.state.status === 'checking' || this.state.status === 'downloading') && !stuck)) return this.status();
    try {
      await u.checkForUpdates();
      this.set({ lastCheck: new Date((this.d.now ?? Date.now)()).toISOString() });
    } catch (e) {
      this.d.log.warn(`Actualizaciones: ${(e as Error).message}`);
      this.set({ status: 'error', error: friendly(e as Error), lastCheck: new Date((this.d.now ?? Date.now)()).toISOString() });
    }
    return this.status();
  }

  /** Instala y reinicia si no hay trabajo en marcha; si lo hay, lo intenta de nuevo en un minuto. */
  tryRestart(force = false): boolean {
    if (this.state.status !== 'ready' || !this.d.updater) return false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    if (force || this.d.canRestart()) {
      this.d.log.info(`Instalando la versión ${this.state.version}.`);
      this.d.updater.quitAndInstall(true, true);
      return true;
    }
    this.retry = setTimeout(() => this.tryRestart(), this.d.retryRestartMs ?? 60_000);
    this.retry.unref?.();
    return false;
  }
}

function friendly(e: Error): string {
  const m = e.message ?? '';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR/i.test(m)) return 'Sin conexión con GitHub. Se reintentará en una hora.';
  if (/latest\.yml|Cannot find latest/i.test(m)) return 'La última versión de GitHub aún no tiene su instalador adjunto (se está compilando; suele tardar unos 5 minutos). Se volverá a comprobar sola.';
  if (/404|No published versions/i.test(m)) return 'Todavía no hay versiones publicadas en GitHub.';
  if (/403|rate limit/i.test(m)) return 'GitHub limitó las consultas. Se reintentará en una hora.';
  return m.split('\n')[0].slice(0, 200);
}

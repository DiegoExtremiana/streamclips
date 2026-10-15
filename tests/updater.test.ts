import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UpdateService, type UpdaterLike } from '../electron/services/updater';
import type { UpdateStatus } from '../shared/types';

class FakeUpdater implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checks = 0;
  installs: [boolean | undefined, boolean | undefined][] = [];
  handlers = new Map<string, (...a: never[]) => void>();
  failWith: Error | null = null;
  async checkForUpdates() {
    this.checks++;
    if (this.failWith) throw this.failWith;
    this.emit('checking-for-update');
    if (this.autoFinish) this.emit('update-not-available');
  }
  autoFinish = true;
  quitAndInstall(a?: boolean, b?: boolean) {
    this.installs.push([a, b]);
  }
  on(e: string, cb: (...a: never[]) => void) {
    this.handlers.set(e, cb);
    return this;
  }
  emit(e: string, ...a: unknown[]) {
    (this.handlers.get(e) as (...x: unknown[]) => void)(...a);
  }
}

const log = { info: () => undefined, warn: () => undefined };
function make(busy = false, extra: Partial<ConstructorParameters<typeof UpdateService>[0]> = {}) {
  const u = new FakeUpdater();
  const seen: UpdateStatus[] = [];
  let isBusy = busy;
  const svc = new UpdateService({ updater: u, currentVersion: '0.6.0', canRestart: () => !isBusy, onStatus: (s) => seen.push(s), log, ...extra });
  return { u, svc, seen, setBusy: (b: boolean) => (isBusy = b) };
}
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('actualizaciones automáticas', () => {
  it('configura el actualizador: descarga sola, instala al cerrar y nunca versiones de prueba', () => {
    const { u } = make();
    assert.deepEqual([u.autoDownload, u.autoInstallOnAppQuit, u.allowPrerelease], [true, true, false]);
  });
  it('sin actualizador (desarrollo) queda como no compatible y no hace nada', async () => {
    const svc = new UpdateService({ updater: null, currentVersion: '0.6.0', canRestart: () => true, onStatus: () => undefined, log });
    assert.equal(svc.status().status, 'unsupported');
    svc.start();
    assert.equal((await svc.check()).status, 'unsupported');
    assert.equal(svc.tryRestart(true), false);
    svc.stop();
  });
  it('recorre el ciclo buscar → descargar → listo → instalar en cuanto no hay trabajo', async () => {
    const { u, svc, seen } = make();
    await svc.check();
    u.emit('update-available', { version: '0.7.0' });
    u.emit('download-progress', { percent: 42.4 });
    assert.deepEqual([svc.status().status, svc.status().progress, svc.status().version], ['downloading', 42, '0.7.0']);
    u.emit('update-downloaded', { version: '0.7.0' });
    assert.equal(svc.status().status, 'ready');
    assert.deepEqual(u.installs, [[true, true]], 'instala en silencio y vuelve a abrir');
    assert.deepEqual(seen.map((s) => s.status).slice(0, 3), ['checking', 'idle', 'idle']);
    assert.ok(seen.some((s) => s.status === 'downloading'));
  });
  it('si hay trabajo en marcha espera y reintenta cada minuto hasta poder', async () => {
    const { u, svc, setBusy } = make(true, { retryRestartMs: 20 });
    u.emit('update-downloaded', { version: '0.7.0' });
    await tick(70);
    assert.equal(u.installs.length, 0);
    setBusy(false);
    await tick(60);
    assert.equal(u.installs.length, 1);
    svc.stop();
  });
  it('instalar a la fuerza (botón) no espera', () => {
    const { u, svc } = make(true);
    u.emit('update-downloaded', { version: '0.7.0' });
    assert.equal(svc.tryRestart(), false);
    assert.equal(svc.tryRestart(true), true);
    assert.equal(u.installs.length, 1);
    svc.stop();
  });
  it('comprueba cada intervalo (cada hora en producción) y no busca si ya hay una lista', async () => {
    const { u, svc } = make(true, { intervalMs: 30, firstCheckMs: 5, retryRestartMs: 10_000 });
    svc.start();
    await tick(100);
    assert.ok(u.checks >= 3, `${u.checks} comprobaciones`);
    u.emit('update-downloaded', { version: '0.7.0' });
    const n = u.checks;
    await tick(100);
    assert.equal(u.checks, n);
    svc.stop();
  });
  it('un fallo de red o sin versiones publicadas se explica en claro y no rompe nada', async () => {
    const { u, svc } = make();
    u.failWith = new Error('getaddrinfo ENOTFOUND github.com');
    assert.match((await svc.check()).error!, /Sin conexión con GitHub/);
    u.failWith = new Error('Cannot find latest.yml in the latest release artifacts (404)');
    assert.match((await svc.check()).error!, /Todavía no hay versiones/);
    u.failWith = null;
    u.emit('error', new Error('HttpError: 403 rate limit exceeded'));
    assert.match(svc.status().error!, /limitó/);
    assert.equal(svc.status().status, 'error');
    // se recupera en la siguiente comprobación
    await svc.check();
    u.emit('update-not-available');
    assert.equal(svc.status().status, 'idle');
    assert.equal(svc.status().error, undefined);
  });
});

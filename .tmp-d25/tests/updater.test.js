"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const updater_1 = require("../electron/services/updater");
class FakeUpdater {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    allowPrerelease = true;
    checks = 0;
    installs = [];
    handlers = new Map();
    failWith = null;
    async checkForUpdates() {
        this.checks++;
        if (this.failWith)
            throw this.failWith;
        this.emit('checking-for-update');
        if (this.autoFinish)
            this.emit('update-not-available');
    }
    autoFinish = true;
    quitAndInstall(a, b) {
        this.installs.push([a, b]);
    }
    on(e, cb) {
        this.handlers.set(e, cb);
        return this;
    }
    emit(e, ...a) {
        this.handlers.get(e)(...a);
    }
}
const log = { info: () => undefined, warn: () => undefined };
function make(busy = false, extra = {}) {
    const u = new FakeUpdater();
    const seen = [];
    let isBusy = busy;
    const svc = new updater_1.UpdateService({ updater: u, currentVersion: '0.6.0', canRestart: () => !isBusy, onStatus: (s) => seen.push(s), log, ...extra });
    return { u, svc, seen, setBusy: (b) => (isBusy = b) };
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
(0, node_test_1.describe)('actualizaciones automáticas', () => {
    (0, node_test_1.it)('configura el actualizador: descarga sola, instala al cerrar y nunca versiones de prueba', () => {
        const { u } = make();
        strict_1.default.deepEqual([u.autoDownload, u.autoInstallOnAppQuit, u.allowPrerelease], [true, true, false]);
    });
    (0, node_test_1.it)('sin actualizador (desarrollo) queda como no compatible y no hace nada', async () => {
        const svc = new updater_1.UpdateService({ updater: null, currentVersion: '0.6.0', canRestart: () => true, onStatus: () => undefined, log });
        strict_1.default.equal(svc.status().status, 'unsupported');
        svc.start();
        strict_1.default.equal((await svc.check()).status, 'unsupported');
        strict_1.default.equal(svc.tryRestart(true), false);
        svc.stop();
    });
    (0, node_test_1.it)('recorre el ciclo buscar → descargar → listo → instalar en cuanto no hay trabajo', async () => {
        const { u, svc, seen } = make();
        await svc.check();
        u.emit('update-available', { version: '0.7.0' });
        u.emit('download-progress', { percent: 42.4 });
        strict_1.default.deepEqual([svc.status().status, svc.status().progress, svc.status().version], ['downloading', 42, '0.7.0']);
        u.emit('update-downloaded', { version: '0.7.0' });
        strict_1.default.equal(svc.status().status, 'ready');
        strict_1.default.deepEqual(u.installs, [[true, true]], 'instala en silencio y vuelve a abrir');
        strict_1.default.deepEqual(seen.map((s) => s.status).slice(0, 3), ['checking', 'idle', 'idle']);
        strict_1.default.ok(seen.some((s) => s.status === 'downloading'));
    });
    (0, node_test_1.it)('si hay trabajo en marcha espera y reintenta cada minuto hasta poder', async () => {
        const { u, svc, setBusy } = make(true, { retryRestartMs: 20 });
        u.emit('update-downloaded', { version: '0.7.0' });
        await tick(70);
        strict_1.default.equal(u.installs.length, 0);
        setBusy(false);
        await tick(60);
        strict_1.default.equal(u.installs.length, 1);
        svc.stop();
    });
    (0, node_test_1.it)('instalar a la fuerza (botón) no espera', () => {
        const { u, svc } = make(true);
        u.emit('update-downloaded', { version: '0.7.0' });
        strict_1.default.equal(svc.tryRestart(), false);
        strict_1.default.equal(svc.tryRestart(true), true);
        strict_1.default.equal(u.installs.length, 1);
        svc.stop();
    });
    (0, node_test_1.it)('comprueba cada intervalo (cada hora en producción) y no busca si ya hay una lista', async () => {
        const { u, svc } = make(true, { intervalMs: 30, firstCheckMs: 5, retryRestartMs: 10_000 });
        svc.start();
        await tick(100);
        strict_1.default.ok(u.checks >= 3, `${u.checks} comprobaciones`);
        u.emit('update-downloaded', { version: '0.7.0' });
        const n = u.checks;
        await tick(100);
        strict_1.default.equal(u.checks, n);
        svc.stop();
    });
    (0, node_test_1.it)('un fallo de red o sin versiones publicadas se explica en claro y no rompe nada', async () => {
        const { u, svc } = make();
        u.failWith = new Error('getaddrinfo ENOTFOUND github.com');
        strict_1.default.match((await svc.check()).error, /Sin conexión con GitHub/);
        u.failWith = new Error('Cannot find latest.yml in the latest release artifacts (404)');
        strict_1.default.match((await svc.check()).error, /aún no tiene su instalador adjunto/);
        u.failWith = new Error('No published versions on GitHub');
        strict_1.default.match((await svc.check()).error, /Todavía no hay versiones/);
        u.failWith = null;
        u.emit('error', new Error('HttpError: 403 rate limit exceeded'));
        strict_1.default.match(svc.status().error, /limitó/);
        strict_1.default.equal(svc.status().status, 'error');
        // se recupera en la siguiente comprobación
        await svc.check();
        u.emit('update-not-available');
        strict_1.default.equal(svc.status().status, 'idle');
        strict_1.default.equal(svc.status().error, undefined);
    });
});

import { installCrashHandlers } from './app/crash';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { CHANNELS } from '../shared/types';
import type { ChannelStatus, UpdateStatus, TaskInfo, VodJob } from '../shared/types';
import { AppContext } from './app/context';
import { createMainWindow } from './app/window';
import { MEDIA_SCHEME } from '../shared/media';
import { findBundledTools } from './app/bundled';
import { planMediaResponse, resolveMedia } from './app/media';
import { autoUpdater } from 'electron-updater';
import { registerIpc } from './ipc/register';
import type { Notifier } from './domain/notifier';
import type { UpdaterLike } from './services/updater';

// Debe declararse antes de que la app esté lista.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

nativeTheme.themeSource = 'dark'; // barra de título oscura en Windows

let win: BrowserWindow | null = null;
let ctx: AppContext | null = null;

const notifier: Notifier = {
  vod: (job: VodJob) => win?.webContents.send(CHANNELS.eventVod, job),
  task: (t: TaskInfo) => win?.webContents.send(CHANNELS.eventTask, t),
  update: (s: UpdateStatus) => win?.webContents.send(CHANNELS.eventUpdate, s),
  channel: (s: ChannelStatus) => win?.webContents.send(CHANNELS.eventChannel, s),
  changed: () => win?.webContents.send(CHANNELS.eventData),
};

function openWindow(): void {
  win = createMainWindow({
    preloadPath: path.join(__dirname, 'preload.js'),
    rendererIndex: path.join(__dirname, '../../dist/index.html'),
    devUrl: process.env.VITE_DEV ? 'http://localhost:5173' : undefined,
  });
  win.on('closed', () => {
    win = null;
  });
}

installCrashHandlers(process, () => ctx?.log);

// Una sola instancia: dos programadores a la vez sobre los mismos datos podrían publicar dos veces.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    ctx = new AppContext({
      userDataDir: app.getPath('userData'),
      defaultOutputDir: path.join(app.getPath('videos'), 'StreamClips'),
      cipher: {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (s) => safeStorage.encryptString(s),
        decrypt: (b) => safeStorage.decryptString(b),
      },
      notifier,
      // solo en el programa instalado: en desarrollo no hay nada que actualizar
      updater: app.isPackaged && process.platform === 'win32' ? (autoUpdater as unknown as UpdaterLike) : null,
      appVersion: app.getVersion(),
      engineSource: () => fs.readFileSync(path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'cloud', 'engine.js'), 'utf8'),
      runnerSource: () => fs.readFileSync(path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'cloud', 'runner.js'), 'utf8'),
      openUrl: (url) => {
        if (!/^https:\/\//.test(url)) throw new Error('Dirección no permitida.');
        return shell.openExternal(url);
      },
      fontsDir: path.join(app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'), 'fonts'),
      bundled: findBundledTools({
        resourcesDir: app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
        platform: process.platform,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        load: (name) => require(name) as unknown,
      }),
    });

    protocol.handle(MEDIA_SCHEME, (request) => {
      const file = ctx ? resolveMedia(ctx, request.url) : null;
      if (!file) return new Response('No encontrado', { status: 404 });
      const plan = planMediaResponse(file, request.headers.get('range'));
      if (plan.status === 416) return new Response(null, { status: 416, headers: plan.headers });
      const stream = fs.createReadStream(file, { start: plan.start, end: plan.end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: plan.status, headers: plan.headers });
    });

    registerIpc(
      { handle: (channel, listener) => ipcMain.handle(channel, (event, ...args) => listener(event, ...args)) },
      ctx,
      {
        pickFolder: async () => {
          const parent = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
          const opts = { properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] };
          const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        pickImage: async () => {
          const parent = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
          const opts = { properties: ['openFile' as const], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] };
          const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        pickTranscript: async () => {
          const parent = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
          const opts = { properties: ['openFile' as const], filters: [{ name: 'Transcripción', extensions: ['json', 'srt', 'vtt'] }] };
          const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
          return r.canceled ? null : (r.filePaths[0] ?? null);
        },
        pickSavePath: async (defaultName) => {
          const parent = BrowserWindow.getFocusedWindow() ?? win ?? undefined;
          const opts = { defaultPath: path.join(app.getPath('downloads'), defaultName), filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }] };
          const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts);
          return r.canceled ? null : (r.filePath ?? null);
        },
        showItem: (file) => shell.showItemInFolder(file),
        openFolder: async (dir) => {
          await shell.openPath(dir);
        },
      },
    );

    openWindow();
    ctx.start();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow();
    });
  });

  app.on('before-quit', () => ctx?.stop());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

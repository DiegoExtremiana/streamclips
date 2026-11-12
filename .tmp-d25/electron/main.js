"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crash_1 = require("./app/crash");
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_stream_1 = require("node:stream");
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("../shared/types");
const context_1 = require("./app/context");
const window_1 = require("./app/window");
const media_1 = require("../shared/media");
const bundled_1 = require("./app/bundled");
const media_2 = require("./app/media");
const electron_updater_1 = require("electron-updater");
const register_1 = require("./ipc/register");
// Debe declararse antes de que la app esté lista.
electron_1.protocol.registerSchemesAsPrivileged([
    { scheme: media_1.MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
electron_1.nativeTheme.themeSource = 'dark'; // barra de título oscura en Windows
let win = null;
let ctx = null;
const notifier = {
    vod: (job) => win?.webContents.send(types_1.CHANNELS.eventVod, job),
    task: (t) => win?.webContents.send(types_1.CHANNELS.eventTask, t),
    update: (s) => win?.webContents.send(types_1.CHANNELS.eventUpdate, s),
    channel: (s) => win?.webContents.send(types_1.CHANNELS.eventChannel, s),
    changed: () => win?.webContents.send(types_1.CHANNELS.eventData),
};
function openWindow() {
    win = (0, window_1.createMainWindow)({
        preloadPath: node_path_1.default.join(__dirname, 'preload.js'),
        rendererIndex: node_path_1.default.join(__dirname, '../../dist/index.html'),
        devUrl: process.env.VITE_DEV ? 'http://localhost:5173' : undefined,
    });
    win.on('closed', () => {
        win = null;
    });
}
(0, crash_1.installCrashHandlers)(process, () => ctx?.log);
// Una sola instancia: dos programadores a la vez sobre los mismos datos podrían publicar dos veces.
if (!electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        if (win) {
            if (win.isMinimized())
                win.restore();
            win.focus();
        }
    });
    void electron_1.app.whenReady().then(() => {
        ctx = new context_1.AppContext({
            userDataDir: electron_1.app.getPath('userData'),
            defaultOutputDir: node_path_1.default.join(electron_1.app.getPath('videos'), 'StreamClips'),
            cipher: {
                available: () => electron_1.safeStorage.isEncryptionAvailable(),
                encrypt: (s) => electron_1.safeStorage.encryptString(s),
                decrypt: (b) => electron_1.safeStorage.decryptString(b),
            },
            notifier,
            // solo en el programa instalado: en desarrollo no hay nada que actualizar
            updater: electron_1.app.isPackaged && process.platform === 'win32' ? electron_updater_1.autoUpdater : null,
            appVersion: electron_1.app.getVersion(),
            engineSource: () => node_fs_1.default.readFileSync(node_path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(electron_1.app.getAppPath(), 'resources'), 'cloud', 'engine.js'), 'utf8'),
            runnerSource: () => node_fs_1.default.readFileSync(node_path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(electron_1.app.getAppPath(), 'resources'), 'cloud', 'runner.js'), 'utf8'),
            openUrl: (url) => {
                if (!/^https:\/\//.test(url))
                    throw new Error('Dirección no permitida.');
                return electron_1.shell.openExternal(url);
            },
            fontsDir: node_path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(electron_1.app.getAppPath(), 'resources'), 'fonts'),
            diarizationModel: node_path_1.default.join(electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(electron_1.app.getAppPath(), 'resources'), 'models', 'pyannote-segmentation-3.0.int8.onnx'),
            bundled: (0, bundled_1.findBundledTools)({
                resourcesDir: electron_1.app.isPackaged ? process.resourcesPath : node_path_1.default.join(electron_1.app.getAppPath(), 'resources'),
                platform: process.platform,
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                load: (name) => require(name),
            }),
        });
        electron_1.protocol.handle(media_1.MEDIA_SCHEME, (request) => {
            const file = ctx ? (0, media_2.resolveMedia)(ctx, request.url) : null;
            if (!file)
                return new Response('No encontrado', { status: 404 });
            const plan = (0, media_2.planMediaResponse)(file, request.headers.get('range'));
            if (plan.status === 416)
                return new Response(null, { status: 416, headers: plan.headers });
            const stream = node_fs_1.default.createReadStream(file, { start: plan.start, end: plan.end });
            return new Response(node_stream_1.Readable.toWeb(stream), { status: plan.status, headers: plan.headers });
        });
        (0, register_1.registerIpc)({ handle: (channel, listener) => electron_1.ipcMain.handle(channel, (event, ...args) => listener(event, ...args)) }, ctx, {
            pickFolder: async () => {
                const parent = electron_1.BrowserWindow.getFocusedWindow() ?? win ?? undefined;
                const opts = { properties: ['openDirectory', 'createDirectory'] };
                const r = parent ? await electron_1.dialog.showOpenDialog(parent, opts) : await electron_1.dialog.showOpenDialog(opts);
                return r.canceled ? null : (r.filePaths[0] ?? null);
            },
            pickImage: async () => {
                const parent = electron_1.BrowserWindow.getFocusedWindow() ?? win ?? undefined;
                const opts = { properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }] };
                const r = parent ? await electron_1.dialog.showOpenDialog(parent, opts) : await electron_1.dialog.showOpenDialog(opts);
                return r.canceled ? null : (r.filePaths[0] ?? null);
            },
            pickTranscript: async () => {
                const parent = electron_1.BrowserWindow.getFocusedWindow() ?? win ?? undefined;
                const opts = { properties: ['openFile'], filters: [{ name: 'Transcripción', extensions: ['json', 'srt', 'vtt'] }] };
                const r = parent ? await electron_1.dialog.showOpenDialog(parent, opts) : await electron_1.dialog.showOpenDialog(opts);
                return r.canceled ? null : (r.filePaths[0] ?? null);
            },
            pickSavePath: async (defaultName) => {
                const parent = electron_1.BrowserWindow.getFocusedWindow() ?? win ?? undefined;
                const opts = { defaultPath: node_path_1.default.join(electron_1.app.getPath('downloads'), defaultName), filters: [{ name: 'Vídeo MP4', extensions: ['mp4'] }] };
                const r = parent ? await electron_1.dialog.showSaveDialog(parent, opts) : await electron_1.dialog.showSaveDialog(opts);
                return r.canceled ? null : (r.filePath ?? null);
            },
            showItem: (file) => electron_1.shell.showItemInFolder(file),
            openFolder: async (dir) => {
                await electron_1.shell.openPath(dir);
            },
        });
        openWindow();
        ctx.start();
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                openWindow();
        });
    });
    electron_1.app.on('before-quit', () => ctx?.stop());
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin')
            electron_1.app.quit();
    });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMainWindow = createMainWindow;
const electron_1 = require("electron");
/** Ventana con el aislamiento de Electron activado y sin navegación ni ventanas externas. */
function createMainWindow(o) {
    const win = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 960,
        minHeight: 640,
        title: 'StreamClips',
        backgroundColor: '#14161a',
        show: false,
        webPreferences: {
            preload: o.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    win.setMenuBarVisibility(false);
    win.once('ready-to-show', () => win.show());
    // Ninguna página puede abrir ventanas nuevas; los enlaces http(s) se abren en el navegador del sistema.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url))
            void electron_1.shell.openExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
        const allowed = o.devUrl ? url.startsWith(o.devUrl) : url.startsWith('file://');
        if (!allowed)
            event.preventDefault();
    });
    if (o.devUrl)
        void win.loadURL(o.devUrl);
    else
        void win.loadFile(o.rendererIndex);
    return win;
}

import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { createDatabase } from './db';

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

/** Default window size; shrunk to fit small screens. */
const DEFAULT_SIZE = { width: 1600, height: 960 };

function createWindow(): void {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(DEFAULT_SIZE.width, workAreaSize.width),
    height: Math.min(DEFAULT_SIZE.height, workAreaSize.height),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Development only: never in a packaged build. Docked inside the window.
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'right' });
  }
}

let database: ReturnType<typeof createDatabase> | undefined;

void app.whenReady().then(() => {
  database = createDatabase(path.join(app.getPath('userData'), 'micropos.db'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => database?.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

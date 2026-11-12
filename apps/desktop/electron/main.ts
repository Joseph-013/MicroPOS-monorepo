import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { createDatabase } from './db';

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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

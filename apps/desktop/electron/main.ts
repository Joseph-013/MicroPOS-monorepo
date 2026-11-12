import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { createDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { attachScanner } from './scanner';

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

  // Scanner keystrokes are caught here, before the page: stray scans cannot type into fields or press buttons.
  attachScanner(win);

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

/**
 * Packaged: the per-user data folder. Development: apps/desktop/local-data/micropos-dev.db, the same file
 * `pnpm db:migrate` and `pnpm db:seed` write to, so the dev app shows whatever they set up.
 */
function databaseFile(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'micropos.db')
    : path.join(app.getAppPath(), 'local-data', 'micropos-dev.db');
}

/** Generated SQL migrations: copied next to the app when packaged (see forge.config.js extraResource). */
function migrationsFolder(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'migrations')
    : path.join(app.getAppPath(), 'electron', 'db', 'migrations');
}

void app.whenReady().then(() => {
  database = createDatabase(databaseFile(), { migrationsFolder: migrationsFolder() });
  registerIpcHandlers(database.db);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => database?.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

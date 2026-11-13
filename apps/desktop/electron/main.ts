import { app, BrowserWindow, Menu, screen, session } from 'electron';
import path from 'node:path';
import { createDatabase } from './db';
import { registerIpcHandlers } from './ipc';
import { closeCustomerDisplay, registerCustomerDisplay } from './display';
import { purgeLegacyData } from './legacy-data';
import { attachScanner } from './scanner';
import { handleSquirrelEvent } from './squirrel';

const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

/** Default window size; shrunk to fit small screens. */
const DEFAULT_SIZE = { width: 1600, height: 960 };

/** The app icon: shipped as a resource when packaged (the window shows it on Linux), read from `assets/` in development. */
function iconFile(): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'assets', 'icon.png');
}

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

let mainWindow: BrowserWindow | undefined;

/** The customer-facing window: the same app, at the `customer-display` route, shown without taking focus (see `display/`). */
function createDisplayWindow(bounds: { x: number; y: number; width: number; height: number }): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    title: 'MicroPOS customer display',
    icon: iconFile(),
    backgroundColor: '#041d29',
    autoHideMenuBar: true,
    webPreferences,
  });
  if (devServerUrl) void win.loadURL(`${devServerUrl}#/customer-display`);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: '/customer-display' });
  return win;
}

function createWindow(): void {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.min(DEFAULT_SIZE.width, workAreaSize.width),
    height: Math.min(DEFAULT_SIZE.height, workAreaSize.height),
    icon: iconFile(),
    title: 'MicroPOS',
    webPreferences,
  });
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = undefined;
    closeCustomerDisplay(); // the customer display never outlives the till
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

/**
 * A packaged app starts on a folder an earlier MicroPOS may have used (same name, other schema): make it this app's
 * own before anything opens it. Not in development, where the data lives in the project.
 */
function claimUserData(): boolean {
  if (!app.isPackaged) return false;
  const result = purgeLegacyData(app.getPath('userData'));
  if (result.state === 'purged') {
    console.log(`Removed data of an earlier install: ${result.removed.join(', ')}${result.failed.length ? ` (could not remove: ${result.failed.join(', ')})` : ''}`);
  }
  return result.state === 'purged';
}

if (handleSquirrelEvent(process.argv, process.execPath)) {
  app.quit(); // installing, updating or uninstalling: shortcuts are made or removed and the app exits
} else {
  // The installed app has no menu bar (File, Edit, View, Window); development keeps it for the DevTools entries.
  if (app.isPackaged) Menu.setApplicationMenu(null);
  const purged = claimUserData();
  void app.whenReady().then(async () => {
    // Browser storage (the old page's local storage, caches) is held by Chromium: clear it through its own API too.
    if (purged) await session.defaultSession.clearStorageData();
    database = createDatabase(databaseFile(), { migrationsFolder: migrationsFolder() });
    registerIpcHandlers(database.db);
    registerCustomerDisplay({ createWindow: createDisplayWindow, mainWindow: () => mainWindow });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('will-quit', () => database?.close());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

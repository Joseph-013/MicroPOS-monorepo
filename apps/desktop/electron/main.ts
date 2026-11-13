import type { DataDomain } from '@micropos/core';
import { app, BrowserWindow, Menu, powerMonitor, screen, session } from 'electron';
import path from 'node:path';
import { ensureOwner, signOut } from './auth/auth';
import { accrueInterest } from './db/queries/credit-interest';
import { createDatabase } from './db';
import { getCloseToTray, onCloseToTrayChanged } from './close-to-tray';
import { startConcernsClock } from './concerns-clock';
import { TrayIcon } from './tray';
import { CHANNELS } from './ipc/channels';
import { emitDataChanged, onDataChanged } from './ipc/changes';
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
/** True once the app is really quitting (Quit in the tray, or the system closing it): then closing the window closes it. */
let quitting = false;
/** Whether closing the window only hides it (the setting, kept here so the close handler needs no database read). */
let closeToTray = false;
const trayIcon = new TrayIcon(
  () => iconFile(),
  () => showMainWindow(),
  () => app.quit(),
);

/** Brings the till back: from the tray, or when the app is started again while it runs hidden. */
function showMainWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

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
  win.on('page-title-updated', (event) => event.preventDefault()); // the title stays as set above, whatever the page is called
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
  // The window is always called MicroPOS: the page titles ("Checkout", "Sales Orders") are for the browser, not the title bar.
  win.on('page-title-updated', (event) => event.preventDefault());
  // With "keep running in the tray" on, closing the window only hides it (background work carries on); Quit in the tray really closes.
  win.on('close', (event) => {
    if (quitting || !closeToTray) return;
    event.preventDefault();
    win.hide();
  });
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
let interestTimer: ReturnType<typeof setInterval> | undefined;
let concernsClock: ReturnType<typeof startConcernsClock> | undefined;

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

// Development has an app id (and launcher entry, written by scripts/dev.mjs) of its own: on Linux the taskbar takes the
// icon from the launcher entry that matches the app id, and the packaged app's `micropos` would match whatever
// MicroPOS happens to be installed on the machine.
if (!app.isPackaged) app.setDesktopName('micropos-dev.desktop');

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
  // One MicroPOS at a time (two would share one database): starting it again, for instance while it runs hidden in the tray, brings the till back.
  const gotLock = app.requestSingleInstanceLock();
  app.on('second-instance', () => showMainWindow());
  if (!gotLock) app.quit();
  else void app.whenReady().then(async () => {
    // Browser storage (the old page's local storage, caches) is held by Chromium: clear it through its own API too.
    if (purged) await session.defaultSession.clearStorageData();
    database = createDatabase(databaseFile(), { migrationsFolder: migrationsFolder() });
    ensureOwner(database.db); // a fresh install gets an owner account to sign in with
    closeToTray = getCloseToTray(database.db);
    if (closeToTray) trayIcon.show();
    onCloseToTrayChanged((value) => {
      closeToTray = value;
      if (value) trayIcon.show();
      else {
        trayIcon.hide();
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show(); // never leave the app running with nothing to click
      }
    });
    // Credit interest that has fallen due is written now, and again every hour for a till left running for days.
    const accrue = (): void => {
      try {
        if (database && accrueInterest(database.db) > 0) emitDataChanged(['customers']); // interest was charged
      } catch (error) {
        console.error('Could not charge credit interest', error);
      }
    };
    accrue();
    interestTimer = setInterval(accrue, 60 * 60 * 1000);
    registerIpcHandlers(database.db);
    // Every window hears when data changes; the clock adds the moments when time alone makes something a concern.
    const broadcast = (domains: readonly DataDomain[]): void => {
      for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(CHANNELS.data.changed, domains);
    };
    onDataChanged(broadcast);
    concernsClock = startConcernsClock(database.db, broadcast);
    powerMonitor.on('resume', () => concernsClock?.resume());
    registerCustomerDisplay({ createWindow: createDisplayWindow, mainWindow: () => mainWindow });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('before-quit', () => {
  quitting = true; // when an updater is added: also set this on autoUpdater's 'before-quit-for-update', which closes windows first
});

app.on('will-quit', () => {
  trayIcon.hide();
  if (interestTimer) clearInterval(interestTimer);
  concernsClock?.stop();
  if (database) signOut(database.db); // records the sign-out of whoever was signed in
  database?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

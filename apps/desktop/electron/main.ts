import type { DataDomain } from '@micropos/core';
import { app, BrowserWindow, Menu, powerMonitor, screen } from 'electron';
import path from 'node:path';
import { ensureOwner, signOut } from './auth/auth';
import { accrueInterest } from './db/queries/credit-interest';
import { createDatabase } from './db';
import { getCloseToTray, onCloseToTrayChanged } from './close-to-tray';
import { startConcernsClock } from './concerns-clock';
import { TrayIcon } from './tray';
import { CHANNELS } from './ipc/channels';
import { emitDataChanged, onDataChanged } from './ipc/changes';
import { registerIpcHandlers, rpcHandlers } from './ipc';
import { LanService } from './lan';
import { applyPendingImport, autoBackup } from './backup/backup';
import { BackupService } from './backup/service';
import { closeCustomerDisplay, registerCustomerDisplay } from './display';
import { initLogging, log } from './logging';
import { attachScanner } from './scanner';

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
  win.on('unresponsive', () => log.warn('main', 'The window stopped responding'));
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

  // Development only: never in a packaged build. In a window of its own, so it never takes room from the till's layout.
  if (!app.isPackaged) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

let database: ReturnType<typeof createDatabase> | undefined;
let backupTimer: ReturnType<typeof setInterval> | undefined;
let interestTimer: ReturnType<typeof setInterval> | undefined;
let concernsClock: ReturnType<typeof startConcernsClock> | undefined;
let lanService: LanService | undefined;

/**
 * Packaged: the per-user data folder. Development: apps/desktop/local-data/micropos-dev.db, the same file
 * `pnpm db:migrate` and `pnpm db:seed` write to, so the dev app shows whatever they set up.
 */
function databaseFile(): string {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'micropos.db')
    : path.join(app.getAppPath(), 'local-data', 'micropos-dev.db');
}

/** Backups of the database: next to it in the per-user data folder when packaged, `local-data/backups` in development. */
function backupsFolder(): string {
  return app.isPackaged ? path.join(app.getPath('userData'), 'backups') : path.join(app.getAppPath(), 'local-data', 'backups');
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

// The installed app has no menu bar (File, Edit, View, Window); development keeps it for the DevTools entries.
if (app.isPackaged) Menu.setApplicationMenu(null);
// Logs go in a `logs` folder: the system's log folder when installed, `local-data/logs` in development.
initLogging(app.isPackaged ? app.getPath('logs') : path.join(app.getAppPath(), 'local-data', 'logs'), !app.isPackaged);
log.info('app', `MicroPOS ${app.getVersion()} started (${process.platform}, Electron ${process.versions.electron})`);
process.on('uncaughtException', (error) => log.error('main', 'Uncaught exception', error));
process.on('unhandledRejection', (reason) => log.error('main', 'Unhandled promise rejection', reason));
app.on('render-process-gone', (_event, _contents, details) => log.error('main', `The window's process ended (${details.reason}, code ${details.exitCode})`));
app.on('child-process-gone', (_event, details) => log.error('main', `A ${details.type} process ended (${details.reason}, code ${details.exitCode})`));
// One MicroPOS at a time (two would share one database): starting it again, for instance while it runs hidden in the tray, brings the till back.
const gotLock = app.requestSingleInstanceLock();
app.on('second-instance', () => showMainWindow());
if (!gotLock) app.quit();
else void app.whenReady().then(async () => {
  // A database chosen in Settings > Backup (import or restore) is put in place before anything opens the file.
  try {
    if (applyPendingImport(databaseFile())) log.info('backup', 'Imported database put in place');
  } catch (error) {
    log.error('backup', 'Could not put the imported database in place', error);
  }
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
      log.error('interest', 'Could not charge credit interest', error);
    }
  };
  accrue();
  interestTimer = setInterval(accrue, 60 * 60 * 1000);
  // The server for phones and tablets on the network (off until an admin turns it on in Devices).
  lanService = new LanService({
    db: database.db,
    handlers: rpcHandlers,
    dataFolder: app.getPath('userData'),
    rendererDir: devServerUrl ? null : path.join(__dirname, '../renderer'),
    devServerUrl: devServerUrl ?? null,
    announce: (domains) => emitDataChanged(domains),
  });
  const backups = new BackupService({
    db: database.db,
    dbFile: databaseFile(),
    folder: backupsFolder(),
    migrationsFolder: migrationsFolder(),
    restart: () => {
      app.relaunch();
      app.quit();
    },
  });
  registerIpcHandlers(database.db, lanService, backups);
  // One automatic backup a day (checked at startup and hourly, for a till left running for days).
  const dailyBackup = (): void => {
    if (database) autoBackup(database.db, backupsFolder()).catch((error) => log.error('backup', 'Could not make the daily backup', error));
  };
  dailyBackup();
  backupTimer = setInterval(dailyBackup, 60 * 60 * 1000);
  void lanService.startIfEnabled();
  // Every window hears when data changes; the clock adds the moments when time alone makes something a concern.
  const broadcast = (domains: readonly DataDomain[]): void => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(CHANNELS.data.changed, domains);
    lanService?.broadcast(domains); // and every paired device
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

app.on('before-quit', () => {
  log.info('app', 'Quitting');
  void lanService?.stop();
  quitting = true; // when an updater is added: also set this on autoUpdater's 'before-quit-for-update', which closes windows first
});

app.on('will-quit', () => {
  trayIcon.hide();
  if (interestTimer) clearInterval(interestTimer);
  if (backupTimer) clearInterval(backupTimer);
  concernsClock?.stop();
  if (database) signOut(database.db); // records the sign-out of whoever was signed in
  database?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

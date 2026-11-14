import { log } from '../logging';
import { CUSTOMER_DISPLAY_MODES, type CustomerDisplayMode, type CustomerDisplayState, IDLE_DISPLAY_STATE } from '@micropos/core';
import { app, type BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CHANNELS } from '../ipc/channels';
import { sanitizeDisplayState } from './state';
import { type DisplayInfo, parsePlacement, type Placement, placementOf, placementOnDisplay, type Rect, resolveBounds } from './window-bounds';

export interface CustomerDisplayDeps {
  /** Makes the (hidden) display window at these bounds. */
  createWindow(bounds: Rect): BrowserWindow;
  /** The main window, told when the display opens or closes. */
  mainWindow(): BrowserWindow | undefined;
}

const SAVE_DELAY_MS = 400;

let win: BrowserWindow | null = null;
let state: CustomerDisplayState = IDLE_DISPLAY_STATE;
let saveTimer: NodeJS.Timeout | undefined;
/** Whether the monitor and position are used and saved (the Settings switch); set by every `show`. */
let remember = true;

const placementFile = (): string => path.join(app.getPath('userData'), 'customer-display.json');

const displays = (): DisplayInfo[] => screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }));

function loadPlacement(): Placement | null {
  try {
    return parsePlacement(JSON.parse(fs.readFileSync(placementFile(), 'utf8')));
  } catch {
    return null; // none saved yet, or unreadable: open at the default place
  }
}

/**
 * Remembers the monitor the window is on and where on it (relative to that monitor). While it is maximized or full
 * screen its bounds are just the monitor, so only the monitor is updated and the size and position it has as an
 * ordinary window stay as they were.
 */
function savePlacement(target: BrowserWindow): void {
  if (!remember || target.isDestroyed() || target.isMinimized()) return;
  const covering = target.isFullScreen() || target.isMaximized();
  const placement = covering ? placementOnDisplay(loadPlacement(), target.getBounds(), displays()) : placementOf(target.getBounds(), displays());
  if (!placement) return;
  try {
    fs.writeFileSync(placementFile(), JSON.stringify(placement));
  } catch (error) {
    log.error('display', 'Could not remember the customer display position', error);
  }
}

function notify(deps: CustomerDisplayDeps, open: boolean): void {
  const main = deps.mainWindow();
  if (main && !main.isDestroyed()) main.webContents.send(CHANNELS.display.visibility, open);
}

/** Puts the window in the wanted mode: an ordinary window (at its remembered size and place), maximized, or full screen. */
function applyMode(target: BrowserWindow, mode: CustomerDisplayMode): void {
  if (mode === 'fullscreen') {
    target.setFullScreen(true);
    return;
  }
  if (target.isFullScreen()) target.setFullScreen(false);
  if (mode === 'maximized') {
    if (!target.isMaximized()) target.maximize();
  } else if (target.isMaximized()) {
    target.unmaximize();
  }
}

const modeOf = (value: unknown): CustomerDisplayMode =>
  (CUSTOMER_DISPLAY_MODES as readonly unknown[]).includes(value) ? (value as CustomerDisplayMode) : 'windowed';

/**
 * Opens the customer display on the monitor it was on, in the wanted mode: windowed at the position it had (kept
 * inside that monitor), maximized or full screen on that monitor. An open window is just put into the mode.
 */
function showDisplay(deps: CustomerDisplayDeps, mode: CustomerDisplayMode, remembering: boolean): void {
  const wasRemembering = remember;
  remember = remembering;
  if (win && !win.isDestroyed()) {
    applyMode(win, mode);
    if (remember && !wasRemembering) savePlacement(win); // switched on while open: this is where it stays from now on
    return;
  }
  // Not remembering: opens where a first start would, and where it is moved to is not kept.
  const bounds = resolveBounds(remembering ? loadPlacement() : null, displays(), screen.getPrimaryDisplay().id);
  if (!bounds) return;
  const created = deps.createWindow(bounds);
  win = created;
  const scheduleSave = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => savePlacement(created), SAVE_DELAY_MS);
  };
  created.on('move', scheduleSave);
  created.on('resize', scheduleSave);
  created.on('close', () => {
    clearTimeout(saveTimer);
    savePlacement(created);
  });
  created.on('closed', () => {
    if (win === created) win = null;
    notify(deps, false);
  });
  // Shown without taking the keyboard from the cashier's window.
  created.once('ready-to-show', () => {
    created.showInactive();
    applyMode(created, mode);
    notify(deps, true);
  });
}

/** Closes it; where it was is remembered for next time. */
function hideDisplay(): void {
  if (win && !win.isDestroyed()) win.close();
}

/** Registers the customer display's IPC calls. */
export function registerCustomerDisplay(deps: CustomerDisplayDeps): void {
  ipcMain.handle(CHANNELS.display.show, (_event, options: unknown) => {
    const o = (options ?? {}) as { mode?: unknown; remember?: unknown };
    showDisplay(deps, modeOf(o.mode), o.remember !== false);
  });
  ipcMain.handle(CHANNELS.display.hide, () => hideDisplay());
  ipcMain.handle(CHANNELS.display.isOpen, () => !!win && !win.isDestroyed() && win.isVisible());
  ipcMain.handle(CHANNELS.display.getState, () => state);
  ipcMain.handle(CHANNELS.display.publish, (_event, value: unknown) => {
    state = sanitizeDisplayState(value);
    if (win && !win.isDestroyed()) win.webContents.send(CHANNELS.display.state, state);
  });
}

/** The main window is closing: the display goes with it. */
export function closeCustomerDisplay(): void {
  hideDisplay();
}

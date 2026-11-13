import { type CustomerDisplayState, IDLE_DISPLAY_STATE } from '@micropos/core';
import { app, type BrowserWindow, ipcMain, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CHANNELS } from '../ipc/channels';
import { sanitizeDisplayState } from './state';
import { type DisplayInfo, parsePlacement, type Placement, placementOf, type Rect, resolveBounds } from './window-bounds';

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

const placementFile = (): string => path.join(app.getPath('userData'), 'customer-display.json');

const displays = (): DisplayInfo[] => screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea }));

function loadPlacement(): Placement | null {
  try {
    return parsePlacement(JSON.parse(fs.readFileSync(placementFile(), 'utf8')));
  } catch {
    return null; // none saved yet, or unreadable: open at the default place
  }
}

/** Remembers the monitor the window is on and where on it (relative to that monitor). */
function savePlacement(target: BrowserWindow): void {
  if (target.isDestroyed() || target.isMinimized() || target.isFullScreen()) return;
  const placement = placementOf(target.getBounds(), displays());
  if (!placement) return;
  try {
    fs.writeFileSync(placementFile(), JSON.stringify(placement));
  } catch (error) {
    console.error('Could not remember the customer display position', error);
  }
}

function notify(deps: CustomerDisplayDeps, open: boolean): void {
  const main = deps.mainWindow();
  if (main && !main.isDestroyed()) main.webContents.send(CHANNELS.display.visibility, open);
}

/** Opens the customer display on the monitor and at the position it had, kept inside that monitor. Does nothing if open. */
function showDisplay(deps: CustomerDisplayDeps): void {
  if (win && !win.isDestroyed()) return;
  const bounds = resolveBounds(loadPlacement(), displays(), screen.getPrimaryDisplay().id);
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
    notify(deps, true);
  });
}

/** Closes it; where it was is remembered for next time. */
function hideDisplay(): void {
  if (win && !win.isDestroyed()) win.close();
}

/** Registers the customer display's IPC calls. */
export function registerCustomerDisplay(deps: CustomerDisplayDeps): void {
  ipcMain.handle(CHANNELS.display.show, () => showDisplay(deps));
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

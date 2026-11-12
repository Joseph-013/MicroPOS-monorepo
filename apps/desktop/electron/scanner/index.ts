import type { BrowserWindow } from 'electron';
import { CHANNELS } from '../ipc/channels';
import { ScanGate } from './scan-gate';

/** Keys Electron's `sendInputEvent` wants by name rather than by character. */
const KEY_NAMES: Record<string, string> = { ' ': 'Space' };

const gates = new Set<ScanGate>();
let enabled = true;

/** The page switches scanning on or off; every window follows. */
export function setScannerEnabled(on: boolean): void {
  enabled = on;
  for (const gate of gates) {
    gate.enabled = on;
    if (!on) gate.dispose();
  }
}

/**
 * Puts the scanner gate in front of a window's keyboard input. A detected scan is sent to the page as
 * `scanner:scan`; keys that were only held back in case they were a scan are typed into the page afterwards.
 */
export function attachScanner(win: BrowserWindow): void {
  let replaying = false; // injected keys must not be examined (and held) a second time

  const gate = new ScanGate({
    emitScan: (code) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.scanner.scan, { code });
    },
    replay: (keys) => {
      if (win.isDestroyed()) return;
      replaying = true;
      try {
        for (const key of keys) {
          const keyCode = KEY_NAMES[key] ?? key;
          win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
          win.webContents.sendInputEvent({ type: 'char', keyCode });
          win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        }
      } finally {
        replaying = false;
      }
    },
  });
  gate.enabled = enabled;
  gates.add(gate);

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || replaying) return;
    if (gate.onKeyDown(input)) event.preventDefault();
  });
  win.on('closed', () => {
    gate.dispose();
    gates.delete(gate);
  });
}

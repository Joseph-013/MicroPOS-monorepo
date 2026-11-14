import { DestroyRef, effect, inject, Service, signal } from '@angular/core';
import { DESKTOP_API } from '../api/desktop-api';
import { devLog } from '../dev-log';

export interface Scan {
  code: string;
}

/** Return `false` to decline a scan and let the next claim down the stack handle it. */
export type ScanHandler = (scan: Scan) => void | boolean;

export interface ScannerClaim {
  release(): void;
}

type ScanInputHandler = (scan: Scan) => void;

/** A hook sees every scan before the claims do; returning true means it was for the hook and nobody else gets it. */
export type ScanHook = (code: string) => boolean;

/**
 * Barcode scans (USB keyboard-wedge scanner), delivered by the Electron main process.
 *
 * The main process watches the keyboard before the page does: it holds back fast keystrokes, and when they prove
 * to be a scan it sends the code here instead of ever delivering the keys. So a scan can never type into a field,
 * press a focused button, tick a checkbox or reopen a dialog trigger, whatever has focus. This service only
 * decides *who* gets the code:
 *
 * - Components take turns by *claiming* the scanner. The most recent claim gets scans first; releasing it hands
 *   control back to the previous claim, so a dialog can take over and give it back when it closes.
 * - A handler may return `false` to pass a scan down to the next claim. With no claims, scans are dropped.
 * - A hook (`addHook`) sees every scan first and may take it: for codes that mean the same wherever the till is,
 *   such as the QR code on a receipt (`OrderQrScan`).
 * - A focused field marked with `appScanInput` receives the scan itself (its value is set to the code) instead
 *   of the claims.
 *
 * Without the Electron bridge (a plain browser) no scans arrive. Inject it once at the root so listening starts
 * at launch.
 */
@Service()
export class ScannerService {
  private readonly api = inject(DESKTOP_API);
  private claims: { id: number; handler: ScanHandler }[] = [];
  private nextId = 0;
  private readonly inputs = new Map<Element, ScanInputHandler>();
  private hooks: ScanHook[] = [];

  /** Turn scanning on or off globally (off lets scanner keys through as ordinary typing). */
  readonly enabled = signal(true);
  /** The most recent scan, whoever handled it. */
  readonly lastScan = signal<Scan | undefined>(undefined);

  constructor() {
    const stop = this.api?.scanner.onScan((scan) => this.receive(scan.code));
    effect(() => void this.api?.scanner.setEnabled(this.enabled()));
    inject(DestroyRef).onDestroy(() => stop?.());
  }

  claim(handler: ScanHandler): ScannerClaim {
    const id = this.nextId++;
    this.claims.push({ id, handler });
    return { release: () => (this.claims = this.claims.filter((c) => c.id !== id)) };
  }

  /** Adds a hook that sees every scan before the claims (not before a focused scan input). Returns a function that removes it. */
  addHook(hook: ScanHook): () => void {
    this.hooks.push(hook);
    return () => (this.hooks = this.hooks.filter((h) => h !== hook));
  }

  /** Mark a text field as a scan target (see `ScanInputDirective`). Returns an unregister function. */
  registerInput(element: Element, handler: ScanInputHandler): () => void {
    this.inputs.set(element, handler);
    return () => this.inputs.delete(element);
  }

  /** A scan arrived from the main process. Public so tests can stand in for the scanner. */
  receive(code: string): void {
    if (!this.enabled() || !code) return;
    const scan: Scan = { code };
    this.lastScan.set(scan);
    const input = this.inputFor(document.activeElement);
    if (input) {
      input(scan);
      devLog(`[scanner] "${code}" (${code.length} chars) delivered to the focused scan input field`);
      return;
    }
    if (this.hooks.some((hook) => hook(code))) {
      devLog(`[scanner] "${code}" (${code.length} chars) taken by a hook`);
      return;
    }
    for (let i = this.claims.length - 1; i >= 0; i--) {
      if (this.claims[i].handler(scan) !== false) {
        devLog(`[scanner] "${code}" (${code.length} chars) handled by claim ${i + 1} of ${this.claims.length}`);
        return;
      }
    }
    devLog(`[scanner] "${code}" (${code.length} chars) detected, no claim handled it`);
  }

  private inputFor(target: Element | null): ScanInputHandler | undefined {
    if (!target) return undefined;
    for (const [element, handler] of this.inputs) if (element === target || element.contains(target)) return handler;
    return undefined;
  }
}

/**
 * Claim the scanner for the lifetime of the calling injection context (component, dialog, ...).
 * Released automatically on destroy. Must be called in an injection context.
 */
export function claimScanner(handler: ScanHandler): ScannerClaim {
  const claim = inject(ScannerService).claim(handler);
  inject(DestroyRef).onDestroy(() => claim.release());
  return claim;
}

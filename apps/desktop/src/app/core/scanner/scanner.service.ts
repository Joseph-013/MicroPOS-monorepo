import { DestroyRef, inject, InjectionToken, Service, signal } from '@angular/core';
import { BurstDetector, BurstOptions, DEFAULT_BURST_OPTIONS } from './burst-detector';

export interface Scan {
  code: string;
}

/** Return `false` to decline a scan and let the next claim down the stack handle it. */
export type ScanHandler = (scan: Scan) => void | boolean;

export interface ScannerClaim {
  release(): void;
}

type ScanInputHandler = (scan: Scan) => void;

export const SCANNER_OPTIONS = new InjectionToken<BurstOptions>('SCANNER_OPTIONS', {
  providedIn: 'root',
  factory: () => DEFAULT_BURST_OPTIONS,
});

interface Snapshot {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

/**
 * Consecutive fast keys after which a burst is certainly a scanner. In a text field a human can
 * occasionally roll over two keys within the threshold, so we wait for three there. Elsewhere
 * (buttons, checkboxes, dropdowns) nothing is typed, so two fast keys are enough to start blocking
 * side effects such as Space activating a button.
 */
const CONFIRM_AFTER_KEYS_IN_FIELD = 3;
const CONFIRM_AFTER_KEYS_ELSEWHERE = 2;

const TEXT_INPUT_TYPES = /^(text|search|email|url|tel|password|number)$/;

function isTextTarget(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.test(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/**
 * Global barcode scanner (USB keyboard-wedge). One document-level listener detects scans;
 * components take turns receiving them by *claiming* the scanner:
 *
 * - The most recent claim gets scans first. Releasing it hands control back to the previous
 *   claim, so a dialog can take over and give control back when it closes.
 * - A handler may return `false` to pass a scan down to the next claim.
 * - With no claims, scans are dropped.
 *
 * The first keys of a burst cannot be told apart from typing, so they pass through. As soon as
 * a burst is confirmed (3 fast keys in a row in a text field, 2 elsewhere; a human cannot do that)
 * the field it started in is rolled back to its previous value and every further key of the
 * burst, including the final Enter, is blocked. Scans therefore never leak into inputs, click a
 * focused button (Space), toggle a checkbox, or type-ahead a dropdown.
 *
 * Fields can opt in to receive scans themselves with the `appScanInput` directive. While such a
 * field is focused, a scan is left to type into it normally (Enter included) and is delivered to
 * that field instead of the claims.
 *
 * Inject it once at the root so listening starts at launch.
 */
@Service()
export class ScannerService {
  private readonly detector = new BurstDetector(inject(SCANNER_OPTIONS));
  /** True once the current burst is confirmed; its keys are blocked. */
  private confirmed = false;
  /** The opted-in field the current burst started in, if any. */
  private burstInput: ScanInputHandler | undefined;
  private readonly inputs = new Map<Element, ScanInputHandler>();
  private readonly speedThresholdMs = inject(SCANNER_OPTIONS).speedThresholdMs;
  private claims: { id: number; handler: ScanHandler }[] = [];
  private nextId = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: Snapshot | undefined;

  /** Turn scanning on or off globally. */
  readonly enabled = signal(true);
  /** The most recent scan, whoever handled it. */
  readonly lastScan = signal<Scan | undefined>(undefined);

  constructor() {
    document.addEventListener('keydown', this.onKeyDown, { capture: true });
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', this.onKeyDown, { capture: true });
      clearTimeout(this.idleTimer);
    });
  }

  claim(handler: ScanHandler): ScannerClaim {
    const id = this.nextId++;
    this.claims.push({ id, handler });
    return { release: () => (this.claims = this.claims.filter((c) => c.id !== id)) };
  }

  /** Mark a text field as a scan target (see `ScanInputDirective`). Returns an unregister function. */
  registerInput(element: Element, handler: ScanInputHandler): () => void {
    this.inputs.set(element, handler);
    return () => this.inputs.delete(element);
  }

  private inputFor(target: EventTarget | null): ScanInputHandler | undefined {
    if (!(target instanceof Element)) return undefined;
    for (const [element, handler] of this.inputs) if (element === target || element.contains(target)) return handler;
    return undefined;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled() || event.isComposing) return;
    if (event.repeat) {
      this.detector.reset();
      this.clearPending();
      return;
    }

    const outcome = this.detector.onKey(
      event.key,
      performance.now(),
      event.ctrlKey || event.metaKey || event.altKey,
    );

    switch (outcome.type) {
      case 'buffering':
        // First character of a possible burst: note where it started, before the key types into it.
        if (this.detector.pending === 1 && event.key.length === 1) {
          this.burstInput = this.inputFor(event.target);
          this.snapshot = this.burstInput ? undefined : this.takeSnapshot();
        }
        // A field that opted in to scans receives them as ordinary typing: never block or roll back.
        if (!this.burstInput) this.confirmBurst(event);
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.onIdle(), this.speedThresholdMs);
        break;
      case 'scan':
        if (!this.burstInput && (outcome.consumeKey || this.confirmed)) event.preventDefault();
        this.complete(outcome.code);
        break;
      case 'none':
        this.clearPending();
        break;
    }
  };

  /** Once enough fast keys arrive it is certainly a scanner: undo what leaked and block the rest. */
  private confirmBurst(event: KeyboardEvent): void {
    const confirmAfter = isTextTarget(event.target) ? CONFIRM_AFTER_KEYS_IN_FIELD : CONFIRM_AFTER_KEYS_ELSEWHERE;
    if (this.detector.pending < confirmAfter) return;
    if (!this.confirmed) {
      this.confirmed = true;
      this.restoreSnapshot(); // undo the (at most two) characters that already went through
    }
    event.preventDefault();
  }

  private onIdle(): void {
    const outcome = this.detector.flushIdle();
    if (outcome.type === 'scan') this.complete(outcome.code);
    else this.clearPending();
  }

  private complete(code: string): void {
    clearTimeout(this.idleTimer);
    this.restoreSnapshot();
    const input = this.burstInput;
    this.clearPending();
    if (input) this.deliverToInput(input, { code });
    else this.dispatch({ code });
  }

  private clearPending(): void {
    clearTimeout(this.idleTimer);
    this.snapshot = undefined;
    this.confirmed = false;
    this.burstInput = undefined;
  }

  private deliverToInput(handler: ScanInputHandler, scan: Scan): void {
    this.lastScan.set(scan);
    handler(scan);
    console.log(`[scanner] "${scan.code}" (${scan.code.length} chars) typed into a scan input field`);
  }

  private dispatch(scan: Scan): void {
    this.lastScan.set(scan);
    for (let i = this.claims.length - 1; i >= 0; i--) {
      if (this.claims[i].handler(scan) !== false) {
        console.log(`[scanner] "${scan.code}" (${scan.code.length} chars) handled by claim ${i + 1} of ${this.claims.length}`);
        return;
      }
    }
    console.log(`[scanner] "${scan.code}" (${scan.code.length} chars) detected, no claim handled it`);
  }

  private takeSnapshot(): Snapshot | undefined {
    const el = document.activeElement;
    const isText =
      (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.test(el.type)) ||
      el instanceof HTMLTextAreaElement;
    if (isText) {
      return { element: el, value: el.value, selectionStart: el.selectionStart, selectionEnd: el.selectionEnd };
    }
    if (el instanceof HTMLSelectElement) {
      return { element: el, value: el.value, selectionStart: null, selectionEnd: null };
    }
    return undefined;
  }

  private restoreSnapshot(): void {
    const s = this.snapshot;
    if (!s || s.element.value === s.value) return;
    s.element.value = s.value;
    if (!(s.element instanceof HTMLSelectElement)) {
      try {
        s.element.setSelectionRange(s.selectionStart, s.selectionEnd);
      } catch {
        // Some input types (e.g. number) do not support selection ranges.
      }
    }
    // Let framework bindings see the rollback.
    s.element.dispatchEvent(new Event('input', { bubbles: true }));
    if (s.element instanceof HTMLSelectElement) s.element.dispatchEvent(new Event('change', { bubbles: true }));
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

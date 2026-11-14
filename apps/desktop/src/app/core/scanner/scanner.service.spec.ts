import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { type DesktopApi, DESKTOP_API_VERSION } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { ScanInputDirective } from './scan-input.directive';
import { ScannerClaimDirective } from './scanner-claim.directive';
import { Scan, ScannerService } from './scanner.service';

/** A bridge whose scan events the test fires, standing in for the Electron main process. */
function fakeBridge() {
  const listeners = new Set<(scan: { code: string }) => void>();
  const enabledCalls: boolean[] = [];
  const api = {
    platform: 'linux',
    version: () => Promise.resolve(DESKTOP_API_VERSION),
    scanner: {
      onScan: (listener: (scan: { code: string }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      setEnabled: (on: boolean) => {
        enabledCalls.push(on);
        return Promise.resolve();
      },
    },
  } as unknown as DesktopApi;
  return { api, fire: (code: string) => listeners.forEach((l) => l({ code })), listeners, enabledCalls };
}

function setup() {
  TestBed.resetTestingModule();
  const bridge = fakeBridge();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: bridge.api }] });
  return { ...bridge, scanner: TestBed.inject(ScannerService) };
}

describe('ScannerService hooks', () => {
  it('see a scan before the claims and keep it from them when they take it', () => {
    const { scanner, fire } = setup();
    const claimed: string[] = [];
    scanner.claim(({ code }) => void claimed.push(code));
    const hooked: string[] = [];
    const remove = scanner.addHook((code) => (hooked.push(code), code.startsWith('QR-')));
    fire('QR-1');
    fire('123');
    expect(hooked).toEqual(['QR-1', '123']);
    expect(claimed).toEqual(['123']); // the hook took the first and declined the second
    remove();
    fire('QR-2');
    expect(claimed).toEqual(['123', 'QR-2']);
  });

  it('do not take a scan from a focused scan input, which is for that field', () => {
    const { scanner, fire } = setup();
    const seen: string[] = [];
    scanner.addHook((code) => (seen.push(code), true));
    const input = document.createElement('input');
    document.body.append(input);
    const got: string[] = [];
    scanner.registerInput(input, ({ code }) => void got.push(code));
    input.focus();
    fire('MICROPOS-ORDER-SO-1');
    expect(got).toEqual(['MICROPOS-ORDER-SO-1']);
    expect(seen).toEqual([]);
    input.remove();
  });
});

describe('ScannerService', () => {
  it('delivers a scan sent by the main process to the active claim', () => {
    const { scanner, fire } = setup();
    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    fire('4006381333931');
    expect(got).toEqual(['4006381333931']);
    expect(scanner.lastScan()?.code).toBe('4006381333931');
  });

  it('gives control to the newest claim and back to the previous one on release', () => {
    const { scanner, fire } = setup();
    const root: string[] = [];
    const dialog: string[] = [];
    scanner.claim((s) => void root.push(s.code));
    const dialogClaim = scanner.claim((s) => void dialog.push(s.code));

    fire('1111111');
    dialogClaim.release();
    fire('2222222');

    expect(dialog).toEqual(['1111111']);
    expect(root).toEqual(['2222222']);
  });

  it('keeps stack order when a lower claim is released first', () => {
    const { scanner, fire } = setup();
    const a: string[] = [];
    const b: string[] = [];
    const claimA = scanner.claim((s) => void a.push(s.code));
    scanner.claim((s) => void b.push(s.code));
    claimA.release();
    fire('3333333');
    expect(b).toEqual(['3333333']);
    expect(a).toEqual([]);
  });

  it('passes a scan down when a handler returns false', () => {
    const { scanner, fire } = setup();
    const root: string[] = [];
    scanner.claim((s) => void root.push(s.code));
    scanner.claim(() => false);
    fire('4444444');
    expect(root).toEqual(['4444444']);
  });

  it('drops scans when nothing is claimed and when disabled, and tells the main process', async () => {
    const { scanner, fire, enabledCalls } = setup();
    fire('5555555');
    expect(scanner.lastScan()?.code).toBe('5555555');

    const got: Scan[] = [];
    scanner.claim((s) => void got.push(s));
    scanner.enabled.set(false);
    TestBed.tick();
    fire('6666666');
    expect(got).toEqual([]);
    expect(enabledCalls).toContain(false); // the main process stops holding keys back
  });

  it('stops listening when destroyed', () => {
    const { listeners } = setup();
    expect(listeners.size).toBe(1);
    TestBed.resetTestingModule();
    expect(listeners.size).toBe(0);
  });

  it('works without a bridge (plain browser): nothing arrives, nothing breaks', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: undefined }] });
    const scanner = TestBed.inject(ScannerService);
    scanner.receive('123456');
    expect(scanner.lastScan()?.code).toBe('123456');
  });
});

@Component({
  imports: [ScannerClaimDirective],
  template: `
    @if (open()) {
      <div appScannerClaim (scan)="dialog.push($event.code)">dialog</div>
    }
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly dialog: string[] = [];
}

describe('ScannerClaimDirective', () => {
  it('takes control while present and returns it when removed', async () => {
    const { scanner, fire } = setup();
    const root: string[] = [];
    scanner.claim((s) => void root.push(s.code));

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    fire('7777777');

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    fire('8888888');

    expect(fixture.componentInstance.dialog).toEqual(['7777777']);
    expect(root).toEqual(['8888888']);
  });
});

@Component({
  imports: [ScanInputDirective],
  template: `<input id="barcode" appScanInput (scan)="codes.push($event.code)" /><input id="notes" />`,
})
class FieldHostComponent {
  readonly codes: string[] = [];
}

describe('ScanInputDirective', () => {
  it('puts a scan into the focused opted-in field and keeps claims out of it', async () => {
    const { scanner, fire } = setup();
    const claimed: string[] = [];
    scanner.claim((s) => void claimed.push(s.code));

    const fixture = TestBed.createComponent(FieldHostComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const field = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#barcode')!;
    const inputEvents: number[] = [];
    field.addEventListener('input', () => inputEvents.push(1));
    field.focus();

    fire('9780201379624');

    expect(field.value).toBe('9780201379624');
    expect(inputEvents.length).toBe(1); // bindings see the new value
    expect(fixture.componentInstance.codes).toEqual(['9780201379624']);
    expect(claimed).toEqual([]);
    fixture.nativeElement.remove();
  });

  it('a field that did not opt in never receives the text; the claims do', async () => {
    const { scanner, fire } = setup();
    const claimed: string[] = [];
    scanner.claim((s) => void claimed.push(s.code));

    const fixture = TestBed.createComponent(FieldHostComponent);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const notes = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#notes')!;
    notes.focus();
    notes.value = 'note';

    fire('9780201379624');

    expect(notes.value).toBe('note');
    expect(claimed).toEqual(['9780201379624']);
    fixture.nativeElement.remove();
  });
});

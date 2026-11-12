import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ScanInputDirective } from './scan-input.directive';
import { ScannerClaimDirective } from './scanner-claim.directive';
import { Scan, ScannerService } from './scanner.service';

function key(key: string, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

/** Simulates a scanner: every character then Enter, effectively instantly. */
function scan(code: string, target: EventTarget = document.body): KeyboardEvent {
  for (const ch of code) key(ch, target);
  return key('Enter', target);
}

describe('ScannerService', () => {
  let scanner: ScannerService;

  beforeEach(() => {
    TestBed.resetTestingModule();
    scanner = TestBed.inject(ScannerService);
  });
  afterEach(() => vi.useRealTimers());

  it('delivers a scan to the active claim and swallows the Enter', () => {
    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    const enter = scan('4006381333931');
    expect(got).toEqual(['4006381333931']);
    expect(enter.defaultPrevented).toBe(true);
    expect(scanner.lastScan()?.code).toBe('4006381333931');
  });

  it('gives control to the newest claim and back to the previous one on release', () => {
    const root: string[] = [];
    const dialog: string[] = [];
    scanner.claim((s) => void root.push(s.code));
    const dialogClaim = scanner.claim((s) => void dialog.push(s.code));

    scan('1111111');
    dialogClaim.release();
    scan('2222222');

    expect(dialog).toEqual(['1111111']);
    expect(root).toEqual(['2222222']);
  });

  it('keeps stack order when a lower claim is released first', () => {
    const a: string[] = [];
    const b: string[] = [];
    const claimA = scanner.claim((s) => void a.push(s.code));
    scanner.claim((s) => void b.push(s.code));
    claimA.release();
    scan('3333333');
    expect(b).toEqual(['3333333']);
    expect(a).toEqual([]);
  });

  it('passes a scan down when a handler returns false', () => {
    const root: string[] = [];
    scanner.claim((s) => void root.push(s.code));
    scanner.claim(() => false);
    scan('4444444');
    expect(root).toEqual(['4444444']);
  });

  it('drops scans when nothing is claimed and when disabled', () => {
    scan('5555555');
    expect(scanner.lastScan()?.code).toBe('5555555');

    const got: Scan[] = [];
    scanner.claim((s) => void got.push(s));
    scanner.enabled.set(false);
    scan('6666666');
    expect(got).toEqual([]);
  });

  it('rolls back text a scan typed into a focused input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.value = 'abc';
    const inputEvents: number[] = [];
    input.addEventListener('input', () => inputEvents.push(1));

    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    for (const ch of '9780201379624') {
      key(ch, input);
      input.value += ch; // what the browser would do after keydown
    }
    key('Enter', input);

    expect(got).toEqual(['9780201379624']);
    expect(input.value).toBe('abc');
    expect(inputEvents.length).toBeGreaterThan(0);
    input.remove();
  });

  it('blocks the keys of a confirmed burst, including Space, so a focused button is not clicked', () => {
    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    const events = [...'SO 12 3456'].map((ch) => key(ch));
    const enter = key('Enter');
    // Outside text fields the first key passes (it looks like typing); from the second on everything is blocked.
    expect(events[0].defaultPrevented).toBe(false);
    expect(events.slice(1).every((e) => e.defaultPrevented)).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
    expect(got).toEqual(['SO 12 3456']);
  });

  it('rolls the field back as soon as the burst is confirmed, not at the end', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.value = 'note';
    scanner.claim(() => undefined);
    const type = (ch: string): void => {
      const event = key(ch, input);
      if (!event.defaultPrevented) input.value += ch; // the browser inserts a character unless it is blocked
    };
    type('9');
    type('7');
    expect(input.value).toBe('note97'); // the first two keys look like typing
    type('8'); // third fast key: burst confirmed, field rolled back, key blocked
    expect(input.value).toBe('note');
    type('2');
    expect(input.value).toBe('note');
    input.remove();
  });

  it('blocks Space on a focused button from the second fast key', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    scanner.claim(() => undefined);
    const first = key('A', button);
    const space = key(' ', button);
    expect(first.defaultPrevented).toBe(false);
    expect(space.defaultPrevented).toBe(true);
    button.remove();
  });

  it('blocks Space on a focused checkbox from the second fast key', () => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    box.focus();
    scanner.claim(() => undefined);
    key('A', box);
    expect(key(' ', box).defaultPrevented).toBe(true);
    box.remove();
  });

  it('restores a focused dropdown after type-ahead', () => {
    const select = document.createElement('select');
    for (const v of ['alpha', 'delta']) select.add(new Option(v, v));
    document.body.appendChild(select);
    select.focus();
    const changes: string[] = [];
    select.addEventListener('change', () => changes.push(select.value));
    scanner.claim(() => undefined);
    key('d', select);
    select.value = 'delta'; // type-ahead
    key('e', select);
    key('l', select);
    expect(select.value).toBe('alpha');
    expect(changes).toContain('alpha');
    select.remove();
  });

  it('does not re-snapshot on Shift between characters', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.value = 'x';
    scanner.claim(() => undefined);
    key('A', input);
    input.value += 'A';
    key('Shift', input); // pending is 1 here; must not capture "xA" as the original value
    key('B', input);
    input.value += 'B';
    key('C', input);
    key('Enter', input);
    expect(input.value).toBe('x');
    input.remove();
  });

  it('detects a long scan without Enter once typing stops', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    for (const ch of 'ABCDEFGH') key(ch);
    expect(got).toEqual([]);
    vi.advanceTimersByTime(40);
    expect(got).toEqual(['ABCDEFGH']);
  });

  it('ignores human-speed typing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const got: string[] = [];
    scanner.claim((s) => void got.push(s.code));
    for (const ch of '12345678') {
      key(ch);
      vi.advanceTimersByTime(120);
    }
    key('Enter');
    vi.advanceTimersByTime(120);
    expect(got).toEqual([]);
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
    TestBed.resetTestingModule();
    const scanner = TestBed.inject(ScannerService);
    const root: string[] = [];
    scanner.claim((s) => void root.push(s.code));

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    scan('7777777');

    fixture.componentInstance.open.set(false);
    await fixture.whenStable();
    scan('8888888');

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
  it('lets a scan type into an opted-in field, delivers it there, and keeps claims out of it', async () => {
    TestBed.resetTestingModule();
    const scanner = TestBed.inject(ScannerService);
    const claimed: string[] = [];
    scanner.claim((s) => void claimed.push(s.code));

    const fixture = TestBed.createComponent(FieldHostComponent);
    await fixture.whenStable();
    const field = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#barcode')!;
    field.focus();

    const events: KeyboardEvent[] = [];
    for (const ch of '9780201379624') {
      const event = key(ch, field);
      events.push(event);
      if (!event.defaultPrevented) field.value += ch; // the browser types it
    }
    const enter = key('Enter', field);

    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(enter.defaultPrevented).toBe(false); // Enter reaches the field (forms/search can react)
    expect(field.value).toBe('9780201379624'); // text stays
    expect(fixture.componentInstance.codes).toEqual(['9780201379624']);
    expect(claimed).toEqual([]);
  });

  it('still rolls back fields that did not opt in', async () => {
    TestBed.resetTestingModule();
    const scanner = TestBed.inject(ScannerService);
    const claimed: string[] = [];
    scanner.claim((s) => void claimed.push(s.code));

    const fixture = TestBed.createComponent(FieldHostComponent);
    await fixture.whenStable();
    const notes = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#notes')!;
    notes.focus();
    notes.value = 'note';
    for (const ch of '9780201379624') {
      const event = key(ch, notes);
      if (!event.defaultPrevented) notes.value += ch;
    }
    key('Enter', notes);

    expect(notes.value).toBe('note');
    expect(claimed).toEqual(['9780201379624']);
  });
});

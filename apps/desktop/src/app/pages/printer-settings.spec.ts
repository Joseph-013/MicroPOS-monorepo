import { TestBed } from '@angular/core/testing';
import type { DesktopApi, PrinterSettings, PrintResult, SavePrinterSettingsResult, UsbPrinterInfo } from '@micropos/core';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { LogsSettings } from './logs-settings';
import { PrinterSettingsCard } from './printer-settings';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
Element.prototype.scrollIntoView ??= () => undefined;

const EMPTY: PrinterSettings = { printer: { connection: null, paperWidthMm: 58 }, shop: { name: '', address: '', footer: '' } };
const wait = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function setup(initial: PrinterSettings = EMPTY, usb: UsbPrinterInfo[] = [], testResult: PrintResult = { ok: true }, logo: { current: string | null; accept?: boolean } = { current: null }) {
  const saved: PrinterSettings[] = [];
  const logos = { uploads: [] as Uint8Array[], removed: 0 };
  let tests = 0;
  const api = {
    printer: {
      getLogo: () => Promise.resolve(logo.current),
      saveLogo: (bytes: Uint8Array) => {
        logos.uploads.push(bytes);
        return Promise.resolve(logo.accept === false ? { ok: false as const, error: 'That file is not a picture the printer can use (use PNG or JPEG)' } : { ok: true as const, dataUrl: 'data:image/png;base64,SAVED' });
      },
      removeLogo: () => (logos.removed++, Promise.resolve()),
      settings: () => Promise.resolve(initial),
      save: (s: PrinterSettings): Promise<SavePrinterSettingsResult> => (saved.push(s), Promise.resolve({ ok: true, settings: s })),
      listUsb: () => Promise.resolve(usb),
      testPrint: () => (tests++, Promise.resolve(testResult)),
    },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return { saved, logos, tests: () => tests };
}

async function render(): Promise<{ el: HTMLElement; fixture: ReturnType<typeof TestBed.createComponent<PrinterSettingsCard>> }> {
  const fixture = TestBed.createComponent(PrinterSettingsCard);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { el: fixture.nativeElement as HTMLElement, fixture };
}
const type = async (el: HTMLElement, selector: string, value: string, fixture: { whenStable(): Promise<unknown> }): Promise<void> => {
  const input = el.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await fixture.whenStable();
};
const submit = async (el: HTMLElement, fixture: { whenStable(): Promise<unknown> }): Promise<void> => {
  (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
  await fixture.whenStable();
  await wait();
};
const choose = async (el: HTMLElement, triggerLabel: string, option: string, fixture: { whenStable(): Promise<unknown> }): Promise<void> => {
  const trigger = el.querySelector(`hlm-select-trigger[aria-labelledby="${triggerLabel}"]`) as HTMLElement;
  (trigger.querySelector('button') ?? trigger).click();
  await fixture.whenStable();
  ([...document.querySelectorAll('hlm-select-item')].find((i) => i.textContent?.trim() === option) as HTMLElement).click();
  await fixture.whenStable();
};

describe('PrinterSettingsCard', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((o) => (o.innerHTML = ''));
  });

  it('shows what is saved', async () => {
    setup({ printer: { connection: { kind: 'network', host: '192.168.1.50', port: 9100 }, paperWidthMm: 80 }, shop: { name: 'Nena', address: '12 Rizal St', footer: 'Thanks' } });
    const { el } = await render();
    expect((el.querySelector('#pr-host') as HTMLInputElement).value).toBe('192.168.1.50');
    expect((el.querySelector('#pr-port') as HTMLInputElement).value).toBe('9100');
    expect((el.querySelector('#pr-name') as HTMLInputElement).value).toBe('Nena');
    expect(el.querySelector('hlm-select-trigger[aria-labelledby="pr-width-label"]')!.textContent).toContain('80 mm');
  });

  it('saves a network printer with its address, port, paper and shop details', async () => {
    const fake = setup();
    const { el, fixture } = await render();
    expect(el.querySelector('#pr-host')).toBeNull(); // no printer: no connection fields
    await choose(el, 'pr-kind-label', 'Network', fixture);
    await type(el, '#pr-host', ' 192.168.1.50 ', fixture);
    await type(el, '#pr-name', 'Nena Store', fixture);
    await choose(el, 'pr-width-label', '80 mm', fixture);
    await submit(el, fixture);
    expect(fake.saved).toEqual([{ printer: { connection: { kind: 'network', host: '192.168.1.50', port: 9100 }, paperWidthMm: 80 }, shop: { name: 'Nena Store', address: '', footer: '' } }]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Printer settings saved');
  });

  it('refuses a port that is not a port without saving', async () => {
    const fake = setup({ printer: { connection: { kind: 'network', host: 'printer.local', port: 9100 }, paperWidthMm: 58 }, shop: EMPTY.shop });
    const { el, fixture } = await render();
    await type(el, '#pr-port', '99999', fixture);
    await submit(el, fixture);
    expect(el.textContent).toContain('Enter a port from 1 to 65535');
    expect(fake.saved).toEqual([]);
  });

  it('picks a USB printer from the ones found, and asks for one when none is chosen', async () => {
    const epson = { vendorId: 1208, productId: 3605, serialNumber: 'S1', label: 'Epson TM-T20' };
    const fake = setup(EMPTY, [epson]);
    const { el, fixture } = await render();
    await choose(el, 'pr-kind-label', 'USB', fixture);
    await wait();
    await fixture.whenStable();
    await submit(el, fixture);
    expect(el.textContent).toContain('Choose the printer');
    expect(fake.saved).toEqual([]);
    await choose(el, 'pr-usb-label', 'Epson TM-T20', fixture);
    await submit(el, fixture);
    expect(fake.saved[0]!.printer.connection).toEqual({ kind: 'usb', ...epson });
  });

  it('saves first, then prints the test page, and reports how it went', async () => {
    const ok = setup({ printer: { connection: { kind: 'network', host: 'h', port: 9100 }, paperWidthMm: 58 }, shop: EMPTY.shop });
    let { el, fixture } = await render();
    (el.querySelector('button[type="button"]:not([aria-labelledby])') as HTMLElement | null);
    const testButton = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test print') as HTMLButtonElement;
    testButton.click();
    await fixture.whenStable();
    await wait();
    expect(ok.saved).toHaveLength(1);
    expect(ok.tests()).toBe(1);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Test page sent');

    TestBed.resetTestingModule();
    setup({ printer: { connection: { kind: 'network', host: 'h', port: 9100 }, paperWidthMm: 58 }, shop: EMPTY.shop }, [], { ok: false, code: 'unreachable', error: 'Cannot reach the printer at h:9100' });
    ({ el, fixture } = await render());
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test print') as HTMLButtonElement).click();
    await fixture.whenStable();
    await wait();
    expect(TestBed.inject(BannerService).current()).toMatchObject({ text: 'Cannot reach the printer at h:9100', severity: 'error' });
  });

  it('has no test button without a printer', async () => {
    setup();
    const { el } = await render();
    expect(([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Test print') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the logo in the printer settings', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });
  const pick = async (el: HTMLElement, file: File, fixture: { whenStable(): Promise<unknown> }): Promise<void> => {
    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await fixture.whenStable();
    await wait(40);
    await fixture.whenStable();
  };
  const button = (el: HTMLElement, label: string): HTMLButtonElement | undefined => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
  const preview = (el: HTMLElement): string | null => el.querySelector('img[alt="Shop logo"]')?.getAttribute('src') ?? null;

  it('shows the saved logo, or says there is none', async () => {
    setup(EMPTY, [], { ok: true }, { current: 'data:image/png;base64,ABC' });
    const withLogo = await render();
    expect(preview(withLogo.el)).toBe('data:image/png;base64,ABC');
    expect(button(withLogo.el, 'Replace')).toBeDefined();
    expect(button(withLogo.el, 'Remove')).toBeDefined();
    TestBed.resetTestingModule();
    setup();
    const without = await render();
    expect(preview(without.el)).toBeNull();
    expect(without.el.textContent).toContain('No logo');
    expect(button(without.el, 'Upload')).toBeDefined();
    expect(button(without.el, 'Remove')).toBeUndefined();
  });

  it('sends the chosen picture to the main process and shows what was saved', async () => {
    const fake = setup();
    const { el, fixture } = await render();
    await pick(el, new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }), fixture);
    expect(fake.logos.uploads).toHaveLength(1);
    expect(Array.from(fake.logos.uploads[0]!)).toEqual([137, 80, 78, 71]);
    expect(preview(el)).toBe('data:image/png;base64,SAVED');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Logo saved');
  });

  it('says why a file was refused and keeps what was shown', async () => {
    setup(EMPTY, [], { ok: true }, { current: 'data:image/png;base64,ABC', accept: false });
    const { el, fixture } = await render();
    await pick(el, new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' }), fixture);
    expect(TestBed.inject(BannerService).current()).toMatchObject({ severity: 'error', text: expect.stringContaining('not a picture') });
    expect(preview(el)).toBe('data:image/png;base64,ABC');
  });

  it('does not even send a file over the size limit', async () => {
    const fake = setup();
    const { el, fixture } = await render();
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await pick(el, big, fixture);
    expect(fake.logos.uploads).toEqual([]);
    expect(TestBed.inject(BannerService).current()?.text).toContain('too large');
  });

  it('removes the logo', async () => {
    const fake = setup(EMPTY, [], { ok: true }, { current: 'data:image/png;base64,ABC' });
    const { el, fixture } = await render();
    button(el, 'Remove')!.click();
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    expect(fake.logos.removed).toBe(1);
    expect(preview(el)).toBeNull();
    expect(el.textContent).toContain('No logo');
  });
});

describe('LogsSettings', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows where the logs are and opens that folder', async () => {
    let opened = 0;
    const api = { shell: { getLogsFolder: () => Promise.resolve('/home/u/logs'), openLogsFolder: () => (opened++, Promise.resolve(true)) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    const fixture = TestBed.createComponent(LogsSettings);
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-logs-folder]')!.textContent).toBe('/home/u/logs');
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Open folder') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });

  it('says when the folder cannot be opened', async () => {
    const api = { shell: { getLogsFolder: () => Promise.resolve('/x'), openLogsFolder: () => Promise.resolve(false) } } as unknown as DesktopApi;
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    const fixture = TestBed.createComponent(LogsSettings);
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    ([...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Open folder') as HTMLButtonElement).click();
    await wait();
    expect(TestBed.inject(BannerService).current()?.text).toBe('Could not open the logs folder');
  });
});

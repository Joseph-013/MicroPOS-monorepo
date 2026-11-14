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

function setup(initial: PrinterSettings = EMPTY, usb: UsbPrinterInfo[] = [], testResult: PrintResult = { ok: true }) {
  const saved: PrinterSettings[] = [];
  let tests = 0;
  const api = {
    printer: {
      settings: () => Promise.resolve(initial),
      save: (s: PrinterSettings): Promise<SavePrinterSettingsResult> => (saved.push(s), Promise.resolve({ ok: true, settings: s })),
      listUsb: () => Promise.resolve(usb),
      testPrint: () => (tests++, Promise.resolve(testResult)),
    },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return { saved, tests: () => tests };
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

import { TestBed } from '@angular/core/testing';
import type { DesktopApi, LanDevice, LanPairing, LanState } from '@micropos/core';
import { DESKTOP_API } from '../../core/api/desktop-api';
import { BannerService } from '../../core/banner';
import { DevicesService } from '../../core/data/devices.service';
import { DevicesPage } from './devices';

// jsdom has no ResizeObserver (overlays watch element sizes).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const device = (over: Partial<LanDevice> = {}): LanDevice => ({ id: 'd1', name: 'iPhone', pairedAt: Date.UTC(2026, 5, 1), lastSeenAt: Date.UTC(2026, 5, 2, 10), online: true, user: 'Casey', ...over });

function setup(initial: { state?: Partial<LanState>; devices?: LanDevice[]; pairing?: LanPairing | null } = {}) {
  const calls = { enabled: [] as boolean[], pairings: 0, revoked: [] as string[] };
  let state: LanState = { enabled: true, running: true, port: 8734, addresses: ['192.168.1.20'], error: null, ...initial.state };
  let devices = initial.devices ?? [device()];
  const pairWith = (d: LanDevice): void => void (devices = [...devices, d]);
  const api = {
    backup: { list: () => Promise.resolve({ backups: [], folder: '' }), create: () => Promise.reject(new Error('unused')), remove: () => Promise.resolve(false), exportTo: () => Promise.reject(new Error('unused')), importFrom: () => Promise.reject(new Error('unused')), restore: () => Promise.reject(new Error('unused')), openFolder: () => Promise.resolve(false) },
    lan: {
      state: () => Promise.resolve(state),
      devices: () => Promise.resolve(devices),
      setEnabled: (enabled: boolean) => (calls.enabled.push(enabled), (state = { ...state, enabled, running: enabled }), Promise.resolve(state)),
      newPairing: () => (calls.pairings++, Promise.resolve(initial.pairing === undefined ? { url: 'https://192.168.1.20:8734/?pair=abc', expiresAt: Date.now() + 300_000 } : initial.pairing)),
      revokeDevice: (id: string) => (calls.revoked.push(id), (devices = devices.filter((d) => d.id !== id)), Promise.resolve(true)),
    },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return Object.assign(calls, { pairWith });
}
async function render() {
  const fixture = TestBed.createComponent(DevicesPage);
  await fixture.whenStable();
  await wait();
  await fixture.whenStable();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}
const text = (el: HTMLElement): string => el.textContent!.replace(/\s+/g, ' ');

describe('DevicesPage', () => {
  it('shows where phones can connect and the paired devices with who is signed in', async () => {
    setup();
    const { el } = await render();
    expect(el.querySelector('[data-address]')!.textContent!.trim()).toBe('https://192.168.1.20:8734');
    const t = text(el);
    expect(t).toContain('iPhoneOnline');
    expect(t).toContain('Signed in as Casey');
  });

  it('says why it is not running, and that it is off', async () => {
    setup({ state: { running: false, error: 'Port 8734 is already in use by another program' } });
    expect(text((await render()).el)).toContain('Port 8734 is already in use by another program');
    setup({ state: { enabled: false, running: false }, devices: [] });
    const { el } = await render();
    expect(text(el)).toContain('Off. Turn it on');
    expect(text(el)).toContain('No device is paired yet');
    expect(text(el)).not.toContain('Pair a device'); // nothing to pair while it is off
  });

  it('turns the server on and off', async () => {
    const calls = setup({ state: { enabled: false, running: false } });
    const { fixture, el } = await render();
    (el.querySelector('hlm-switch button, hlm-switch') as HTMLElement).click();
    await fixture.whenStable();
    await wait();
    expect(calls.enabled).toEqual([true]);
  });

  it('shows a QR code that works for a few minutes, and says when it has expired', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    const pair = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pair a device')!;
    pair.click();
    await fixture.whenStable();
    await wait();
    expect(calls.pairings).toBe(1);
    expect(el.querySelector('app-qr-code svg path')!.getAttribute('d')!.length).toBeGreaterThan(100);
    expect(el.querySelector('[data-countdown]')!.textContent).toMatch(/Works for [45]:\d\d, once/);
    setup({ pairing: { url: 'https://x', expiresAt: Date.now() - 1 } });
    const again = await render();
    [...again.el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pair a device')!.click();
    await again.fixture.whenStable();
    await wait();
    expect(again.el.querySelector('[data-expired]')).not.toBeNull();
    expect(again.el.querySelector('app-qr-code')).toBeNull();
  });

  it('takes the QR code off the page once a device has paired with it', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Pair a device')!.click();
    await fixture.whenStable();
    await wait();
    expect(el.querySelector('app-qr-code')).not.toBeNull();
    calls.pairWith(device({ id: 'd2', name: 'Android phone', lastSeenAt: null, online: false, user: null }));
    await TestBed.inject(DevicesService).load(); // what the "devices changed" announcement triggers
    await fixture.whenStable();
    expect(el.querySelector('app-qr-code')).toBeNull();
    expect(text(el)).toContain('Android phone');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Android phone paired');
  });

  it('unpairs a device after asking', async () => {
    const calls = setup();
    const { fixture, el } = await render();
    [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Unpair')!.click();
    await fixture.whenStable();
    expect(document.body.textContent).toContain('Unpair iPhone?');
    expect(calls.revoked).toEqual([]);
    (document.querySelector('[hlmAlertDialogAction]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await wait();
    expect(calls.revoked).toEqual(['d1']);
    expect(TestBed.inject(BannerService).current()?.text).toBe('iPhone unpaired');
    expect(text(el)).toContain('No device is paired yet');
  });
});

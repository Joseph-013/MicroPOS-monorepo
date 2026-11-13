import { TestBed } from '@angular/core/testing';
import { type CustomerDisplayMode, type CustomerDisplayState, type DesktopApi, IDLE_DISPLAY_STATE } from '@micropos/core';
import { AppSettings } from './settings/app-settings.service';
import { DESKTOP_API } from './api/desktop-api';
import { CustomerDisplayService } from './customer-display.service';

function setup(open = false) {
  const calls = { show: 0, hide: 0, modes: [] as (CustomerDisplayMode | undefined)[], published: [] as CustomerDisplayState[] };
  const listeners: ((open: boolean) => void)[] = [];
  const api = {
    display: {
      show: (options?: { mode?: CustomerDisplayMode }) => {
        calls.show++;
        calls.modes.push(options?.mode);
        listeners.forEach((l) => l(true));
        return Promise.resolve();
      },
      hide: () => {
        calls.hide++;
        listeners.forEach((l) => l(false));
        return Promise.resolve();
      },
      isOpen: () => Promise.resolve(open),
      onVisibility: (listener: (open: boolean) => void) => {
        listeners.push(listener);
        return () => undefined;
      },
      publish: (state: CustomerDisplayState) => {
        calls.published.push(state);
        return Promise.resolve();
      },
    },
  } as unknown as DesktopApi;
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  return { service: TestBed.inject(CustomerDisplayService), calls, listeners };
}

describe('CustomerDisplayService', () => {
  beforeEach(() => localStorage.clear());

  it('knows whether the window is open at start and when it opens or closes', async () => {
    const { service, listeners } = setup(true);
    await Promise.resolve();
    expect(service.open()).toBe(true);
    listeners.forEach((l) => l(false)); // closed from the window itself
    expect(service.open()).toBe(false);
  });

  it('toggles between showing and hiding', async () => {
    const { service, calls } = setup();
    await service.toggle();
    expect(calls.show).toBe(1);
    expect(service.open()).toBe(true);
    await service.toggle();
    expect(calls.hide).toBe(1);
    expect(service.open()).toBe(false);
  });

  it('passes published states on', () => {
    const { service, calls } = setup();
    service.publish(IDLE_DISPLAY_STATE);
    expect(calls.published).toEqual([IDLE_DISPLAY_STATE]);
  });

  it('does nothing without the desktop bridge (a plain browser)', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: undefined }] });
    const service = TestBed.inject(CustomerDisplayService);
    await service.toggle();
    service.publish(IDLE_DISPLAY_STATE);
    expect(service.open()).toBe(false);
  });

  it('opens the window in the mode chosen in Settings', async () => {
    const { service, calls } = setup();
    await service.show();
    TestBed.inject(AppSettings).customerDisplayMode.set('fullscreen');
    TestBed.flushEffects();
    await service.hide();
    await service.show();
    expect(calls.modes).toEqual(['windowed', 'fullscreen', 'fullscreen']);
  });

  it('puts an open window into a new mode as soon as Settings changes it, and does nothing while it is closed', async () => {
    const { service, calls } = setup();
    const settings = TestBed.inject(AppSettings);
    TestBed.flushEffects();
    settings.customerDisplayMode.set('maximized'); // closed: nothing to change
    TestBed.flushEffects();
    expect(calls.show).toBe(0);

    await service.show(); // open, maximized
    settings.customerDisplayMode.set('windowed');
    TestBed.flushEffects();
    await Promise.resolve();
    expect(calls.modes).toEqual(['maximized', 'windowed']);
  });
});

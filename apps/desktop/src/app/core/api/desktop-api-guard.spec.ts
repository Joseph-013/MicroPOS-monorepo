import { TestBed } from '@angular/core/testing';
import { DESKTOP_API_VERSION, type DesktopApi } from '@micropos/core';
import { BannerService } from '../banner';
import { DESKTOP_API } from './desktop-api';
import { DesktopApiGuard } from './desktop-api-guard';

const api = (version?: () => Promise<number>): DesktopApi =>
  ({ platform: 'linux', version, catalog: {}, checkout: {} }) as unknown as DesktopApi;

function setup(value: DesktopApi | undefined) {
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: value }] });
  return { guard: TestBed.inject(DesktopApiGuard), banner: TestBed.inject(BannerService) };
}

describe('DesktopApiGuard', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));

  it('stays quiet when the main process matches', async () => {
    const { guard, banner } = setup(api(() => Promise.resolve(DESKTOP_API_VERSION)));
    expect(await guard.check()).toBe(true);
    expect(banner.current()).toBeNull();
  });

  it('shows a persistent error when the main process is on another version', async () => {
    const { guard, banner } = setup(api(() => Promise.resolve(DESKTOP_API_VERSION - 1)));
    expect(await guard.check()).toBe(false);
    expect(banner.current()).toMatchObject({ severity: 'error', durationMs: 0, text: expect.stringContaining('Restart') });
  });

  it('treats a main process that does not know the call at all (an old one) as out of date', async () => {
    const { guard, banner } = setup(api(() => Promise.reject(new Error("No handler registered for 'app:version'"))));
    expect(await guard.check()).toBe(false);
    expect(banner.current()?.severity).toBe('error');
  });

  it('treats an old preload without `version` as out of date', async () => {
    const { guard } = setup(api(undefined));
    expect(await guard.check()).toBe(false);
  });

  it('does nothing in a plain browser where there is no bridge', async () => {
    const { guard, banner } = setup(undefined);
    expect(await guard.check()).toBe(true);
    expect(banner.current()).toBeNull();
  });
});

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HlmAccordionImports } from '@spartan-ng/helm/accordion';
import type { DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../core/api/desktop-api';
import { ActivityMonitor } from '../core/auth/activity-monitor';
import { AuthService } from '../core/auth/auth.service';
import { fakeAuthApi, sessionUser } from '../core/auth/testing';
import { BannerService } from '../core/banner';
import { SessionSettingsCard } from './session-settings';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

@Component({ imports: [HlmAccordionImports, SessionSettingsCard], template: '<hlm-accordion type="multiple"><app-session-settings /></hlm-accordion>' })
class Host {}

async function open(initial: number | null, accept = true) {
  const saved: (number | null)[] = [];
  const base = fakeAuthApi({ status: sessionUser(['settings.manage']) }).api;
  const api = {
    ...base,
    auth: { ...base.auth, activity: () => Promise.resolve({ user: sessionUser(['settings.manage']), timeoutMinutes: initial }), setSessionTimeout: (m: number | null) => (saved.push(m), Promise.resolve(accept)) },
  } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
  await TestBed.inject(AuthService).whenReady();
  TestBed.inject(ActivityMonitor);
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 20));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const input = el.querySelector('#session-minutes') as HTMLInputElement;
  const save = async (value: string): Promise<void> => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { el, input, saved, save };
}

describe('SessionSettingsCard (Auto sign-out)', () => {
  it('is off to begin with, and shows the saved limit once it is known', async () => {
    expect((await open(null)).input.value).toBe('');
    expect((await open(20)).input.value).toBe('20');
  });

  it('saves a number of minutes, or a blank for off', async () => {
    const { saved, save } = await open(null);
    await save('15');
    expect(saved).toEqual([15]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Signing out after 15 minutes idle');
    await save('');
    expect(saved).toEqual([15, null]);
    expect(TestBed.inject(BannerService).current()?.text).toBe('Auto sign-out is off');
  });

  it('refuses anything that is not a whole number from 1 to 1440, saving nothing', async () => {
    const { el, saved, save } = await open(null);
    for (const bad of ['0', '1441', '2.5', 'abc', '-3']) {
      await save(bad);
      expect(el.textContent, bad).toContain('Enter a whole number of minutes from 1 to 1440');
    }
    expect(saved).toEqual([]);
  });

  it('says when the main process refused it', async () => {
    const { save } = await open(null, false);
    await save('10');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Could not save it');
  });
});

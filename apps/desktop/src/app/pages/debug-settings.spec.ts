import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import type { DesktopApi } from '@micropos/core';
import { HlmAccordionImports } from '@spartan-ng/helm/accordion';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { DebugSettings } from './debug-settings';

@Component({ imports: [HlmAccordionImports, DebugSettings], template: '<hlm-accordion type="multiple"><app-debug-settings /></hlm-accordion>' })
class Host {}

const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('DebugSettings', () => {
  const setup = (saveImages: boolean, accept = true) => {
    const calls = { set: [] as boolean[], opened: 0 };
    const api = {
      debug: {
        get: () => Promise.resolve({ saveImages, folder: '/home/u/Downloads/MicroPOS receipts' }),
        setSaveImages: (v: boolean) => (calls.set.push(v), Promise.resolve(accept)),
        openReceiptsFolder: () => (calls.opened++, Promise.resolve(true)),
      },
    } as unknown as DesktopApi;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: DESKTOP_API, useValue: api }] });
    return calls;
  };
  const render = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  };

  it('shows whether receipts are saved as images, and the folder they go in', async () => {
    setup(true);
    const { el } = await render();
    expect(el.querySelector('app-debug-settings hlm-switch button')!.getAttribute('aria-checked')).toBe('true');
    expect(el.querySelector('[data-receipts-folder]')!.textContent).toBe('/home/u/Downloads/MicroPOS receipts');
  });

  it('turns it on and off, and opens the folder', async () => {
    const calls = setup(false);
    const { fixture, el } = await render();
    (el.querySelector('app-debug-settings hlm-switch button') as HTMLElement).click();
    await fixture.whenStable();
    expect(calls.set).toEqual([true]);
    ([...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Open folder') as HTMLElement).click();
    expect(calls.opened).toBe(1);
  });

  it('puts the switch back and says so when the setting could not be saved', async () => {
    setup(false, false);
    const { fixture, el } = await render();
    const toggle = el.querySelector('app-debug-settings hlm-switch button') as HTMLElement;
    toggle.click();
    await fixture.whenStable();
    await wait();
    await fixture.whenStable();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(TestBed.inject(BannerService).current()?.text).toBe('Could not save the setting');
  });
});

import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DesktopApi } from '@micropos/core';
import { provideRouter, Router } from '@angular/router';
import { DESKTOP_API } from './api/desktop-api';
import { AuthService } from './auth/auth.service';
import { fakeAuthApi, sessionUser } from './auth/testing';
import { NavRail } from './nav-rail';
import { Topbar } from './topbar';

@Component({ imports: [NavRail, Topbar], template: '<app-nav-rail /><app-topbar />' })
class Shell {}
@Component({ template: '' })
class Blank {}

async function render(mobile: boolean) {
  localStorage.clear();
  window.matchMedia = ((query: string) => ({ matches: mobile && query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as never;
  const api = { ...fakeAuthApi({ status: sessionUser(['checkout.sell', 'orders.view']) }).api, customers: { alertCount: () => Promise.resolve(0) } } as unknown as DesktopApi;
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'checkout', title: 'Checkout', component: Blank },
        { path: 'orders', title: 'Sales Orders', children: [{ path: '', component: Blank }] },
      ]),
      { provide: DESKTOP_API, useValue: api },
    ],
  });
  await TestBed.inject(AuthService).whenReady();
  await TestBed.inject(Router).navigateByUrl('/checkout');
  const fixture = TestBed.createComponent(Shell);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  return { el, fixture, settle, nav: () => el.querySelector('nav') as HTMLElement, burger: () => el.querySelector('button[aria-label="Menu"]') as HTMLButtonElement | null, backdrop: () => el.querySelector('nav')!.parentElement!.querySelector('div.fixed.inset-0') };
}

describe('top bar and navigation drawer', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('on a wide screen: no top bar (it is hidden), no burger, and the rail as always on the left', async () => {
    const { el, nav, burger } = await render(false);
    const bar = el.querySelector('app-topbar') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(true); // shown only below the md breakpoint (max-md:block)
    expect(bar.classList.contains('max-md:block')).toBe(true);
    expect(el.querySelector('[data-page-title]')!.textContent!.trim()).toBe('Checkout');
    expect(burger()).toBeNull();
    expect(nav().classList.contains('left-0')).toBe(true);
    expect(nav().classList.contains('right-0')).toBe(false);
    expect(nav().hasAttribute('inert')).toBe(false);
    expect(nav().style.width).toBe('3.5rem'); // collapsed, as before
  });

  it('the top bar follows the page', async () => {
    const { el, settle } = await render(false);
    await TestBed.inject(Router).navigateByUrl('/orders');
    await settle();
    expect(el.querySelector('[data-page-title]')!.textContent!.trim()).toBe('Sales Orders');
  });

  it('on a phone: the navigation is on the right and hidden, with a burger at the far right of the top bar', async () => {
    const { el, nav, burger } = await render(true);
    expect(nav().classList.contains('right-0')).toBe(true);
    expect(nav().classList.contains('translate-x-full')).toBe(true);
    expect(nav().hasAttribute('inert')).toBe(true); // not reachable by Tab or screen readers while hidden
    expect(burger()).not.toBeNull();
    const bar = el.querySelector('header')!;
    expect(bar.lastElementChild).toBe(burger()); // rightmost
    expect(burger()!.getAttribute('aria-expanded')).toBe('false');
  });

  it('the burger opens the drawer; a tap outside, Escape or choosing a page closes it', async () => {
    const { nav, burger, backdrop, settle } = await render(true);
    burger()!.click();
    await settle();
    expect(nav().classList.contains('translate-x-full')).toBe(false);
    expect(nav().hasAttribute('inert')).toBe(false);
    expect(burger()!.getAttribute('aria-expanded')).toBe('true');
    expect(nav().textContent).toContain('Checkout'); // labels are shown in the drawer
    expect(backdrop()).not.toBeNull();

    (backdrop() as HTMLElement).click();
    await settle();
    expect(nav().classList.contains('translate-x-full')).toBe(true);

    burger()!.click();
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(nav().classList.contains('translate-x-full')).toBe(true);

    burger()!.click();
    await settle();
    await TestBed.inject(Router).navigateByUrl('/orders');
    await settle();
    expect(nav().classList.contains('translate-x-full')).toBe(true);
    expect(backdrop()).toBeNull();
  });
});

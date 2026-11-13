import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import type { DesktopApi } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { AuthService } from './auth.service';
import { requires } from './permission.guard';
import { fakeAuthApi, sessionUser } from './testing';

@Component({ template: '' })
class Blank {}

function setup(api?: DesktopApi): AuthService {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'checkout', component: Blank, ...requires('checkout.sell') },
        { path: 'orders', component: Blank, ...requires('orders.view') },
        { path: 'settings', component: Blank },
      ]),
      { provide: DESKTOP_API, useValue: api },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('AuthService', () => {
  it('starts locked, with the people who can sign in', async () => {
    const auth = setup(fakeAuthApi().api);
    await auth.whenReady();
    expect(auth.user()).toBeNull();
    expect(auth.choices().map((c) => c.name)).toEqual(['Sam', 'Alex']);
  });

  it('picks up a session the main process already has (a reloaded window)', async () => {
    const auth = setup(fakeAuthApi({ status: sessionUser(['orders.view']) }).api);
    await auth.whenReady();
    expect(auth.user()?.name).toBe('Sam');
    expect(auth.can('orders.view')).toBe(true);
    expect(auth.can('orders.reverse')).toBe(false);
  });

  it('signs in with a PIN, and stays locked on a wrong one', async () => {
    const fake = fakeAuthApi({ signIn: ({ pin }) => (pin === '1234' ? { ok: true, user: sessionUser(['checkout.sell']) } : { ok: false, error: 'Wrong PIN' }) });
    const auth = setup(fake.api);
    await auth.whenReady();
    expect(await auth.signIn('u1', '0000')).toEqual({ ok: false, error: 'Wrong PIN' });
    expect(auth.user()).toBeNull();
    expect((await auth.signIn('u1', '1234')).ok).toBe(true);
    expect(auth.user()?.id).toBe('u1');
  });

  it('locks again on sign-out', async () => {
    const fake = fakeAuthApi({ status: sessionUser(['checkout.sell']) });
    const auth = setup(fake.api);
    await auth.whenReady();
    await auth.signOut();
    expect(fake.calls.signOut).toBe(1);
    expect(auth.user()).toBeNull();
    expect(auth.choices()).toHaveLength(2);
  });

  it('allows everything where there is no main process to sign in to', async () => {
    const auth = setup(undefined);
    await auth.whenReady();
    expect(auth.can('users.manage')).toBe(true);
  });

  it('sends a signed-in person to the first page they may use when the current one is not theirs', async () => {
    const fake = fakeAuthApi({ signIn: () => ({ ok: true, user: sessionUser(['orders.view']) }) });
    const auth = setup(fake.api);
    const router = TestBed.inject(Router);
    await auth.whenReady();
    await router.navigateByUrl('/checkout'); // locked: nothing is checked
    expect(router.url).toBe('/checkout');
    await auth.signIn('u1', '1234');
    expect(router.url).toBe('/orders');
  });

  it('keeps a person off a page they are not allowed to open', async () => {
    const auth = setup(fakeAuthApi({ status: sessionUser(['orders.view']) }).api);
    const router = TestBed.inject(Router);
    await auth.whenReady();
    await router.navigateByUrl('/checkout');
    expect(router.url).toBe('/orders');
  });
});

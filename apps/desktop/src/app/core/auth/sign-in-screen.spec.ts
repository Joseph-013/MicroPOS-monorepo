import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DESKTOP_API } from '../api/desktop-api';
import { AuthService } from './auth.service';
import { fakeAuthApi, sessionUser } from './testing';
import { SIGN_IN_FILTER_FROM, SIGN_IN_IDLE_MS, SignInScreen } from './sign-in-screen';

describe('SignInScreen', () => {
  let fixture: ComponentFixture<SignInScreen>;
  let el: HTMLElement;

  async function open(fake = fakeAuthApi()): Promise<ReturnType<typeof fakeAuthApi>> {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }]), { provide: DESKTOP_API, useValue: fake.api }] });
    await TestBed.inject(AuthService).whenReady();
    fixture = TestBed.createComponent(SignInScreen);
    await fixture.whenStable();
    el = fixture.nativeElement as HTMLElement;
    return fake;
  }
  const button = (label: string): HTMLButtonElement => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label)!;
  const press = async (...labels: string[]): Promise<void> => {
    for (const label of labels) {
      button(label).click();
      await fixture.whenStable();
    }
  };

  it('lists who can sign in, then asks for their PIN', async () => {
    await open();
    expect(Array.from(el.querySelectorAll('li button')).map((b) => b.getAttribute('aria-label'))).toEqual(['Sam', 'Alex']);
    await press('Sam');
    expect(el.textContent).toContain('Enter your PIN');
  });

  it('signs in with the digits pressed', async () => {
    const fake = await open(fakeAuthApi({ signIn: () => ({ ok: true, user: sessionUser(['checkout.sell']) }) }));
    await press('Sam', '1', '2', '3', '4', 'Sign in');
    expect(fake.calls.signIn).toEqual([{ userId: 'u1', pin: '1234' }]);
  });

  it('does not offer to sign in with fewer than four digits', async () => {
    await open();
    await press('Sam', '1', '2');
    expect(button('Sign in').disabled).toBe(true);
  });

  it('says so on a wrong PIN, and clears the digits', async () => {
    await open();
    await press('Sam', '9', '9', '9', '9', 'Sign in');
    await fixture.whenStable();
    expect(el.textContent).toContain('Wrong PIN');
    expect(el.querySelectorAll('[data-pin-dots] span')).toHaveLength(0);
  });

  it('shows each person with their initials and role', async () => {
    await open(fakeAuthApi({ choices: [{ id: 'u1', name: 'Store Owner', role: 'admin' }] }));
    const tile = button('Store Owner');
    expect(tile.textContent).toContain('SO');
    expect(tile.textContent).toContain('Admin');
    expect(el.textContent).toContain('Sign in as');
  });

  it('offers a name filter only for a long list, ignoring case and accents', async () => {
    const many = Array.from({ length: SIGN_IN_FILTER_FROM }, (_, i) => ({ id: `u${i}`, name: i === 0 ? 'José Cruz' : `Person ${i}`, role: 'cashier' as const }));
    await open(fakeAuthApi({ choices: many.slice(0, SIGN_IN_FILTER_FROM - 1) }));
    expect(el.querySelector('input[type="search"]')).toBeNull();

    TestBed.resetTestingModule();
    await open(fakeAuthApi({ choices: many }));
    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'jose';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(Array.from(el.querySelectorAll('li button')).map((b) => b.getAttribute('aria-label'))).toEqual(['José Cruz']);
    search.value = 'nobody';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Nobody matches');
  });

  it('shows the shop name instead of the wordmark when there is one', async () => {
    await open(fakeAuthApi({ branding: { shopName: 'Aling Nena Store', logo: null } }));
    expect(el.textContent).toContain('Aling Nena Store');
    expect(el.querySelector('app-logo')).toBeNull();
  });

  it('offers Restore from backup only on a fresh install, and says why it failed', async () => {
    await open();
    expect(button('Restore from backup')).toBeUndefined();

    TestBed.resetTestingModule();
    const fake = await open(fakeAuthApi({ fresh: true, importFresh: { ok: false, error: 'This is not a MicroPOS database' } }));
    await press('Restore from backup');
    expect(fake.calls.importFresh).toBe(1);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('This is not a MicroPOS database');
  });

  describe('left alone', () => {
    afterEach(() => vi.useRealTimers());
    // With a fake clock whenStable never settles (the screen's clock always has a timer waiting): render by hand.
    const wait = async (ms: number): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    };
    const tap = async (...labels: string[]): Promise<void> => {
      for (const label of labels) {
        button(label).click();
        await wait(0);
      }
    };
    const onPinStep = (): boolean => !!el.textContent?.includes('Enter your PIN');

    it('clears a half-typed PIN and goes back to the people', async () => {
      await open();
      vi.useFakeTimers();
      await tap('Sam', '1', '2');
      await wait(SIGN_IN_IDLE_MS - 1000);
      expect(onPinStep()).toBe(true);
      await wait(1000);
      expect(onPinStep()).toBe(false);
      expect(button('Sam')).toBeDefined(); // the tiles again
      await tap('Sam');
      expect(el.querySelectorAll('[data-pin-dots] span')).toHaveLength(0); // the digits did not survive
    });

    it('waits again after every key pressed', async () => {
      await open();
      vi.useFakeTimers();
      await tap('Sam');
      await wait(SIGN_IN_IDLE_MS - 5000);
      await tap('1');
      await wait(SIGN_IN_IDLE_MS - 5000);
      expect(onPinStep()).toBe(true);
      await wait(5000);
      expect(onPinStep()).toBe(false);
    });
  });

  it('asks for a new PIN of their own after signing in with a starting one', async () => {
    await open(fakeAuthApi({ status: sessionUser(['checkout.sell'], { pinChangeRequired: true }) }));
    expect(el.textContent).toContain('Choose your own PIN');
    expect(el.querySelector('#pin-new')).toBeTruthy();
  });
});

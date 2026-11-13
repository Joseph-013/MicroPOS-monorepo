import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DESKTOP_API } from '../api/desktop-api';
import { AuthService } from './auth.service';
import { fakeAuthApi, sessionUser } from './testing';
import { SignInScreen } from './sign-in-screen';

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
    expect(Array.from(el.querySelectorAll('li button')).map((b) => b.textContent!.trim())).toEqual(['Sam', 'Alex']);
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

  it('asks for a new PIN of their own after signing in with a starting one', async () => {
    await open(fakeAuthApi({ status: sessionUser(['checkout.sell'], { pinChangeRequired: true }) }));
    expect(el.textContent).toContain('Choose your own PIN');
    expect(el.querySelector('#pin-new')).toBeTruthy();
  });
});

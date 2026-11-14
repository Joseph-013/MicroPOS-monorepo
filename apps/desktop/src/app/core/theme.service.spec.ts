import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { SessionUser } from '@micropos/core';
import { AuthService } from './auth/auth.service';
import { sessionUser } from './auth/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  const user = signal<SessionUser | null>(null);
  const setup = (): ThemeService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { user } }] });
    return TestBed.inject(ThemeService);
  };
  beforeEach(() => {
    localStorage.clear();
    user.set(null);
    document.documentElement.classList.remove('dark');
  });

  it('remembers each person\'s choice and applies it when they sign in', () => {
    const theme = setup();
    user.set(sessionUser([], { id: 'u1' }));
    TestBed.flushEffects?.();
    theme.set('dark');
    user.set(sessionUser([], { id: 'u2', name: 'Alex' }));
    TestBed.flushEffects?.();
    expect(theme.mode()).toBe('dark'); // nothing chosen yet: carries on from the device
    theme.set('light');
    user.set(sessionUser([], { id: 'u1' }));
    TestBed.flushEffects?.();
    expect(theme.mode()).toBe('dark');
    user.set(sessionUser([], { id: 'u2', name: 'Alex' }));
    TestBed.flushEffects?.();
    expect(theme.mode()).toBe('light');
  });

  it('starts from the last choice on the device (the lock screen) and keeps it after a restart', () => {
    setup().set('dark');
    expect(setup().mode()).toBe('dark');
  });

  it('applies the theme as soon as it starts, remembers what is in use for the next launch, and starts from it', () => {
    const theme = setup();
    theme.set('dark');
    TestBed.flushEffects?.();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(JSON.parse(localStorage.getItem('micropos.themeApplied')!)).toBe('dark');
    // Another person's choice was made last on this device, but dark was in use when the app closed: it starts dark.
    localStorage.setItem('micropos.theme', JSON.stringify('light'));
    expect(setup().mode()).toBe('dark');
  });
});

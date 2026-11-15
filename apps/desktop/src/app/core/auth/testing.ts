import { ALL_PERMISSIONS, type DesktopApi, type ImportDatabaseResult, type Permission, type SessionUser, type SignInBranding, type SignInChoice, type SignInResult } from '@micropos/core';

/** Fakes for specs that need someone signed in (or a till to sign in to). */
export const sessionUser = (permissions: Permission[], over: Partial<SessionUser> = {}): SessionUser => ({
  id: 'u1',
  name: 'Sam',
  role: 'cashier',
  permissions,
  pinChangeRequired: false,
  ...over,
});

interface FakeAuth {
  status?: SessionUser | null;
  signIn?: (input: { userId: string; pin: string }) => SignInResult;
  choices?: SignInChoice[];
  branding?: SignInBranding;
  /** A fresh install (the sign-in screen offers Restore from backup). */
  fresh?: boolean;
  importFresh?: ImportDatabaseResult;
}

export function fakeAuthApi(options: FakeAuth = {}) {
  const calls = { signIn: [] as { userId: string; pin: string }[], signOut: 0, importFresh: 0 };
  const api = {
    auth: {
      status: () => Promise.resolve(options.status ?? null),
      choices: () =>
        Promise.resolve(
          options.choices ?? [
            { id: 'u1', name: 'Sam', role: 'cashier' },
            { id: 'u2', name: 'Alex', role: 'manager' },
          ],
        ),
      branding: () => Promise.resolve(options.branding ?? { shopName: '', logo: null }),
      signIn: (input: { userId: string; pin: string }) => {
        calls.signIn.push(input);
        return Promise.resolve(options.signIn?.(input) ?? ({ ok: false, error: 'Wrong PIN' } as const));
      },
      signOut: () => {
        calls.signOut += 1;
        return Promise.resolve();
      },
      changePin: () => Promise.resolve({ ok: true as const, user: sessionUser([]) }),
      activity: () => Promise.resolve({ user: options.status ?? null, timeoutMinutes: null }),
    },
    backup: {
      freshInstall: () => Promise.resolve(options.fresh ?? false),
      importFresh: () => {
        calls.importFresh += 1;
        return Promise.resolve(options.importFresh ?? ({ ok: false, canceled: true, error: 'Canceled' } as const));
      },
    },
  } as unknown as DesktopApi;
  return { api, calls };
}

/** A fake bridge with someone signed in (everything allowed unless `permissions` says otherwise), for specs whose subject is not the sign-in. */
export const withSession = (api: DesktopApi, permissions: readonly Permission[] = ALL_PERMISSIONS): DesktopApi =>
  ({ ...fakeAuthApi({ status: sessionUser([...permissions]) }).api, ...api }) as DesktopApi;

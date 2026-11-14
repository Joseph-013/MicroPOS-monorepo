import { ALL_PERMISSIONS, type DesktopApi, type Permission, type SessionUser, type SignInResult } from '@micropos/core';

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
}

export function fakeAuthApi(options: FakeAuth = {}) {
  const calls = { signIn: [] as { userId: string; pin: string }[], signOut: 0 };
  const api = {
    auth: {
      status: () => Promise.resolve(options.status ?? null),
      choices: () => Promise.resolve([{ id: 'u1', name: 'Sam' }, { id: 'u2', name: 'Alex' }]),
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
  } as unknown as DesktopApi;
  return { api, calls };
}

/** A fake bridge with someone signed in (everything allowed unless `permissions` says otherwise), for specs whose subject is not the sign-in. */
export const withSession = (api: DesktopApi, permissions: readonly Permission[] = ALL_PERMISSIONS): DesktopApi =>
  ({ ...fakeAuthApi({ status: sessionUser([...permissions]) }).api, ...api }) as DesktopApi;

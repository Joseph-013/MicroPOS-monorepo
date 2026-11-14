import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is signed in on one connection, and who sales and stock changes are attributed to. */
export interface SessionState {
  session: { employeeId: string; loginSessionId: string } | null;
  actorId: string | null;
}

export const newSessionState = (): SessionState => ({ session: null, actorId: null });

/** The till's own window: one person at a time. Calls from the till's window and everything outside a request use it. */
const tillState = newSessionState();
const storage = new AsyncLocalStorage<SessionState>();

/** The state of the connection the current call belongs to (a paired phone's, or the till's). */
export const sessionState = (): SessionState => storage.getStore() ?? tillState;

/** Runs `fn` (and everything it awaits) as the connection that owns `state`: sign-ins and attribution stay on it. */
export const runAsSession = <T>(state: SessionState, fn: () => T): T => storage.run(state, fn);

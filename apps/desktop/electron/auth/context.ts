import { AsyncLocalStorage } from 'node:async_hooks';

/** Who is signed in on one connection, and who sales and stock changes are attributed to. */
export interface SessionState {
  session: { employeeId: string; loginSessionId: string } | null;
  actorId: string | null;
  /** When this connection last reported activity (sign-in, or the page's heartbeat while someone uses it). */
  lastActivityAt: number;
  /** The paired device this connection is (its id), or null for the till's own window. Each has its own checkout order in progress. */
  deviceId: string | null;
}

export const newSessionState = (deviceId: string | null = null): SessionState => ({ session: null, actorId: null, lastActivityAt: 0, deviceId });

/** The till's own window: one person at a time. Calls from the till's window and everything outside a request use it. */
const tillState = newSessionState();
const storage = new AsyncLocalStorage<SessionState>();

/** The state of the connection the current call belongs to (a paired phone's, or the till's). */
export const sessionState = (): SessionState => storage.getStore() ?? tillState;

/** Runs `fn` (and everything it awaits) as the connection that owns `state`: sign-ins and attribution stay on it. */
export const runAsSession = <T>(state: SessionState, fn: () => T): T => storage.run(state, fn);

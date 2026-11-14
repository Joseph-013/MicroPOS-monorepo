import type { SessionUser } from './auth.js';

/** Signing out after nobody has touched the till (or a paired phone) for this long: whole minutes, or off. */
export const MIN_SESSION_TIMEOUT_MINUTES = 1;
export const MAX_SESSION_TIMEOUT_MINUTES = 24 * 60;

export const isSessionTimeoutMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= MIN_SESSION_TIMEOUT_MINUTES && value <= MAX_SESSION_TIMEOUT_MINUTES;

/** What the page learns each time it reports that someone is using it. */
export interface SessionActivity {
  /** Who is signed in now: null when the session has already ended (it expired, or was ended elsewhere). */
  user: SessionUser | null;
  /** The shop's inactivity limit in minutes, or null when sessions never expire. */
  timeoutMinutes: number | null;
}

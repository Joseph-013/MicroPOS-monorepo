import { and, desc, eq, isNull } from 'drizzle-orm';
import {
  ALL_PERMISSIONS,
  type ChangePinInput,
  type ChangePinResult,
  isValidPin,
  MAX_FAILED_SIGN_INS,
  normalizePermissions,
  type Permission,
  PIN_RULE,
  ROLE_PRESETS,
  type SessionActivity,
  type SessionUser,
  SIGN_IN_PAUSE_MS,
  type SignInChoice,
  type SignInResult,
} from '@micropos/core';
import type { AppDatabase } from '../db';
import { auditLog, type Employee, employees, loginSessions } from '../db/schema';
import { setActor } from './actor';
import { sessionState } from './context';
import { getSessionTimeout } from './session-timeout';
import { hashPin, verifyPin } from './pin';

/** Employees whose PIN hash is a real one can sign in; the "Register" stand-in used before sign-in existed cannot. */
export const canSignIn = (employee: Pick<Employee, 'pinHash' | 'active' | 'deletedAt'>): boolean =>
  employee.active && employee.deletedAt === null && employee.pinHash.startsWith('scrypt$');

/** What an employee may do: their own switches, or the role's preset for rows from before permissions existed. */
export function permissionsOf(employee: Pick<Employee, 'permissions' | 'role'>): Permission[] {
  return employee.permissions ? normalizePermissions(employee.permissions) : [...ROLE_PRESETS[employee.role]];
}

export function toSessionUser(employee: Employee): SessionUser {
  return { id: employee.id, name: employee.name, role: employee.role, permissions: permissionsOf(employee), pinChangeRequired: employee.pinChangeRequired };
}

/** Who is signed in now, read fresh so a change to their permissions, or deactivating them, applies at once. */
export function currentUser(db: AppDatabase, now = Date.now()): SessionUser | null {
  const state = sessionState();
  const session = state.session;
  if (!session) return null;
  // A session nobody has used for longer than the shop's limit has ended (it is closed as of its last activity).
  const limit = getSessionTimeout(db);
  if (limit !== null && now - state.lastActivityAt > limit * 60_000) {
    endSession(db, state.lastActivityAt);
    return null;
  }
  const [employee] = db.select().from(employees).where(eq(employees.id, session.employeeId)).all();
  if (!employee || !canSignIn(employee)) {
    endSession(db);
    return null;
  }
  return toSessionUser(employee);
}

/**
 * The page says someone is using it: the session's inactivity clock restarts. Returns who is signed in (null once the
 * session has ended, because it was idle too long) and the shop's limit.
 */
export function recordActivity(db: AppDatabase, now = Date.now()): SessionActivity {
  const user = currentUser(db, now);
  if (user) sessionState().lastActivityAt = now;
  return { user, timeoutMinutes: getSessionTimeout(db) };
}

/** True when someone is signed in and holds any of `needed` (or `needed` is empty: signed in is enough). */
export function isAllowed(db: AppDatabase, needed: readonly Permission[]): boolean {
  const user = currentUser(db);
  if (!user) return false;
  return needed.length === 0 || needed.some((p) => user.permissions.includes(p));
}

export function signInChoices(db: AppDatabase): SignInChoice[] {
  return db
    .select()
    .from(employees)
    .where(isNull(employees.deletedAt))
    .orderBy(employees.name)
    .all()
    .filter(canSignIn)
    .map((e) => ({ id: e.id, name: e.name }));
}

export function signIn(db: AppDatabase, input: unknown, now = Date.now()): SignInResult {
  const { userId, pin } = (input ?? {}) as { userId?: unknown; pin?: unknown };
  if (typeof userId !== 'string' || typeof pin !== 'string') return { ok: false, error: 'Could not sign in' };
  const [employee] = db.select().from(employees).where(eq(employees.id, userId)).all();
  if (!employee || !canSignIn(employee)) return { ok: false, error: 'Could not sign in' };
  if (employee.lockedUntil !== null && employee.lockedUntil > now) {
    const seconds = Math.ceil((employee.lockedUntil - now) / 1000);
    return { ok: false, error: `Too many wrong PINs. Try again in ${seconds} second${seconds === 1 ? '' : 's'}`, pausedUntil: employee.lockedUntil };
  }
  if (!verifyPin(pin, employee.pinHash)) {
    const failed = employee.failedAttempts + 1;
    if (failed >= MAX_FAILED_SIGN_INS) {
      const pausedUntil = now + SIGN_IN_PAUSE_MS;
      db.update(employees).set({ failedAttempts: 0, lockedUntil: pausedUntil }).where(eq(employees.id, employee.id)).run();
      return { ok: false, error: `Too many wrong PINs. Try again in ${SIGN_IN_PAUSE_MS / 1000} seconds`, pausedUntil };
    }
    db.update(employees).set({ failedAttempts: failed }).where(eq(employees.id, employee.id)).run();
    return { ok: false, error: 'Wrong PIN' };
  }
  db.update(employees).set({ failedAttempts: 0, lockedUntil: null }).where(eq(employees.id, employee.id)).run();
  endSession(db, now);
  const loginSessionId = db.insert(loginSessions).values({ employeeId: employee.id, loggedInAt: now }).returning({ id: loginSessions.id }).get().id;
  sessionState().session = { employeeId: employee.id, loginSessionId };
  sessionState().lastActivityAt = now;
  setActor(employee.id);
  return { ok: true, user: toSessionUser(employee) };
}

export function signOut(db: AppDatabase): void {
  endSession(db);
}

export function endSession(db: AppDatabase, now = Date.now()): void {
  const state = sessionState();
  const session = state.session;
  if (!session) return;
  db.update(loginSessions).set({ loggedOutAt: now }).where(and(eq(loginSessions.id, session.loginSessionId), isNull(loginSessions.loggedOutAt))).run();
  state.session = null;
  setActor(null);
}

/** Changes the signed-in person's own PIN; it must be given the current one, so a till left unlocked cannot be taken over. */
export function changePin(db: AppDatabase, input: unknown): ChangePinResult {
  const user = currentUser(db);
  if (!user) return { ok: false, error: 'Sign in first' };
  const { currentPin, newPin } = (input ?? {}) as Partial<ChangePinInput>;
  const [employee] = db.select().from(employees).where(eq(employees.id, user.id)).all();
  if (typeof currentPin !== 'string' || !employee || !verifyPin(currentPin, employee.pinHash)) return { ok: false, error: 'The current PIN is wrong' };
  if (!isValidPin(newPin)) return { ok: false, error: `The new PIN must be ${PIN_RULE}` };
  if (newPin === currentPin) return { ok: false, error: 'Choose a different PIN' };
  db.transaction((tx) => {
    tx.update(employees).set({ pinHash: hashPin(newPin), pinChangeRequired: false }).where(eq(employees.id, user.id)).run();
    tx.insert(auditLog).values({ employeeId: user.id, action: 'user.pin-change', entity: 'employee', entityId: user.id }).run();
  });
  return { ok: true, user: { ...user, pinChangeRequired: false } };
}

/** PIN of the account made on a fresh install; it must be changed at the first sign-in. */
export const INITIAL_OWNER_PIN = '1234';

/**
 * Makes sure someone can manage users: on a database where nobody can, an admin account "Owner" is created with the
 * well-known starting PIN, which has to be changed at the first sign-in. Does nothing otherwise.
 */
export function ensureOwner(db: AppDatabase): void {
  const hasManager = db
    .select()
    .from(employees)
    .where(isNull(employees.deletedAt))
    .all()
    .some((e) => canSignIn(e) && permissionsOf(e).includes('users.manage'));
  if (hasManager) return;
  const taken = new Set(
    db
      .select({ number: employees.employeeNumber })
      .from(employees)
      .where(isNull(employees.deletedAt))
      .all()
      .map((e) => e.number),
  );
  let number = 1001;
  while (taken.has(String(number))) number += 1;
  db.insert(employees)
    .values({ name: 'Owner', employeeNumber: String(number), role: 'admin', permissions: [...ALL_PERMISSIONS], pinHash: hashPin(INITIAL_OWNER_PIN), pinChangeRequired: true })
    .run();
}

/** The latest sign-in of each employee, for the Users page. */
export function lastSignIns(db: AppDatabase): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of db.select().from(loginSessions).orderBy(desc(loginSessions.loggedInAt)).all()) {
    if (!map.has(row.employeeId)) map.set(row.employeeId, row.loggedInAt);
  }
  return map;
}

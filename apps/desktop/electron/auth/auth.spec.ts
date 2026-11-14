import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, MAX_FAILED_SIGN_INS, type UserInput } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { auditLog, employees, loginSessions } from '../db/schema';
import { sellingEmployee } from '../db/queries/orders';
import { currentActorId } from './actor';
import { changePin, currentUser, ensureOwner, INITIAL_OWNER_PIN, isAllowed, recordActivity, signIn, signInChoices, signOut } from './auth';
import { getSessionTimeout, setSessionTimeout } from './session-timeout';
import { hashPin } from './pin';
import { createUser, listUsers, resetPin, signInLog, updateUser } from './users';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-auth-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  signOut(db);
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const ownerId = (): string => signInChoices(db).find((c) => c.name === 'Owner')!.id;
const signInAsOwner = (): void => {
  ensureOwner(db);
  const result = signIn(db, { userId: ownerId(), pin: INITIAL_OWNER_PIN });
  expect(result.ok).toBe(true);
};
const form = (over: Partial<UserInput> = {}): UserInput => ({
  name: 'Sam',
  employeeNumber: '2001',
  role: 'cashier',
  permissions: ['checkout.sell'],
  active: true,
  pin: '4321',
  ...over,
});

describe('the first owner', () => {
  it('is made on a database where nobody can manage users, with a PIN that must be changed', () => {
    ensureOwner(db);
    const [owner] = listUsers(db);
    expect(owner).toMatchObject({ name: 'Owner', employeeNumber: '1001', role: 'admin', pinChangeRequired: true });
    expect(owner.permissions).toEqual(ALL_PERMISSIONS);
  });

  it('is not made again', () => {
    ensureOwner(db);
    ensureOwner(db);
    expect(listUsers(db)).toHaveLength(1);
  });

  it('is made when the only employee is the Register stand-in', () => {
    db.insert(employees).values({ name: 'Register', employeeNumber: '0000', pinHash: '!' }).run();
    ensureOwner(db);
    expect(signInChoices(db).map((c) => c.name)).toEqual(['Owner']);
  });
});

describe('signing in', () => {
  it('records the sign-in and out, and names who is signed in', () => {
    signInAsOwner();
    expect(currentUser(db)?.name).toBe('Owner');
    expect(currentActorId()).toBe(ownerId());
    signOut(db);
    expect(currentUser(db)).toBeNull();
    expect(currentActorId()).toBeNull();
    const [entry] = signInLog(db);
    expect(entry).toMatchObject({ userName: 'Owner' });
    expect(entry.signedOutAt).not.toBeNull();
  });

  it('refuses a wrong PIN, and pauses after too many in a row', () => {
    ensureOwner(db);
    const userId = ownerId();
    const now = 1_000_000;
    for (let i = 1; i < MAX_FAILED_SIGN_INS; i += 1) expect(signIn(db, { userId, pin: '0000' }, now)).toEqual({ ok: false, error: 'Wrong PIN' });
    const paused = signIn(db, { userId, pin: '0000' }, now);
    expect(paused).toMatchObject({ ok: false, pausedUntil: now + 60_000 });
    // Even the right PIN waits until the pause is over.
    expect(signIn(db, { userId, pin: INITIAL_OWNER_PIN }, now + 1000)).toMatchObject({ ok: false });
    expect(signIn(db, { userId, pin: INITIAL_OWNER_PIN }, now + 60_001)).toMatchObject({ ok: true });
  });

  it('does not let an inactive user, the Register stand-in or a made-up id sign in', () => {
    ensureOwner(db);
    const register = db.insert(employees).values({ name: 'Register', employeeNumber: '0000', pinHash: '!' }).returning().get();
    expect(signIn(db, { userId: register.id, pin: '!' })).toMatchObject({ ok: false });
    expect(signIn(db, { userId: 'nope', pin: '1234' })).toMatchObject({ ok: false });
    expect(signIn(db, { userId: 5, pin: 1234 })).toMatchObject({ ok: false });
  });

  it('ends the session of a user who is deactivated while signed in', () => {
    signInAsOwner();
    db.update(employees).set({ active: false }).where(eq(employees.id, ownerId() ?? '')).run();
    expect(currentUser(db)).toBeNull();
  });
});

describe('permissions', () => {
  it('allows only what the signed-in user was given', () => {
    signInAsOwner();
    const created = createUser(db, form({ permissions: ['checkout.sell', 'orders.view'] }));
    expect(created.ok).toBe(true);
    signOut(db);
    const sam = signInChoices(db).find((c) => c.name === 'Sam')!;
    expect(isAllowed(db, ['orders.view'])).toBe(false); // nobody signed in
    expect(signIn(db, { userId: sam.id, pin: '4321' })).toMatchObject({ ok: true, user: { pinChangeRequired: true } });
    expect(isAllowed(db, ['orders.view'])).toBe(true);
    expect(isAllowed(db, ['orders.reverse'])).toBe(false);
    expect(isAllowed(db, ['orders.reverse', 'checkout.sell'])).toBe(true); // any of them
    expect(isAllowed(db, [])).toBe(true); // signed in is enough
    expect(isAllowed(db, ['users.manage'])).toBe(false);
  });

  it('applies a change to someone already signed in at once', () => {
    signInAsOwner();
    const created = createUser(db, form());
    if (!created.ok) throw new Error('not created');
    signOut(db);
    signIn(db, { userId: created.user.id, pin: '4321' });
    expect(isAllowed(db, ['orders.view'])).toBe(false);
    db.update(employees).set({ permissions: ['orders.view'] }).where(eq(employees.id, created.user.id)).run();
    expect(isAllowed(db, ['orders.view'])).toBe(true);
  });

  it('falls back to the role preset for an employee from before permissions existed', () => {
    ensureOwner(db);
    const row = db.insert(employees).values({ name: 'Old', employeeNumber: '3001', pinHash: hashPin('1111'), role: 'manager' }).returning().get();
    expect(signIn(db, { userId: row.id, pin: '1111' })).toMatchObject({ ok: true });
    expect(isAllowed(db, ['purchasing.manage'])).toBe(true);
    expect(isAllowed(db, ['users.manage'])).toBe(false);
  });
});

describe('who made the sale', () => {
  it('attributes sales, payments and stock movements to the signed-in user, and to the old fallback when nobody is', () => {
    ensureOwner(db);
    const fallback = sellingEmployee(db);
    signInAsOwner();
    expect(sellingEmployee(db)).toBe(ownerId());
    expect(currentActorId()).toBe(ownerId());
    signOut(db);
    expect(sellingEmployee(db)).toBe(fallback);
  });
});

describe('changing your own PIN', () => {
  it('needs the current PIN, a valid new one, and clears the "must change" flag', () => {
    signInAsOwner();
    expect(changePin(db, { currentPin: '0000', newPin: '5555' })).toMatchObject({ ok: false });
    expect(changePin(db, { currentPin: INITIAL_OWNER_PIN, newPin: '12' })).toMatchObject({ ok: false });
    expect(changePin(db, { currentPin: INITIAL_OWNER_PIN, newPin: INITIAL_OWNER_PIN })).toMatchObject({ ok: false });
    expect(changePin(db, { currentPin: INITIAL_OWNER_PIN, newPin: '5555' })).toMatchObject({ ok: true, user: { pinChangeRequired: false } });
    signOut(db);
    expect(signIn(db, { userId: ownerId(), pin: INITIAL_OWNER_PIN })).toMatchObject({ ok: false });
    expect(signIn(db, { userId: ownerId(), pin: '5555' })).toMatchObject({ ok: true, user: { pinChangeRequired: false } });
  });

  it('cannot be done while locked', () => {
    ensureOwner(db);
    expect(changePin(db, { currentPin: INITIAL_OWNER_PIN, newPin: '5555' })).toEqual({ ok: false, error: 'Sign in first' });
  });
});

describe('managing users', () => {
  it('creates a user with a starting PIN they must change, and audits it', () => {
    signInAsOwner();
    const result = createUser(db, form());
    expect(result).toMatchObject({ ok: true, user: { name: 'Sam', pinChangeRequired: true, permissions: ['checkout.sell'] } });
    expect(db.select().from(auditLog).all().map((a) => a.action)).toContain('user.create');
  });

  it('checks the form: name, number, PIN and a number nobody else has', () => {
    signInAsOwner();
    expect(createUser(db, form({ name: ' ' }))).toMatchObject({ ok: false, field: 'name' });
    expect(createUser(db, form({ employeeNumber: '' }))).toMatchObject({ ok: false, field: 'employeeNumber' });
    expect(createUser(db, form({ pin: '12' }))).toMatchObject({ ok: false, field: 'pin' });
    expect(createUser(db, form({ employeeNumber: '1001' }))).toMatchObject({ ok: false, field: 'employeeNumber' });
    expect(createUser(db, 'junk')).toMatchObject({ ok: false });
  });

  it('keeps unknown permissions out', () => {
    signInAsOwner();
    const result = createUser(db, { ...form(), permissions: ['checkout.sell', 'rule.the.world'] });
    expect(result).toMatchObject({ ok: true, user: { permissions: ['checkout.sell'] } });
  });

  it('never leaves nobody able to manage users', () => {
    signInAsOwner();
    const id = ownerId();
    expect(updateUser(db, id, form({ employeeNumber: '1001', name: 'Owner', role: 'admin', permissions: ['checkout.sell'] }))).toMatchObject({ ok: false, field: 'permissions' });
    expect(updateUser(db, id, form({ employeeNumber: '1001', name: 'Owner', role: 'admin', permissions: [...ALL_PERMISSIONS], active: false }))).toMatchObject({ ok: false, field: 'active' });
    // With a second manager, the first can step down.
    createUser(db, form({ name: 'Second', employeeNumber: '2002', permissions: [...ALL_PERMISSIONS] }));
    expect(updateUser(db, id, form({ employeeNumber: '1001', name: 'Owner', role: 'admin', permissions: ['checkout.sell'] }))).toMatchObject({ ok: true });
  });

  it('does not let you deactivate yourself', () => {
    signInAsOwner();
    createUser(db, form({ name: 'Second', employeeNumber: '2002', permissions: [...ALL_PERMISSIONS] }));
    expect(updateUser(db, ownerId(), form({ employeeNumber: '1001', name: 'Owner', role: 'admin', permissions: [...ALL_PERMISSIONS], active: false }))).toMatchObject({ ok: false, field: 'active' });
  });

  it('resets a PIN (and lifts a pause), which then must be changed', () => {
    signInAsOwner();
    const created = createUser(db, form());
    if (!created.ok) throw new Error('not created');
    expect(resetPin(db, created.user.id, 'abcd')).toMatchObject({ ok: false });
    expect(resetPin(db, created.user.id, '9999')).toEqual({ ok: true });
    signOut(db);
    expect(signIn(db, { userId: created.user.id, pin: '9999' })).toMatchObject({ ok: true, user: { pinChangeRequired: true } });
    expect(db.select().from(auditLog).all().map((a) => a.action)).toContain('user.pin-reset');
  });

  it('lists sign-ins newest first with the last sign-in on the user', () => {
    signInAsOwner();
    signOut(db);
    signIn(db, { userId: ownerId(), pin: INITIAL_OWNER_PIN });
    expect(signInLog(db)).toHaveLength(2);
    expect(listUsers(db)[0].lastSignInAt).not.toBeNull();
    expect(db.select().from(loginSessions).all()).toHaveLength(2);
  });
});

describe('session expiry after inactivity', () => {
  const T0 = 1_000_000;
  const MINUTE = 60_000;
  const signInAt = (now: number): void => {
    ensureOwner(db);
    expect(signIn(db, { userId: ownerId(), pin: INITIAL_OWNER_PIN }, now).ok).toBe(true);
  };

  it('never expires by default, and the limit is saved only as a whole number of minutes in range', () => {
    expect(getSessionTimeout(db)).toBeNull();
    signInAt(T0);
    expect(currentUser(db, T0 + 1000 * 60 * MINUTE)?.name).toBe('Owner'); // days later, still signed in
    for (const bad of [0, -5, 1.5, 1441, '10', undefined, NaN]) expect(setSessionTimeout(db, bad), String(bad)).toBe(false);
    expect(setSessionTimeout(db, 15)).toBe(true);
    expect(getSessionTimeout(db)).toBe(15);
    expect(setSessionTimeout(db, null)).toBe(true);
    expect(getSessionTimeout(db)).toBeNull();
  });

  it('ends a session that has been idle longer than the limit, and records the sign-out at its last activity', () => {
    setSessionTimeout(db, 5);
    signInAt(T0);
    expect(currentUser(db, T0 + 5 * MINUTE)?.name).toBe('Owner'); // exactly at the limit is still fine
    expect(currentUser(db, T0 + 5 * MINUTE + 1)).toBeNull();
    expect(currentUser(db, T0 + 5 * MINUTE + 2)).toBeNull(); // stays ended
    expect(isAllowed(db, [])).toBe(false);
    expect(db.select().from(loginSessions).all()[0]!.loggedOutAt).toBe(T0);
  });

  it('keeps a session alive while the page reports activity, and tells it when the session has ended', () => {
    setSessionTimeout(db, 5);
    signInAt(T0);
    expect(recordActivity(db, T0 + 4 * MINUTE)).toMatchObject({ user: { name: 'Owner' }, timeoutMinutes: 5 });
    expect(recordActivity(db, T0 + 8 * MINUTE).user?.name).toBe('Owner'); // 4 minutes since the last report
    expect(recordActivity(db, T0 + 14 * MINUTE)).toEqual({ user: null, timeoutMinutes: 5 }); // idle 6 minutes
    expect(recordActivity(db, T0 + 15 * MINUTE).user).toBeNull(); // it does not come back by itself
  });

  it('applies a limit set later, and turning it off keeps sessions open again', () => {
    signInAt(T0);
    setSessionTimeout(db, 1);
    expect(currentUser(db, T0 + 2 * MINUTE)).toBeNull();
    signInAt(T0 + 3 * MINUTE);
    setSessionTimeout(db, null);
    expect(currentUser(db, T0 + 500 * MINUTE)?.name).toBe('Owner');
  });
});

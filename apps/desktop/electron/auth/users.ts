import { desc, eq, isNull } from 'drizzle-orm';
import {
  isPermission,
  isValidPin,
  normalizePermissions,
  PIN_RULE,
  type ResetPinResult,
  type SaveUserResult,
  type SignInLogEntry,
  USER_ROLES,
  type UserInput,
  type UserRecord,
  validateUserInput,
} from '@micropos/core';
import type { AppDatabase } from '../db';
import { auditLog, type Employee, employees, loginSessions } from '../db/schema';
import { currentActorId } from './actor';
import { canSignIn, lastSignIns, permissionsOf } from './auth';
import { hashPin } from './pin';

function toRecord(employee: Employee, lastSignIn: number | null): UserRecord {
  return {
    id: employee.id,
    name: employee.name,
    employeeNumber: employee.employeeNumber,
    role: employee.role,
    permissions: permissionsOf(employee),
    active: employee.active,
    pinChangeRequired: employee.pinChangeRequired,
    lastSignInAt: lastSignIn,
  };
}

/** Users that can have a PIN. The stand-in "Register" employee that old sales may point at is not a person and is left out. */
function liveUsers(db: AppDatabase): Employee[] {
  return db.select().from(employees).where(isNull(employees.deletedAt)).orderBy(employees.name).all().filter((e) => e.pinHash.startsWith('scrypt$'));
}

export function listUsers(db: AppDatabase): UserRecord[] {
  const last = lastSignIns(db);
  return liveUsers(db).map((e) => toRecord(e, last.get(e.id) ?? null));
}

/** Reads and checks a user form coming from the renderer. */
function parseInput(raw: unknown): UserInput | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o['name'] !== 'string' || typeof o['employeeNumber'] !== 'string' || typeof o['active'] !== 'boolean') return null;
  if (!USER_ROLES.includes(o['role'] as never) || !Array.isArray(o['permissions'])) return null;
  return {
    name: o['name'].trim(),
    employeeNumber: o['employeeNumber'].trim(),
    role: o['role'] as UserInput['role'],
    permissions: normalizePermissions(o['permissions'].filter(isPermission)),
    active: o['active'],
    pin: typeof o['pin'] === 'string' ? o['pin'] : undefined,
  };
}

const NOT_VALID = { ok: false, field: null, error: 'That is not a valid user' } as const;

function numberTaken(db: AppDatabase, number: string, exceptId: string | null): boolean {
  return db
    .select()
    .from(employees)
    .where(eq(employees.employeeNumber, number))
    .all()
    .some((e) => e.deletedAt === null && e.id !== exceptId);
}

function audit(db: Pick<AppDatabase, 'insert'>, action: string, entityId: string, detail?: Record<string, unknown>): void {
  db.insert(auditLog).values({ employeeId: currentActorId(), action, entity: 'employee', entityId, detail }).run();
}

export function createUser(db: AppDatabase, raw: unknown): SaveUserResult {
  const input = parseInput(raw);
  if (!input) return NOT_VALID;
  const invalid = validateUserInput(input, true);
  if (invalid) return { ok: false, ...invalid };
  if (numberTaken(db, input.employeeNumber, null)) return { ok: false, field: 'employeeNumber', error: 'Another user has this number' };
  const employee = db.transaction((tx) => {
    // The person picks their own PIN at the first sign-in: the one typed here is only a way in.
    const created = tx
      .insert(employees)
      .values({ name: input.name, employeeNumber: input.employeeNumber, role: input.role, permissions: input.permissions, active: input.active, pinHash: hashPin(input.pin!), pinChangeRequired: true })
      .returning()
      .get();
    audit(tx, 'user.create', created.id, { name: created.name, permissions: input.permissions });
    return created;
  });
  return { ok: true, user: toRecord(employee, null) };
}

/** True when someone other than `exceptId` can sign in and manage users: the last such person must never be removed. */
function otherManagerExists(db: AppDatabase, exceptId: string): boolean {
  return liveUsers(db).some((e) => e.id !== exceptId && canSignIn(e) && permissionsOf(e).includes('users.manage'));
}

export function updateUser(db: AppDatabase, id: unknown, raw: unknown): SaveUserResult {
  const input = parseInput(raw);
  if (typeof id !== 'string' || !input) return NOT_VALID;
  const [existing] = db.select().from(employees).where(eq(employees.id, id)).all();
  if (!existing || existing.deletedAt !== null) return { ok: false, field: null, error: 'This user no longer exists' };
  const invalid = validateUserInput(input, false);
  if (invalid) return { ok: false, ...invalid };
  if (numberTaken(db, input.employeeNumber, id)) return { ok: false, field: 'employeeNumber', error: 'Another user has this number' };
  if (!input.active && id === currentActorId()) return { ok: false, field: 'active', error: 'You cannot deactivate yourself' };
  const keepsManaging = input.active && input.permissions.includes('users.manage');
  if (!keepsManaging && !otherManagerExists(db, id)) {
    return input.active
      ? { ok: false, field: 'permissions', error: 'Someone must be able to manage users: this is the only one who can' }
      : { ok: false, field: 'active', error: 'Someone must be able to manage users: this is the only one who can' };
  }
  const before = permissionsOf(existing);
  const updated = db.transaction((tx) => {
    const row = tx
      .update(employees)
      .set({ name: input.name, employeeNumber: input.employeeNumber, role: input.role, permissions: input.permissions, active: input.active })
      .where(eq(employees.id, id))
      .returning()
      .get();
    audit(tx, 'user.update', id, { name: input.name, active: input.active, permissionsBefore: before, permissionsAfter: input.permissions });
    return row;
  });
  return { ok: true, user: toRecord(updated, lastSignIns(db).get(id) ?? null) };
}

export function resetPin(db: AppDatabase, id: unknown, pin: unknown): ResetPinResult {
  if (typeof id !== 'string') return { ok: false, error: 'That is not a valid user' };
  if (!isValidPin(pin)) return { ok: false, error: `The PIN must be ${PIN_RULE}` };
  const [existing] = db.select().from(employees).where(eq(employees.id, id)).all();
  if (!existing || existing.deletedAt !== null) return { ok: false, error: 'This user no longer exists' };
  db.transaction((tx) => {
    tx.update(employees).set({ pinHash: hashPin(pin), pinChangeRequired: true, failedAttempts: 0, lockedUntil: null }).where(eq(employees.id, id)).run();
    audit(tx, 'user.pin-reset', id);
  });
  return { ok: true };
}

export function signInLog(db: AppDatabase): SignInLogEntry[] {
  return db
    .select({ id: loginSessions.id, userId: loginSessions.employeeId, userName: employees.name, signedInAt: loginSessions.loggedInAt, signedOutAt: loginSessions.loggedOutAt })
    .from(loginSessions)
    .innerJoin(employees, eq(employees.id, loginSessions.employeeId))
    .orderBy(desc(loginSessions.loggedInAt))
    .limit(200)
    .all();
}

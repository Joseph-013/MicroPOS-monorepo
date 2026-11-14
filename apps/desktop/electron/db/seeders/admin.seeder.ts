import { and, eq, isNull } from 'drizzle-orm';
import { hashPin } from '../../auth/pin';
import type { AppDatabase } from '../index';
import { employees } from '../schema';

/** PIN used for dummy and bootstrap accounts. Development tooling only; change it in real use. */
export const DEFAULT_PIN = '1234';

export const DEFAULT_ADMIN = { employeeNumber: 'EMP-001', name: 'Admin' } as const;

export interface AdminAccount {
  id: string;
  employeeNumber: string;
  name: string;
  /** The PIN that was set, or null when an admin already existed and was left untouched. */
  pin: string | null;
  created: boolean;
}

/**
 * Makes sure one admin account exists (the baseline of every fresh database).
 * Does nothing, and reports `created: false`, if a live admin is already there.
 * The PIN comes from `MICROPOS_ADMIN_PIN`, falling back to `DEFAULT_PIN`.
 */
export function seedAdmin(db: AppDatabase, pin: string = process.env['MICROPOS_ADMIN_PIN'] ?? DEFAULT_PIN): AdminAccount {
  const [existing] = db
    .select()
    .from(employees)
    .where(and(eq(employees.role, 'admin'), isNull(employees.deletedAt)))
    .limit(1)
    .all();
  if (existing) {
    return { id: existing.id, employeeNumber: existing.employeeNumber, name: existing.name, pin: null, created: false };
  }
  const [admin] = db
    .insert(employees)
    .values({ ...DEFAULT_ADMIN, role: 'admin', pinHash: hashPin(pin) })
    .returning()
    .all();
  return { id: admin.id, employeeNumber: admin.employeeNumber, name: admin.name, pin, created: true };
}

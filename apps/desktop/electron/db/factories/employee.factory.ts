import { faker } from '@faker-js/faker';
import { hashPin } from '../../auth/pin';
import type { EmployeeRole, NewEmployee } from '../schema';
import { DEFAULT_PIN } from '../seeders/admin.seeder';
import { uuid7 } from '../uuid';

/** PIN given to every dummy employee. Dev data only. */
export const DUMMY_PIN = DEFAULT_PIN;

export function buildEmployee(
  overrides: Partial<NewEmployee> & { pin?: string } = {},
  now = Date.now(),
): NewEmployee {
  const { pin = DUMMY_PIN, ...rest } = overrides;
  return {
    id: uuid7(now),
    name: faker.person.fullName(),
    employeeNumber: `EMP-${faker.number.int({ min: 100, max: 999 })}`,
    pinHash: hashPin(pin),
    role: 'cashier' satisfies EmployeeRole,
    active: true,
    failedAttempts: 0,
    createdAt: now,
    updatedAt: now,
    ...rest,
  };
}

import { faker } from '@faker-js/faker';
import type { NewCustomer } from '../schema';
import { uuid7 } from '../uuid';

/** A customer with a phone number and, for about half of them, a credit limit (in cents). */
export function buildCustomer(overrides: Partial<NewCustomer> = {}, now = Date.now()): NewCustomer {
  return {
    id: uuid7(now),
    name: faker.person.fullName(),
    phone: faker.phone.number({ style: 'national' }),
    note: faker.datatype.boolean(0.2) ? faker.lorem.words(3) : null,
    creditLimit: faker.datatype.boolean(0.5) ? faker.number.int({ min: 20, max: 60 }) * 10_000 : null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

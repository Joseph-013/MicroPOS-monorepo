import { integer, text } from 'drizzle-orm/sqlite-core';
import { uuid7 } from '../uuid';

/** Primary key: UUIDv7 text, generated on insert. */
export const id = () => text().primaryKey().$defaultFn(() => uuid7());

/** Epoch milliseconds (UTC). Money columns elsewhere are integer cents. */
const now = () => Date.now();
export const createdAt = () => integer().notNull().$defaultFn(now);
export const updatedAt = () => integer().notNull().$defaultFn(now).$onUpdate(now);
/** Soft delete marker; null while the row is live. */
export const deletedAt = () => integer();

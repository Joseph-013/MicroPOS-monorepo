import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { createdAt, id } from './_columns';

/** A phone or tablet paired with the till over the shop's network. Only a hash of its token is kept. */
export const lanDevices = sqliteTable(
  'lan_devices',
  {
    id: id(),
    name: text().notNull(),
    /** SHA-256 of the device's secret token (the token itself lives only in the phone's browser). */
    tokenHash: text().notNull(),
    pairedAt: createdAt(),
    lastSeenAt: integer(),
    /** Set when an admin unpairs it; the token stops working. */
    revokedAt: integer(),
  },
  (t) => [uniqueIndex('lan_devices_token_hash_unique').on(t.tokenHash), index('lan_devices_revoked_at_idx').on(t.revokedAt)],
);

export type LanDeviceRow = typeof lanDevices.$inferSelect;

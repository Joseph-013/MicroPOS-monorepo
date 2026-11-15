import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { sessionState } from '../../auth/context';
import type { AppDatabase } from '../index';
import { settings } from '../schema';

/*
 * Drafts (the checkout order in progress, a half-filled product or Repackage form) belong to the person who started
 * them: each is stored under its old key plus `@<employee id>` (`checkout.draft@<id>`, `checkout.draft.<device>@<id>`,
 * `product.draft.new@<id>`, `repackage.draft@<id>`), so someone else signing in on the same till never sees, changes or
 * completes it. A draft saved before drafts had owners (the plain key) goes to whoever uses it first after the update.
 * With nobody signed in (tools, the seeder, tests) the plain key is used, as before.
 */

/** Who the drafts of the current call belong to: the person signed in on this connection, or null. */
export const draftOwner = (): string | null => sessionState().session?.employeeId ?? null;

/** The key a draft is stored under for `owner`. */
export const ownedKey = (plainKey: string, owner: string | null = draftOwner()): string => (owner ? `${plainKey}@${owner}` : plainKey);

/** The plain key part of an owned key (`checkout.draft.dev1@u1` -> `checkout.draft.dev1`), and its owner. */
export function splitOwnedKey(key: string): { plainKey: string; owner: string | null } {
  const at = key.lastIndexOf('@');
  return at < 0 ? { plainKey: key, owner: null } : { plainKey: key.slice(0, at), owner: key.slice(at + 1) };
}

/**
 * The key to use for a draft of the current person, after handing them the unowned draft saved before drafts had
 * owners, if there is one and they have none of their own.
 */
export function claimedKey(db: AppDatabase, plainKey: string): string {
  const key = ownedKey(plainKey);
  if (key === plainKey) return key;
  const [legacy] = db.select({ key: settings.key }).from(settings).where(eq(settings.key, plainKey)).all();
  if (legacy) {
    const [mine] = db.select({ key: settings.key }).from(settings).where(eq(settings.key, key)).all();
    if (!mine) db.update(settings).set({ key }).where(eq(settings.key, plainKey)).run();
  }
  return key;
}

/** Deletes a draft for everyone: the unowned one and every person's (`plainKey` and `plainKey@*`). */
export function deleteDraftForEveryone(db: AppDatabase, plainKey: string): void {
  db.delete(settings).where(or(eq(settings.key, plainKey), keyLike(`${escapeLike(plainKey)}@%`))!).run();
}

/** The draft prefixes that hold people's drafts (see above). */
const DRAFT_PREFIXES = ['checkout.draft', 'product.draft.', 'repackage.draft'];

/** Deletes every draft that belongs to `employeeId` (a deactivated user's half-finished work). */
export function deleteDraftsOf(db: AppDatabase, employeeId: string): void {
  for (const prefix of DRAFT_PREFIXES) {
    db.delete(settings).where(and(keyLike(`${escapeLike(prefix)}%`), keyLike(`%@${escapeLike(employeeId)}`))!).run();
  }
}

/** `settings.key LIKE pattern`, with a backslash as the escape character (see `escapeLike`). */
const keyLike = (pattern: string): SQL => sql`${settings.key} LIKE ${pattern} ESCAPE '\\'`;

/** Escapes LIKE's wildcards (and the escape character itself) in a literal part of a pattern. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

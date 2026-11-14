import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { LAN_PAIRING_MS, MAX_DEVICE_NAME } from '@micropos/core';
import type { AppDatabase } from '../db';
import { lanDevices } from '../db/schema';

const hash = (token: string): string => createHash('sha256').update(token).digest('hex');

/** One-time pairing codes (what the QR holds): in memory only, valid for `LAN_PAIRING_MS`, used once. */
export class PairingCodes {
  private readonly codes = new Map<string, number>();

  create(now = Date.now()): { code: string; expiresAt: number } {
    this.prune(now);
    const code = randomBytes(18).toString('base64url');
    const expiresAt = now + LAN_PAIRING_MS;
    this.codes.set(code, expiresAt);
    return { code, expiresAt };
  }

  /** True once for a code that exists and has not expired; the code is then gone. */
  consume(code: unknown, now = Date.now()): boolean {
    this.prune(now);
    if (typeof code !== 'string') return false;
    for (const known of this.codes.keys()) {
      const a = Buffer.from(known);
      const b = Buffer.from(code);
      if (a.length === b.length && timingSafeEqual(a, b)) return this.codes.delete(known);
    }
    return false;
  }

  private prune(now: number): void {
    for (const [code, expiresAt] of this.codes) if (expiresAt <= now) this.codes.delete(code);
  }
}

const cleanName = (name: unknown): string => (typeof name === 'string' ? name.trim().slice(0, MAX_DEVICE_NAME) : '') || 'Device';

/** Pairs a device: a new row and the secret token its browser keeps (shown once; only its hash is stored). */
export function pairDevice(db: AppDatabase, name: unknown, now = Date.now()): { id: string; token: string } {
  const token = randomBytes(32).toString('base64url');
  const id = db.insert(lanDevices).values({ name: cleanName(name), tokenHash: hash(token), pairedAt: now }).returning({ id: lanDevices.id }).get().id;
  return { id, token };
}

/** The device a token belongs to, or null when unknown or unpaired. */
export function deviceForToken(db: AppDatabase, token: unknown): { id: string; name: string } | null {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
  return db.select({ id: lanDevices.id, name: lanDevices.name }).from(lanDevices).where(and(eq(lanDevices.tokenHash, hash(token)), isNull(lanDevices.revokedAt))).get() ?? null;
}

export function touchDevice(db: AppDatabase, id: string, now = Date.now()): void {
  db.update(lanDevices).set({ lastSeenAt: now }).where(eq(lanDevices.id, id)).run();
}

export function listDevices(db: AppDatabase): { id: string; name: string; pairedAt: number; lastSeenAt: number | null }[] {
  return db
    .select({ id: lanDevices.id, name: lanDevices.name, pairedAt: lanDevices.pairedAt, lastSeenAt: lanDevices.lastSeenAt })
    .from(lanDevices)
    .where(isNull(lanDevices.revokedAt))
    .orderBy(desc(lanDevices.pairedAt))
    .all();
}

/** Unpairs a device; false when there is no such paired device. */
export function revokeDevice(db: AppDatabase, id: unknown, now = Date.now()): boolean {
  if (typeof id !== 'string') return false;
  return db.update(lanDevices).set({ revokedAt: now }).where(and(eq(lanDevices.id, id), isNull(lanDevices.revokedAt))).run().changes > 0;
}

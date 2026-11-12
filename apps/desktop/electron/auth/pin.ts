import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Format: scrypt$N$r$p$saltHex$hashHex (parameters are stored so they can be raised later).
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('hex'), hash.toString('hex')].join('$');
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, n, r, p, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

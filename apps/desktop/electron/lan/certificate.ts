import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

/**
 * A self-signed HTTPS certificate for the till's addresses, made with Node's own crypto (no outside packages: the
 * X.509 structure is small). Phones show a one-time warning because nothing vouches for it, but the traffic is
 * encrypted. It is an ECDSA P-256 key, valid for a year (browsers refuse longer for self-signed certificates on some
 * systems), with the addresses as subject alternative names.
 */

// --- a tiny DER writer: just what a certificate needs ---
const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const length = body.length < 128 ? Buffer.from([body.length]) : (() => {
    const bytes: number[] = [];
    for (let n = body.length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  })();
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const seq = (...p: Buffer[]): Buffer => der(0x30, ...p);
const set = (...p: Buffer[]): Buffer => der(0x31, ...p);
const oid = (dotted: string): Buffer => {
  const [a, b, ...rest] = dotted.split('.').map(Number) as [number, number, ...number[]];
  const bytes = [a * 40 + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift((v & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return der(0x06, Buffer.from(bytes));
};
const integer = (bytes: Buffer): Buffer => der(0x02, bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
const utf8 = (text: string): Buffer => der(0x0c, Buffer.from(text, 'utf8'));
const octets = (b: Buffer): Buffer => der(0x04, b);
const bits = (b: Buffer): Buffer => der(0x03, Buffer.concat([Buffer.from([0]), b]));
const bool = (v: boolean): Buffer => der(0x01, Buffer.from([v ? 0xff : 0]));
const explicit = (n: number, ...p: Buffer[]): Buffer => der(0xa0 | n, ...p);
const utcTime = (ms: number): Buffer => {
  const d = new Date(ms);
  const two = (n: number): string => String(n).padStart(2, '0');
  return der(0x17, Buffer.from(`${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`));
};

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const ipBytes = (ip: string): Buffer => Buffer.from(ip.split('.').map(Number));

export interface Certificate {
  key: string;
  cert: string;
  /** The addresses it names. */
  addresses: string[];
  expiresAt: number;
}

export function createCertificate(addresses: readonly string[], now = Date.now()): Certificate {
  const ips = addresses.filter((a) => net.isIPv4(a));
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const name = seq(set(seq(oid('2.5.4.3'), utf8('MicroPOS till'))));
  const notBefore = now - 60 * 60_000; // an hour back: tolerates a phone whose clock is a little behind
  const notAfter = now + 365 * 24 * 60 * 60_000;
  const san = seq(der(0x82, Buffer.from('localhost')), ...ips.map((ip) => der(0x87, ipBytes(ip))));
  const extensions = explicit(
    3,
    seq(
      seq(oid('2.5.29.19'), bool(true), octets(seq(bool(false)))), // not a CA
      seq(oid('2.5.29.15'), bool(true), octets(bits(Buffer.from([0x80])))), // digital signature
      seq(oid('2.5.29.37'), octets(seq(oid('1.3.6.1.5.5.7.3.1')))), // server authentication
      seq(oid('2.5.29.17'), octets(san)),
    ),
  );
  const signatureAlgorithm = seq(oid(ECDSA_SHA256));
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // v3
    integer(randomBytes(16).fill(0x01, 0, 1)), // a positive serial
    signatureAlgorithm,
    name,
    seq(utcTime(notBefore), utcTime(notAfter)),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
    extensions,
  );
  const signature = sign('sha256', tbs, privateKey); // DER-encoded ECDSA signature
  const certDer = seq(tbs, signatureAlgorithm, bits(signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${certDer.toString('base64').replace(/(.{64})/g, '$1\n').trim()}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert: pem, addresses: [...ips], expiresAt: notAfter };
}

/**
 * The saved certificate in `folder` while it is still good for a month and names every current address; otherwise a
 * new one is made and saved. (A new one makes phones show the warning again, so it is kept as long as it fits.)
 */
export function loadOrCreateCertificate(folder: string, addresses: readonly string[], now = Date.now()): Certificate {
  const file = path.join(folder, 'lan-certificate.json');
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Certificate;
    new X509Certificate(saved.cert); // must still parse
    if (saved.expiresAt > now + 30 * 24 * 60 * 60_000 && addresses.every((a) => saved.addresses.includes(a))) return saved;
  } catch {
    // none yet, or unreadable: make one
  }
  const made = createCertificate(addresses, now);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(made), { mode: 0o600 });
  return made;
}

/** A short fingerprint to show next to the pairing code, so the person can tell it is theirs. */
export const fingerprint = (cert: string): string => createHash('sha256').update(new X509Certificate(cert).raw).digest('hex').slice(0, 16).toUpperCase().replace(/(.{4})/g, '$1 ').trim();

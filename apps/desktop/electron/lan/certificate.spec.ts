import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCertificate, fingerprint, loadOrCreateCertificate, publicKeyPin } from './certificate';

describe('self-signed certificate', () => {
  it('is a valid X.509 certificate that signs itself and names the addresses', () => {
    const made = createCertificate(['192.168.1.20', '10.0.0.5']);
    const cert = new X509Certificate(made.cert);
    expect(cert.verify(cert.publicKey)).toBe(true); // self-signed
    expect(cert.subject).toContain('MicroPOS till');
    expect(cert.checkIP('192.168.1.20')).toBe('192.168.1.20');
    expect(cert.checkIP('10.0.0.5')).toBe('10.0.0.5');
    expect(cert.checkIP('192.168.1.99')).toBeUndefined();
    expect(cert.checkHost('localhost')).toBe('localhost');
    expect(cert.ca).toBe(false);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + 300 * 24 * 3600_000);
    expect(fingerprint(made.cert)).toMatch(/^([0-9A-F]{4} ){3}[0-9A-F]{4}$/);
  });

  it('works for a real HTTPS server (a client that trusts it connects and reads)', async () => {
    const made = createCertificate(['127.0.0.1']);
    const server = https.createServer({ key: made.key, cert: made.cert }, (_req, res) => res.end('hello'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, ca: made.cert, servername: 'localhost', checkServerIdentity: () => undefined }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => resolve(text));
      }).on('error', reject);
    });
    server.close();
    expect(body).toBe('hello');
  });

  it('is kept while it still fits (so phones are not warned again) and replaced when an address is new', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-cert-'));
    try {
      const first = loadOrCreateCertificate(dir, ['192.168.1.20']);
      expect(loadOrCreateCertificate(dir, ['192.168.1.20']).cert).toBe(first.cert);
      expect(loadOrCreateCertificate(dir, ['192.168.1.20', '10.1.1.1']).cert).not.toBe(first.cert);
      expect(loadOrCreateCertificate(dir, ['192.168.1.20'], Date.now() + 340 * 24 * 3600_000).cert).not.toBe(first.cert); // nearly expired
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps the same public key (and pin) when it is renewed, so paired phones keep trusting it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-cert-'));
    try {
      const first = loadOrCreateCertificate(dir, ['192.168.1.20']);
      const moved = loadOrCreateCertificate(dir, ['10.1.1.1']); // another address: a new certificate
      expect(moved.cert).not.toBe(first.cert);
      expect(publicKeyPin(moved.cert)).toBe(publicKeyPin(first.cert));
      expect(new X509Certificate(moved.cert).checkIP('10.1.1.1')).toBe('10.1.1.1');
      expect(new X509Certificate(moved.cert).verify(new X509Certificate(moved.cert).publicKey)).toBe(true);
      expect(publicKeyPin(first.cert)).toMatch(/^[0-9a-f]{64}$/);
      expect(publicKeyPin(createCertificate(['192.168.1.20']).cert)).not.toBe(publicKeyPin(first.cert)); // a different key
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

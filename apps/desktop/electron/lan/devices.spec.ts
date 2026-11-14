import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAN_PAIRING_MS } from '@micropos/core';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { deviceForToken, listDevices, PairingCodes, pairDevice, revokeDevice, touchDevice } from './devices';
import { lanAddresses } from './network';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-devices-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
});
afterEach(() => {
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('pairing codes', () => {
  it('work once, and only until they expire', () => {
    const codes = new PairingCodes();
    const { code, expiresAt } = codes.create(1000);
    expect(expiresAt).toBe(1000 + LAN_PAIRING_MS);
    expect(codes.consume(code, 2000)).toBe(true);
    expect(codes.consume(code, 2000)).toBe(false); // used
    const late = codes.create(1000);
    expect(codes.consume(late.code, expiresAt + 1)).toBe(false);
    expect(codes.consume('nope')).toBe(false);
    expect(codes.consume(undefined)).toBe(false);
    expect(codes.create(1).code).not.toBe(codes.create(1).code);
  });
});

describe('paired devices', () => {
  it('pairs a device whose token works until it is unpaired, and keeps only a hash', () => {
    const { id, token } = pairDevice(db, '  iPhone ');
    expect(deviceForToken(db, token)).toEqual({ id, name: 'iPhone' });
    expect(deviceForToken(db, token + 'x')).toBeNull();
    expect(deviceForToken(db, 'short')).toBeNull();
    expect(deviceForToken(db, 5)).toBeNull();
    expect(JSON.stringify(handle.db.$client.prepare('SELECT * FROM lan_devices').all())).not.toContain(token);
    touchDevice(db, id, 5000);
    expect(listDevices(db)).toMatchObject([{ id, name: 'iPhone', lastSeenAt: 5000 }]);
    expect(revokeDevice(db, id)).toBe(true);
    expect(revokeDevice(db, id)).toBe(false);
    expect(deviceForToken(db, token)).toBeNull();
    expect(listDevices(db)).toEqual([]);
  });

  it('names an unnamed device, and tells devices apart by token', () => {
    const a = pairDevice(db, undefined);
    const b = pairDevice(db, 'Tablet');
    expect(deviceForToken(db, a.token)!.name).toBe('Device');
    expect(deviceForToken(db, b.token)!.id).toBe(b.id);
    expect(a.token).not.toBe(b.token);
  });
});

describe('addresses', () => {
  it('lists IPv4 addresses that are not loopback, ordinary shop ranges first', () => {
    const ifaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '203.0.113.9', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
      wlan0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
    } as never;
    expect(lanAddresses(ifaces)).toEqual(['192.168.1.20', '203.0.113.9']);
  });
});

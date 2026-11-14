import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { currentUser, ensureOwner, INITIAL_OWNER_PIN, isAllowed, signIn, signInChoices, signOut } from '../auth/auth';
import { type AppDatabase, createDatabase, SOURCE_MIGRATIONS_FOLDER } from '../db';
import { CHANNELS } from '../ipc/channels';
import { createCertificate } from './certificate';
import { listDevices } from './devices';
import { channelFor, LAN_MARKER, LanServer, type RpcHandler, withMarker } from './server';

let dir: string;
let handle: ReturnType<typeof createDatabase>;
let db: AppDatabase;
let server: LanServer;
let port: number;
let changes: number;
const made = createCertificate(['127.0.0.1']);

/** The handlers a phone may reach, as the till registers them (real sign-in and permission checks). */
const handlers = (): Map<string, RpcHandler> =>
  new Map<string, RpcHandler>([
    [CHANNELS.app.version, () => 99],
    [CHANNELS.auth.status, () => currentUser(db)],
    [CHANNELS.auth.signIn, (_e, input) => signIn(db, input)],
    [CHANNELS.auth.signOut, () => signOut(db)],
    [CHANNELS.users.list, () => (isAllowed(db, ['users.manage']) ? ['secret'] : Promise.reject(new Error('Not allowed')))],
  ]);

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'micropos-lan-'));
  handle = createDatabase(path.join(dir, 'test.db'), { migrationsFolder: SOURCE_MIGRATIONS_FOLDER });
  db = handle.db;
  ensureOwner(db);
  changes = 0;
  const pub = path.join(dir, 'app');
  fs.mkdirSync(pub);
  fs.writeFileSync(path.join(pub, 'index.html'), '<!doctype html><html><head><title>x</title></head><body>app</body></html>');
  fs.writeFileSync(path.join(pub, 'main.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'do not serve');
  server = new LanServer({ db, handlers: handlers(), key: made.key, cert: made.cert, rendererDir: pub, devServerUrl: null, onDevicesChanged: () => (changes += 1) });
  await server.start(0);
  port = ((server as unknown as { server: { address(): { port: number } } }).server.address()).port;
});
afterEach(async () => {
  await server.stop();
  handle.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function request(method: string, url: string, options: { body?: unknown; token?: string } = {}): Promise<{ status: number; text: string; json: () => any }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: url, method, ca: made.cert, servername: 'localhost', checkServerIdentity: () => undefined, headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
const pair = async (name?: string): Promise<string> => {
  const { code } = server.codes.create();
  const res = await request('POST', '/lan/pair', { body: { code, name } });
  expect(res.status).toBe(200);
  return res.json().token as string;
};
const rpc = async (token: string, group: string | null, method: string, ...args: unknown[]) => (await request('POST', '/lan/rpc', { token, body: { group, method, args } })).json();

describe('which calls a device may make', () => {
  it('maps a group and method to a channel, and refuses what belongs to the till', () => {
    expect(channelFor('orders', 'list')).toBe(CHANNELS.orders.list);
    expect(channelFor(null, 'version')).toBe(CHANNELS.app.version);
    for (const [group, method] of [['shell', 'getLogsFolder'], ['debug', 'get'], ['display', 'show'], ['lan', 'setEnabled'], ['reports', 'export'], ['printer', 'settings'], ['printer', 'saveLogo'], ['orders', 'nope'], ['nope', 'x'], ['orders', '__proto__'], ['orders', 'constructor'], [null, 'other'], [5, 'x']] as const) {
      expect(channelFor(group, method), `${group}.${method}`).toBeNull();
    }
    expect(channelFor('printer', 'printOrder')).toBe(CHANNELS.printer.printOrder); // a phone may print a receipt on the till's printer
  });
});

describe('serving the app', () => {
  it('serves the app with the marker, other files as they are, and nothing outside the folder', async () => {
    const index = await request('GET', '/');
    expect(index.status).toBe(200);
    expect(index.text).toContain(LAN_MARKER);
    expect(withMarker(index.text)).toBe(index.text); // not added twice
    expect((await request('GET', '/main.js')).text).toBe('console.log(1)');
    expect((await request('GET', '/anything/else')).text).toContain('app'); // falls back to the app
    expect((await request('GET', '/..%2fsecret.txt')).text).not.toContain('do not serve');
    expect((await request('GET', '/%2e%2e/secret.txt')).text).not.toContain('do not serve');
  });
});

describe('pairing and calls', () => {
  it('pairs with a one-time code, and a used or made-up code is refused', async () => {
    const { code } = server.codes.create();
    const ok = await request('POST', '/lan/pair', { body: { code, name: 'iPhone' } });
    expect(ok.status).toBe(200);
    expect(ok.json().token.length).toBeGreaterThan(30);
    expect(listDevices(db).map((d) => d.name)).toEqual(['iPhone']);
    expect(changes).toBe(1);
    expect((await request('POST', '/lan/pair', { body: { code } })).status).toBe(403); // used
    expect((await request('POST', '/lan/pair', { body: { code: 'made-up' } })).status).toBe(403);
  });

  it('refuses a call without a paired token, and calls from an unpaired device', async () => {
    expect((await request('POST', '/lan/rpc', { body: { group: null, method: 'version', args: [] } })).status).toBe(401);
    expect((await request('POST', '/lan/rpc', { token: 'x'.repeat(40), body: { group: null, method: 'version', args: [] } })).status).toBe(401);
    const token = await pair();
    expect((await rpc(token, null, 'version')).result).toBe(99);
    expect((await request('POST', '/lan/rpc', { token, body: { group: 'shell', method: 'getLogsFolder', args: [] } })).status).toBe(404);
  });

  it('gives each device its own sign-in: one signing in neither signs in the other nor the till', async () => {
    const a = await pair('A');
    const b = await pair('B');
    const owner = signInChoices(db).find((c) => c.name === 'Owner')!;
    expect((await rpc(a, 'auth', 'status')).result).toBeNull();
    const signedIn = await rpc(a, 'auth', 'signIn', { userId: owner.id, pin: INITIAL_OWNER_PIN });
    expect(signedIn.result.ok).toBe(true);
    expect((await rpc(a, 'auth', 'status')).result.name).toBe('Owner');
    expect((await rpc(b, 'auth', 'status')).result).toBeNull(); // the other phone is still locked
    expect(currentUser(db)).toBeNull(); // so is the till
    expect((await rpc(b, 'users', 'list')).error).toBe('Not allowed'); // permission checks run per device
    expect((await rpc(a, 'users', 'list')).result).toEqual(['secret']);
    expect(server.userOf(listDevices(db).find((d) => d.name === 'A')!.id)).toBe('Owner');
    expect((await rpc(a, 'auth', 'signOut')).result).toBeNull();
    expect((await rpc(a, 'auth', 'status')).result).toBeNull();
  });

  it('signs a device out and refuses it once it is unpaired', async () => {
    const token = await pair('A');
    const owner = signInChoices(db).find((c) => c.name === 'Owner')!;
    await rpc(token, 'auth', 'signIn', { userId: owner.id, pin: INITIAL_OWNER_PIN });
    const id = listDevices(db)[0]!.id;
    server.dropDevice(id);
    expect(server.userOf(id)).toBeNull();
  });
});

describe('live updates', () => {
  const connect = (token: string): Promise<{ ws: WebSocket; messages: any[] }> =>
    new Promise((resolve, reject) => {
      const messages: any[] = [];
      const ws = new WebSocket(`wss://127.0.0.1:${port}/lan/ws`, { ca: made.cert, servername: 'localhost', checkServerIdentity: () => undefined });
      ws.on('message', (d) => {
        const m = JSON.parse(String(d));
        messages.push(m);
        if (m.type === 'ready') resolve({ ws, messages });
      });
      ws.on('open', () => ws.send(JSON.stringify({ token })));
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
      ws.on('error', reject);
    });
  const until = async (check: () => boolean): Promise<void> => {
    for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };

  it('tells a connected device which data changed, shows it online, and closes it when unpaired', async () => {
    const token = await pair('A');
    const id = listDevices(db)[0]!.id;
    const { ws, messages } = await connect(token);
    expect(server.isOnline(id)).toBe(true);
    server.broadcast(['sales', 'stock']);
    await until(() => messages.some((m) => m.type === 'changed'));
    expect(messages.find((m) => m.type === 'changed').domains).toEqual(['sales', 'stock']);
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)));
    server.dropDevice(id);
    expect(await closed).toBe(4001);
    await until(() => !server.isOnline(id));
  });

  it('refuses a socket without a good token', async () => {
    await expect(connect('x'.repeat(40))).rejects.toThrow('closed 4001');
  });
});

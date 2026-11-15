import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Changes, createRemoteApi, TillClient, UNREACHABLE, UnpairedError, type Deps, type Pairing } from './client';
import { pairWithTill } from './pair';

const pairing: Pairing = { host: '192.168.1.20', port: 8734, token: 'secret', pin: 'a'.repeat(64), deviceId: 'dev1', name: 'MicroPOS Android app' };

const reply = (status: number, body: unknown) => Promise.resolve({ status, json: () => Promise.resolve(body) } as Response);

describe('pairWithTill', () => {
  it('sets the pin before the first request and returns the till\'s token', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      order.push('fetch');
      expect(url).toBe('https://192.168.1.20:8734/lan/pair');
      expect(JSON.parse(String(init?.body))).toEqual({ code: 'abc', name: 'MicroPOS Android app' });
      return reply(200, { token: 'tok', id: 'dev1', name: 'Counter phone' });
    });
    const result = await pairWithTill({ host: '192.168.1.20', port: 8734, code: 'abc', pin: pairing.pin }, { fetch: fetchMock as unknown as typeof fetch, setPin: () => order.push('pin') });
    expect(order).toEqual(['pin', 'fetch']);
    expect(result).toEqual({ host: '192.168.1.20', port: 8734, token: 'tok', pin: pairing.pin, deviceId: 'dev1', name: 'Counter phone' });
  });

  it('shows the till\'s reason for a refused code and puts the old pin back', async () => {
    const pins: (string | null)[] = [];
    const fetchMock = vi.fn(() => reply(403, { error: 'This QR code has expired or was already used. Make a new one on the till.' }));
    await expect(
      pairWithTill({ host: 'h', port: 1, code: 'x', pin: 'b'.repeat(64) }, { fetch: fetchMock as unknown as typeof fetch, setPin: (p) => pins.push(p), previousPin: 'old' }),
    ).rejects.toThrow('expired or was already used');
    expect(pins).toEqual(['b'.repeat(64), 'old']);
  });

  it('turns a network failure (or a certificate that is not the till\'s) into a readable message', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Network request failed')));
    await expect(pairWithTill({ host: 'h', port: 1, code: 'x', pin: pairing.pin }, { fetch: fetchMock as unknown as typeof fetch, setPin: () => undefined })).rejects.toThrow(UNREACHABLE);
  });
});

describe('TillClient.call', () => {
  const clientWith = (response: () => Promise<Response>, onUnpaired = vi.fn()) => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => response());
    return { client: new TillClient(pairing, { fetch: fetchMock as unknown as typeof fetch }, onUnpaired), fetchMock, onUnpaired };
  };

  it('posts group, method and args with the bearer token and returns the result', async () => {
    const { client, fetchMock } = clientWith(() => reply(200, { result: [1, 2] }));
    await expect(client.call('orders', 'list', ['x'])).resolves.toEqual([1, 2]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://192.168.1.20:8734/lan/rpc');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(String(init!.body))).toEqual({ group: 'orders', method: 'list', args: ['x'] });
  });
  it('rejects with the till\'s message when a call is refused', async () => {
    const { client } = clientWith(() => reply(200, { error: 'Not allowed' }));
    await expect(client.call('users', 'list', [])).rejects.toThrow('Not allowed');
  });
  it('treats 401 as unpaired: tells the app and rejects', async () => {
    const { client, onUnpaired } = clientWith(() => reply(401, { error: 'This device is not paired' }));
    await expect(client.call(null, 'version', [])).rejects.toBeInstanceOf(UnpairedError);
    expect(onUnpaired).toHaveBeenCalledOnce();
  });
  it('says so when the till cannot be reached', async () => {
    const { client } = clientWith(() => Promise.reject(new TypeError('Network request failed')));
    await expect(client.call('orders', 'list', [])).rejects.toThrow(UNREACHABLE);
  });
});

describe('createRemoteApi', () => {
  it('sends api.<group>.<method>(...) to the till and answers the till-only parts locally', async () => {
    const calls: unknown[] = [];
    const client = { call: (g: string | null, m: string, a: unknown[]) => (calls.push([g, m, a]), Promise.resolve('ok')), changes: { add: () => () => undefined } } as unknown as TillClient;
    const api = createRemoteApi(client) as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>> & { version: () => unknown; platform: string };
    await expect(api.orders!.list!(1, 2)).resolves.toBe('ok');
    await api.version();
    expect(calls).toEqual([['orders', 'list', [1, 2]], [null, 'version', []]]);
    await expect(api.display!.isOpen!()).resolves.toBe(false); // the till's own second screen: not asked
    expect(api.platform).toBe('android');
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

describe('Changes (live updates)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.all = [];
  });
  afterEach(() => vi.useRealTimers());
  const deps = { WebSocket: FakeSocket as unknown as typeof WebSocket } satisfies Deps;

  it('connects to wss, sends the token, and passes on what changed', () => {
    const changes = new Changes(pairing, deps, vi.fn());
    const heard: string[][] = [];
    changes.add((d) => heard.push(d));
    const socket = FakeSocket.all[0]!;
    expect(socket.url).toBe('wss://192.168.1.20:8734/lan/ws');
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ token: 'secret' });
    socket.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
    expect(changes.online).toBe(true);
    socket.onmessage?.({ data: JSON.stringify({ type: 'changed', domains: ['stock'] }) });
    expect(heard).toEqual([['stock']]);
  });

  it('reconnects with a growing delay and asks everyone to refresh once it is back', () => {
    const changes = new Changes(pairing, deps, vi.fn());
    const heard: string[][] = [];
    changes.add((d) => heard.push(d));
    FakeSocket.all[0]!.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
    FakeSocket.all[0]!.onclose?.({ code: 1006 });
    expect(changes.online).toBe(false);
    vi.advanceTimersByTime(499);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1]!.onclose?.({ code: 1006 }); // fails again: waits longer
    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
    FakeSocket.all[2]!.onmessage?.({ data: JSON.stringify({ type: 'ready' }) });
    expect(heard).toHaveLength(1); // a refresh of every domain
    expect(heard[0]!.length).toBeGreaterThan(1);
  });

  it('stops and tells the app when the till unpairs the device (code 4001)', () => {
    const onUnpaired = vi.fn();
    const changes = new Changes(pairing, deps, onUnpaired);
    changes.add(() => undefined);
    FakeSocket.all[0]!.onclose?.({ code: 4001 });
    expect(onUnpaired).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1); // no reconnect
  });

  it('closes the connection when the last listener goes, without reconnecting', () => {
    const changes = new Changes(pairing, deps, vi.fn());
    const stop = changes.add(() => undefined);
    stop();
    expect(FakeSocket.all[0]!.closed).toBe(true);
    FakeSocket.all[0]!.onclose?.({ code: 1000 });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});

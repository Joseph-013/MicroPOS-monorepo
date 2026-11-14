import { createRemoteApi, forgetPairing, isPaired, pairFromAddress, showNotPaired } from './remote-api';

describe('remote api (a paired device)', () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let reply: (url: string) => { status?: number; body: unknown };
  beforeEach(() => {
    localStorage.clear();
    calls.length = 0;
    reply = () => ({ body: { result: null } });
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = reply(url);
      return Promise.resolve({ ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: () => Promise.resolve(r.body) });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
  });

  it('turns a pairing code in the address into a token, and removes the code from the address', async () => {
    history.replaceState(null, '', '/?pair=abc123#/checkout');
    reply = () => ({ body: { token: 'T'.repeat(40), id: 'd1' } });
    expect(await pairFromAddress()).toEqual({ state: 'paired' });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ code: 'abc123' });
    expect(isPaired()).toBe(true);
    expect(location.search).toBe('');
    expect(location.hash).toBe('#/checkout');
  });

  it('says so when the code was refused or there is nothing to go on', async () => {
    expect(await pairFromAddress()).toEqual({ state: 'not-paired' });
    history.replaceState(null, '', '/?pair=old');
    reply = () => ({ status: 403, body: { error: 'This QR code has expired' } });
    expect(await pairFromAddress()).toEqual({ state: 'refused', error: 'This QR code has expired' });
    expect(isPaired()).toBe(false);
    localStorage.setItem('micropos.lanToken', 'x'.repeat(40));
    history.replaceState(null, '', '/');
    expect(await pairFromAddress()).toEqual({ state: 'paired' }); // paired earlier
  });

  it('makes every call the preload would make over the network, with the token, and returns what the till answers', async () => {
    localStorage.setItem('micropos.lanToken', 'T'.repeat(40));
    reply = (url) => ({ body: { result: url === '/lan/rpc' ? [1, 2] : null } });
    const api = createRemoteApi();
    expect(await api.orders.list()).toEqual([1, 2]);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ group: 'orders', method: 'list', args: [] });
    expect((calls[0]!.init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${'T'.repeat(40)}`);
    await api.version();
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ group: null, method: 'version', args: [] });
    await api.products.update('p1', { name: 'x' } as never);
    expect(JSON.parse(calls[2]!.init.body as string)).toEqual({ group: 'products', method: 'update', args: ['p1', { name: 'x' }] });
    expect((api as unknown as { then?: unknown }).then).toBeUndefined(); // never mistaken for a promise
  });

  it('rejects with what the till refused, like an IPC call', async () => {
    localStorage.setItem('micropos.lanToken', 'T'.repeat(40));
    reply = () => ({ body: { error: 'Not allowed' } });
    await expect(createRemoteApi().users.list()).rejects.toThrow('Not allowed');
  });

  it('answers harmlessly for what belongs to the till itself (customer display, scanner)', async () => {
    const api = createRemoteApi();
    expect(await api.display.isOpen()).toBe(false);
    expect(api.display.onVisibility(() => undefined)).toBeTypeOf('function');
    await api.scanner.setEnabled(true);
    expect(calls).toHaveLength(0); // nothing went over the network
  });

  it('forgets the pairing, and shows how to pair when there is none', () => {
    localStorage.setItem('micropos.lanToken', 'T'.repeat(40));
    forgetPairing();
    expect(isPaired()).toBe(false);
    const host = document.createElement('div');
    showNotPaired(host, 'This QR code has expired');
    expect(host.textContent).toContain('This device is not paired');
    expect(host.textContent).toContain('Pair a device');
    expect(host.textContent).toContain('This QR code has expired');
  });
});

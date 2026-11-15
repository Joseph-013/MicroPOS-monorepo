import { DATA_DOMAINS, type DataDomain, type DesktopApi, IDLE_DISPLAY_STATE } from '@micropos/core';

/**
 * The phone's side of the till's network protocol (see "Devices" in apps/desktop/CLAUDE.md): `POST /lan/pair` trades a
 * one-time code for a token, `POST /lan/rpc` runs a call as the desktop's own window would, and `/lan/ws` pushes which
 * parts of the data changed. HTTPS to the till is trusted by the pin from the pairing code (modules/micropos-tls).
 */
export interface Pairing {
  host: string;
  port: number;
  /** Secret that identifies this device to the till. */
  token: string;
  /** The till's public-key hash the connection is pinned to. */
  pin: string;
  deviceId: string;
  name: string;
}

export interface Deps {
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
}

const REQUEST_TIMEOUT_MS = 20_000;
export const UNREACHABLE = 'Could not reach the till. Is this device on the shop network?';

/** Raised when the till no longer knows this device (it was unpaired there). */
export class UnpairedError extends Error {
  constructor() {
    super('This device is no longer paired with the till');
  }
}

export const baseUrl = (p: Pick<Pairing, 'host' | 'port'>): string => `https://${p.host}:${p.port}`;

/** POST JSON with a timeout; a network failure becomes the readable `UNREACHABLE` error. */
export async function postJson(deps: Deps, url: string, body: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown> | null;
    return { status: res.status, body: parsed ?? {} };
  } catch {
    throw new Error(UNREACHABLE);
  } finally {
    clearTimeout(timer);
  }
}

type Listener = (domains: DataDomain[]) => void;

/** One WebSocket shared by every listener, reconnecting (and asking everyone to refresh) when it drops. */
export class Changes {
  private readonly listeners = new Set<Listener>();
  private readonly statusListeners = new Set<(online: boolean) => void>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private delay = 500;
  online = false;

  constructor(
    private readonly pairing: Pairing,
    private readonly deps: Deps,
    private readonly onUnpaired: () => void,
  ) {}

  add(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.socket) this.open();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size && !this.statusListeners.size) this.close();
    };
  }

  /** Follows whether the live connection is up; keeps the connection open while anyone listens. */
  onStatus(listener: (online: boolean) => void): () => void {
    this.statusListeners.add(listener);
    if (!this.socket) this.open();
    listener(this.online);
    return () => {
      this.statusListeners.delete(listener);
      if (!this.listeners.size && !this.statusListeners.size) this.close();
    };
  }

  private setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    for (const l of [...this.statusListeners]) l(online);
  }

  private open(): void {
    const Socket = this.deps.WebSocket ?? WebSocket;
    const socket = new Socket(`wss://${this.pairing.host}:${this.pairing.port}/lan/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ token: this.pairing.token }));
    socket.onmessage = (event) => {
      let message: { type?: string; domains?: DataDomain[] };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === 'ready') {
        const reconnected = this.delay !== 500;
        this.delay = 500;
        this.setOnline(true);
        if (reconnected) this.emit([...DATA_DOMAINS]); // anything may have changed while the connection was down
      } else if (message.type === 'changed' && message.domains) this.emit(message.domains);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return; // closed on purpose
      this.socket = null;
      this.setOnline(false);
      if (event.code === 4001) {
        this.onUnpaired();
        return;
      }
      if (!this.listeners.size && !this.statusListeners.size) return;
      this.retry = setTimeout(() => this.open(), this.delay);
      this.delay = Math.min(this.delay * 2, 10_000);
    };
    socket.onerror = () => undefined; // onclose follows and handles the retry
  }

  close(): void {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setOnline(false);
  }

  private emit(domains: DataDomain[]): void {
    for (const listener of [...this.listeners]) listener(domains);
  }
}

export class TillClient {
  readonly changes: Changes;

  constructor(
    readonly pairing: Pairing,
    private readonly deps: Deps = {},
    private readonly onUnpaired: () => void = () => undefined,
  ) {
    this.changes = new Changes(pairing, deps, onUnpaired);
  }

  /** Runs `group.method(...args)` on the till. A refused call rejects with the till's own message, like IPC. */
  async call(group: string | null, method: string, args: unknown[]): Promise<unknown> {
    const { status, body } = await postJson(this.deps, `${baseUrl(this.pairing)}/lan/rpc`, { group, method, args }, this.pairing.token);
    if (status === 401) {
      this.onUnpaired();
      throw new UnpairedError();
    }
    if (typeof body.error === 'string') throw new Error(body.error);
    if (status === 404) throw new Error('Not available on this device');
    return body.result;
  }
}

const none = (): void => undefined;
/** What belongs to the till's own hardware and windows has no meaning on a phone: harmless answers instead of errors. */
const LOCAL_ONLY: Record<string, Record<string, unknown>> = {
  display: { show: () => Promise.resolve(), hide: () => Promise.resolve(), isOpen: () => Promise.resolve(false), onVisibility: () => none, publish: () => Promise.resolve(), getState: () => Promise.resolve(IDLE_DISPLAY_STATE), onState: () => none },
  scanner: { onScan: () => none, setEnabled: () => Promise.resolve() },
};

/** The same `DesktopApi` the desktop's window has, spoken to the till over the network. */
export function createRemoteApi(client: TillClient): DesktopApi {
  const groups = new Map<string, unknown>();
  const group = (name: string): unknown => {
    let made = groups.get(name);
    if (!made) {
      made = new Proxy(
        {},
        {
          get: (_target, method) => {
            if (typeof method !== 'string' || method === 'then') return undefined;
            if (name === 'data' && method === 'onChanged') return (listener: Listener) => client.changes.add(listener);
            const local = LOCAL_ONLY[name]?.[method];
            if (local !== undefined) return local;
            return (...args: unknown[]) => client.call(name, method, args);
          },
        },
      );
      groups.set(name, made);
    }
    return made;
  };
  return new Proxy({} as DesktopApi, {
    get: (_target, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (prop === 'platform') return 'android';
      if (prop === 'version') return () => client.call(null, 'version', []);
      return group(prop);
    },
  });
}

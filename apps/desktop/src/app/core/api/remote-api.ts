import { DATA_DOMAINS, type DataDomain, type DesktopApi, IDLE_DISPLAY_STATE } from '@micropos/core';

/**
 * The app opened in a phone's or tablet's browser from the till's address (https://<till>:8734): there is no Electron
 * here, so every call the preload would make over IPC goes to the till over HTTPS instead (`POST /lan/rpc`), and the
 * till pushes data changes over a WebSocket (`/lan/ws`). The server marks its page with `window.__MICROPOS_LAN__`.
 * A device is paired once by scanning the QR code shown on the till (Devices): the code in the address becomes a secret
 * token kept in this browser.
 */
const TOKEN_KEY = 'micropos.lanToken';

declare global {
  interface Window {
    /** Set by the till's server in the page it serves to other devices. */
    __MICROPOS_LAN__?: boolean;
  }
}

/** True in a browser that was served by a till (not in the Electron window, and not in a plain browser tab on a dev machine). */
export const isLanDevice = (): boolean => window.__MICROPOS_LAN__ === true && !window.micropos;

const readToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const isPaired = (): boolean => readToken() !== null;
export function forgetPairing(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
}

/**
 * Before the app starts: when the address carries a pairing code (`?pair=...`, from the QR), trades it for this
 * device's token and removes it from the address. 'paired' (now or before), 'not-paired' (nothing to go on), or
 * 'refused' with the till's reason (an expired or used code).
 */
export async function pairFromAddress(): Promise<{ state: 'paired' | 'not-paired' } | { state: 'refused'; error: string }> {
  const url = new URL(location.href);
  const code = url.searchParams.get('pair');
  if (!code) return { state: isPaired() ? 'paired' : 'not-paired' };
  try {
    const res = await fetch('/lan/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const body = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !body.token) return { state: 'refused', error: body.error ?? 'Could not pair' };
    localStorage.setItem(TOKEN_KEY, body.token);
    url.searchParams.delete('pair');
    url.searchParams.delete('fp'); // the mobile app's pin of the certificate; a browser has no use for it
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    return { state: 'paired' };
  } catch {
    return { state: 'refused', error: 'Could not reach the till. Is this device on the shop network?' };
  }
}

type Listener = (domains: DataDomain[]) => void;

/** One WebSocket shared by every listener, reconnecting (and asking everyone to refresh) when it drops. */
class Changes {
  private readonly listeners = new Set<Listener>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private delay = 500;

  add(listener: Listener): () => void {
    this.listeners.add(listener);
    if (!this.socket) this.open();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) this.close();
    };
  }

  private open(): void {
    const token = readToken();
    if (!token) return;
    const socket = new WebSocket(`wss://${location.host}/lan/ws`);
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ token }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type?: string; domains?: DataDomain[] };
      if (message.type === 'ready') {
        const reconnected = this.delay !== 500;
        this.delay = 500;
        if (reconnected) this.emit([...DATA_DOMAINS]); // anything may have changed while the connection was down
      } else if (message.type === 'changed' && message.domains) this.emit(message.domains);
    };
    socket.onclose = (event) => {
      this.socket = null;
      if (event.code === 4001) {
        forgetPairing(); // unpaired on the till: back to the "not paired" page
        location.reload();
        return;
      }
      if (!this.listeners.size) return;
      this.retry = setTimeout(() => this.open(), this.delay);
      this.delay = Math.min(this.delay * 2, 10_000);
    };
  }

  private close(): void {
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = null;
  }

  private emit(domains: DataDomain[]): void {
    for (const listener of [...this.listeners]) listener(domains);
  }
}

/** Raised when the till no longer knows this device (it was unpaired). */
export class UnpairedError extends Error {
  constructor() {
    super('This device is no longer paired with the till');
  }
}

async function call(group: string | null, method: string, args: unknown[]): Promise<unknown> {
  const token = readToken();
  if (!token) throw new UnpairedError();
  const res = await fetch('/lan/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ group, method, args }) });
  if (res.status === 401) {
    forgetPairing();
    location.reload(); // shows the "not paired" page
    throw new UnpairedError();
  }
  const body = (await res.json()) as { result?: unknown; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result;
}

const none = (): void => undefined;
/** What belongs to the till's own hardware and windows has no meaning on a phone: harmless answers instead of errors. */
const LOCAL_ONLY: Record<string, Record<string, unknown>> = {
  display: { show: () => Promise.resolve(), hide: () => Promise.resolve(), isOpen: () => Promise.resolve(false), onVisibility: () => none, publish: () => Promise.resolve(), getState: () => Promise.resolve(IDLE_DISPLAY_STATE), onState: () => none },
  scanner: { onScan: () => none, setEnabled: () => Promise.resolve() },
};

/** The same `DesktopApi` the Electron preload gives the window, spoken to the till over the network. */
export function createRemoteApi(): DesktopApi {
  const changes = new Changes();
  const groups = new Map<string, unknown>();
  const group = (name: string): unknown => {
    let made = groups.get(name);
    if (!made) {
      made = new Proxy(
        {},
        {
          get: (_target, method) => {
            if (typeof method !== 'string' || method === 'then') return undefined;
            if (name === 'data' && method === 'onChanged') return (listener: Listener) => changes.add(listener);
            const local = LOCAL_ONLY[name]?.[method];
            if (local !== undefined) return local;
            return (...args: unknown[]) => call(name, method, args);
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
      if (prop === 'platform') return 'linux';
      if (prop === 'version') return () => call(null, 'version', []);
      return group(prop);
    },
  });
}

/** The page for a device that is not paired (or whose QR code did not work): what to do, without starting the app. */
export function showNotPaired(host: HTMLElement, problem: string | null): void {
  host.innerHTML = '';
  const box = document.createElement('div');
  box.setAttribute('style', 'font-family:system-ui,sans-serif;max-width:26rem;margin:15vh auto;padding:1.5rem;text-align:center;line-height:1.5');
  const title = document.createElement('h1');
  title.textContent = 'This device is not paired';
  title.setAttribute('style', 'font-size:1.4rem;margin:0 0 .75rem');
  const how = document.createElement('p');
  how.textContent = 'On the till, open Devices and press Pair a device, then scan the QR code with this device\u2019s camera.';
  box.append(title, how);
  if (problem) {
    const why = document.createElement('p');
    why.textContent = problem;
    why.setAttribute('style', 'color:#b91c1c');
    box.append(why);
  }
  host.append(box);
}

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { type DataDomain, deviceNameFromAgent } from '@micropos/core';
import { WebSocket, WebSocketServer } from 'ws';
import { endSession, currentUser } from '../auth/auth';
import { newSessionState, runAsSession, type SessionState } from '../auth/context';
import type { AppDatabase } from '../db';
import { log } from '../logging';
import { CHANNELS } from '../ipc/channels';
import { deviceForToken, PairingCodes, pairDevice, touchDevice } from './devices';

/** A handler as registered for the till's own window; called here for a paired device with a stand-in event. */
export type RpcHandler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * What a paired device may not call: things that belong to the till itself (its window, printer setup, files and
 * folders on its disk, the customer display, this server's own settings).
 */
const DENIED_GROUPS = new Set(['shell', 'debug', 'display', 'scanner', 'lan', 'backup']);
const DENIED_CHANNELS = new Set<string>([
  CHANNELS.reports.export,
  CHANNELS.printer.settings,
  CHANNELS.printer.save,
  CHANNELS.printer.getLogo,
  CHANNELS.printer.saveLogo,
  CHANNELS.printer.removeLogo,
  CHANNELS.printer.listUsb,
  CHANNELS.printer.testPrint,
]);

/** The channel for a call from a device, or null when it is not one a device may make. `group` null is a top-level call (`version`). */
export function channelFor(group: unknown, method: unknown): string | null {
  if (typeof method !== 'string') return null;
  if (group === null) return method === 'version' ? CHANNELS.app.version : null;
  if (typeof group !== 'string' || DENIED_GROUPS.has(group)) return null;
  const channels = (CHANNELS as Record<string, Record<string, string> | undefined>)[group];
  const channel = channels && Object.hasOwn(channels, method) ? channels[method] : undefined;
  return typeof channel === 'string' && !DENIED_CHANNELS.has(channel) ? channel : null;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

/** Tells the app it is being served by the till (so it talks to it over the network, and says so when not paired). */
export const LAN_MARKER = '<script>window.__MICROPOS_LAN__=true</script>';
export const withMarker = (html: string): string => (html.includes(LAN_MARKER) ? html : html.replace(/<head>/i, `<head>${LAN_MARKER}`));

const MAX_BODY = 4 * 1024 * 1024;
const PAIR_ATTEMPTS = { perMinute: 10 };

export interface LanServerOptions {
  db: AppDatabase;
  handlers: ReadonlyMap<string, RpcHandler>;
  key: string;
  cert: string;
  /** The built app to serve (a packaged build), or null in development, where `devServerUrl` is proxied. */
  rendererDir: string | null;
  devServerUrl: string | null;
  /** The devices list changed (paired, unpaired, went online or offline). */
  onDevicesChanged: () => void;
}

/**
 * The till's server for other devices on the network, over HTTPS (a self-signed certificate):
 * - the app itself (static files; the first page carries `LAN_MARKER`),
 * - `POST /lan/pair` {code, name}: a QR code's one-time code becomes the device's token,
 * - `POST /lan/rpc` {group, method, args} with `Authorization: Bearer <token>`: the same calls the till's window makes
 *   over IPC, run as the device's own session (its own PIN sign-in, see `auth/context.ts`),
 * - `/lan/ws`: the device authenticates with its token and is told which parts of the data changed.
 */
export class LanServer {
  private server: https.Server | null = null;
  private readonly sockets = new WebSocketServer({ noServer: true });
  private readonly clients = new Map<string, Set<WebSocket>>();
  private readonly sessions = new Map<string, SessionState>();
  private readonly attempts = new Map<string, number[]>();
  readonly codes = new PairingCodes();
  private ping: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: LanServerOptions) {}

  get running(): boolean {
    return this.server?.listening === true;
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = https.createServer({ key: this.options.key, cert: this.options.cert }, (req, res) => {
        void this.handle(req, res).catch((error: unknown) => {
          log.error('lan', 'Request failed', error);
          if (!res.headersSent) res.writeHead(500).end();
          else res.end();
        });
      });
      server.on('upgrade', (req, socket, head) => this.upgrade(req, socket, head));
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => {
        server.off('error', reject);
        server.on('error', (error) => log.error('lan', 'Server error', error));
        this.server = server;
        this.ping = setInterval(() => this.heartbeat(), 30_000);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    clearInterval(this.ping);
    for (const set of this.clients.values()) for (const socket of set) socket.terminate();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve())));
  }

  /** Tells every connected device that these parts of the data changed. */
  broadcast(domains: readonly DataDomain[]): void {
    const message = JSON.stringify({ type: 'changed', domains });
    for (const set of this.clients.values()) for (const socket of set) if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }

  isOnline(deviceId: string): boolean {
    return (this.clients.get(deviceId)?.size ?? 0) > 0;
  }

  /** Who is signed in on a device, if anyone. */
  userOf(deviceId: string): string | null {
    const state = this.sessions.get(deviceId);
    return state ? (runAsSession(state, () => currentUser(this.options.db))?.name ?? null) : null;
  }

  /** Signs a device out and drops its connections (it was unpaired). */
  dropDevice(deviceId: string): void {
    const state = this.sessions.get(deviceId);
    if (state) runAsSession(state, () => endSession(this.options.db));
    this.sessions.delete(deviceId);
    for (const socket of this.clients.get(deviceId) ?? []) socket.close(4001, 'Unpaired');
    this.clients.delete(deviceId);
  }

  // --- requests ---

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'https://till');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (url.pathname === '/lan/pair' && req.method === 'POST') return this.pair(req, res);
    if (url.pathname === '/lan/rpc' && req.method === 'POST') return this.rpc(req, res);
    if (url.pathname.startsWith('/lan/')) return void res.writeHead(404).end();
    if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405).end();
    if (this.options.rendererDir) return this.serveFile(url.pathname, res, req.method === 'HEAD');
    if (this.options.devServerUrl) return this.proxyDev(req, res, url);
    res.writeHead(404).end();
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body ?? null));
  }

  private async body(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new Error('Request too large');
      chunks.push(chunk as Buffer);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return null;
    }
  }

  private tooManyAttempts(address: string, now = Date.now()): boolean {
    const recent = (this.attempts.get(address) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.attempts.set(address, recent);
    return recent.length > PAIR_ATTEMPTS.perMinute;
  }

  private async pair(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (this.tooManyAttempts(req.socket.remoteAddress ?? '')) return this.json(res, 429, { error: 'Too many tries. Wait a minute.' });
    const input = (await this.body(req)) as { code?: unknown; name?: unknown } | null;
    if (!this.codes.consume(input?.code)) return this.json(res, 403, { error: 'This QR code has expired or was already used. Make a new one on the till.' });
    const name = typeof input?.name === 'string' && input.name.trim() ? input.name : deviceNameFromAgent(req.headers['user-agent'] ?? '');
    const device = pairDevice(this.options.db, name);
    log.info('lan', `Paired a device (${name})`);
    this.options.onDevicesChanged();
    this.json(res, 200, { token: device.token, id: device.id, name });
  }

  private deviceOf(req: http.IncomingMessage): { id: string; name: string } | null {
    const header = req.headers.authorization ?? '';
    return deviceForToken(this.options.db, header.startsWith('Bearer ') ? header.slice(7) : null);
  }

  private stateOf(deviceId: string): SessionState {
    let state = this.sessions.get(deviceId);
    if (!state) this.sessions.set(deviceId, (state = newSessionState(deviceId)));
    return state;
  }

  private async rpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const device = this.deviceOf(req);
    if (!device) return this.json(res, 401, { error: 'This device is not paired' });
    touchDevice(this.options.db, device.id);
    const input = (await this.body(req)) as { group?: unknown; method?: unknown; args?: unknown } | null;
    const channel = channelFor(input?.group ?? null, input?.method);
    const handler = channel ? this.options.handlers.get(channel) : undefined;
    if (!channel || !handler) return this.json(res, 404, { error: 'Not available on this device' });
    const args = Array.isArray(input?.args) ? input.args : [];
    try {
      const result = await runAsSession(this.stateOf(device.id), async () => handler({ sender: null }, ...args));
      this.json(res, 200, { result: result ?? null });
    } catch (error) {
      // Same as the till's window: a refused call (not signed in, not allowed) rejects with its message.
      this.json(res, 200, { error: error instanceof Error ? error.message : 'Something went wrong' });
    }
  }

  // --- the app itself ---

  private serveFile(pathname: string, res: http.ServerResponse, headOnly: boolean): void {
    const root = this.options.rendererDir!;
    let relative: string;
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      return void res.writeHead(400).end();
    }
    const file = path.resolve(root, '.' + path.posix.normalize('/' + relative));
    if (!file.startsWith(root + path.sep) && file !== root) return void res.writeHead(403).end();
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, 'index.html');
    const isIndex = path.basename(target) === 'index.html';
    let data: Buffer | string;
    try {
      data = fs.readFileSync(target);
    } catch {
      return void res.writeHead(404).end();
    }
    if (isIndex) data = withMarker(data.toString('utf8'));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=3600' });
    res.end(headOnly ? undefined : data);
  }

  /** Development: the Angular dev server's pages, so a phone can try the app while it is being built. */
  private proxyDev(req: http.IncomingMessage, res: http.ServerResponse, url: URL): void {
    const target = new URL(url.pathname + url.search, this.options.devServerUrl!);
    const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host, 'accept-encoding': 'identity' } }, (response) => {
      const type = String(response.headers['content-type'] ?? '');
      if (!type.includes('text/html')) {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (c: Buffer) => chunks.push(c));
      response.on('end', () => {
        const html = withMarker(Buffer.concat(chunks).toString('utf8'));
        const headers = { ...response.headers, 'content-length': String(Buffer.byteLength(html)) };
        res.writeHead(response.statusCode ?? 200, headers).end(html);
      });
    });
    upstream.on('error', () => (res.headersSent ? res.end() : res.writeHead(502).end('The development server is not running')));
    req.pipe(upstream);
  }

  // --- live updates ---

  private upgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (new URL(req.url ?? '/', 'https://till').pathname !== '/lan/ws') return void socket.destroy();
    this.sockets.handleUpgrade(req, socket, head, (ws) => {
      let deviceId: string | null = null;
      const timer = setTimeout(() => ws.close(4000, 'No token'), 10_000);
      ws.once('message', (data) => {
        clearTimeout(timer);
        let token: unknown;
        try {
          token = (JSON.parse(String(data)) as { token?: unknown }).token;
        } catch {
          token = null;
        }
        const device = deviceForToken(this.options.db, token);
        if (!device) return ws.close(4001, 'Not paired');
        deviceId = device.id;
        const set = this.clients.get(device.id) ?? new Set<WebSocket>();
        set.add(ws);
        this.clients.set(device.id, set);
        (ws as WebSocket & { alive?: boolean }).alive = true;
        ws.send(JSON.stringify({ type: 'ready' }));
        this.options.onDevicesChanged();
      });
      ws.on('pong', () => ((ws as WebSocket & { alive?: boolean }).alive = true));
      ws.on('close', () => {
        clearTimeout(timer);
        if (!deviceId) return;
        const set = this.clients.get(deviceId);
        set?.delete(ws);
        if (set && set.size === 0) this.clients.delete(deviceId);
        this.options.onDevicesChanged();
      });
      ws.on('error', () => ws.terminate());
    });
  }

  private heartbeat(): void {
    for (const set of this.clients.values()) {
      for (const socket of set) {
        const tracked = socket as WebSocket & { alive?: boolean };
        if (tracked.alive === false) socket.terminate();
        else {
          tracked.alive = false;
          socket.ping();
        }
      }
    }
  }
}

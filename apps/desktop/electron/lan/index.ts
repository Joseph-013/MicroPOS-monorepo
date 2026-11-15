import { eq } from 'drizzle-orm';
import { type DataDomain, LAN_DEFAULT_PORT, type LanDevice, type LanPairing, type LanState } from '@micropos/core';
import type { AppDatabase } from '../db';
import { settings } from '../db/schema';
import { draftKey } from '../db/queries/draft';
import { log } from '../logging';
import { loadOrCreateCertificate, publicKeyPin } from './certificate';
import { listDevices, revokeDevice } from './devices';
import { lanAddresses } from './network';
import { LanServer, type RpcHandler } from './server';

const KEY = 'lan';

export const isLanEnabled = (db: AppDatabase): boolean => (db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)).get()?.value as { enabled?: unknown } | undefined)?.enabled === true;

function saveEnabled(db: AppDatabase, enabled: boolean, now = Date.now()): void {
  db.insert(settings).values({ key: KEY, value: { enabled }, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { value: { enabled }, updatedAt: now } }).run();
}

export interface LanServiceOptions {
  db: AppDatabase;
  handlers: ReadonlyMap<string, RpcHandler>;
  /** Where the certificate is kept (the app's data folder). */
  dataFolder: string;
  rendererDir: string | null;
  devServerUrl: string | null;
  /** Tell the till's windows that the devices changed. */
  announce: (domains: readonly DataDomain[]) => void;
  port?: number;
}

/**
 * Serving the till to other devices on the network (Settings > Devices, admins): turned on and off from the Devices
 * page, remembered across restarts, started at launch when it was on. Off by default.
 */
export class LanService {
  private server: LanServer | null = null;
  /** The pin of the running server's certificate, put in the pairing QR (`fp`). */
  private pin = '';
  private error: string | null = null;
  private readonly port: number;

  constructor(private readonly options: LanServiceOptions) {
    this.port = options.port ?? LAN_DEFAULT_PORT;
  }

  /** Starts the server if it was left on. Never throws: a failure is shown on the Devices page. */
  async startIfEnabled(): Promise<void> {
    if (isLanEnabled(this.options.db)) await this.start();
  }

  private async start(): Promise<void> {
    if (this.server?.running) return;
    this.error = null;
    try {
      const addresses = lanAddresses();
      const { key, cert } = loadOrCreateCertificate(this.options.dataFolder, addresses);
      this.pin = publicKeyPin(cert);
      const server = new LanServer({
        db: this.options.db,
        handlers: this.options.handlers,
        key,
        cert,
        rendererDir: this.options.rendererDir,
        devServerUrl: this.options.devServerUrl,
        onDevicesChanged: () => this.options.announce(['devices']),
      });
      await server.start(this.port);
      this.server = server;
      log.info('lan', `Serving devices on port ${this.port}`);
    } catch (error) {
      this.server = null;
      const code = (error as NodeJS.ErrnoException).code;
      this.error = code === 'EADDRINUSE' ? `Port ${this.port} is already in use by another program` : error instanceof Error ? error.message : 'Could not start';
      log.error('lan', 'Could not start the server for devices', error);
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    await server?.stop();
  }

  state(): LanState {
    return { enabled: isLanEnabled(this.options.db), running: this.server?.running === true, port: this.port, addresses: lanAddresses(), error: this.error };
  }

  async setEnabled(enabled: unknown): Promise<LanState> {
    if (typeof enabled !== 'boolean') return this.state();
    saveEnabled(this.options.db, enabled);
    if (enabled) await this.start();
    else {
      this.error = null;
      await this.stop();
    }
    this.options.announce(['devices']);
    return this.state();
  }

  devices(): LanDevice[] {
    return listDevices(this.options.db).map((d) => ({ ...d, online: this.server?.isOnline(d.id) === true, user: this.server?.userOf(d.id) ?? null }));
  }

  /** A QR code's address for one new device; null while the server is not running. */
  newPairing(): LanPairing | null {
    const server = this.server;
    const address = lanAddresses()[0];
    if (!server?.running || !address) return null;
    const { code, expiresAt } = server.codes.create();
    return { url: `https://${address}:${this.port}/?pair=${code}&fp=${this.pin}`, expiresAt };
  }

  revoke(id: unknown): boolean {
    if (!revokeDevice(this.options.db, id)) return false;
    this.server?.dropDevice(id as string);
    this.options.db.delete(settings).where(eq(settings.key, draftKey(id as string))).run(); // its order in progress goes with it
    this.options.announce(['devices']);
    return true;
  }

  broadcast(domains: readonly DataDomain[]): void {
    this.server?.broadcast(domains);
  }
}

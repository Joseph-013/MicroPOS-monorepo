import { inject, Service, signal } from '@angular/core';
import type { LanDevice, LanPairing, LanState } from '@micropos/core';
import { DESKTOP_API } from '../api/desktop-api';
import { BannerService } from '../banner';
import type { LoadStatus } from './catalog.service';
import { refreshOnChange } from './refresh-on-change';

/** Connecting other devices over the network (Devices page, admins): the server's state, the paired devices, pairing codes. */
@Service()
export class DevicesService {
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  readonly state = signal<LanState | null>(null);
  readonly devices = signal<LanDevice[]>([]);
  readonly status = signal<LoadStatus>('idle');
  /** The QR code being shown, if any. */
  readonly pairing = signal<LanPairing | null>(null);

  constructor() {
    refreshOnChange(['devices'], () => this.status() !== 'idle', () => this.load());
  }

  async load(): Promise<void> {
    if (!this.api) return void this.status.set('error');
    if (this.status() !== 'ready') this.status.set('loading');
    try {
      const [state, devices] = await Promise.all([this.api.lan.state(), this.api.lan.devices()]);
      this.state.set(state);
      this.devices.set(devices);
      this.status.set('ready');
    } catch (error) {
      console.error('Failed to load the devices', error);
      this.status.set('error');
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    try {
      this.state.set(await this.api!.lan.setEnabled(enabled));
      if (!enabled) this.pairing.set(null);
    } catch (error) {
      console.error('Failed to change the device server', error);
      this.banner.error('Could not change it', { key: 'lan-enabled' });
    }
  }

  /** Makes a new QR code (the earlier one stops working when it expires). */
  async newPairing(): Promise<void> {
    try {
      const pairing = await this.api!.lan.newPairing();
      this.pairing.set(pairing);
      if (!pairing) this.banner.error('The server is not running', { key: 'lan-pairing' });
    } catch (error) {
      console.error('Failed to make a pairing code', error);
      this.banner.error('Could not make a QR code', { key: 'lan-pairing' });
    }
  }

  async revoke(device: LanDevice): Promise<void> {
    try {
      if (await this.api!.lan.revokeDevice(device.id)) {
        this.banner.success(`${device.name} unpaired`, { key: 'lan-revoke' });
        await this.load();
      }
    } catch (error) {
      console.error('Failed to unpair the device', error);
      this.banner.error('Could not unpair it', { key: 'lan-revoke' });
    }
  }
}

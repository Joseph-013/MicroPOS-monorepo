import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import type { LanDevice } from '@micropos/core';
import { HlmAlertDialogImports } from '@spartan-ng/helm/alert-dialog';
import { HlmBadgeImports } from '@spartan-ng/helm/badge';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { DevicesService } from '../../core/data/devices.service';
import { QrCode } from './qr-code';

/**
 * Devices (admins): serve the till to phones and tablets on the shop's Wi-Fi. Turn it on, press Pair a device and scan
 * the QR code with the phone's camera: the phone opens the same app from the till (over HTTPS with the till's own
 * certificate, so it warns once) and is paired for good until it is unpaired here. Each person still signs in with their
 * PIN on the phone, with their own permissions.
 */
@Component({
  imports: [DatePipe, QrCode, HlmAlertDialogImports, HlmBadgeImports, HlmButtonImports, HlmCardImports, HlmSwitchImports],
  template: `
    <div class="mx-auto grid w-full max-w-3xl gap-3">
      <section hlmCard class="gap-0">
        <header class="flex min-h-(--control-height) items-center justify-between gap-3 px-4 pb-3">
          <h1 class="text-2xl">Devices</h1>
          @if (state(); as s) {
            <label class="flex items-center gap-3 text-sm">
              <span>Allow devices on this network</span>
              <hlm-switch aria-label="Allow devices on this network" [checked]="s.enabled" (checkedChange)="service.setEnabled($event)" />
            </label>
          }
        </header>
        @if (state(); as s) {
          <div class="grid gap-1 border-t px-4 py-3 text-sm">
            @if (s.running) {
              <p>
                <span hlmBadge variant="success">On</span>
                Phones on the same Wi-Fi can open the app at <span class="font-medium break-all select-text" data-address>{{ address() }}</span>
              </p>
            } @else if (s.enabled) {
              <p class="text-destructive" data-error>{{ s.error ?? 'The server could not start' }}</p>
            } @else {
              <p class="text-muted-foreground">Off. Turn it on to connect phones and tablets by QR code.</p>
            }
            @if (!s.addresses.length && s.enabled) {
              <p class="text-destructive">This computer is not on a network.</p>
            }
          </div>
        }
      </section>

      @if (state()?.running) {
        <section hlmCard class="gap-0">
          <header class="flex min-h-(--control-height) flex-wrap items-center justify-between gap-3 px-4 pb-3">
            <h2 class="text-xl">Pair a device</h2>
            <button hlmBtn type="button" class="px-4" (click)="service.newPairing()">{{ service.pairing() ? 'New QR code' : 'Pair a device' }}</button>
          </header>
          @if (service.pairing(); as pairing) {
            <div class="grid justify-items-center gap-3 border-t px-4 py-4 text-center text-sm">
              @if (expired()) {
                <p class="text-destructive" data-expired>This QR code has expired. Make a new one.</p>
              } @else {
                <app-qr-code class="size-64 max-w-full border" [text]="pairing.url" label="QR code to pair a device" />
                <p data-countdown>Works for {{ remaining() }}, once.</p>
                <p class="text-muted-foreground max-w-md">
                  Scan it with the phone's camera and open the link. The phone will warn that the connection is not private: the till makes its own
                  certificate. Choose Advanced, then continue to the site. The traffic is encrypted either way.
                </p>
              }
            </div>
          }
        </section>
      }

      <section hlmCard class="gap-0">
        <header class="px-4 pb-3"><h2 class="text-xl">Paired devices</h2></header>
        <ul class="divide-border flex flex-col divide-y border-t" aria-label="Paired devices">
          @for (device of service.devices(); track device.id) {
            <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div class="min-w-0">
                <p class="flex items-center gap-2 text-base">
                  <span class="truncate">{{ device.name }}</span>
                  <span hlmBadge [variant]="device.online ? 'success' : 'outline'">{{ device.online ? 'Online' : 'Offline' }}</span>
                </p>
                <p class="text-muted-foreground truncate text-sm">
                  @if (device.user) { Signed in as {{ device.user }} · }
                  @if (device.lastSeenAt) { last seen {{ device.lastSeenAt | date: 'MMM d, h:mm a' }} } @else { never used }
                  · paired {{ device.pairedAt | date: 'MMM d, y' }}
                </p>
              </div>
              <button hlmBtn variant="outline" type="button" class="px-4" (click)="pending.set(device)">Unpair</button>
            </li>
          } @empty {
            <li class="text-muted-foreground px-4 py-6 text-center text-sm">{{ service.status() === 'error' ? 'The devices could not be loaded' : 'No device is paired yet' }}</li>
          }
        </ul>
      </section>
    </div>

    <hlm-alert-dialog [state]="pending() ? 'open' : 'closed'" (closed)="pending.set(null)">
      <hlm-alert-dialog-content *hlmAlertDialogPortal="let ctx">
        <hlm-alert-dialog-header>
          <h3 hlmAlertDialogTitle>Unpair {{ pending()?.name }}?</h3>
          <p hlmAlertDialogDescription>It is signed out at once and cannot connect again until it is paired with a new QR code.</p>
        </hlm-alert-dialog-header>
        <hlm-alert-dialog-footer>
          <button hlmAlertDialogCancel type="button">Cancel</button>
          <button hlmAlertDialogAction variant="destructive" type="button" (click)="unpair()">Unpair</button>
        </hlm-alert-dialog-footer>
      </hlm-alert-dialog-content>
    </hlm-alert-dialog>
  `,
})
export class DevicesPage {
  protected readonly service = inject(DevicesService);
  protected readonly state = this.service.state;
  protected readonly pending = signal<LanDevice | null>(null);
  private readonly now = signal(Date.now());

  protected readonly address = computed(() => {
    const s = this.state();
    return s?.addresses[0] ? `https://${s.addresses[0]}:${s.port}` : '';
  });
  protected readonly expired = computed(() => {
    const p = this.service.pairing();
    return !!p && this.now() >= p.expiresAt;
  });
  protected readonly remaining = computed(() => {
    const p = this.service.pairing();
    const seconds = Math.max(0, Math.ceil(((p?.expiresAt ?? 0) - this.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  constructor() {
    void this.service.load();
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected unpair(): void {
    const device = this.pending();
    this.pending.set(null);
    if (device) void this.service.revoke(device);
  }
}

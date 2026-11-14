import { Component, computed, inject, signal } from '@angular/core';
import {
  DEFAULT_PRINTER_PORT,
  MAX_LOGO_BYTES,
  MAX_SHOP_ADDRESS,
  MAX_SHOP_FOOTER,
  MAX_SHOP_NAME,
  PAPER_WIDTHS_MM,
  type PaperWidthMm,
  type PrinterConnection,
  type PrinterSettings,
  type PrinterSettingsField,
  type UsbPrinterInfo,
} from '@micropos/core';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { DESKTOP_API } from '../core/api/desktop-api';
import { BannerService } from '../core/banner';
import { OnScreenKeypadDirective } from '../core/keypad';
import { AppSettings } from '../core/settings/app-settings.service';

type Kind = 'none' | 'network' | 'usb';
const KIND_LABELS: Record<Kind, string> = { none: 'No printer', network: 'Network', usb: 'USB' };
const usbKey = (d: Pick<UsbPrinterInfo, 'vendorId' | 'productId' | 'serialNumber'>): string => `${d.vendorId}:${d.productId}:${d.serialNumber}`;

/**
 * Settings > Receipt Printer (needs `settings.manage`): how the printer is connected, the paper width, and what the
 * shop prints on receipts. The main process prints; this only edits what it uses and asks for a test page.
 */
@Component({
  selector: 'app-printer-settings',
  imports: [OnScreenKeypadDirective, HlmButtonImports, HlmCardImports, HlmInputImports, HlmLabelImports, HlmSelectImports],
  template: `
    <section hlmCard class="mt-3 max-w-xl">
      <div hlmCardHeader>
        <h2 hlmCardTitle>Receipt Printer</h2>
      </div>
      <div hlmCardContent>
        <form class="grid gap-3" (submit)="$event.preventDefault(); save()">
          <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <span id="pr-kind-label">Connection</span>
            <hlm-select [value]="kind()" (valueChange)="setKind($event)" [itemToString]="kindLabel">
              <hlm-select-trigger class="w-40" aria-labelledby="pr-kind-label">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (k of kinds; track k) {
                  <hlm-select-item [value]="k">{{ kindLabel(k) }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>

          @if (kind() === 'network') {
            <div class="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <div class="flex flex-col gap-2">
                <label hlmLabel data-required for="pr-host">Address</label>
                <input hlmInput id="pr-host" type="text" placeholder="192.168.1.50" [forceInvalid]="invalid('host')" [value]="host()" (input)="host.set($any($event.target).value)" />
                @if (errorFor('host'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
              <div class="flex flex-col gap-2">
                <label hlmLabel for="pr-port">Port</label>
                <input
                  hlmInput
                  id="pr-port"
                  type="text"
                  appOnScreenKeypad
                  [keypadWholeDigits]="5"
                  [keypadDecimals]="0"
                  [attr.inputmode]="settings.onScreenKeyboard() ? 'none' : 'numeric'"
                  [forceInvalid]="invalid('port')"
                  [value]="port()"
                  (input)="port.set($any($event.target).value)"
                />
                @if (errorFor('port'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
              </div>
            </div>
          }

          @if (kind() === 'usb') {
            <div class="flex flex-col gap-2">
              <label hlmLabel data-required id="pr-usb-label">Printer</label>
              <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <hlm-select [value]="usbChoice()" (valueChange)="usbChoice.set($event ?? '')" [itemToString]="usbLabel">
                  <hlm-select-trigger class="w-full" aria-labelledby="pr-usb-label">
                    <hlm-select-value placeholder="Choose the printer" />
                  </hlm-select-trigger>
                  <hlm-select-content *hlmSelectPortal>
                    @for (d of usbOptions(); track usbKeyOf(d)) {
                      <hlm-select-item [value]="usbKeyOf(d)">{{ d.label }}</hlm-select-item>
                    }
                  </hlm-select-content>
                </hlm-select>
                <button hlmBtn variant="outline" type="button" class="px-4" (click)="refreshUsb()">Refresh</button>
              </div>
              @if (errorFor('usb'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
            </div>
          }

          <div class="flex min-h-(--control-height) items-center justify-between gap-4 text-sm">
            <span id="pr-width-label">Paper width</span>
            <hlm-select [value]="paperWidth()" (valueChange)="setPaperWidth($event)" [itemToString]="widthLabel">
              <hlm-select-trigger class="w-40" aria-labelledby="pr-width-label">
                <hlm-select-value />
              </hlm-select-trigger>
              <hlm-select-content *hlmSelectPortal>
                @for (w of widths; track w) {
                  <hlm-select-item [value]="w">{{ widthLabel(w) }}</hlm-select-item>
                }
              </hlm-select-content>
            </hlm-select>
          </div>

          <div class="flex flex-col gap-2">
            <span hlmLabel id="pr-logo-label">Logo</span>
            <div class="flex items-center gap-3">
              <div class="flex h-16 w-40 min-w-0 shrink-0 items-center justify-center overflow-hidden border bg-white p-1" aria-labelledby="pr-logo-label">
                @if (logo(); as src) {
                  <img [src]="src" alt="Shop logo" class="max-h-14 max-w-full object-contain" />
                } @else {
                  <span class="text-xs text-neutral-500">No logo</span>
                }
              </div>
              <div class="flex flex-wrap gap-2">
                <button hlmBtn variant="outline" type="button" class="px-4" [disabled]="busy()" (click)="picker.click()">{{ logo() ? 'Replace' : 'Upload' }}</button>
                @if (logo()) {
                  <button hlmBtn variant="destructive" type="button" class="px-4" [disabled]="busy()" (click)="removeLogo()">Remove</button>
                }
              </div>
              <input #picker type="file" accept="image/png,image/jpeg" class="hidden" tabindex="-1" aria-hidden="true" (change)="upload(picker)" />
            </div>
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="pr-name">Shop name</label>
            <input hlmInput id="pr-name" type="text" [attr.maxlength]="maxName" [forceInvalid]="invalid('shopName')" [value]="shopName()" (input)="shopName.set($any($event.target).value)" />
            @if (errorFor('shopName'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="pr-address">Address</label>
            <input hlmInput id="pr-address" type="text" [attr.maxlength]="maxAddress" [forceInvalid]="invalid('shopAddress')" [value]="shopAddress()" (input)="shopAddress.set($any($event.target).value)" />
            @if (errorFor('shopAddress'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>
          <div class="flex flex-col gap-2">
            <label hlmLabel for="pr-footer">Closing message</label>
            <input hlmInput id="pr-footer" type="text" [attr.maxlength]="maxFooter" [forceInvalid]="invalid('shopFooter')" [value]="shopFooter()" (input)="shopFooter.set($any($event.target).value)" />
            @if (errorFor('shopFooter'); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          </div>

          @if (formError(); as error) { <p class="text-destructive text-sm">{{ error }}</p> }
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" type="button" class="px-5" [disabled]="busy() || kind() === 'none'" (click)="test()">Test print</button>
            <button hlmBtn type="submit" class="px-5" [disabled]="busy()">Save</button>
          </div>
        </form>
      </div>
    </section>
  `,
})
export class PrinterSettingsCard {
  protected readonly settings = inject(AppSettings);
  private readonly api = inject(DESKTOP_API);
  private readonly banner = inject(BannerService);

  protected readonly kinds: Kind[] = ['none', 'network', 'usb'];
  protected readonly kindLabel = (k: Kind): string => KIND_LABELS[k];
  protected readonly widths = PAPER_WIDTHS_MM;
  protected readonly widthLabel = (w: PaperWidthMm): string => `${w} mm`;
  protected readonly maxName = MAX_SHOP_NAME;
  protected readonly maxAddress = MAX_SHOP_ADDRESS;
  protected readonly maxFooter = MAX_SHOP_FOOTER;

  protected readonly kind = signal<Kind>('none');
  protected readonly host = signal('');
  protected readonly port = signal(String(DEFAULT_PRINTER_PORT));
  protected readonly usbChoice = signal('');
  private readonly usbSaved = signal<PrinterConnection | null>(null);
  private readonly usbFound = signal<UsbPrinterInfo[]>([]);
  protected readonly logo = signal<string | null>(null);
  protected readonly paperWidth = signal<PaperWidthMm>(58);
  protected readonly shopName = signal('');
  protected readonly shopAddress = signal('');
  protected readonly shopFooter = signal('');
  protected readonly busy = signal(false);
  private readonly problem = signal<{ field: PrinterSettingsField | null; error: string } | null>(null);
  protected readonly formError = computed(() => (this.problem()?.field === null ? this.problem()!.error : null));

  /** The USB printers to choose from: those found, plus the saved one when it is not plugged in right now. */
  protected readonly usbOptions = computed<UsbPrinterInfo[]>(() => {
    const saved = this.usbSaved();
    const found = this.usbFound();
    return saved?.kind === 'usb' && !found.some((d) => usbKey(d) === usbKey(saved)) ? [...found, saved] : found;
  });
  protected readonly usbKeyOf = usbKey;
  protected readonly usbLabel = (key: string | null): string => this.usbOptions().find((d) => usbKey(d) === key)?.label ?? '';

  constructor() {
    void this.api?.printer
      .settings()
      .then((s) => this.apply(s))
      .catch((error) => console.error('Failed to read the printer settings', error));
    void this.api?.printer
      .getLogo()
      .then((src) => this.logo.set(src))
      .catch((error) => console.error('Failed to read the shop logo', error));
  }

  /** The chosen picture goes to the main process, which checks it, scales it for the paper and keeps it. */
  protected async upload(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ''; // choosing the same file again must still count
    if (!file || this.busy()) return;
    if (file.size > MAX_LOGO_BYTES) return void this.banner.error(`The picture is too large (the limit is ${MAX_LOGO_BYTES / 1024 / 1024} MB)`, { key: 'printer-logo' });
    this.busy.set(true);
    try {
      const result = await this.api!.printer.saveLogo(new Uint8Array(await file.arrayBuffer()));
      if (result.ok) {
        this.logo.set(result.dataUrl);
        this.banner.success('Logo saved', { key: 'printer-logo' });
      } else this.banner.error(result.error, { key: 'printer-logo', duration: 'long' });
    } catch (error) {
      console.error('Failed to save the logo', error);
      this.banner.error('Could not save the logo', { key: 'printer-logo' });
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeLogo(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.api!.printer.removeLogo();
      this.logo.set(null);
    } catch (error) {
      console.error('Failed to remove the logo', error);
      this.banner.error('Could not remove the logo', { key: 'printer-logo' });
    } finally {
      this.busy.set(false);
    }
  }

  private apply(s: PrinterSettings): void {
    const c = s.printer.connection;
    this.kind.set(c?.kind ?? 'none');
    this.host.set(c?.kind === 'network' ? c.host : '');
    this.port.set(String(c?.kind === 'network' ? c.port : DEFAULT_PRINTER_PORT));
    this.usbSaved.set(c?.kind === 'usb' ? c : null);
    this.usbChoice.set(c?.kind === 'usb' ? usbKey(c) : '');
    this.paperWidth.set(s.printer.paperWidthMm);
    this.shopName.set(s.shop.name);
    this.shopAddress.set(s.shop.address);
    this.shopFooter.set(s.shop.footer);
    if (c?.kind === 'usb') void this.refreshUsb();
  }

  protected setKind(kind: Kind | null | undefined): void {
    this.kind.set(kind ?? 'none');
    if (kind === 'usb' && !this.usbFound().length) void this.refreshUsb();
  }
  protected setPaperWidth(width: PaperWidthMm | null | undefined): void {
    if (width) this.paperWidth.set(width);
  }

  protected async refreshUsb(): Promise<void> {
    try {
      this.usbFound.set((await this.api?.printer.listUsb()) ?? []);
    } catch (error) {
      console.error('Failed to list USB printers', error);
    }
  }

  protected invalid(field: PrinterSettingsField): boolean {
    return this.problem()?.field === field;
  }
  protected errorFor(field: PrinterSettingsField): string | null {
    return this.invalid(field) ? this.problem()!.error : null;
  }

  /** The form as the settings it stands for; a problem with the port is shown against its field. */
  private current(): PrinterSettings | null {
    let connection: PrinterConnection | null = null;
    if (this.kind() === 'network') {
      const text = this.port().trim();
      const port = text === '' ? DEFAULT_PRINTER_PORT : /^\d{1,5}$/.test(text) ? Number(text) : NaN;
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        this.problem.set({ field: 'port', error: 'Enter a port from 1 to 65535' });
        return null;
      }
      connection = { kind: 'network', host: this.host().trim(), port };
    } else if (this.kind() === 'usb') {
      const device = this.usbOptions().find((d) => usbKey(d) === this.usbChoice());
      if (!device) {
        this.problem.set({ field: 'usb', error: 'Choose the printer' });
        return null;
      }
      connection = { kind: 'usb', vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber, label: device.label };
    }
    return { printer: { connection, paperWidthMm: this.paperWidth() }, shop: { name: this.shopName(), address: this.shopAddress(), footer: this.shopFooter() } };
  }

  /** Saves the form; true when it was saved. */
  private async persist(): Promise<boolean> {
    this.problem.set(null);
    const settings = this.current();
    if (!settings) return false;
    try {
      const result = await this.api!.printer.save(settings);
      if (result.ok) return true;
      this.problem.set({ field: result.field, error: result.error });
    } catch (error) {
      console.error('Failed to save the printer settings', error);
      this.problem.set({ field: null, error: 'Could not save the settings' });
    }
    return false;
  }

  protected async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    if (await this.persist()) this.banner.success('Printer settings saved', { key: 'printer-saved' });
    this.busy.set(false);
  }

  /** Saves, then prints a test page with what was just saved. */
  protected async test(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      if (!(await this.persist())) return;
      const result = await this.api!.printer.testPrint();
      if (result.ok) this.banner.success('Test page sent', { key: 'printer-test' });
      else this.banner.error(result.error, { key: 'printer-test', duration: 'long' });
    } catch (error) {
      console.error('Failed to print the test page', error);
      this.banner.error('Could not print the test page', { key: 'printer-test' });
    } finally {
      this.busy.set(false);
    }
  }
}

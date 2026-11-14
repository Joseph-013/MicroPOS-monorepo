import type { UsbPrinterInfo } from '@micropos/core';
import { PrinterError } from '../errors';
import type { PrinterTransport } from './types';

/** The part of the `usb` package (its WebUSB-style API) that printing uses, so tests can stand in for it. */
export interface UsbEndpoint {
  direction: string;
  type: string;
  endpointNumber: number;
  packetSize: number;
}
export interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  manufacturerName?: string | null;
  productName?: string | null;
  configuration?: { configurationValue: number } | null;
  configurations: { interfaces: { interfaceNumber: number; alternate: { interfaceClass: number; endpoints: UsbEndpoint[] } }[] }[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(value: number): Promise<void>;
  claimInterface(number: number): Promise<void>;
  releaseInterface(number: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<{ status?: string }>;
}
export interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
}

/** The USB device class of printers. */
const PRINTER_CLASS = 7;

export interface PrinterInterface {
  interfaceNumber: number;
  endpointNumber: number;
  packetSize: number;
}

/** The first printer-class interface that has a bulk-out endpoint (where the bytes go), or null. */
export function findPrinterInterface(device: Pick<UsbDeviceLike, 'configurations'>): PrinterInterface | null {
  for (const config of device.configurations) {
    for (const iface of config.interfaces) {
      if (iface.alternate.interfaceClass !== PRINTER_CLASS) continue;
      const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (out) return { interfaceNumber: iface.interfaceNumber, endpointNumber: out.endpointNumber, packetSize: out.packetSize };
    }
  }
  return null;
}

/** Loads the native `usb` package only when needed, so a machine where it cannot load still runs everything else. */
export function loadUsb(): UsbLike {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('usb') as { usb: UsbLike }).usb;
  } catch (error) {
    throw new PrinterError('unsupported', `USB printing is not available on this computer (${error instanceof Error ? error.message : String(error)})`);
  }
}

const describe = (d: UsbDeviceLike): string => [d.manufacturerName, d.productName].filter(Boolean).join(' ') || `USB device ${d.vendorId.toString(16)}:${d.productId.toString(16)}`;

/** USB devices that have a printer-class interface, for choosing one. */
export async function listUsbPrinters(usb: UsbLike = loadUsb()): Promise<UsbPrinterInfo[]> {
  const found: UsbPrinterInfo[] = [];
  for (const device of await usb.getDevices()) {
    if (findPrinterInterface(device)) found.push({ vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber ?? '', label: describe(device) });
  }
  return found;
}

/**
 * A USB printer, opened for one job. On Linux this needs no setup. On Windows, claiming the interface only works when
 * the printer uses the WinUSB driver instead of Windows' own printer driver; with the normal driver installed the
 * claim fails (reported as `busy`). That path has not been tried on real hardware yet.
 */
export class UsbTransport implements PrinterTransport {
  constructor(
    private readonly target: Pick<UsbPrinterInfo, 'vendorId' | 'productId' | 'serialNumber'>,
    private readonly usb: () => UsbLike = loadUsb,
  ) {}

  async send(bytes: Uint8Array): Promise<void> {
    const devices = await this.usb().getDevices();
    const device = devices.find((d) => d.vendorId === this.target.vendorId && d.productId === this.target.productId && (d.serialNumber ?? '') === this.target.serialNumber);
    if (!device) throw new PrinterError('unreachable', 'The USB printer is not connected');
    const iface = findPrinterInterface(device);
    if (!iface) throw new PrinterError('no-printer-interface', 'This USB device has no printer interface');

    try {
      await device.open();
    } catch (error) {
      throw new PrinterError('busy', `Could not open the USB printer (${String(error)})`);
    }
    let claimed = false;
    try {
      if (device.configuration?.configurationValue !== 1) await device.selectConfiguration(1).catch(() => undefined);
      try {
        await device.claimInterface(iface.interfaceNumber);
        claimed = true;
      } catch (error) {
        throw new PrinterError('busy', `Could not claim the USB printer (${String(error)})`);
      }
      // One packet at a time: the printer's own buffer is small, and each transfer waits for it to take the data.
      for (let offset = 0; offset < bytes.length; offset += iface.packetSize) {
        try {
          await device.transferOut(iface.endpointNumber, bytes.slice(offset, offset + iface.packetSize));
        } catch (error) {
          throw new PrinterError('write-failed', `Sending to the USB printer failed (${String(error)})`);
        }
      }
    } finally {
      if (claimed) await device.releaseInterface(iface.interfaceNumber).catch(() => undefined);
      await device.close().catch(() => undefined);
    }
  }
}

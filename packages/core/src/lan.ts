/** Connecting other devices (phones, tablets) over the shop's Wi-Fi: the till serves the app and the phone pairs by QR. */
export const LAN_DEFAULT_PORT = 8734;
/** How long a pairing QR code works, in milliseconds. */
export const LAN_PAIRING_MS = 5 * 60_000;
export const MAX_DEVICE_NAME = 60;

export interface LanState {
  /** The admin turned it on (kept across restarts). */
  enabled: boolean;
  /** Listening right now. */
  running: boolean;
  port: number;
  /** The till's addresses on the network (IPv4), best first. A phone must be on the same network. */
  addresses: string[];
  /** Why it is not running although it is on (port busy, no certificate...). */
  error: string | null;
}

/** A paired device. */
export interface LanDevice {
  id: string;
  name: string;
  pairedAt: number;
  lastSeenAt: number | null;
  /** Has the live connection (WebSocket) open now. */
  online: boolean;
  /** Who is signed in on it now. */
  user: string | null;
}

/** A QR code to scan with the phone's camera: `url` opens the app on the phone and pairs it, once, until `expiresAt`. */
export interface LanPairing {
  url: string;
  expiresAt: number;
}

/** A device name from what the browser says about itself ("iPhone", "Android phone", "Chrome on Windows"). */
export function deviceNameFromAgent(agent: string): string {
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return /Mobile/i.test(agent) ? 'Android phone' : 'Android tablet';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const os = /Windows/i.test(agent) ? 'Windows' : /Mac OS X|Macintosh/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

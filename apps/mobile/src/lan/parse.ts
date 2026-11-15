/** What the till's pairing QR code carries: `https://<address>:<port>/?pair=<code>&fp=<pin>`. */
export interface ParsedPairing {
  host: string;
  port: number;
  code: string;
  /** SHA-256 of the till's public key, lowercase hex. */
  pin: string;
}

const ADDRESS = /^https:\/\/([A-Za-z0-9.-]+)(?::(\d{1,5}))?\/?\?([^#\s]*)(?:#.*)?$/;
const PIN = /^[0-9a-f]{64}$/;

/** Reads a scanned or pasted pairing address; a string says what is wrong with it. */
export function parsePairingUrl(text: string): ParsedPairing | string {
  const match = ADDRESS.exec(text.trim());
  if (!match) return 'This is not a MicroPOS pairing code.';
  const host = match[1]!;
  const port = match[2] ? Number(match[2]) : 443;
  if (port < 1 || port > 65535) return 'This is not a MicroPOS pairing code.';
  const params = new Map<string, string>();
  for (const pair of match[3]!.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (key) params.set(key, rest.join('='));
  }
  const code = params.get('pair');
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) return 'This is not a MicroPOS pairing code.';
  const pin = params.get('fp')?.toLowerCase();
  if (!pin || !PIN.test(pin)) return 'This code is from an older MicroPOS till. Update the till, then make a new code.';
  return { host, port, code, pin };
}

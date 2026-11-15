import { describe, expect, it } from 'vitest';
import { parsePairingUrl } from './parse';

const PIN = 'a'.repeat(64);

describe('parsePairingUrl', () => {
  it('reads the address, port, code and key pin from the till QR', () => {
    expect(parsePairingUrl(`https://192.168.1.20:8734/?pair=abc123_-&fp=${PIN}`)).toEqual({ host: '192.168.1.20', port: 8734, code: 'abc123_-', pin: PIN });
    expect(parsePairingUrl(`  https://till.local/?fp=${PIN.toUpperCase()}&pair=x\n`)).toEqual({ host: 'till.local', port: 443, code: 'x', pin: PIN });
  });
  it('refuses anything that is not a pairing address, saying why', () => {
    for (const bad of ['', 'hello', 'http://192.168.1.20:8734/?pair=a&fp=' + PIN, 'https://x:99999/?pair=a&fp=' + PIN, `https://x:1/?fp=${PIN}`, 'https://x:1/?pair=a%20b&fp=' + PIN]) {
      expect(parsePairingUrl(bad)).toBe('This is not a MicroPOS pairing code.');
    }
  });
  it('asks for a newer till when the code has no key pin', () => {
    expect(parsePairingUrl('https://192.168.1.20:8734/?pair=abc')).toMatch(/older MicroPOS till/);
    expect(parsePairingUrl('https://192.168.1.20:8734/?pair=abc&fp=zz')).toMatch(/older MicroPOS till/);
  });
});

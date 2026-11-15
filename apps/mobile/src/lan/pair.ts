import { baseUrl, postJson, type Deps, type Pairing } from './client';
import type { ParsedPairing } from './parse';

const DEVICE_NAME = 'MicroPOS Android app';

/**
 * Trades the pairing code for this device's token. The till's key pin is set before anything is sent, so the very first
 * request already refuses any server but the till; `setPin` is restored if pairing fails.
 */
export async function pairWithTill(parsed: ParsedPairing, deps: Deps & { setPin: (pin: string | null) => void; previousPin?: string | null }): Promise<Pairing> {
  deps.setPin(parsed.pin);
  try {
    const { status, body } = await postJson(deps, `${baseUrl(parsed)}/lan/pair`, { code: parsed.code, name: DEVICE_NAME });
    if (typeof body.token !== 'string' || status !== 200) throw new Error(typeof body.error === 'string' ? body.error : 'Could not pair');
    return {
      host: parsed.host,
      port: parsed.port,
      token: body.token,
      pin: parsed.pin,
      deviceId: typeof body.id === 'string' ? body.id : '',
      name: typeof body.name === 'string' ? body.name : DEVICE_NAME,
    };
  } catch (error) {
    deps.setPin(deps.previousPin ?? null);
    throw error;
  }
}

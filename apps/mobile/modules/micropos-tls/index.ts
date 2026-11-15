import { requireOptionalNativeModule } from 'expo';

interface MicroposTlsNative {
  setPin(pin: string | null): void;
}

// Missing in Expo Go and in builds made without this module: then only servers with a normally valid certificate work.
const native = requireOptionalNativeModule<MicroposTlsNative>('MicroposTls');

/** True in a development or release build that includes the native pin module (not in Expo Go). */
export const pinningAvailable = native !== null;

/**
 * Trusts the till whose public key hashes to `pin` (lowercase hex SHA-256 of its SubjectPublicKeyInfo) for every
 * request and WebSocket the app makes from now on; null removes it. Must be set again after every app start.
 */
export function setPin(pin: string | null): void {
  native?.setPin(pin);
}

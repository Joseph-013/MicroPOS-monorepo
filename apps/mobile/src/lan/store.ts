import * as SecureStore from 'expo-secure-store';
import type { Pairing } from './client';

const KEY = 'micropos.pairing';

const valid = (v: unknown): v is Pairing => {
  const p = v as Partial<Pairing> | null;
  return !!p && typeof p.host === 'string' && typeof p.port === 'number' && typeof p.token === 'string' && typeof p.pin === 'string' && typeof p.deviceId === 'string' && typeof p.name === 'string';
};

/** The pairing (including the secret token) lives in the Android keystore through expo-secure-store, never in plain storage. */
export async function loadPairing(): Promise<Pairing | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const savePairing = (pairing: Pairing): Promise<void> => SecureStore.setItemAsync(KEY, JSON.stringify(pairing));
export const clearPairing = (): Promise<void> => SecureStore.deleteItemAsync(KEY);

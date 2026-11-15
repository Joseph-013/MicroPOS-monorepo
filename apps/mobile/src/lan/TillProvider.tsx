import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DesktopApi } from '@micropos/core';
import { setPin } from '../../modules/micropos-tls';
import { createRemoteApi, TillClient, type Pairing } from './client';
import { pairWithTill } from './pair';
import { parsePairingUrl } from './parse';
import { clearPairing, loadPairing, savePairing } from './store';

type State = { status: 'loading' } | { status: 'unpaired' } | { status: 'paired'; client: TillClient; api: DesktopApi };

interface TillContextValue {
  state: State;
  /** The live connection to the till is up. */
  online: boolean;
  /** Pairs from a scanned or pasted address; resolves to an error message, or null when it worked. */
  pair(text: string): Promise<string | null>;
  /** Forgets the till on this phone (it stays listed on the till until removed there). */
  unpair(): Promise<void>;
}

const TillContext = createContext<TillContextValue | null>(null);
export function useTill(): TillContextValue {
  const value = useContext(TillContext);
  if (!value) throw new Error('TillProvider missing');
  return value;
}

/** Holds the pairing with the till (token in the Android keystore) and the `DesktopApi` the screens use. */
export function TillProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [online, setOnline] = useState(false);
  const current = useRef<TillClient | null>(null);

  const unpair = useCallback(async () => {
    current.current?.changes.close();
    current.current = null;
    setPin(null);
    setOnline(false);
    await clearPairing().catch(() => undefined);
    setState({ status: 'unpaired' });
  }, []);

  const start = useCallback(
    (pairing: Pairing) => {
      setPin(pairing.pin); // before the first request: the pin is what makes the till's certificate trusted
      const client = new TillClient(pairing, {}, () => void unpair());
      current.current = client;
      setState({ status: 'paired', client, api: createRemoteApi(client) });
    },
    [unpair],
  );

  useEffect(() => {
    let cancelled = false;
    void loadPairing().then((pairing) => {
      if (cancelled) return;
      if (pairing) start(pairing);
      else setState({ status: 'unpaired' });
    });
    return () => {
      cancelled = true;
    };
  }, [start]);

  useEffect(() => {
    if (state.status !== 'paired') return;
    return state.client.changes.onStatus(setOnline);
  }, [state]);

  const pair = useCallback(
    async (text: string): Promise<string | null> => {
      const parsed = parsePairingUrl(text);
      if (typeof parsed === 'string') return parsed;
      try {
        const pairing = await pairWithTill(parsed, { setPin, previousPin: current.current?.pairing.pin ?? null });
        await savePairing(pairing);
        current.current?.changes.close();
        start(pairing);
        return null;
      } catch (error) {
        return error instanceof Error ? error.message : 'Could not pair';
      }
    },
    [start],
  );

  const value = useMemo(() => ({ state, online, pair, unpair }), [state, online, pair, unpair]);
  return <TillContext.Provider value={value}>{children}</TillContext.Provider>;
}

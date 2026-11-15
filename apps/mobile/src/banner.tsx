import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from './theme';

type Tone = 'success' | 'warning' | 'info' | 'destructive';
interface Banner {
  key: string;
  message: string;
  tone: Tone;
  persistent: boolean;
  dismissible: boolean;
}
interface BannerApi {
  success(message: string): void;
  warning(message: string, opts?: { key?: string; persistent?: boolean; dismissible?: boolean }): void;
  remove(key: string): void;
}

const BannerContext = createContext<BannerApi | null>(null);
export const useBanner = (): BannerApi => {
  const api = useContext(BannerContext);
  if (!api) throw new Error('BannerProvider missing');
  return api;
};

const TIMED_MS = 3000;

/** Banners shown across the top of the screen: timed ones fade after a few seconds, persistent ones stay until removed. */
export function BannerProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((key: string) => {
    clearTimeout(timers.current.get(key));
    timers.current.delete(key);
    setBanners((b) => b.filter((x) => x.key !== key));
  }, []);

  const show = useCallback(
    (b: Banner) => {
      clearTimeout(timers.current.get(b.key));
      setBanners((list) => [...list.filter((x) => x.key !== b.key), b]);
      if (!b.persistent) timers.current.set(b.key, setTimeout(() => remove(b.key), TIMED_MS));
    },
    [remove],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach(clearTimeout);
  }, []);

  const api: BannerApi = {
    success: (message) => show({ key: `t${Date.now()}`, message, tone: 'success', persistent: false, dismissible: true }),
    warning: (message, opts) =>
      show({ key: opts?.key ?? `w${Date.now()}`, message, tone: 'warning', persistent: opts?.persistent ?? false, dismissible: opts?.dismissible ?? true }),
    remove,
  };

  return (
    <BannerContext.Provider value={api}>
      {children}
      <BannerHost banners={banners} onDismiss={remove} />
    </BannerContext.Provider>
  );
}

function BannerHost({ banners, onDismiss }: { banners: Banner[]; onDismiss: (key: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  if (!banners.length) return null;
  const colors: Record<Tone, [string, string]> = {
    success: [t.success, t.successForeground],
    warning: [t.warning, t.warningForeground],
    info: [t.primary, t.primaryForeground],
    destructive: [t.destructive, t.destructiveForeground],
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top, left: 0, right: 0, zIndex: 100 }}>
      {banners.map((b) => (
        <View key={b.key} style={{ backgroundColor: colors[b.tone][0], flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingLeft: 12 }}>
          <Text style={{ color: colors[b.tone][1], flex: 1, fontSize: 14, paddingVertical: 8 }}>{b.message}</Text>
          {b.dismissible && (
            <Pressable accessibilityLabel="Dismiss" onPress={() => onDismiss(b.key)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color={colors[b.tone][1]} />
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

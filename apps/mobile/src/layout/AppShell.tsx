import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, BackHandler, Easing, Pressable, View, useWindowDimensions } from 'react-native';
import { Computer, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Logo } from '../components/Logo';
import { useTheme } from '../theme';
import { NavList } from './NavList';

/** Same breakpoint as the desktop (Tailwind `md`): below it a phone layout, from it a tablet layout. */
export const WIDE_BREAKPOINT = 768;
const RAIL_COLLAPSED = 56;
const RAIL_EXPANDED = 256;
const TOPBAR = 48;

export interface ShellMetrics {
  /** Width left for the page content (inside its padding). */
  contentWidth: number;
  wide: boolean;
}

/**
 * Phone (narrow): a 48px top bar with the logo left and the burger at the far right; the navigation is a drawer
 * from the right over a dimmed backdrop. Tablet (wide): the navigation is a rail on the left, icons only until
 * toggled open. Content padding is 12px as on the desktop.
 */
export function AppShell({ route, onNavigate, children }: { route: string; onNavigate: (id: string) => void; children: (m: ShellMetrics) => ReactNode }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= WIDE_BREAKPOINT;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  // Rotating or resizing to the tablet layout leaves no drawer open behind.
  useEffect(() => {
    if (wide) setDrawerOpen(false);
  }, [wide]);

  // The Android back button closes the drawer first.
  useEffect(() => {
    if (!drawerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setDrawerOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [drawerOpen]);

  const go = (id: string) => {
    onNavigate(id);
    setDrawerOpen(false);
  };

  const railWidth = wide ? (railOpen ? RAIL_EXPANDED : RAIL_COLLAPSED) : 0;
  const contentWidth = width - railWidth - insets.left - insets.right - 24;

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: t.background, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }}>
      {wide && (
        <View style={{ width: railWidth, borderRightWidth: 1, borderColor: t.border, padding: 6, paddingBottom: Math.max(insets.bottom, 6) }}>
          <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, overflow: 'hidden' }}>
            {railOpen ? <View style={{ paddingLeft: 5 }}><Logo height={22} /></View> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={railOpen ? 'Collapse navigation' : 'Expand navigation'}
              onPress={() => setRailOpen((v) => !v)}
              style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.accent : 'transparent' })}
            >
              {railOpen ? <PanelLeftClose size={20} color={t.mutedForeground} strokeWidth={1.5} /> : <Computer size={22} color={t.primary} strokeWidth={2.5} />}
            </Pressable>
          </View>
          <NavList route={route} onNavigate={go} compact={!railOpen} />
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0 }}>
        {!wide && (
          <View style={{ height: TOPBAR, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 12, borderBottomWidth: 1, borderColor: t.border }}>
            <Logo height={22} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Menu"
              accessibilityState={{ expanded: drawerOpen }}
              onPress={() => setDrawerOpen((v) => !v)}
              style={({ pressed }) => ({ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.accent : 'transparent' })}
            >
              <Menu size={22} color={t.foreground} strokeWidth={1.5} />
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>{children({ contentWidth, wide })}</View>
      </View>

      {!wide && <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} top={insets.top} bottom={insets.bottom} route={route} onNavigate={go} />}
    </View>
  );
}

/** The phone's navigation: slides in from the right, max 85% of the width, dimmed backdrop, tap outside to close. */
function Drawer({ open, onClose, top, bottom, route, onNavigate }: { open: boolean; onClose: () => void; top: number; bottom: number; route: string; onNavigate: (id: string) => void }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(288, width * 0.85);
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, progress]);

  if (!mounted) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 30 }}>
      <Animated.View style={{ ...absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)', opacity: progress }}>
        <Pressable accessibilityLabel="Close menu" onPress={onClose} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: drawerWidth,
          backgroundColor: t.background,
          borderLeftWidth: 1,
          borderColor: t.border,
          paddingTop: top + 6,
          paddingBottom: Math.max(bottom, 6),
          paddingHorizontal: 6,
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [drawerWidth, 0] }) }],
        }}
      >
        <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingLeft: 5 }}>
          <Logo height={22} />
          <Pressable accessibilityRole="button" accessibilityLabel="Close menu" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <X size={22} color={t.foreground} strokeWidth={1.5} />
          </Pressable>
        </View>
        <NavList route={route} onNavigate={onNavigate} />
      </Animated.View>
    </View>
  );
}

const absoluteFill = { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } as const;

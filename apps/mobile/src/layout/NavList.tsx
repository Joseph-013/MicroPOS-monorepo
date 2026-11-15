import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronRight, Settings } from 'lucide-react-native';
import { useTheme } from '../theme';
import { NAV, SETTINGS, type NavItem } from './nav';

/**
 * The navigation entries, shared by the tablet rail and the phone drawer. `compact` shows icons only (the collapsed rail).
 * Rows are 40px tall like the desktop's; labels truncate.
 */
export function NavList({ route, onNavigate, compact }: { route: string; onNavigate: (id: string) => void; compact?: boolean }) {
  const t = useTheme();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const hasActive = (i: NavItem): boolean => i.id === route || !!i.children?.some(hasActive);

  const row = (item: NavItem, level: number) => {
    const Icon = item.icon;
    const active = item.id === route;
    const group = !!item.children;
    const expanded = open[item.id] ?? hasActive(item);
    const fg = active ? t.primaryForeground : group && hasActive(item) ? t.primary : t.foreground;
    return (
      <View key={item.id}>
        <Pressable
          accessibilityRole={group ? 'button' : 'link'}
          accessibilityLabel={item.label}
          accessibilityState={group ? { expanded } : { selected: active }}
          onPress={() => (group && !compact ? setOpen((o) => ({ ...o, [item.id]: !expanded })) : group ? onNavigate(item.children![0].id) : onNavigate(item.id))}
          style={({ pressed }) => ({
            height: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingLeft: compact ? 11 : 11 + level * 30,
            paddingRight: 11,
            backgroundColor: active ? t.primary : pressed ? t.accent : 'transparent',
          })}
        >
          {Icon ? <Icon size={18} color={fg} strokeWidth={1.5} /> : level > 0 && !compact ? <View style={{ width: 18 }} /> : null}
          {!compact && (
            <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: fg, fontSize: 14, fontWeight: group && hasActive(item) ? '600' : '400' }}>
              {item.label}
            </Text>
          )}
          {group && !compact && <ChevronRight size={16} color={t.mutedForeground} style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }} />}
        </Pressable>
        {group && expanded && !compact && <View style={{ gap: 6, paddingTop: 6 }}>{item.children!.map((c) => row(c, level + 1))}</View>}
      </View>
    );
  };

  const settingsActive = route === SETTINGS.id;
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
        {NAV.map((i) => row(i, 0))}
      </ScrollView>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Settings"
        onPress={() => onNavigate(SETTINGS.id)}
        style={({ pressed }) => ({ height: 44, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 11, marginTop: 6, backgroundColor: settingsActive ? t.primary : pressed ? t.accent : 'transparent' })}
      >
        <Settings size={18} color={settingsActive ? t.primaryForeground : t.foreground} strokeWidth={1.5} />
        {!compact && <Text style={{ color: settingsActive ? t.primaryForeground : t.foreground, fontSize: 14 }}>Settings</Text>}
      </Pressable>
    </View>
  );
}

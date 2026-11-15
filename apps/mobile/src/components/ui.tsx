import { useState, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Switch as RNSwitch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Check, ChevronsUpDown } from 'lucide-react-native';
import { CONTROL, useTheme } from '../theme';

/* ---------- Button ---------- */
type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive';
export function Button({
  children,
  variant = 'default',
  size = 'md',
  disabled,
  onPress,
  style,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: keyof typeof CONTROL;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const look = {
    default: { bg: t.primary, fg: t.primaryForeground, border: t.primary },
    outline: { bg: 'transparent', fg: t.foreground, border: t.input },
    ghost: { bg: 'transparent', fg: t.foreground, border: 'transparent' },
    destructive: { bg: t.destructive, fg: t.destructiveForeground, border: t.destructive },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: CONTROL[size],
          paddingHorizontal: 16,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed && variant !== 'default' ? t.accent : look.bg,
          borderWidth: 1,
          borderColor: look.border,
          opacity: disabled ? 0.5 : pressed && variant === 'default' ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text numberOfLines={1} style={{ color: look.fg, fontSize: 14, fontWeight: '500' }}>
        {children}
      </Text>
    </Pressable>
  );
}

/* ---------- Badge (tags) ---------- */
export function Badge({ children, variant = 'tagOutline' }: { children: string; variant?: 'tagOutline' | 'tagAccent' | 'tagNeutral' }) {
  const t = useTheme();
  const look = {
    tagOutline: { bg: 'transparent', fg: t.foreground, border: t.border },
    tagAccent: { bg: t.tagAccentBg, fg: t.tagAccentFg, border: 'transparent' },
    tagNeutral: { bg: t.tagNeutralBg, fg: t.tagNeutralFg, border: 'transparent' },
  }[variant];
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: look.bg, borderColor: look.border, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text numberOfLines={1} style={{ color: look.fg, fontSize: 12, fontWeight: '500' }}>
        {children}
      </Text>
    </View>
  );
}

/* ---------- Card with blueprint corner marks ---------- */
function Marks() {
  const t = useTheme();
  const m = { position: 'absolute' as const, width: 8, height: 8, borderColor: t.mark };
  return (
    <>
      <View pointerEvents="none" style={[m, { top: -1, left: -1, borderTopWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View pointerEvents="none" style={[m, { top: -1, right: -1, borderTopWidth: 1.5, borderRightWidth: 1.5 }]} />
      <View pointerEvents="none" style={[m, { bottom: -1, left: -1, borderBottomWidth: 1.5, borderLeftWidth: 1.5 }]} />
      <View pointerEvents="none" style={[m, { bottom: -1, right: -1, borderBottomWidth: 1.5, borderRightWidth: 1.5 }]} />
    </>
  );
}
export function Card({ title, children, style }: { title: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ borderWidth: 1, borderColor: t.border, backgroundColor: t.card, padding: 16, gap: 12 }, style]}>
      <Marks />
      <Text accessibilityRole="header" style={{ color: t.foreground, fontSize: 16, fontWeight: '600' }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/* ---------- Label, Input, Textarea ---------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.foreground, fontSize: 14, fontWeight: '500' }}>{label}</Text>
      {children}
    </View>
  );
}
export function Input({ invalid, multiline, style, ...rest }: TextInputProps & { invalid?: boolean }) {
  const t = useTheme();
  const editable = rest.editable !== false;
  return (
    <TextInput
      placeholderTextColor={t.mutedForeground}
      multiline={multiline}
      {...rest}
      style={[
        {
          minHeight: multiline ? 88 : CONTROL.md,
          borderWidth: 1,
          borderColor: invalid ? t.destructive : t.input,
          color: t.foreground,
          paddingHorizontal: 12,
          paddingVertical: multiline ? 10 : 0,
          fontSize: 16,
          textAlignVertical: multiline ? 'top' : 'center',
          opacity: editable ? 1 : 0.5,
        },
        style,
      ]}
    />
  );
}

/* ---------- Checkbox, Switch, Radio ---------- */
export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange?.(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: CONTROL.md, opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ width: 22, height: 22, borderWidth: 1, borderColor: checked ? t.primary : t.input, backgroundColor: checked ? t.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked && <Check size={16} color={t.primaryForeground} strokeWidth={3} />}
      </View>
      <Text style={{ color: t.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: CONTROL.md }}>
      <Text style={{ color: t.foreground, fontSize: 14, flexShrink: 1 }}>{label}</Text>
      <RNSwitch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: t.input, true: t.primary }} thumbColor={t.background} />
    </View>
  );
}
export function RadioGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup">
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: CONTROL.md }}
        >
          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: value === o.value ? t.primary : t.input, alignItems: 'center', justifyContent: 'center' }}>
            {value === o.value && <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.primary }} />}
          </View>
          <Text style={{ color: t.foreground, fontSize: 14 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/* ---------- Modal sheet shared by Dialog, AlertDialog, Select and context menu ---------- */
function Sheet({ visible, onClose, children, maxWidth = 420, marks }: { visible: boolean; onClose: () => void; children: ReactNode; maxWidth?: number; marks?: boolean }) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        {/* Inner Pressable swallows taps so touching the panel does not close it. */}
        <Pressable style={{ width: '100%', maxWidth, maxHeight: height - 48, backgroundColor: t.popover, borderWidth: 1, borderColor: t.border }}>
          {marks && <Marks />}
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ---------- Dialog ---------- */
export function Dialog({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children?: ReactNode; footer: ReactNode }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} marks>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text accessibilityRole="header" style={{ color: t.foreground, fontSize: 18, fontWeight: '600' }}>
          {title}
        </Text>
        {children}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>{footer}</View>
      </ScrollView>
    </Sheet>
  );
}
export function AlertDialog({
  visible,
  onClose,
  title,
  description,
  actionLabel,
  destructive,
  onAction,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  description: string;
  actionLabel: string;
  destructive?: boolean;
  onAction: () => void;
}) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} marks>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
        <Text accessibilityRole="header" style={{ color: t.foreground, fontSize: 18, fontWeight: '600' }}>
          {title}
        </Text>
        <Text style={{ color: t.mutedForeground, fontSize: 14 }}>{description}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <Button variant="outline" onPress={onClose}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onPress={() => {
              onAction();
              onClose();
            }}
          >
            {actionLabel}
          </Button>
        </View>
      </ScrollView>
    </Sheet>
  );
}

/* ---------- Select ---------- */
export function Select({ value, onChange, options, placeholder }: { value?: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="combobox"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={{ minHeight: CONTROL.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: t.input, paddingHorizontal: 12 }}
      >
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: 16, color: current ? t.foreground : t.mutedForeground }}>
          {current?.label ?? placeholder}
        </Text>
        <ChevronsUpDown size={16} color={t.mutedForeground} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} maxWidth={360}>
        <ScrollView>
          {options.map((o) => (
            <Pressable
              key={o.value}
              accessibilityRole="menuitem"
              onPress={() => {
                onChange(o.value);
                setOpen(false);
              }}
              style={({ pressed }) => ({ minHeight: CONTROL.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: pressed ? t.accent : 'transparent' })}
            >
              <Text numberOfLines={1} style={{ color: t.foreground, fontSize: 16, flexShrink: 1 }}>
                {o.label}
              </Text>
              {o.value === value && <Check size={16} color={t.primary} />}
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

/* ---------- Tabs ---------- */
export function Tabs({ tabs }: { tabs: { id: string; label: string; content: ReactNode }[] }) {
  const t = useTheme();
  const [active, setActive] = useState(tabs[0]?.id);
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <View style={{ flexDirection: 'row', backgroundColor: t.muted, padding: 3, gap: 2 }}>
          {tabs.map((x) => (
            <Pressable
              key={x.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active === x.id }}
              onPress={() => setActive(x.id)}
              style={{ minHeight: CONTROL.sm, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: active === x.id ? t.background : 'transparent' }}
            >
              <Text style={{ color: active === x.id ? t.foreground : t.mutedForeground, fontSize: 14, fontWeight: '500' }}>{x.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <View style={{ paddingTop: 12 }}>{tabs.find((x) => x.id === active)?.content}</View>
    </View>
  );
}

/* ---------- Table (scrolls sideways when the columns do not fit) ---------- */
export interface Column<R> {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  render: (row: R) => ReactNode;
}
export function Table<R>({ columns, rows, rowKey }: { columns: Column<R>[]; rows: R[]; rowKey: (r: R) => string }) {
  const t = useTheme();
  const cell = (c: Column<R>, child: ReactNode) => (
    <View key={c.key} style={{ width: c.width, paddingHorizontal: 8, justifyContent: 'center', alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
      {typeof child === 'string' ? (
        <Text numberOfLines={1} style={{ color: t.foreground, fontSize: 14 }}>
          {child}
        </Text>
      ) : (
        child
      )}
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View accessibilityRole="list">
        <View style={{ flexDirection: 'row', minHeight: CONTROL.sm, borderBottomWidth: 1, borderColor: t.border }}>
          {columns.map((c) => (
            <View key={c.key} style={{ width: c.width, paddingHorizontal: 8, justifyContent: 'center', alignItems: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
              <Text numberOfLines={1} style={{ color: t.mutedForeground, fontSize: 13, fontWeight: '500' }}>
                {c.title}
              </Text>
            </View>
          ))}
        </View>
        {rows.map((r) => (
          <View key={rowKey(r)} style={{ flexDirection: 'row', minHeight: CONTROL.md, borderBottomWidth: 1, borderColor: t.border }}>
            {columns.map((c) => cell(c, c.render(r)))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/* ---------- Context menu: long-press the zone ---------- */
export function ContextMenu({ children, items }: { children: ReactNode; items: { label: string; destructive?: boolean; onPress?: () => void }[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable delayLongPress={450} onLongPress={() => setOpen(true)} accessibilityHint="Long press for actions">
        {children}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} maxWidth={280}>
        {items.map((i) => (
          <Pressable
            key={i.label}
            accessibilityRole="menuitem"
            onPress={() => {
              setOpen(false);
              i.onPress?.();
            }}
            style={({ pressed }) => ({ minHeight: CONTROL.md, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: pressed ? t.accent : 'transparent' })}
          >
            <Text style={{ color: i.destructive ? t.destructive : t.foreground, fontSize: 16 }}>{i.label}</Text>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}

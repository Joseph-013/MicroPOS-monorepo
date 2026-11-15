import { Text, View } from 'react-native';
import { useTheme } from '../theme';

/** Empty screen stub until the real screen is built. */
export function PlaceholderScreen({ title }: { title: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: 12 }}>
      <Text accessibilityRole="header" style={{ color: t.foreground, fontSize: 24 }}>
        {title}
      </Text>
    </View>
  );
}

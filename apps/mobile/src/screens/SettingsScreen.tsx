import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AlertDialog, Badge, Button, Card } from '../components/ui';
import { useTill } from '../lan/TillProvider';
import { useTheme } from '../theme';

/** Settings of this phone. Only the till connection so far. */
export function SettingsScreen() {
  const t = useTheme();
  const { state, online, unpair } = useTill();
  const [confirm, setConfirm] = useState(false);
  if (state.status !== 'paired') return null;
  const { pairing } = state.client;
  return (
    <ScrollView contentContainerStyle={{ padding: 12, gap: 12, alignItems: 'center' }}>
      <Card title="Till connection" style={{ width: '100%', maxWidth: 520 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Text numberOfLines={1} selectable style={{ flex: 1, minWidth: 0, color: t.foreground, fontSize: 14 }}>
            {pairing.host}:{pairing.port}
          </Text>
          <Badge variant={online ? 'tagAccent' : 'tagNeutral'}>{online ? 'Connected' : 'Offline'}</Badge>
        </View>
        <Button variant="destructive" onPress={() => setConfirm(true)}>
          Unpair
        </Button>
      </Card>
      <AlertDialog
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Unpair this phone?"
        description="It will forget the till. To pair again, make a new code on the till (Devices). Remove the phone from the till's list there as well."
        actionLabel="Unpair"
        destructive
        onAction={() => void unpair()}
      />
    </ScrollView>
  );
}

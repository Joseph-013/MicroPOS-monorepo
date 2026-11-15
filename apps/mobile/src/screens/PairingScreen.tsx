import { useRef, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Logo } from '../components/Logo';
import { Button, Card, Field, Input } from '../components/ui';
import { pinningAvailable } from '../../modules/micropos-tls';
import { useTill } from '../lan/TillProvider';
import { UNREACHABLE } from '../lan/client';
import { useTheme } from '../theme';

/** Shown until this phone is paired: scan the QR code on the till (Devices > Pair a device), or paste its address. */
export function PairingScreen() {
  const t = useTheme();
  const { pair } = useTill();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scanning = useRef(false); // a QR code is seen many times a second: handle it once

  const submit = async (value: string) => {
    if (scanning.current) return;
    scanning.current = true;
    setBusy(true);
    setError(null);
    const problem = await pair(value);
    // A successful pairing replaces this screen; on failure the phone can try again.
    setBusy(false);
    scanning.current = false;
    if (problem) setError(problem === UNREACHABLE && !pinningAvailable ? `${problem} (This build cannot trust the till's certificate: use the development build, not Expo Go.)` : problem);
  };

  const boxSize = Math.min(width - 56, 320);
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12, gap: 16 }} keyboardShouldPersistTaps="handled" style={{ backgroundColor: t.background }}>
      <Logo height={28} />
      <Card title="Pair with the till" style={{ width: '100%', maxWidth: 420 }}>
        <Text style={{ color: t.mutedForeground, fontSize: 14 }}>On the till, open Devices and press Pair a device, then scan its code.</Text>
        {permission?.granted ? (
          <View style={{ width: boxSize, height: boxSize, alignSelf: 'center', borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={busy ? undefined : ({ data }) => void submit(data)}
            />
          </View>
        ) : (
          <Button variant="outline" onPress={() => void requestPermission()}>
            {permission && !permission.canAskAgain ? 'Camera blocked: allow it in Settings' : 'Allow camera to scan'}
          </Button>
        )}
        <Field label="Or paste the address">
          <Input value={text} onChangeText={setText} placeholder="https://…" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        </Field>
        {error && (
          <Text accessibilityRole="alert" selectable style={{ color: t.destructive, fontSize: 14 }}>
            {error}
          </Text>
        )}
        <Button size="lg" disabled={busy || !text.trim()} onPress={() => void submit(text)}>
          {busy ? 'Pairing…' : 'Pair'}
        </Button>
      </Card>
    </ScrollView>
  );
}

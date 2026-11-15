import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { subtotal, type LineItem } from '@micropos/core';

// Placeholder screen proving the shared core package resolves. Money is integer cents.
const DEMO: LineItem[] = [
  { sku: 'A', unitPrice: 250, qty: 2 },
  { sku: 'B', unitPrice: 199, qty: 1 },
];

export default function App() {
  const cents = subtotal(DEMO);
  return (
    <View style={styles.container}>
      <Text style={styles.title}>MicroPOS</Text>
      <Text>Core subtotal: {cents} cents</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
});

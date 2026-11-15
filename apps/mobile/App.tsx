import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BannerProvider } from './src/banner';
import { AppShell } from './src/layout/AppShell';
import { findLabel } from './src/layout/nav';
import { ComponentsScreen } from './src/screens/ComponentsScreen';
import { TillProvider, useTill } from './src/lan/TillProvider';
import { PairingScreen } from './src/screens/PairingScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ThemeProvider } from './src/theme';

/** Until the phone is paired with a till there is nothing to show but the pairing screen. */
function Gate() {
  const { state } = useTill();
  // No router yet: the shell keeps the current screen id.
  const [route, setRoute] = useState(__DEV__ ? 'components' : 'dashboard');
  if (state.status === 'loading') return null;
  if (state.status === 'unpaired') return <PairingScreen />;
  return (
    <AppShell route={route} onNavigate={setRoute}>
      {(metrics) =>
        route === 'components' ? <ComponentsScreen {...metrics} /> : route === 'settings' ? <SettingsScreen /> : <PlaceholderScreen title={findLabel(route)} />
      }
    </AppShell>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <BannerProvider>
          <TillProvider>
            <Gate />
          </TillProvider>
          <StatusBar style="auto" />
        </BannerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

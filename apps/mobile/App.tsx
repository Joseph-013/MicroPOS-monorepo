import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BannerProvider } from './src/banner';
import { AppShell } from './src/layout/AppShell';
import { findLabel } from './src/layout/nav';
import { ComponentsScreen } from './src/screens/ComponentsScreen';
import { PlaceholderScreen } from './src/screens/PlaceholderScreen';
import { ThemeProvider } from './src/theme';

export default function App() {
  // No router yet: the shell keeps the current screen id.
  const [route, setRoute] = useState(__DEV__ ? 'components' : 'dashboard');
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <BannerProvider>
          <AppShell route={route} onNavigate={setRoute}>
            {(metrics) => (route === 'components' ? <ComponentsScreen {...metrics} /> : <PlaceholderScreen title={findLabel(route)} />)}
          </AppShell>
          <StatusBar style="auto" />
        </BannerProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

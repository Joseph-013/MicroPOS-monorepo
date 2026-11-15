import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { themes, type ColorTokens } from '@micropos/theme';

const ThemeContext = createContext<ColorTokens>(themes.light);

/** Colors come from the shared @micropos/theme tokens; follows the system light/dark setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  return <ThemeContext.Provider value={scheme === 'dark' ? themes.dark : themes.light}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ColorTokens => useContext(ThemeContext);

/** Touch sizing, same as the desktop's --control-height variables. */
export const CONTROL = { sm: 36, md: 44, lg: 56 } as const;

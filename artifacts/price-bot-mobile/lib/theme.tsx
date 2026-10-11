import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from '@/constants/theme';
import { keys, prefs } from '@/lib/storage';

export type ThemeMode = 'system' | 'dark' | 'light';

const ThemeContext = createContext<{ c: Palette; mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({
  c: dark, mode: 'system', setMode: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');
  useEffect(() => {
    void prefs.get<ThemeMode>(keys.theme, 'system').then(setModeState);
  }, []);
  const value = useMemo(() => {
    // The brand is dark-first: "system" follows the phone, but only switches to light when the phone asks for it.
    const scheme = mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
    return {
      c: scheme === 'light' ? light : dark,
      mode,
      setMode: (next: ThemeMode) => { setModeState(next); void prefs.set(keys.theme, next); },
    };
  }, [mode, system]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

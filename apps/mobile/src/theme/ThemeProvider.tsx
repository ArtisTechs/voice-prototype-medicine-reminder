import * as SecureStore from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { palettes, statusTokens, type Palette } from './tokens';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'medrem.theme';

type Theme = {
  scheme: 'light' | 'dark';
  colors: Palette;
  status: (typeof statusTokens)['light'];
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
};

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [pref, setPrefState] = useState<ThemePref>('system');

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v);
      })
      .catch(() => {});
  }, []);

  const value = useMemo<Theme>(() => {
    const scheme = pref === 'system' ? (system === 'dark' ? 'dark' : 'light') : pref;
    return {
      scheme,
      colors: palettes[scheme],
      status: statusTokens[scheme],
      pref,
      setPref: (p) => {
        setPrefState(p);
        SecureStore.setItemAsync(KEY, p).catch(() => {});
      },
    };
  }, [pref, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return { scheme: 'light', colors: palettes.light, status: statusTokens.light, pref: 'system', setPref: () => {} };
}

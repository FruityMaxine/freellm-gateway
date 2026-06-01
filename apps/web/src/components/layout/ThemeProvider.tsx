import { createContext, useContext, useEffect, useState } from 'react';
import { useSystemDark } from '@/lib/hooks';

type ThemeMode = 'dark' | 'light' | 'auto';

interface ThemeCtx {
  mode: ThemeMode;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = 'freellm.theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemDark = useSystemDark();
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'dark';
  });

  const isDark = mode === 'auto' ? systemDark : mode === 'dark';

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.classList.toggle('light', !isDark);
  }, [isDark]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return <Ctx.Provider value={{ mode, isDark, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}

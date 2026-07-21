import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useSettingsSlice } from './settings-store';

const DarkModeContext = createContext<boolean | undefined>(undefined);

export interface DarkModeProviderProps {
  children: ReactNode;
}

/**
 * Resolves the effective light/dark mode (matching the `light`/`dark` class
 * toggled on `<html>`), exposes it via context, and side-effects `uiScale`
 * onto the root element.
 */
export const DarkModeProvider = ({ children }: Readonly<DarkModeProviderProps>) => {
  const [uiSettings] = useSettingsSlice('ui');
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  // Track the OS preference while in `system` mode so `isDark` stays in sync
  // with the class `setMode` toggles on `<html>`.
  useEffect(() => {
    if (uiSettings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [uiSettings.theme]);

  const isDark = uiSettings.theme === 'system' ? systemPrefersDark : uiSettings.theme === 'dark';

  useEffect(() => {
    document.documentElement.style.fontSize = `${uiSettings.uiScale}%`;

    const cl = document.documentElement.classList;
    if (isDark) {
      cl.remove('light');
      cl.add('dark');
    } else {
      cl.remove('dark');
      cl.add('light');
    }
  }, [isDark, uiSettings.uiScale]);

  return <DarkModeContext.Provider value={isDark}>{children}</DarkModeContext.Provider>;
};

/**
 * Reads the effective dark mode from `UiSettingsProvider`. Throws if used
 * outside the provider to catch misuse early.
 */
export function useIsDarkMode(): boolean {
  const isDark = useContext(DarkModeContext);
  if (isDark === undefined) {
    throw new Error('useIsDarkMode must be used within a UiSettingsProvider');
  }
  return isDark;
}

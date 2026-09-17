"use client";

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

import { resolveTheme, type Theme } from "./product-themes";
export type { Theme } from "./product-themes";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  theme: "light",
  setTheme: () => {},
});

const STORAGE_KEY = "traqen-theme";

function applyTheme(id: Theme) {
  const theme = resolveTheme(id);
  document.documentElement.dataset.theme = theme.id;
  document.documentElement.style.colorScheme = theme.colorScheme;
  for (const [key, value] of Object.entries(theme.tokens)) document.documentElement.style.setProperty(`--${key}`, value);
}

function subscribeTheme(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    applyTheme(resolveTheme(event.newValue).id);
    notify();
  };
  window.addEventListener("traqen:theme", notify);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("traqen:theme", notify); window.removeEventListener("storage", onStorage); };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The pre-paint script and the selector read the same theme; no delayed second state.
  const theme = useSyncExternalStore(subscribeTheme, () => resolveTheme(document.documentElement.dataset.theme ?? null).id, () => "light" as Theme);

  const setTheme = useCallback((next: Theme) => {
    const id = resolveTheme(next).id;
    applyTheme(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Storage is optional. */ }
    window.dispatchEvent(new Event("traqen:theme"));
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "enterprise" | "apple" | "warm" | "fresh" | "minimal";

const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>({
  theme: "enterprise",
  setTheme: () => {},
});

const STORAGE_KEY = "traqen-theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "enterprise";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && ["enterprise", "apple", "warm", "fresh", "minimal"].includes(stored)) return stored;
  } catch {
    // ignore
  }
  return "enterprise";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("enterprise");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setThemeState(getInitialTheme()));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

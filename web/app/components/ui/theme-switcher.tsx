"use client";

import { useTheme, type Theme } from "../../theme-context";

const themes: Array<{ key: Theme; label: string; dot: string }> = [
  { key: "enterprise", label: "Enterprise", dot: "#2563eb" },
  { key: "apple", label: "Apple", dot: "#007aff" },
  { key: "warm", label: "Warm", dot: "#d97706" },
  { key: "fresh", label: "Fresh", dot: "#10b981" },
  { key: "minimal", label: "Minimal", dot: "#0066cc" },
];

export function ThemeSwitcher({ ariaLabel }: { ariaLabel?: string }) {
  const { theme, setTheme } = useTheme();
  const activeTheme = themes.find((item) => item.key === theme) ?? themes[0];

  return (
    <label className="theme-switch" title={ariaLabel ?? "Color theme"}>
      <span className="theme-dot" style={{ background: activeTheme.dot }} aria-hidden="true" />
      <select aria-label={ariaLabel ?? "Color theme"} value={theme} onChange={(event) => setTheme(event.currentTarget.value as Theme)}>
        {themes.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select>
    </label>
  );
}

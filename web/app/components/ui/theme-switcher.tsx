"use client";

import { useTheme, type Theme } from "../../theme-context";
import { themes } from "../../product-themes";

export function ThemeSwitcher({ ariaLabel }: { ariaLabel?: string }) {
  const { theme, setTheme } = useTheme();
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0];

  return (
    <label className="theme-switch" title={ariaLabel ?? "Color theme"}>
      <span className="theme-dot" style={{ background: activeTheme.tokens.accent }} aria-hidden="true" />
      <select aria-label={ariaLabel ?? "Color theme"} value={theme} onChange={(event) => setTheme(event.currentTarget.value as Theme)}>
        {themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
  );
}

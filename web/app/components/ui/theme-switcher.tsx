"use client";

import { useTheme, type Theme } from "../../theme-context";

const themes: Array<{ key: Theme; label: string; dot: string }> = [
  { key: "apple", label: "Apple", dot: "#007aff" },
  { key: "warm", label: "Warm", dot: "#d97706" },
  { key: "fresh", label: "Fresh", dot: "#10b981" },
  { key: "minimal", label: "Minimal", dot: "#0066cc" },
];

export function ThemeSwitcher({ ariaLabel }: { ariaLabel?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className="theme-switch"
      role="group"
      aria-label={ariaLabel ?? "Color theme"}
      title={ariaLabel ?? "Color theme"}
    >
      {themes.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={theme === item.key}
          className={theme === item.key ? "active" : ""}
          onClick={() => setTheme(item.key)}
        >
          <span className="theme-dot" style={{ background: item.dot }} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

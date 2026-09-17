export const themes = [
  { id: "light", label: "瓷白浅色", colorScheme: "light", tokens: {
    ink: "#1d1d1f", muted: "#626570", paper: "#f5f5f7", panel: "#ffffff", line: "#e1e3e8", control: "#898f9b",
    accent: "#0066cc", "accent-hover": "#0054a8", "accent-subtle": "#e8f1ff", "on-accent": "#ffffff",
    success: "#28714b", "success-subtle": "#edf7f1", warning: "#945c05", "warning-subtle": "#fff5e3", danger: "#b43232", "danger-subtle": "#fff0ef",
    info: "#0066cc", "surface-muted": "#f0f1f4", "sidebar-bg": "#ebedf1", "sidebar-text": "#1d1d1f", "sidebar-muted": "#626570", "sidebar-border": "#e1e3e8", "sidebar-hover": "#ffffff",
    "code-bg": "#f0f1f4", "graph-node": "#ffffff", "graph-edge": "#626570", disabled: "#6b6f7b", focus: "#0066cc", "shadow": "0 1px 3px #1d1d1f08", "shadow-lg": "0 12px 36px #1d1d1f18",
  } },
  { id: "dark", label: "石墨深色", colorScheme: "dark", tokens: {
    ink: "#f2f3f6", muted: "#b3b7c3", paper: "#16171b", panel: "#222329", line: "#3c3e48", control: "#72788a",
    accent: "#84bbff", "accent-hover": "#add1ff", "accent-subtle": "#263b59", "on-accent": "#162333",
    success: "#8dceac", "success-subtle": "#213c30", warning: "#eac283", "warning-subtle": "#40331f", danger: "#ffaaa4", "danger-subtle": "#442a2c",
    info: "#84bbff", "surface-muted": "#292b33", "sidebar-bg": "#1c1d23", "sidebar-text": "#f2f3f6", "sidebar-muted": "#b3b7c3", "sidebar-border": "#3c3e48", "sidebar-hover": "#292b33",
    "code-bg": "#1c1d23", "graph-node": "#222329", "graph-edge": "#b3b7c3", disabled: "#9a9eab", focus: "#84bbff", "shadow": "0 1px 3px #00000020", "shadow-lg": "0 12px 36px #00000050",
  } },
] as const;
export type Theme = typeof themes[number]["id"];
export const resolveTheme = (id: string | null) => themes.find(theme => theme.id === id) ?? themes[0];

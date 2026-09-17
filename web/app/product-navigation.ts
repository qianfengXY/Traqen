export const pageRoutes = {
  overview: "overview", workspace: "sources", feature: "evidence", graph: "graph",
  review: "review", impact: "impact", templates: "templates", settings: "settings",
} as const;
export type ProductView = keyof typeof pageRoutes | "not-found";

export function readProductRoute(search: string): { view: ProductView; workspaceId: string | null } {
  const params = new URLSearchParams(search);
  const page = params.get("page") ?? "overview";
  const view = (Object.keys(pageRoutes) as Array<keyof typeof pageRoutes>).find(key => pageRoutes[key] === page) ?? "not-found";
  return { view, workspaceId: params.get("workspace") };
}

export function productHref(view: ProductView, workspaceId: string | null) {
  const params = new URLSearchParams({ page: view === "not-found" ? "unknown" : pageRoutes[view] });
  if (workspaceId !== null) params.set("workspace", workspaceId);
  return `/?${params}`;
}

export function writeProductRoute(view: ProductView, workspaceId: string | null, replace = false) {
  const href = productHref(view, workspaceId);
  if (`${location.pathname}${location.search}` === href) return;
  window.history[replace ? "replaceState" : "pushState"](null, "", href);
  window.dispatchEvent(new Event("traqen:navigate"));
}

export function subscribeProductRoute(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener("traqen:navigate", notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener("traqen:navigate", notify); };
}

// One desktop canvas, with the same content and proportions at both reference sizes.
// Small CSS viewports (including browser zoom) reflow at natural size for legibility.
export function desktopScale(width: number, height: number) {
  return Math.max(1, Math.min(width / 1440, height / 900));
}

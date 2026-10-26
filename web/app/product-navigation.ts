import { sourceReferenceParams, type SourceReference } from "./source-truth/context.ts";

export const pageRoutes = {
  overview: "overview", workspace: "sources", feature: "evidence", graph: "graph",
  review: "review", impact: "impact", templates: "templates", settings: "settings",
} as const;
export type ProductView = keyof typeof pageRoutes | "not-found";
export const accessViewFromRoute = (search: string) => ["overview", "settings"].includes(readProductRoute(search).view)
  ? new URLSearchParams(search).get("view") : null;

export function readProductRoute(search: string): { view: ProductView; workspaceId: string | null } {
  const params = new URLSearchParams(search);
  const page = params.get("page") ?? "overview";
  const view = (Object.keys(pageRoutes) as Array<keyof typeof pageRoutes>).find(key => pageRoutes[key] === page) ?? "not-found";
  return { view, workspaceId: params.get("workspace") };
}

export function productHref(view: ProductView, workspaceId: string | null, source?: Partial<SourceReference>) {
  const params = new URLSearchParams({ page: view === "not-found" ? "unknown" : pageRoutes[view] });
  if (workspaceId !== null) params.set("workspace", workspaceId);
  if (view === "workspace" && source && source.workspaceId === workspaceId) for (const [key, value] of sourceReferenceParams(source)) params.set(key, value);
  return `/?${params}`;
}

export function writeProductRoute(view: ProductView, workspaceId: string | null, replace = false) {
  let href = productHref(view, workspaceId);
  const prior = readProductRoute(location.search);
  if (prior.workspaceId === workspaceId && ["graph", "feature"].includes(prior.view) && ["graph", "feature"].includes(view)
    && !(prior.view === "graph" && new URLSearchParams(location.search).has("runId"))) {
    const next = new URL(href, location.origin), params = new URLSearchParams(location.search);
    for (const key of ["revision", "objectId"]) if (params.has(key)) next.searchParams.set(key, params.get(key)!);
    href = next.pathname + next.search;
  }
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

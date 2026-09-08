export type InventoryFilter = { query: string; componentId: string; disposition: string };

export function inventoryRoute(route: string, filter: InventoryFilter, cursor: string | null) {
  const [pathname, search = ""] = route.split("?", 2);
  const query = new URLSearchParams(search);
  query.set("limit", "100");
  for (const [key, value] of Object.entries({ ...filter, cursor })) {
    if (value) query.set(key, value); else query.delete(key);
  }
  return `${pathname}?${query}`;
}

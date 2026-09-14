import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inventoryRoute } from "../app/source-truth/inventory.ts";

test("inventory query preserves the exact historical receipt and sends literal search/filter state on every bounded page", () => {
  const route = "/bundles/frozen/inventory-history?receiptId=receipt%2B1";
  const filter = { query: "订单% &x", componentId: "a".repeat(64), disposition: "VERIFIED" };
  for (const cursor of [null, "page-token"]) {
    const url = new URL(inventoryRoute(route, filter, cursor), "http://isolated.invalid");
    assert.equal(url.pathname, "/bundles/frozen/inventory-history");
    assert.equal(url.searchParams.get("receiptId"), "receipt+1");
    assert.equal(url.searchParams.get("query"), filter.query);
    assert.equal(url.searchParams.get("componentId"), filter.componentId);
    assert.equal(url.searchParams.get("disposition"), filter.disposition);
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("cursor"), cursor);
  }
  const cleared = new URL(inventoryRoute(route, { query: "", componentId: "", disposition: "" }, null), "http://isolated.invalid");
  for (const key of ["query", "componentId", "disposition", "cursor"]) assert.equal(cleared.searchParams.has(key), false);
});

test("live and historical material views expose accessible search and component-aware results without local page filtering", async () => {
  const source = await readFile(new URL("../app/source-truth/evidence-view.tsx", import.meta.url), "utf8");
  assert.match(source, /type="search"/, "path search must be available in the real material table");
  assert.match(source, /组件筛选/); assert.match(source, /处置筛选/);
  assert.match(source, /inventoryRoute\(/);
  assert.match(source, /matchedCount/);
  assert.doesNotMatch(source, /page\.items\.filter\(/, "the current page cannot stand in for a full inventory search");
});

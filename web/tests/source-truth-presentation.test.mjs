import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source access failure does not also claim verification is still loading", async () => {
  const source = await readFile(new URL("../app/source-truth/workbench.tsx", import.meta.url), "utf8");
  assert.match(source, /!overview\s*\?\s*\(error\s*\?/);
  assert.match(source, /来源访问尚未就绪/);
});

test("source navigation names the actual workflow rather than the retired analysis entry", async () => {
  const source = await readFile(new URL("../app/traqen-product.tsx", import.meta.url), "utf8");
  assert.match(source, /key: "workspace"[^\n]*zh: "来源快照"/);
  const surface = await readFile(new URL("../app/product-surfaces.tsx", import.meta.url), "utf8");
  const entry = surface.slice(surface.indexOf("export function EmptyWorkspace"), surface.indexOf("export function WorkspaceOverview"));
  assert.doesNotMatch(entry, /FULL 分析|immutable execution profile/);
  assert.match(entry, /error.*role="alert"/s);
});

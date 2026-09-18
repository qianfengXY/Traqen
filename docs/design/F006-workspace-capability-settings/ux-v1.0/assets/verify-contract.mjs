/**
 * Static contract guard for the F006 fixture-only UX prototype.
 * It intentionally does not connect to a product service.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const html = await readFile(resolve(here, "prototype.html"), "utf8");

for (const scene of ["empty", "accounts", "models", "team", "capabilities", "conflict", "lifecycle", "mcp", "versions", "f003"]) {
  assert.match(html, new RegExp(`\\b${scene}\\s*:`), `missing ${scene} fixture scene`);
}
for (const control of ["scope-switcher", "theme-switcher", "agent-child-2", "conflict-retry", "lifecycle-dialog", "mcp-paused", "f003-fixture-only"]) {
  assert.match(html, new RegExp(`data-testid=["']${control}["']`), `missing ${control} interaction anchor`);
}
assert.match(html, /window\.__f006UX/, "fixture state must be inspectable by the isolated verifier");
assert.match(html, /零业务写入/, "fixture must label simulated-write evidence honestly");
console.log(JSON.stringify({ result: "PASS", contract: "F006-UX-v1.0", scenes: 10 }));

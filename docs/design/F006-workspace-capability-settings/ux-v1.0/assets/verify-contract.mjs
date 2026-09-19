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

for (const scene of ["empty", "accounts", "models", "skills", "team", "capabilities", "conflict", "lifecycle", "mcp", "versions", "f003"]) {
  assert.match(html, new RegExp(`\\b${scene}\\s*:`), `missing ${scene} fixture scene`);
}
for (const control of ["scope-switcher", "theme-switcher", "agent-child-2", "conflict-retry", "conflict-server", "recovery-success", "lifecycle-dialog", "mcp-paused", "f003-fixture-only", "product-toolbar", "recent-viewed", "workspace-settings-nav", "global-settings-nav", "draft-saved", "apply-scope", "versions-entry", "versions-return", "fixture-tools", "legacy-authorization", "logical-stage"]) {
  assert.match(html, new RegExp(`data-testid=["']${control}["']`), `missing ${control} interaction anchor`);
}
assert.match(html, /window\.__f006UX/, "fixture state must be inspectable by the isolated verifier");
assert.match(html, /零业务写入/, "fixture must label simulated-write evidence honestly");
assert.match(html, /const agentConfigs/, "agent card Skill counts must have one source of truth");
assert.match(html, /function applyDesktopScale/, "desktop fixture must calculate one logical-canvas scale");
assert.match(html, /innerWidth >= 1440 && innerHeight >= 900/, "smaller ordinary windows must enter accessibility layout");
assert.match(html, /const scale = isDesktop \? Math\.min\(innerWidth \/ 1440, innerHeight \/ 900\) : 1/, "smaller ordinary windows must retain the 1× scale floor");
assert.match(html, /#logical-stage \{ width: 1440px; min-height: 900px; height: auto; margin: 0 auto; overflow: visible;/, "logical canvas must grow vertically rather than crop lower configuration and sidebar content");
assert.match(html, /grid-template-columns: 320px minmax\(0, 1fr\)/, "the F006 team list must stay 320 logical px wide on the desktop master");
assert.match(html, /采用服务器草稿（丢弃未保存本地编辑）/, "the server-draft recovery action must disclose local M3 discard before it happens");
assert.match(html, /function syncDesktopStageHeight/, "scaled desktop pages must reserve document height for vertically reachable content");
assert.doesNotMatch(html, /wide-only/, "wide screens must not reveal extra fixture-only content");
assert.doesNotMatch(html, /可以应用/, "agent cards must not imply a local Apply action");
console.log(JSON.stringify({ result: "PASS", contract: "F006-UX-v1.0", scenes: 11 }));

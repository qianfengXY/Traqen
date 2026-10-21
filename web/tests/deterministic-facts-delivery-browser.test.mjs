import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("delivery lifecycle browser lane is opt-in and runs after the real connected evidence reader", () => {
  const runner = readFileSync(new URL("../../test/support/f002-interface-browser.mjs", import.meta.url), "utf8");
  assert.ok(runner.includes('"--delivery-lifecycle"'), "admit the explicit bounded delivery lane");
  assert.match(runner, /deliveryLifecycle: mode === "--delivery-lifecycle"/);
  assert.ok(runner.indexOf("await verifyDeliveryLifecycle(") > runner.indexOf("await connect();"));
  assert.match(runner, /mode === "--theme-contrast" \|\| mode === "--delivery-lifecycle"/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readProductRoute, productHref, desktopScale } from "../app/product-navigation.ts";
import { themes, resolveTheme } from "../app/product-themes.ts";

test("deep links distinguish an unspecified workspace from explicit creation and preserve exact IDs", () => {
  assert.equal(readProductRoute("").workspaceId, null);
  assert.equal(readProductRoute("?page=sources&workspace=").workspaceId, "");
  const identity = "tenant / 中文 & #draft";
  const href = productHref("workspace", identity);
  assert.deepEqual(readProductRoute(new URL(href, "https://example.test").search), { view: "workspace", workspaceId: identity });
  assert.equal(readProductRoute("?page=does-not-exist").view, "not-found");
});

test("both desktop references use one canvas while browser zoom can reflow at natural size", () => {
  assert.equal(desktopScale(1440, 900), 1);
  assert.equal(desktopScale(2560, 1440), 1.6);
  assert.equal(desktopScale(720, 450), 1);
});

test("registered light and dark themes cover identical semantic tokens and old preferences migrate safely", () => {
  assert.deepEqual(themes.map(theme => theme.id), ["light", "dark"]);
  assert.deepEqual(Object.keys(themes[0].tokens).sort(), Object.keys(themes[1].tokens).sort());
  assert.equal(resolveTheme("enterprise").id, "light");
  assert.equal(resolveTheme("dark").colorScheme, "dark");
});

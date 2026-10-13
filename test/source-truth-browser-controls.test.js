import assert from "node:assert/strict";
import test from "node:test";
import { datetimeLocalValue } from "./support/source-truth-browser-controls.mjs";

test("browser acceptance helper preserves the exact second and uses HTML-normalized local datetime", () => {
  const minute = new Date("2026-10-13T05:25:00.000Z"), second = new Date("2026-10-13T05:25:01.000Z");
  assert.match(datetimeLocalValue(minute), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.match(datetimeLocalValue(second), /:01$/);
  assert.equal(new Date(datetimeLocalValue(minute)).getTime(), minute.getTime());
  assert.equal(new Date(datetimeLocalValue(second)).getTime(), second.getTime());
});

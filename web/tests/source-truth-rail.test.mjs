import assert from "node:assert/strict";
import test from "node:test";
import { revealSourceStation } from "../app/source-truth/rail.ts";

test("station reveal scrolls only the clipped distance in its own horizontal container", () => {
  const calls = [];
  let bounds = { left: 555, right: 639 };
  const rail = {
    querySelector: (selector) => { assert.equal(selector, '[data-station="7"]'); return { getBoundingClientRect: () => bounds }; },
    getBoundingClientRect: () => ({ left: 51, right: 339 }),
    scrollBy: (options) => calls.push(options),
  };
  revealSourceStation(rail, 7);
  assert.deepEqual(calls, [{ left: 300, behavior: "auto" }]);
  bounds = { left: 255, right: 339 };
  revealSourceStation(rail, 7);
  assert.equal(calls.length, 1, "a visible station causes no polling/resize jitter");
  bounds = { left: -33, right: 51 };
  revealSourceStation(rail, 7);
  assert.deepEqual(calls[1], { left: -84, behavior: "auto" });
});

test("missing rails, missing buttons and invalid stations cannot scroll or query arbitrary selectors", () => {
  revealSourceStation(null, 7);
  for (const value of [0, 9, 1.5, NaN]) revealSourceStation({ querySelector: () => assert.fail("invalid station") }, value);
  revealSourceStation({ querySelector: () => null }, 7);
});

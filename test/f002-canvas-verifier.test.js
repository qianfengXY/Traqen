import assert from "node:assert/strict";
import test from "node:test";
import { assertCanvasSample, assertCanvasTarget, canvasControlRendered, canvasSizes, traversalDeadlineMs } from "./support/f002-canvas-checks.mjs";

// These are verifier-unit inputs, never substitutes for real browser samples.
test("full32-condition execution has a bounded plan-sized budget without changing original or diagnostic limits", () => {
  assert.equal(traversalDeadlineMs("--canvas-matrix"), 40_000 + 4 * 2 * canvasSizes.length * 10_000);
  assert.equal(traversalDeadlineMs(), 180_000);
  assert.equal(traversalDeadlineMs("--scroll-anchoring-diagnostic"), 180_000);
  assert.equal(traversalDeadlineMs("--canvas-disclosure-diagnostic"), 180_000);
});
function sample() {
  return { tab: "objects", viewport: { width: 1440, height: 900 }, scale: 1, dpr: 1, pinch: 1, rootFont: 16,
    shell: { width: 1440, height: 900, left: 0, top: 0 }, tabCount: 4, activeTabs: ["对象与事实"],
    controls: [{ tag: "BUTTON", disabled: false, rendered: true, text: "保留操作" }], textDigest: "digest", reference: "fixed",
    disclosures: [{ summary: "成员身份", open: false }, { summary: "请求", open: true }],
    positions: { ".main": [0, 0], ".f002-detail": [0, 120] }, shellWarning: "unconfigured legacy runtime",
    regions: Object.fromEntries([".sidebar", ".topbar", "#product-content", ".f002-context", ".f002-tabs"].map(key => [key, { left: 0, top: 0, width: 224, height: 66 }])) };
}
test("canvas verifier requires the real desktop scale and centering while treating1280 as separate reachability", () => {
  const base = sample(); assert.doesNotThrow(() => assertCanvasSample(base));
  assert.deepEqual(canvasSizes, [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1280, height: 800 }]);
  for (const [width, height, scale, left] of [[1920,1080,1.2,96], [2560,1440,1.6,128], [1280,800,1,0]]) {
    const actual = { ...base, viewport: { width, height }, scale, shell: { width: width < 1440 ? width : 1440 * scale, height: height < 900 ? height : 900 * scale, left, top: 0 } };
    assert.doesNotThrow(() => assertCanvasSample(actual, base));
    assert.throws(() => assertCanvasSample({ ...actual, scale: .8 }, base));
    assert.throws(() => assertCanvasSample({ ...actual, shell: { ...actual.shell, left: left + 1 } }, base));
  }
});
test("canvas visibility rejects positive layout boxes in skipped closed details content", () => {
  // R61 actual: password and target FUNCTION have rectCount1/visible but
  // checkVisibility false at both sizes; only the old rectangle probe flips.
  assert.equal(canvasControlRendered({ rectCount: 1, visibility: "visible", painted: false }), false);
  assert.equal(canvasControlRendered({ rectCount: 0, visibility: "visible", painted: false }), false);
  assert.equal(canvasControlRendered({ rectCount: 1, visibility: "visible", painted: true }), true, "closed details SUMMARY itself stays visible");
  assert.equal(canvasControlRendered({ rectCount: 1, visibility: "hidden", painted: true }), false);
  assert.equal(canvasControlRendered({ rectCount: 1, visibility: "collapse", painted: true }), false);
});
test("canvas visibility fails closed for absent or invalid actual measurements", () => {
  for (const measurement of [{ rectCount: 1, visibility: "visible" }, { rectCount: 1, visibility: "visible", painted: "true" },
    { rectCount: Infinity, visibility: "visible", painted: true }, { rectCount: 1, painted: true }]) {
    assert.equal(canvasControlRendered(measurement), false);
  }
});
test("canvas comparison independently retains actual disclosure open state", () => {
  const base = sample();
  assert.throws(() => assertCanvasSample({ ...base, disclosures: [{ summary: "成员身份", open: true }, base.disclosures[1]] }, base));
  assert.throws(() => assertCanvasSample({ ...base, disclosures: [] }, base));
  assert.throws(() => assertCanvasSample({ ...base, disclosures: undefined }, base));
});
test("canvas comparison cannot pass missing controls changed authority dropped regions or invalid measurements", () => {
  const base = sample();
  for (const patch of [{ controls: [] }, { controls: [{ ...base.controls[0], disabled: true }] }, { controls: [{ ...base.controls[0], rendered: false }] },
    { textDigest: "different" }, { reference: "latest" }, { positions: { ".main": [0,0], ".f002-detail": [0,0] } },
    { shellWarning: null }, { graph: "reset-viewport" }, { activeTabs: [] }, { activeTabs: ["关系"] }, { tabCount: 3 }, { dpr: 2 }, { pinch: 2 }, { rootFont: 8 },
    { regions: {} }, { viewport: { width: NaN, height: 900 } },
    { regions: { ...base.regions, ".sidebar": { ...base.regions[".sidebar"], width: 225 } } }]) {
    assert.throws(() => assertCanvasSample({ ...base, ...patch }, base));
  }
});
test("canvas physical targets require full finite viewport bounds real hit focus and ring without clipping tolerance", () => {
  const actual = { rendered: true, hit: true, focused: true, disabled: false, outline: 3, outlineStyle: "solid",
    box: { left: 20, top: 20, right: 120, bottom: 60, width: 100, height: 40 }, viewport: { width: 1280, height: 800 } };
  assert.doesNotThrow(() => assertCanvasTarget(actual));
  for (const patch of [{ hit: false }, { focused: false }, { rendered: false }, { outline: 2 }, { outlineStyle: "none" },
    { box: { ...actual.box, left: -.01 } }, { box: { ...actual.box, bottom: 800.01 } }, { box: { ...actual.box, width: NaN } },
    { viewport: { width: Infinity, height: 800 } }]) {
    assert.throws(() => assertCanvasTarget({ ...actual, ...patch }));
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buttonTextContrast, settleWorkbenchTheme } from "./support/f002-theme-contrast-checks.mjs";

const row = (color, backgrounds) => ({ rendered: true, color, backgrounds, opacity: backgrounds.map(() => 1), images: backgrounds.map(() => "none") });
test("button contrast measures foreground and actual ancestor backgrounds without substituting theme tokens", () => {
  assert.equal(buttonTextContrast(row("rgb(0, 0, 0)", ["rgb(255, 255, 255)"])), 21);
  assert.equal(buttonTextContrast(row("rgb(255, 255, 255)", ["rgb(255, 255, 255)"])), 1);
  assert.equal(buttonTextContrast(row("rgb(255, 255, 255)", ["rgba(0, 0, 0, 0)", "rgb(0, 0, 0)"])), 21);
  assert.ok(buttonTextContrast(row("rgba(0, 0, 0, 0.5)", ["rgb(255, 255, 255)"])) < 4.5);
});
test("button contrast cannot count unknown colors images or translucent groups as passing", () => {
  for (const value of ["transparent", "rgb(NaN, 0, 0)", "rgb(256, 0, 0)"]) assert.throws(() => buttonTextContrast(row(value, ["rgb(255, 255, 255)"])));
  assert.throws(() => buttonTextContrast({ ...row("rgb(0, 0, 0)", ["rgb(255, 255, 255)"]), opacity: [.7] }));
  assert.throws(() => buttonTextContrast({ ...row("rgb(0, 0, 0)", ["rgb(255, 255, 255)"]), images: ["url(unmeasured)"] }));
});
test("button contrast cannot measure the skipped paint of a closed disclosure as visible text", () => {
  assert.throws(() => buttonTextContrast({ ...row("rgb(255, 255, 255)", ["rgb(255, 255, 255)"]), rendered: false }));
});
test("the contrast browser lane requires the real connected reader and owned runtime preflight", async () => {
  const browser = await readFile(new URL("./support/f002-interface-browser.mjs", import.meta.url), "utf8");
  assert.ok(browser.includes('"--theme-contrast"'));
  assert.ok(browser.includes('mode === "--native-accessibility" || mode === "--theme-contrast"'));
  assert.ok(browser.indexOf("await verifyThemeContrast(") > browser.indexOf("await connect();"));
});

// Execute the actual browser callback, with deterministic frame and deadline delivery.
// This calibrates the waiter; it is not actual-page acceptance or a browser fixture.
function themePage({ animations = () => [], color = () => "rgb(0, 0, 0)", deliverFrames = true } = {}) {
  let frame = 0, nextId = 0;
  const frames = new Map(), timers = new Map(), deadlines = [];
  const node = { tagName: "BUTTON", className: "button", textContent: "Refresh", checkVisibility: () => true, parentElement: null };
  const context = {
    document: { documentElement: { dataset: { theme: "dark" } }, getAnimations: () => animations(frame) },
    getComputedStyle: () => ({ color: color(frame), backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(0, 0, 0)", opacity: "1", backgroundImage: "none" }),
    requestAnimationFrame: callback => { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, delay) => { const id = ++nextId; timers.set(id, callback); deadlines.push(delay); return id; },
    clearTimeout: id => timers.delete(id),
    nodes: [node],
  };
  const page = {
    waitForFunction: async (callback, theme) => assert.equal(runInNewContext(`(${callback})("${theme}")`, context), true),
    locator: selector => {
      assert.equal(selector, ".f002-workbench .button");
      return { evaluateAll: async callback => {
        let done = false;
        const result = runInNewContext(`(${callback})(nodes)`, context);
        Promise.resolve(result).then(() => { done = true; });
        for (let turn = 0; turn < 12 && !done; turn++) {
          await new Promise(resolve => setImmediate(resolve));
          if (deliverFrames && frames.size) {
            frame++;
            const pending = [...frames.values()]; frames.clear();
            for (const tick of pending) tick(frame * 16);
          }
        }
        if (!done) for (const expire of [...timers.values()]) expire();
        return await result;
      } };
    },
  };
  return { page, deadlines, frame: () => frame, pending: () => frames.size + timers.size };
}
const animation = (state = "running", pending = true) => ({
  constructor: { name: "CSSTransition" }, transitionProperty: "background-color", playState: state, pending,
  currentTime: 0, startTime: null, finished: new Promise(() => {}),
  effect: { target: null, getComputedTiming: () => ({ iterations: 1, endTime: 150 }) },
});

test("theme settling observes current frames when a retired animation's finished promise remains unresolved", async () => {
  const retired = animation(), harness = themePage({ animations: frame => frame === 0 ? [retired] : [] }), receipts = [];
  await settleWorkbenchTheme(harness.page, "dark", receipts);
  assert.equal(receipts[0].settled, true);
  assert.equal(receipts[0].before.length, 1); assert.equal(receipts[0].after.length, 0);
  assert.ok(harness.frame() >= 2, "require actual stable frames, not just an empty snapshot");
  assert.deepEqual(harness.deadlines, [5000]); assert.equal(harness.pending(), 0);
});

test("theme settling tracks replacement animations that were absent from its first snapshot", async () => {
  const replacement = animation();
  const harness = themePage({ animations: frame => frame > 0 && frame < 4 ? [replacement] : [] }), receipts = [];
  await settleWorkbenchTheme(harness.page, "dark", receipts);
  assert.ok(harness.frame() >= 5, "a new live transition must end before two stable frames");
  assert.equal(receipts[0].settled, true); assert.equal(harness.pending(), 0);
});

test("theme settling requires unchanged painted button styles across consecutive animation-free frames", async () => {
  const harness = themePage({ color: frame => frame === 2 ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)" });
  await settleWorkbenchTheme(harness.page, "dark");
  assert.ok(harness.frame() >= 4); assert.equal(harness.pending(), 0);
});

test("theme settling remains bounded and fails closed for live running, paused, or pending animations and absent frames", async () => {
  for (const [state, pending] of [["running", false], ["paused", false], ["idle", true]]) {
    const harness = themePage({ animations: () => [animation(state, pending)] }), receipts = [];
    await assert.rejects(settleWorkbenchTheme(harness.page, "dark", receipts), /did not settle within its diagnostic bound/);
    assert.equal(receipts[0].settled, false); assert.equal(receipts[0].after.length, 1);
    assert.deepEqual(harness.deadlines, [5000]); assert.equal(harness.pending(), 0);
  }
  const harness = themePage({ deliverFrames: false });
  await assert.rejects(settleWorkbenchTheme(harness.page, "dark"), /did not settle within its diagnostic bound/);
  assert.equal(harness.pending(), 0);
});

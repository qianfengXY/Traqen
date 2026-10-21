import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as capture from "./support/f002-native-capture.mjs";
import * as native from "./support/f002-native-accessibility-checks.mjs";
import { assertNativeBrowserZoom, assertCompleteFontMeasurements, assertTextEnlargement, nativeTextSelectors } from "./support/f002-native-accessibility-checks.mjs";

const baseline = { width: 1440, height: 900, dpr: 1 };
const zoomed = { width: 360, height: 225, dpr: 4, pinch: 1, applicationScale: 1, pageWidth: 360 };

const form = 'details.f002-panel:has(select[aria-label="取证请求类型"])';
const formTargets = [" > summary", " > p:first-of-type", ".f002-form-grid:nth-of-type(1) > label:nth-child(1)",
  ".f002-form-grid:nth-of-type(1) input", ".f002-form-grid:nth-of-type(1) > label:nth-child(2)",
  ".f002-form-grid:nth-of-type(1) textarea", ".f002-form-grid:nth-of-type(2) > label:nth-child(1)",
  'select[aria-label="取证请求类型"]', ".f002-form-grid:nth-of-type(2) > label:nth-child(1) small",
  ".f002-form-grid:nth-of-type(2) > label:nth-child(2)", 'select[aria-label="请求的已安装能力"]',
  ".f002-form-grid:nth-of-type(2) > label:nth-child(2) small", " > button:nth-of-type(1)", " > button:nth-of-type(2)",
  " > h3", " > label", " > label input", " > button:nth-of-type(3)"].map(target => `${form} ${target.trimStart()}`);

test("native text acceptance includes every exact request-form text family after the original eleven targets", () => {
  assert.deepEqual(nativeTextSelectors.slice(11, 29), formTargets);
});

test("native acceptance extends exact font and real Tab coverage to the new catalog without activating a read", () => {
  const catalog = `${form} section[aria-label="调查预算与请求清单"]`;
  assert.deepEqual(nativeTextSelectors.slice(29, 34), [" > h3:nth-of-type(1)", " > button", " > p:first-of-type", " > p:nth-of-type(2)", " > h3:nth-of-type(2)"].map(target => catalog + target));
  const checks = readFileSync(new URL("./support/f002-native-accessibility-checks.mjs", import.meta.url), "utf8");
  assert.match(checks, /controls = \[summary, investigation, question, purpose, capabilities, clear, submit, lookup, read, catalog\]/);
  assert.match(checks, /if \(controls\[index\] === read\) await lookup\.fill/);
});

test("native text acceptance retains all original 34 targets and adds both fixed request coordinates", () => {
  assert.deepEqual(nativeTextSelectors.slice(34, 36), [' > p[aria-label="固定取证基准"]', ' > p[aria-label="当前固定取证目标"]'].map(target => form + target));
});

test("native acceptance retains all original36 font targets and ten form controls while adding the material picker", () => {
  const picker = `${form} section[aria-label="取证材料重选"]`;
  assert.deepEqual(nativeTextSelectors.slice(36), [" > h3", " > p:first-of-type", " > div > button:first-of-type", " > div > button:nth-of-type(2)", " > p:last-of-type"].map(target => picker + target));
  const checks = readFileSync(new URL("./support/f002-native-accessibility-checks.mjs", import.meta.url), "utf8");
  assert.match(checks, /controls\.push\(materialPicker\)/);
  assert.match(checks, /getByRole\("button", \{ name: "从当前来源选择", exact: true \}\)/);
});

test("native form controls require real focus full finite bounds hit and a visible ring without clipping tolerance", () => {
  assert.equal(typeof native.assertNativeFormControl, "function");
  const state = { focused: true, visible: true, hit: true, outline: 3, outlineStyle: "solid",
    box: { left: 45, right: 315, top: 62.390625, bottom: 162.390625, width: 270, height: 100 }, viewport: { width: 360, height: 225 } };
  assert.doesNotThrow(() => native.assertNativeFormControl(state));
  for (const change of [{ focused: false }, { visible: false }, { hit: false }, { outline: 2 }, { outlineStyle: "none" },
    { box: { ...state.box, bottom: 225.8125 } }, { box: { ...state.box, left: -.01 } },
    { box: { ...state.box, width: NaN } }, { viewport: { width: Infinity, height: 225 } }]) {
    assert.throws(() => native.assertNativeFormControl({ ...state, ...change }));
  }
});

test("native form acceptance uses only the owned configured fixture and executes its reachability checks", () => {
  const runner = readFileSync(new URL("./support/f002-interface-browser.mjs", import.meta.url), "utf8");
  const checks = readFileSync(new URL("./support/f002-native-accessibility-checks.mjs", import.meta.url), "utf8");
  assert.match(runner, /requestForm: mode === "--request-form" \|\| mode === "--native-accessibility"/);
  assert.match(checks, /await reachableRequestForm\(theme, kind\)/);
  assert.match(checks, /assert\.equal\(proof\.requestForm\.posted\.length, 0/);
});

test("native clear semantics retain optional-capability submission and every independent clear and write guard", () => {
  const checks = readFileSync(new URL("./support/f002-native-accessibility-checks.mjs", import.meta.url), "utf8");
  const start = checks.indexOf('await clear.press("Enter")');
  const end = checks.indexOf("await capabilities.selectOption(draft.capabilities)", start);
  assert.ok(start >= 0 && end > start, "native acceptance must execute the actual clear action and restore its draft");
  const cleared = checks.slice(start, end);
  assert.match(cleared, /assert\.deepEqual\(await capabilities\.evaluate\([\s\S]*\), \[\]\)/);
  assert.match(cleared, /assert\.equal\(await submit\.isDisabled\(\), false,/, "empty optional capabilities are not an invalid input");
  assert.match(cleared, /assert\.equal\(await clear\.isDisabled\(\), true\)/);
  assert.match(checks, /assert\.equal\(proof\.requestForm\.posted\.length, 0/);
});

test("native browser zoom requires independent layout DPR pinch and application measurements", () => {
  assert.doesNotThrow(() => assertNativeBrowserZoom(baseline, zoomed, 4));
  for (const [key, value] of [["width", 1440], ["height", 900], ["dpr", 1], ["dpr", 3.3], ["pinch", 4], ["applicationScale", .25], ["pageWidth", 500]]) {
    assert.throws(() => assertNativeBrowserZoom(baseline, { ...zoomed, [key]: value }, 4), key);
  }
});

const measured = nativeTextSelectors.map(selector => ({ selector, present: true, size: 13 }));

test("font acceptance cannot silently omit duplicate reorder or substitute an actual target", () => {
  assert.doesNotThrow(() => assertCompleteFontMeasurements(measured));
  for (const rows of [measured.slice(1), [...measured, measured[0]], [...measured].reverse(),
    measured.map((row, index) => index === 3 ? { ...row, selector: ".f002-search label" } : row)]) {
    assert.throws(() => assertCompleteFontMeasurements(rows), /all actual font targets/);
  }
});

test("missing and non-numeric font targets must fail closed without replacement", () => {
  assert.throws(() => assertCompleteFontMeasurements(measured.map((row, index) => index === 3 ? { ...row, present: false, size: null } : row)), /missing actual font target/);
  for (const size of [null, NaN, Infinity, 0, -1, "13"]) {
    assert.throws(() => assertCompleteFontMeasurements(measured.map((row, index) => index === 3 ? { ...row, size } : row)), /non-numeric actual font measurement/);
  }
});

test("native font receipt cannot count as enlargement unless every actual text target doubles", () => {
  const doubled = measured.map(row => ({ ...row, size: row.size * 2 }));
  assert.doesNotThrow(() => assertTextEnlargement(measured, doubled));
  assert.throws(() => assertTextEnlargement(measured, measured), /native text200/);
  for (let index = 0; index < doubled.length; index += 1) {
    assert.throws(() => assertTextEnlargement(measured, doubled.map((row, position) => position === index ? { ...row, size: 13 } : row)), /native text200/);
  }
});

// Protocol stubs use only an IHDR header: these are unit checks of capture
// selection/geometry, never replacements for the real browser PNG evidence.
function pngHeader(width, height) {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12); png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
  return png;
}
async function captureFixture(t, { width = 1440, height = 900, changed = false, domChange = {} } = {}) {
  assert.equal(typeof capture.captureNativeViewport, "function", "native evidence must use a verified raw viewport capture");
  const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-native-capture-unit-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "viewport.png"), calls = [], png = pngHeader(width, height);
  let windows = 0;
  const dom = { width: 360, height: 225, dpr: 4, pinch: 1, rootFont: 16, applicationScale: 1, pageWidth: 360, ...domChange };
  const layout = { visualViewport: { clientWidth: 1440, clientHeight: 900, scale: 1, zoom: 4 },
    cssVisualViewport: { clientWidth: 360, clientHeight: 225, scale: 1, zoom: 4 } };
  const cdp = { async send(method, params) {
    calls.push({ method, params });
    if (method === "Page.getLayoutMetrics") return structuredClone(layout);
    if (method === "Browser.getWindowForTarget") return { windowId: 7, bounds: { width: changed && windows++ > 0 ? 1500 : 1440, height: 987 } };
    assert.equal(method, "Page.captureScreenshot");
    assert.deepEqual(params, { format: "png", fromSurface: true, captureBeyondViewport: false }, "no CSS/legacy clip, scaling or image rewriting");
    return { data: png.toString("base64") };
  } };
  return { file, png, calls, run: () => capture.captureNativeViewport({ page: {}, cdp, file, dimensions: async () => structuredClone(dom) }) };
}

test("native400 evidence records the unedited full physical viewport without a CSS-coordinate clip", async t => {
  const fixture = await captureFixture(t);
  const actual = await fixture.run();
  assert.equal(actual.method, "cdp-no-clip-native-viewport");
  assert.equal(actual.geometryVerified, true);
  assert.deepEqual(actual.pixels, { width: 1440, height: 900 });
  assert.deepEqual(actual.before, actual.after);
  assert.deepEqual(await readFile(fixture.file), fixture.png, "write the exact browser bytes, never resize or stitch");
  assert.equal(fixture.calls.filter(row => row.method === "Page.captureScreenshot").length, 1);
});

test("native capture rejects the actual cropped viewport and fullPage dimensions instead of accepting a strip", async t => {
  for (const [width, height] of [[360, 225], [360, 5970]]) {
    const fixture = await captureFixture(t, { width, height });
    await assert.rejects(fixture.run(), /whole native viewport pixels/);
    await assert.rejects(readFile(fixture.file), { code: "ENOENT" });
  }
});

test("native capture rejects changed windows and invalid or compensated viewport measurements", async t => {
  const changed = await captureFixture(t, { changed: true });
  await assert.rejects(changed.run(), /native capture must not change/);
  await assert.rejects(readFile(changed.file), { code: "ENOENT" });
  for (const domChange of [{ dpr: NaN }, { pinch: 4 }, { applicationScale: .25 }, { width: 0 }]) {
    const fixture = await captureFixture(t, { domChange });
    await assert.rejects(fixture.run());
    await assert.rejects(readFile(fixture.file), { code: "ENOENT" });
  }
});

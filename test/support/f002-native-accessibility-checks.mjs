// Browser-owned zoom/font preferences in a NEW disposable profile, never a
// CSS transform, device emulation, pinch, OS setting or existing user profile.
import assert from "node:assert/strict";
import path from "node:path";
import { keyboardReach } from "./f002-accessibility-checks.mjs";
import { captureNativeViewport } from "./f002-native-capture.mjs";
import { verifyInspectorHeaderPaint } from "./f002-inspector-paint-checks.mjs";

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1, `${label}: ${a} != ${b}`);
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const dimensions = page => page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
  pinch: visualViewport.scale, rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize),
  applicationScale: Number(getComputedStyle(document.querySelector(".desktop-frame")).getPropertyValue("--desktop-scale")),
  pageWidth: document.documentElement.scrollWidth }));
const formSelector = 'details.f002-panel:has(select[aria-label="取证请求类型"])';
const formTextSelectors = [" > summary", " > p:first-of-type", ".f002-form-grid:nth-of-type(1) > label:nth-child(1)",
  ".f002-form-grid:nth-of-type(1) input", ".f002-form-grid:nth-of-type(1) > label:nth-child(2)",
  ".f002-form-grid:nth-of-type(1) textarea", ".f002-form-grid:nth-of-type(2) > label:nth-child(1)",
  'select[aria-label="取证请求类型"]', ".f002-form-grid:nth-of-type(2) > label:nth-child(1) small",
  ".f002-form-grid:nth-of-type(2) > label:nth-child(2)", 'select[aria-label="请求的已安装能力"]',
  ".f002-form-grid:nth-of-type(2) > label:nth-child(2) small", " > button:nth-of-type(1)", " > button:nth-of-type(2)",
  " > h3", " > label", " > label input", " > button:nth-of-type(3)"].map(target => `${formSelector} ${target.trimStart()}`);
export const nativeTextSelectors = [".sidebar .nav-button.active", ".f002-context b", ".f002-tabs a", "label.f002-search",
  ".f002-directory h2", ".f002-reading h2", ".f002-code code", ".f002-code button", ".f002-detail p", ".f002-caption", ".f002-reading .button", ...formTextSelectors,
  ...[" > h3:nth-of-type(1)", " > button", " > p:first-of-type", " > p:nth-of-type(2)", " > h3:nth-of-type(2)"]
    .map(target => `${formSelector} section[aria-label="调查预算与请求清单"]${target}`),
  ...[' > p[aria-label="固定取证基准"]', ' > p[aria-label="当前固定取证目标"]'].map(target => formSelector + target),
  ...[" > h3", " > p:first-of-type", " > div > button:first-of-type", " > div > button:nth-of-type(2)", " > p:last-of-type"]
    .map(target => `${formSelector} section[aria-label="取证材料重选"]${target}`)];
const fonts = page => page.evaluate(selectors => selectors.map(selector => {
  const node = document.querySelector(selector);
  return { selector, present: Boolean(node), size: node ? parseFloat(getComputedStyle(node).fontSize) : null };
}), nativeTextSelectors);

export function assertCompleteFontMeasurements(measurements) {
  assert.ok(Array.isArray(measurements), "all actual font targets must be measured");
  assert.deepEqual(measurements.map(row => row.selector), nativeTextSelectors, "all actual font targets must retain their exact identity and order");
  for (const row of measurements) {
    assert.equal(row.present, true, `missing actual font target ${row.selector}`);
    assert.ok(Number.isFinite(row.size) && row.size > 0, `non-numeric actual font measurement ${row.selector}`);
  }
}

export function assertTextEnlargement(before, after) {
  assertCompleteFontMeasurements(before); assertCompleteFontMeasurements(after);
  for (let index = 0; index < before.length; index += 1) assert.ok(Math.abs(after[index].size - before[index].size * 2) < .01,
    `native text200 ${before[index].selector}: ${after[index].size} != ${before[index].size * 2}`);
}

export function assertNativeBrowserZoom(before, after, factor) {
  near(after.width, before.width / factor, "native layout viewport width");
  near(after.height, before.height / factor, "native layout viewport height");
  assert.ok(Math.abs(after.dpr - before.dpr * factor) < .01, "native zoom changes DPR without device emulation");
  assert.equal(after.pinch, 1, "pinch is not browser zoom");
  assert.equal(after.applicationScale, 1, "the application cannot shrink text to cancel user zoom");
  assert.ok(after.pageWidth <= after.width + 1, "native zoom must not require page-level horizontal scrolling");
}

export function assertNativeFormControl(state) {
  assert.equal(state.focused, true, "real Tab must reach the exact form control");
  assert.equal(state.visible, true, "the entire form control must be in view after explicit native scrolling");
  assert.equal(state.hit, true, "the form control must receive a physical hit");
  for (const value of [...Object.values(state.box), ...Object.values(state.viewport)]) assert.ok(Number.isFinite(value), "finite actual form geometry required");
  assert.ok(state.box.width > 0 && state.box.height > 0 && state.viewport.width > 0 && state.viewport.height > 0);
  assert.ok(state.box.left >= 0 && state.box.right <= state.viewport.width && state.box.top >= 0 && state.box.bottom <= state.viewport.height,
    "strict whole-control bounds cannot accept even a fractional-pixel clip");
  assert.ok(state.outline >= 3 && state.outlineStyle === "solid", "the actual keyboard focus ring must remain visible");
}

export async function verifyNativeEvidenceAccessibility({ page, context, meta, metadata, directory, report, connect, readerToken, ownerToken }) {
  const fixed = page.url(), cdp = await context.newCDPSession(page), settings = await context.newPage();
  settings.setDefaultTimeout(10_000);
  const proof = report.nativeAccessibility = { osIme: "NOT_RUN", browserZoom400: "NOT_RUN", text200: "NOT_RUN", conditions: [], controls: [], captures: [], inspectorPaints: [] };
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY", "form controls use only the explicitly configured owned resolver seam");
  proof.requestForm = { browserZoom400: "NOT_RUN", text200: "NOT_RUN", controls: [], clearControls: [], stages: [], posted: [], readRequests: [], osIme: "NOT_RUN" };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith("/v1/workspaces/workspace/deterministic-facts")) return;
    if (request.method() !== "GET" && request.method() !== "OPTIONS") proof.requestForm.posted.push({ method: request.method(), pathname });
    if (request.method() === "GET" && pathname.includes("/requests/")) proof.requestForm.readRequests.push(pathname);
  });
  const panel = page.locator(formSelector), summary = panel.locator(":scope > summary");
  const investigation = panel.getByRole("textbox", { name: "可信调查 ID", exact: true });
  const question = panel.getByRole("textbox", { name: "问题（不粘贴敏感原文）", exact: true });
  const purpose = panel.getByRole("combobox", { name: "取证请求类型", exact: true });
  const capabilities = panel.getByRole("listbox", { name: "请求的已安装能力", exact: true });
  const clear = panel.getByRole("button", { name: "清除能力选择", exact: true });
  const submit = panel.getByRole("button", { name: "按当前固定引用请求取证", exact: true });
  const lookup = panel.getByRole("textbox", { name: "持久请求 ID", exact: true });
  const read = panel.getByRole("button", { name: "复验原绑定并读取", exact: true });
  const catalog = panel.getByRole("button", { name: "复验调查边界与请求清单", exact: true });
  const materialPicker = panel.getByRole("button", { name: "从当前来源选择", exact: true });
  const draft = { investigation: meta.formInvestigations.SUSPECTED_OMISSION, question: "Owned native form draft; no submission or adoption.",
    purpose: "SUSPECTED_OMISSION", capabilities: ["properties"], lookup: "" };
  async function openForm() { assert.equal(await panel.count(), 1); if (!await panel.evaluate(node => node.open)) await summary.click(); }
  async function assertDraft(stage) {
    const actual = { investigation: await investigation.inputValue(), question: await question.inputValue(), purpose: await purpose.inputValue(),
      capabilities: await capabilities.evaluate(node => Array.from(node.selectedOptions, option => option.value)), lookup: await lookup.inputValue() };
    const metrics = await dimensions(page);
    proof.requestForm.stages.push({ stage, actual, fixed: page.url(), metrics });
    assert.deepEqual(actual, draft); assert.equal(page.url(), fixed);
    assert.ok(metrics.pageWidth <= metrics.width + 1, "form draft actions and refresh must retain page-level reflow");
    assert.equal(await submit.isDisabled(), false); assert.equal(await read.isDisabled(), true);
    assert.ok((await panel.innerText()).includes(meta.noFact.materialId), "the form retains its original fixed Material target");
  }
  await openForm();
  assert.deepEqual(await purpose.locator("option").evaluateAll(nodes => nodes.map(node => node.value)), ["TARGETED_EVIDENCE", "SUSPECTED_OMISSION", "SUSPECTED_ERROR"]);
  await investigation.fill(draft.investigation); await question.fill(draft.question);
  await purpose.selectOption(draft.purpose); await capabilities.selectOption(draft.capabilities);
  await assertDraft("native100-prepared");
  proof.browserVersion = await cdp.send("Browser.getVersion");
  assert.ok(proof.browserVersion.product.startsWith("Chrome/"), "native browser preferences require full installed Chrome, not headless shell");
  await settings.goto("chrome://settings/appearance");
  const zoom = settings.locator("select#zoomLevel");
  assert.equal(await zoom.inputValue(), "1", "a fresh owned profile must start at native 100%, not an inherited user preference");
  const window = await cdp.send("Browser.getWindowForTarget"), initial = await dimensions(page);
  proof.calibration = { before: { window, metrics: initial }, method: "Browser.setWindowBounds + Page.bringToFront" };
  await cdp.send("Browser.setWindowBounds", { windowId: window.windowId, bounds: {
    width: window.bounds.width + 1440 - initial.width, height: window.bounds.height + 900 - initial.height } });
  proof.calibration.requested = { window: await cdp.send("Browser.getWindowForTarget"), metrics: await dimensions(page) };
  // Headless Chrome can report changed outer bounds while the target still
  // has its previous content size. Native target activation applies that
  // resize; do not substitute device metrics or accept a smaller viewport.
  await page.bringToFront();
  await page.waitForFunction(() => innerWidth === 1440 && innerHeight === 900);
  const baseline = await dimensions(page);
  const nativeWindow = await cdp.send("Browser.getWindowForTarget");
  proof.calibration.after = { window: nativeWindow, metrics: baseline };
  const baselineFonts = proof.fontTargetsBaseline = await fonts(page);
  assertCompleteFontMeasurements(baselineFonts);
  proof.conditions.push({ kind: "native100", metrics: baseline, fonts: baselineFonts, window: nativeWindow });
  await zoom.selectOption("4");
  await page.waitForFunction(() => devicePixelRatio === 4 && innerWidth === 360);
  proof.browserZoom400 = "APPLIED_NOT_ACCEPTED";
  const enlarged = await dimensions(page);
  proof.conditions.push({ kind: "native400", setting: await zoom.inputValue(), metrics: enlarged });
  proof.nativeWindow400 = await cdp.send("Browser.getWindowForTarget");
  assert.equal(proof.nativeWindow400.windowId, nativeWindow.windowId);
  assert.equal(proof.nativeWindow400.bounds.width, nativeWindow.bounds.width);
  assert.equal(proof.nativeWindow400.bounds.height, nativeWindow.bounds.height);
  assertNativeBrowserZoom(baseline, enlarged, 4);

  async function reachableRequestForm(theme, kind) {
    await openForm();
    const controls = [summary, investigation, question, purpose, capabilities, clear, submit, lookup, read, catalog];
    controls.push(materialPicker);
    for (let index = 0; index < controls.length; index += 1) {
      // Empty lookup intentionally disables GET. A bounded synthetic draft ID
      // exercises the real enablement and Tab order only; never activate GET.
      if (controls[index] === read) await lookup.fill("00000000-0000-4000-8000-000000000000");
      const tab = await keyboardReach(page, controls[index]);
      await controls[index].evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" })); await settled(page);
      const state = await controls[index].evaluate(node => {
        const box = node.getBoundingClientRect(), style = getComputedStyle(node);
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height },
          viewport: { width: innerWidth, height: innerHeight }, focused: document.activeElement === node,
          visible: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          hit: hit === node || node.contains(hit), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle };
      });
      proof.requestForm.controls.push({ kind, theme, index, tab, ...state });
      assertNativeFormControl(state);
    }
    await lookup.fill("");
    await keyboardReach(page, clear); await clear.press("Enter");
    assert.deepEqual(await capabilities.evaluate(node => Array.from(node.selectedOptions, option => option.value)), []);
    proof.requestForm.clearControls.push({ kind, theme, submitDisabled: await submit.isDisabled(), clearDisabled: await clear.isDisabled(), metrics: await dimensions(page) });
    // Capabilities are optional in the existing request contract. Clearing
    // them does not invalidate the bound question or grant any authorization.
    assert.equal(await submit.isDisabled(), false, "clearing optional capabilities retains an otherwise valid bound request");
    assert.equal(await clear.isDisabled(), true);
    await capabilities.selectOption(draft.capabilities);
    await keyboardReach(page, summary); await summary.press("Enter"); assert.equal(await panel.evaluate(node => node.open), false);
    await summary.press("Enter"); assert.equal(await panel.evaluate(node => node.open), true);
    await assertDraft(`${kind}-${theme}`);
    assert.equal(proof.requestForm.posted.length, 0, "native preference keyboard and draft operations never POST");
    assert.equal(proof.requestForm.readRequests.length, 0, "focus on a lookup button never performs or fabricates a request read");
    await capabilities.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" })); await settled(page);
    const file = path.join(directory, `${kind}-request-form-${theme}.png`);
    if (kind === "native400") proof.captures.push(await captureNativeViewport({ page, cdp, file, dimensions }));
    else await page.screenshot({ path: file, fullPage: true });
  }

  async function reachable(theme, kind) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    const controls = [page.locator(".f002-search input"), page.getByLabel("材料类型筛选", { exact: true }),
      page.getByLabel("能力处置状态筛选", { exact: true }), page.getByRole("button", { name: "关闭依据面板", exact: true }),
      page.locator(".f002-detail").getByRole("button", { name: "复制完整引用", exact: true }),
      page.locator(".f002-reading").getByRole("button", { name: "关闭软换行", exact: true })];
    for (let index = 0; index < controls.length; index += 1) proof.controls.push({ kind, theme, index, ...await keyboardReach(page, controls[index]) });
    assert.equal(await page.locator(".f002-tabs a").count(), 4);
    const close = page.getByRole("button", { name: "关闭依据面板", exact: true });
    await close.press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "重开依据面板");
    await page.getByRole("button", { name: "重开依据面板", exact: true }).press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-inspector-heading") === "true");
    assert.equal(page.url(), fixed, "native preferences cannot replace material, physical range or history");
    assert.equal(await page.locator(".f002-detail").evaluate(node => { node.scrollTop = 120; return node.scrollTop; }), 120);
    await settled(page);
    const paint = {}; await verifyInspectorHeaderPaint(page, paint);
    proof.inspectorPaints.push({ kind, theme, ...paint.inspectorPaint });
    const file = path.join(directory, `${kind}-${theme}.png`);
    if (kind === "native400") proof.captures.push(await captureNativeViewport({ page, cdp, file, dimensions }));
    else await page.screenshot({ path: file, fullPage: true });
    await reachableRequestForm(theme, kind);
  }
  for (const theme of ["light", "dark"]) await reachable(theme, "native400");
  proof.browserZoom400 = "PASSED";
  report.results.push({ case: "native-browser400-two-themes-real-Tab-hit-focus-and-Inspector-retain-fixed-reading", passed: true });
  proof.requestForm.browserZoom400 = "PASSED";
  report.results.push({ case: "native-browser400-request-form-two-themes-real-Tab-whole-control-hit-and-draft-actions-without-submission", passed: true });

  await zoom.selectOption("1");
  await page.waitForFunction(() => devicePixelRatio === 1 && innerWidth === 1440);
  // This is Chrome's native default-font setting, not inserted CSS. Check its
  // browser receipt AND each actual text target; an accepted pref alone is not
  // evidence that pixel-sized application text grew.
  const preference = await settings.evaluate(async () => {
    const key = "webkit.webprefs.default_font_size";
    const before = await new Promise(resolve => chrome.settingsPrivate.getPref(key, resolve));
    const applied = await new Promise(resolve => chrome.settingsPrivate.setPref(key, 32, resolve));
    const after = await new Promise(resolve => chrome.settingsPrivate.getPref(key, resolve));
    return { key, before: before.value, applied, after: after.value };
  });
  assert.deepEqual(preference, { key: "webkit.webprefs.default_font_size", before: 16, applied: true, after: 32 });
  await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 32);
  await settled(page);
  const textMetrics = await dimensions(page), enlargedFonts = await fonts(page);
  proof.text200 = "APPLIED_NOT_ACCEPTED";
  proof.conditions.push({ kind: "native-font200", preference, metrics: textMetrics, fonts: enlargedFonts });
  assert.equal(textMetrics.width, baseline.width); assert.equal(textMetrics.height, baseline.height); assert.equal(textMetrics.dpr, baseline.dpr);
  assertTextEnlargement(baselineFonts, enlargedFonts);
  for (const theme of ["light", "dark"]) await reachable(theme, "native-font200");
  proof.text200 = "PASSED";
  report.results.push({ case: "native-font200-doubles-actual-navigation-controls-code-and-headings-without-viewport-zoom", passed: true });
  proof.requestForm.text200 = "PASSED";
  report.results.push({ case: "native-font200-doubles-all-eighteen-form-text-targets-and-retains-two-theme-keyboard-draft-controls", passed: true });

  await page.reload(); await connect();
  assert.equal(page.url(), fixed); await page.locator('.f002-code [data-line="401"]').waitFor();
  await openForm(); await assertDraft("native-font200-owner-refresh");
  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator(".f002-search input").waitFor();
  await openForm();
  assert.equal(await investigation.inputValue(), ""); assert.equal(await question.inputValue(), "");
  assert.equal(await purpose.inputValue(), "TARGETED_EVIDENCE");
  assert.deepEqual(await capabilities.evaluate(node => Array.from(node.selectedOptions, option => option.value)), []);
  assert.equal(await submit.isDisabled(), true);
  const revoked = page.waitForResponse(response => response.status() === 403 && new URL(response.url()).pathname.includes("/deterministic-facts"));
  await metadata("revoke-reader", "POST"); await revoked;
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await page.locator(".f002-code").count(), 0); assert.equal(await page.locator(".f002-directory").count(), 0);
  await metadata("restore-reader", "POST");
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(ownerToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator('.f002-code [data-line="401"]').waitFor(); assert.equal(page.url(), fixed);
  await openForm(); await assertDraft("native-font200-owner-after-live403");
  proof.fixture = await metadata();
  assert.equal(proof.fixture.sourceStable, true); assert.equal(proof.fixture.originalDigest, meta.originalDigest); assert.equal(proof.fixture.startRunCount, 0);
  assert.equal(proof.fixture.additionalSourceStable, true); assert.deepEqual(proof.fixture.submittedRequests, []);
  assert.equal(proof.requestForm.posted.length, 0); assert.equal(proof.requestForm.readRequests.length, 0);
  report.results.push({ case: "native-enlargement-current-authorization-refresh-live403-and-original-source-stable-without-writes", passed: true });
  await settings.close(); await cdp.detach();
}

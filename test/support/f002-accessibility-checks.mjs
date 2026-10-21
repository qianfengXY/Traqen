// Browser-protocol candidate input is not JavaScript dispatchEvent. Chromium
// can deliver an untrusted scoped compositionend on protocol commit; this is
// explicitly NOT an OS IME acceptance or a native browser/text zoom check.
import assert from "node:assert/strict";
import path from "node:path";

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .75, `${label}: ${actual} != ${expected}`);
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

export function verifyProtocolComposition(events, value) {
  assert.equal(value, "预览", "the controlled search must retain the protocol-committed Chinese text");
  const candidate = events.filter(event => event.type !== "compositionend"), end = events.filter(event => event.type === "compositionend");
  assert.ok(candidate.some(event => event.type === "compositionstart") && candidate.some(event => event.type === "compositionupdate"));
  assert.ok(candidate.some(event => event.type === "input" && event.composing === true));
  assert.ok(candidate.every(event => event.trusted === true), "JavaScript-dispatched candidates cannot masquerade as trusted renderer composition");
  assert.equal(end.length, 1, "the protocol path must really complete composition, not only insert text");
  assert.equal(events.at(-1).type, "compositionend");
  // InputMethodController queues this separately via DispatchScopedEvent,
  // unlike start/update DispatchEvent. Preserve the observed trust bit, never
  // change it or promote this protocol check to native/OS completion proof.
  return { protocolCommitTrust: end[0].trusted, osIme: "NOT_RUN" };
}

export async function keyboardReach(page, locator) {
  // Locate the predecessor in the real sequential focus order; then use an
  // actual Tab, rather than calling focus() on the asserted target.
  await locator.evaluate(target => {
    const nodes = [...document.querySelectorAll('a[href],button,input,textarea,select,summary,[tabindex="0"]')]
      .filter(node => !node.disabled && node.getClientRects().length);
    const index = nodes.indexOf(target);
    if (index <= 0) throw new Error("the asserted control must have an accessible focus predecessor");
    nodes[index - 1].focus();
  });
  await page.keyboard.press("Tab");
  const proof = await locator.evaluate(target => {
    const rect = target.getBoundingClientRect(), style = getComputedStyle(target);
    const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    return { focused: document.activeElement === target, width: rect.width, height: rect.height,
      visible: rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight,
      hit: hit === target || target.contains(hit), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle };
  });
  assert.equal(proof.focused, true, "actual Tab must reach the intended control");
  assert.equal(proof.visible && proof.hit, true, "a focused control must be visible and hit-testable after native focus scrolling");
  assert.ok(proof.outline >= 3 && proof.outlineStyle !== "none", "keyboard focus must retain a visible ring");
  return proof;
}

export async function verifyEvidenceAccessibility({ page, context, meta, metadata, directory, report, runId }) {
  const fixed = page.url(), search = page.locator(".f002-search input");
  const cdp = await context.newCDPSession(page);
  report.accessibility = { osIme: "NOT_RUN", nativeBrowserZoom400: "NOT_RUN", nativeTextZoom200: "NOT_RUN", input: [], desktop: [], reflow: [] };
  report.accessibility.browserVersion = await cdp.send("Browser.getVersion");
  await search.fill(""); await search.focus();
  await search.evaluate(node => {
    window.__f002Composition = [];
    for (const type of ["compositionstart", "compositionupdate", "compositionend", "input"]) node.addEventListener(type, event => {
      window.__f002Composition.push({ type, trusted: event.isTrusted, composing: event.isComposing ?? null });
    });
  });
  await cdp.send("Input.imeSetComposition", { text: "预", selectionStart: 1, selectionEnd: 1 });
  await cdp.send("Input.imeSetComposition", { text: "预览", selectionStart: 2, selectionEnd: 2 });
  await cdp.send("Input.insertText", { text: "预览" });
  await settled(page);
  const events = await page.evaluate(() => window.__f002Composition);
  report.accessibility.input.push({ case: "renderer-ime-Chinese", events, value: await search.inputValue() });
  Object.assign(report.accessibility, verifyProtocolComposition(events, await search.inputValue()));
  assert.equal(page.url(), fixed, "IME editing cannot replace a fixed material or version");
  await search.fill("");
  report.results.push({ case: "browser-protocol-Chinese-candidate-and-commit-keeps-fixed-reading-not-OS-IME", passed: true });

  await page.locator(".f002-tabs").getByRole("link", { name: "版本与交付", exact: true }).click();
  const lookup = page.getByLabel("按运行 ID 回查", { exact: true });
  await lookup.fill(runId); await lookup.focus();
  const requests = [];
  const observe = request => { if (new URL(request.url()).pathname.endsWith(`/runs/${runId}`)) requests.push({ method: request.method() }); };
  page.on("request", observe);
  await lookup.evaluate(node => {
    window.__f002Keys = [];
    node.addEventListener("keydown", event => window.__f002Keys.push({ key: event.key, code: event.keyCode, composing: event.isComposing, trusted: event.isTrusted }), true);
  });
  try {
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await settled(page);
    const keys = await page.evaluate(() => window.__f002Keys);
    report.accessibility.input.push({ case: "IME-boundary-229", keys, requests: [...requests] });
    assert.deepEqual(keys, [{ key: "Enter", code: 229, composing: false, trusted: true }]);
    assert.equal(requests.length, 0, "IME completion Enter (keyCode 229, isComposing false) must not submit a run lookup");
    for (const key of ["Control+Enter", "Meta+Enter", "Alt+Enter", "Shift+Enter"]) await lookup.press(key);
    await settled(page);
    assert.equal(requests.length, 0, "modified Enter belongs to editing/platform shortcuts, not implicit lookup");
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/runs/${runId}`));
    await lookup.press("Enter");
    assert.equal((await response).status(), 200);
    assert.equal(requests.length, 1, "a non-composing unmodified Enter still reads the actual persisted run once");
  } finally { page.off("request", observe); }
  report.results.push({ case: "IME-boundary-and-modifiers-do-not-submit-only-explicit-Enter-reads", passed: true });
  await page.locator(".f002-tabs").getByRole("link", { name: "对象与事实", exact: true }).click();
  assert.equal(page.url(), fixed);
  await page.locator(".f002-detail").getByRole("button", { name: "复制完整引用", exact: true }).waitFor();

  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    for (const [width, height, scale, gutter] of [[1440, 900, 1, 0], [1920, 1080, 1.2, 96], [2560, 1440, 1.6, 128]]) {
      await page.setViewportSize({ width, height }); await settled(page);
      const layout = await page.evaluate(() => {
        const rect = selector => { const value = document.querySelector(selector).getBoundingClientRect(); return { x: value.x, width: value.width, height: value.height }; };
        return { shell: rect(".app-shell"), sidebar: rect(".sidebar"), topbar: rect(".topbar"), inspector: rect(".f002-detail"),
          padding: parseFloat(getComputedStyle(document.querySelector("#product-content")).paddingLeft),
          columns: getComputedStyle(document.querySelector(".f002-browser-grid")).gridTemplateColumns.split(" ").length };
      });
      report.accessibility.desktop.push({ theme, width, height, scale, layout });
      near(layout.shell.width, 1440 * scale, "single logical master width"); near(layout.shell.height, 900 * scale, "single logical master height");
      near(layout.shell.x, gutter, "centered canvas gutter"); near(layout.sidebar.width, 224 * scale, "uniform sidebar scale");
      near(layout.topbar.height, 66 * scale, "uniform topbar scale"); near(layout.inspector.width, 302 * scale, "uniform Inspector scale");
      assert.equal(layout.padding, 32); assert.equal(layout.columns, 3, "large desktops do not add content columns");
      await keyboardReach(page, search);
      const wrap = page.locator(".f002-reading").getByRole("button", { name: "关闭软换行", exact: true });
      await wrap.click(); await page.locator(".f002-code:not(.wrap)").waitFor();
      await page.getByRole("button", { name: "开启软换行", exact: true }).click();
      await page.screenshot({ path: path.join(directory, `master-${theme}-${width}.png`), fullPage: true });
      assert.equal(page.url(), fixed, "scale and hit testing cannot change the fixed reading");
    }
  }
  report.results.push({ case: "two-theme-three-master-sizes-scale-layout-focus-and-hit-targets-uniformly", passed: true });
  for (const [width, height] of [[1280, 800], [1024, 768], [360, 225], [320, 900]]) {
    await page.setViewportSize({ width, height }); await settled(page);
    const focus = await keyboardReach(page, page.getByLabel("材料类型筛选", { exact: true }));
    const layout = await page.evaluate(() => ({ width: innerWidth, scale: Number(getComputedStyle(document.querySelector(".desktop-frame")).getPropertyValue("--desktop-scale")),
      columns: getComputedStyle(document.querySelector(".f002-browser-grid")).gridTemplateColumns.split(" ").length,
      pageWidth: document.documentElement.scrollWidth, tabs: document.querySelectorAll(".f002-tabs a").length }));
    report.accessibility.reflow.push({ width, height, layout, focus });
    assert.equal(layout.scale, 1, "small CSS viewports cannot shrink text through an inverse desktop transform");
    assert.equal(layout.columns, 1); assert.equal(layout.tabs, 4);
    assert.ok(layout.pageWidth <= width + 1, "reflow needs no page-level horizontal scrolling");
    await page.getByRole("button", { name: "关闭依据面板", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "重开依据面板");
    await page.getByRole("button", { name: "重开依据面板", exact: true }).press("Enter");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-inspector-heading") === "true");
    assert.equal(page.url(), fixed); assert.equal(await page.locator(".f002-detail").count(), 1);
  }
  report.results.push({ case: "small-CSS-viewport-reflow-controls-and-native-Tab-remain-reachable-without-auto-closing", passed: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  const after = await metadata();
  assert.equal(after.sourceStable, true); assert.equal(after.originalDigest, meta.originalDigest); assert.equal(after.startRunCount, 0);
  await cdp.detach();
}

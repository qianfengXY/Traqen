import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { settleWorkbenchTheme } from "./f002-theme-contrast-checks.mjs";

const form = 'details.f002-panel:has(select[aria-label="取证请求类型"])';
const tabs = { objects: "对象与事实", relations: "关系", coverage: "覆盖与缺口", delivery: "版本与交付" };
export const canvasSizes = [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }, { width: 1280, height: 800 }];
export function traversalDeadlineMs(mode) {
  // R62: the32-condition matrix kept progressing at6.4–10s/condition when
  // the original seven-case180s timer closed it. Keep action timeouts intact.
  return mode === "--canvas-matrix" ? 40_000 + Object.keys(tabs).length * 2 * canvasSizes.length * 10_000 : 180_000;
}
const near = (actual, expected, label) => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= .1,
    `${label}: ${actual} differs from ${expected} (logical geometry tolerance0.1px, not a clipping allowance)`);
};
export function canvasControlRendered({ rectCount, visibility, painted }) {
  // Closed details can retain layout boxes while their content is skipped.
  // A box alone must never become evidence of rendered controls.
  return Number.isFinite(rectCount) && rectCount > 0 && visibility === "visible" && painted === true;
}
export function assertCanvasSample(actual, baseline = null) {
  const { width, height } = actual.viewport;
  assert.ok(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0);
  const desktop = width >= 1440 && height >= 900, scale = Math.max(1, Math.min(width / 1440, height / 900));
  near(actual.scale, scale, "application scale");
  near(actual.shell.width, (desktop ? 1440 : width) * scale, "physical shell width");
  near(actual.shell.height, desktop ? 900 * scale : height, "physical shell height");
  near(actual.shell.left, desktop ? (width - 1440 * scale) / 2 : 0, "centering remainder");
  near(actual.shell.top, 0, "top alignment");
  assert.equal(actual.dpr, 1); assert.equal(actual.pinch, 1); assert.equal(actual.rootFont, 16);
  assert.equal(actual.tabCount, 4); assert.equal(actual.activeTabs.length, 1);
  assert.equal(actual.activeTabs[0], tabs[actual.tab], "URL tab and unique selected navigation must agree");
  assert.ok(actual.controls.length > 0 && actual.textDigest && actual.reference);
  assert.ok(Array.isArray(actual.disclosures) && actual.disclosures.length > 0
    && actual.disclosures.every(row => typeof row.summary === "string" && row.summary.length > 0 && typeof row.open === "boolean"), "actual disclosure states are required");
  for (const selector of [".sidebar", ".topbar", "#product-content", ".f002-context", ".f002-tabs"]) assert.ok(actual.regions[selector], `missing actual canvas region ${selector}`);
  for (const box of Object.values(actual.regions)) {
    assert.ok([box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0, "invalid region geometry");
  }
  if (!baseline) return;
  assert.deepEqual(actual.controls, baseline.controls, "resize/theme must retain every control, field, option, disabled and disclosure state");
  assert.deepEqual(actual.disclosures, baseline.disclosures, "resize/theme must retain each actual disclosure open state");
  assert.equal(actual.textDigest, baseline.textDigest, "the same state must retain all content and limitations");
  assert.equal(actual.reference, baseline.reference, "fixed source/fact/record/range cannot change with display scale");
  assert.equal(actual.shellWarning, baseline.shellWarning, "truthful shell limitations cannot be suppressed for a display comparison");
  assert.equal(actual.graph, baseline.graph, "exploration zoom/pan must remain independent of application scaling");
  assert.deepEqual(actual.positions, baseline.positions, "resize cannot replace independent reading positions");
  if (desktop) {
    assert.deepEqual(Object.keys(actual.regions), Object.keys(baseline.regions), "no desktop region may be dropped or added");
    for (const [selector, box] of Object.entries(actual.regions)) {
      for (const field of ["left", "top", "width", "height"]) near(box[field], baseline.regions[selector][field], `${selector}.${field}`);
    }
  }
}

export function assertCanvasTarget(actual) {
  assert.equal(actual.rendered, true); assert.equal(actual.hit, true);
  assert.ok(Number.isFinite(actual.viewport.width) && actual.viewport.width > 0 && Number.isFinite(actual.viewport.height) && actual.viewport.height > 0);
  for (const key of ["left", "top", "right", "bottom", "width", "height"]) assert.ok(Number.isFinite(actual.box[key]));
  assert.ok(actual.box.width > 0 && actual.box.height > 0 && actual.box.left >= 0 && actual.box.top >= 0
    && actual.box.right <= actual.viewport.width && actual.box.bottom <= actual.viewport.height, "whole control must be reachable, not a clipped center");
  if (!actual.disabled) { assert.equal(actual.focused, true); assert.ok(actual.outline >= 3); assert.equal(actual.outlineStyle, "solid"); }
}

async function frames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function sample(page) {
  const actual = await page.evaluate(() => {
    const shell = document.querySelector(".app-shell"), origin = shell.getBoundingClientRect();
    const scale = Number(getComputedStyle(document.querySelector(".desktop-frame")).getPropertyValue("--desktop-scale"));
    const workbench = document.querySelector(".f002-workbench"), main = document.querySelector(".main");
    const controlNodes = [...workbench.querySelectorAll("a,button,input,textarea,select,summary,[role=button]")];
    const controls = controlNodes.map(node => {
      const rectCount = node.getClientRects().length, style = getComputedStyle(node);
      return {
        tag: node.tagName, role: node.getAttribute("role"), label: node.getAttribute("aria-label"), text: node.textContent.trim().replace(/\s+/g, " "),
        disabled: Boolean(node.disabled), rendered: rectCount > 0 && style.visibility !== "hidden", type: node.getAttribute("type"),
        visibilityMeasurement: { rectCount, visibility: style.visibility, painted: node.checkVisibility() },
        value: node.type === "password" ? null : "value" in node ? node.value : null,
        selected: node.tagName === "SELECT" ? [...node.selectedOptions].map(option => option.value) : null,
        options: node.tagName === "SELECT" ? [...node.options].map(option => [option.value, option.text, option.disabled]) : null,
        current: node.getAttribute("aria-current"), pressed: node.getAttribute("aria-pressed"),
      };
    });
    const disclosures = [...workbench.querySelectorAll("details")].map(node => ({
      summary: node.querySelector(":scope > summary")?.textContent.trim(), open: node.open,
    }));
    const visibilityDiagnostics = controlNodes.map((node, index) => {
      const closed = [];
      for (let ancestor = node.parentElement; ancestor && ancestor !== workbench; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === "DETAILS" && !ancestor.open) closed.push({ summary: ancestor.querySelector(":scope > summary")?.textContent.trim(),
          contentVisibility: getComputedStyle(ancestor).contentVisibility });
      }
      const style = getComputedStyle(node);
      return { index, tag: node.tagName, text: controls[index].text, type: node.getAttribute("type"),
        renderedFromRects: controls[index].rendered, rectCount: node.getClientRects().length, painted: node.checkVisibility(),
        display: style.display, visibility: style.visibility, contentVisibility: style.contentVisibility, closed };
    }).filter(row => row.type === "password" || row.closed.length || !row.painted).slice(0,64);
    const regions = {};
    for (const selector of [".sidebar", ".topbar", "#product-content", ".f002-heading", ".f002-context", ".f002-tabs", ".f002-browser-grid", ".f002-directory", ".f002-main-reading", ".f002-reading", ".f002-records", ".f002-detail", ".f002-relations", ".f002-delivery", 'details.f002-panel:has(select[aria-label="取证请求类型"])']) {
      const node = document.querySelector(selector);
      if (node) { const box = node.getBoundingClientRect(); regions[selector] = { left: (box.left - origin.left) / scale, top: (box.top - origin.top) / scale, width: box.width / scale, height: box.height / scale }; }
    }
    const query = new URLSearchParams(location.search);
    return { viewport: { width: innerWidth, height: innerHeight }, scale, dpr: devicePixelRatio, pinch: visualViewport.scale,
      rootFont: parseFloat(getComputedStyle(document.documentElement).fontSize), shell: { left: origin.left, top: origin.top, width: origin.width, height: origin.height },
      tabCount: workbench.querySelectorAll(".f002-tabs a").length,
      activeTabs: [...workbench.querySelectorAll('.f002-tabs a[aria-current="page"]')].map(node => node.textContent), controls, regions, disclosures, visibilityDiagnostics,
      reference: JSON.stringify(["workspace", "factset", "source", "kind", "record", "line", "lineEnd", "windowLine", "graphRoot"].map(key => [key, query.get(key)])),
      positions: Object.fromEntries([".main", ".f002-code", ".f002-directory", ".f002-detail", ".f002-relation-list", ".f002-gap-list"].flatMap(selector => {
        const node = document.querySelector(selector); return node ? [[selector, [node.scrollLeft, node.scrollTop]]] : [];
      })),
      text: workbench.textContent.replace(/\s+/g, " "), shellWarning: document.querySelector(".toast-message.error")?.textContent ?? null,
      graph: document.querySelector("[data-graph-viewport]")?.getAttribute("transform") ?? null,
      mainHeight: main.scrollHeight,
    };
  });
  actual.controlVisibility = actual.controls.map(control => control.visibilityMeasurement);
  actual.controls = actual.controls.map(({ visibilityMeasurement, ...control }) => ({ ...control, rendered: canvasControlRendered(visibilityMeasurement) }));
  actual.textDigest = createHash("sha256").update(actual.text).digest("hex"); delete actual.text;
  return actual;
}
async function target(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  if (!await locator.isDisabled()) {
    await locator.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  }
  await frames(page);
  const actual = await locator.evaluate(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { rendered: node.checkVisibility(), hit: hit === node || node.contains(hit), disabled: Boolean(node.disabled), focused: document.activeElement === node,
      outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle,
      box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight } };
  });
  assertCanvasTarget(actual); return actual;
}
async function graphHit(page, factId) {
  const edge = page.locator(`[data-edge-fact-id="${factId}"]`);
  await page.locator(".f002-relations svg").evaluate(node => node.scrollIntoView({ block: "center" })); await frames(page);
  const point = await edge.locator(".f002-edge-hit").evaluate(node => {
    const svg = node.ownerSVGElement.getBoundingClientRect(), matrix = node.getScreenCTM(), length = node.getTotalLength();
    for (const fraction of [.5, .4, .6, .3, .7, .2, .8]) {
      const p = node.getPointAtLength(length * fraction).matrixTransform(matrix), hit = document.elementFromPoint(p.x, p.y);
      if (p.x >= 0 && p.y >= 0 && p.x < innerWidth && p.y < innerHeight && p.x >= svg.left && p.x <= svg.right && p.y >= svg.top && p.y <= svg.bottom
        && hit?.closest("[data-edge-fact-id]") === node.parentElement) return { x: p.x, y: p.y, fraction, hitId: node.parentElement.dataset.edgeFactId };
    }
    return null;
  });
  assert.ok(point, "a real graph edge point must physically hit the same Fact after application scaling");
  await page.mouse.click(point.x, point.y);
  assert.equal(new URL(page.url()).searchParams.get("record"), factId);
  assert.equal(await edge.getAttribute("aria-pressed"), "true"); return point;
}

export async function verifyCanvasMatrix({ page, meta, fact, report, directory, read, diagnosticOnly = false }) {
  const startedAt = Date.now();
  const proof = report.canvasMatrix = { accepted: false, diagnosticOnly, sizes: canvasSizes, conditions: [], hits: [], graphHits: [], drawers: [], writes: [], timings: [] };
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:6225" && !["GET", "HEAD", "OPTIONS"].includes(request.method())) proof.writes.push({ method: request.method(), pathname: url.pathname });
  });
  await page.locator(`[data-edge-fact-id="${fact.id}"]`).press("Enter");
  await page.getByRole("button", { name: "放大局部关系图", exact: true }).click();
  await page.getByRole("button", { name: "向左平移局部关系图", exact: true }).click();
  const graph = await page.locator("[data-graph-viewport]").getAttribute("transform");
  assert.ok(graph.includes("scale(1.25)") && graph.includes("translate(-40 0)"));
  await page.locator(form).locator(":scope > summary").click();
  await page.getByLabel("可信调查 ID", { exact: true }).fill("owned-canvas-draft");
  await page.getByLabel("问题（不粘贴敏感原文）", { exact: true }).fill("Owned matrix draft; never submitted.");
  await page.getByLabel("取证请求类型", { exact: true }).selectOption("SUSPECTED_OMISSION");
  await page.getByLabel("请求的已安装能力", { exact: true }).selectOption("properties");
  const baselines = new Map();
  for (const [tab, label] of Object.entries(tabs)) {
    await page.locator(".f002-tabs").getByRole("link", { name: label, exact: true }).click();
    if (["objects", "relations"].includes(tab)) {
      await page.getByLabel("能力处置状态筛选", { exact: true }).waitFor();
      await page.locator(".f002-code code").first().waitFor();
      await page.locator("[data-predicate-meaning]").waitFor();
      if (tab === "relations") await page.locator(`[data-edge-fact-id="${fact.id}"]`).waitFor();
      else await page.locator(".f002-records table").first().waitFor();
    } else if (tab === "coverage") await page.locator("[data-gap-id]").first().waitFor();
    else {
      await page.getByRole("heading", { name: "版本与五部分交付", exact: true }).waitFor();
      await page.getByRole("button", { name: "导出五部分交付", exact: true }).waitFor();
      await page.getByLabel("冻结来源", { exact: true }).locator(`option[value="${meta.sourceVersionId}"]`).waitFor({ state: "attached" });
    }
    await page.waitForFunction(() => ![...document.querySelectorAll(".f002-workbench [role=status]")].some(node =>
      /^(读取固定|读取获准|读取事实|读取缺口|正在加载材料|正在读取本固定版本)/.test(node.textContent.trim())));
    for (const theme of ["light", "dark"]) {
      await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
      await settleWorkbenchTheme(page, theme, report.themeSettles ??= []);
      for (const size of canvasSizes) {
        const timing = { tab, theme, size, startedMs: Date.now() - startedAt, completedMs: null, action: "resize", actionStartedMs: Date.now() - startedAt };
        proof.timings.push(timing);
        await page.setViewportSize(size);
        await page.waitForFunction(size => Number(getComputedStyle(document.querySelector(".desktop-frame")).getPropertyValue("--desktop-scale")) === Math.max(1, Math.min(size.width / 1440, size.height / 900)), size);
        await page.locator(".main").evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; }); await frames(page);
        const actual = { tab, theme, ...(await sample(page)) }; proof.conditions.push(actual);
        assertCanvasSample(actual, baselines.get(tab));
        if (diagnosticOnly && proof.conditions.length === 2) {
          proof.diagnosticOutcome = "original-comparison-did-not-fail-with-added-observation";
          proof.fixture = await read("/__f002_fixture/metadata");
          assert.equal(proof.fixture.sourceStable, true); assert.equal(proof.fixture.startRunCount, 0); assert.deepEqual(proof.writes, []);
          return; // Observation-only: never set accepted or complete a matrix case.
        }
        assert.equal(new URL(page.url()).searchParams.get("record"), fact.id);
        assert.equal(new URL(page.url()).searchParams.get("factset"), meta.standard.graphVersionId);
        if (actual.graph) assert.equal(actual.graph, graph, "application resize/theme may not reset exploration zoom/pan");
        if (!baselines.has(tab)) baselines.set(tab, actual);
        timing.action = "viewport-capture"; timing.actionStartedMs = Date.now() - startedAt;
        const png = await page.screenshot({ path: path.join(directory, `canvas-${tab}-${theme}-${size.width}.png`) });
        actual.pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
        assert.deepEqual(actual.pixels, size, "save the original physical viewport, not a resized canvas crop");
        const core = [page.getByRole("combobox", { name: "全局主题配色", exact: true }), page.locator(".f002-tabs a").nth(0),
          page.getByLabel("可信调查 ID", { exact: true }), page.getByLabel("问题（不粘贴敏感原文）", { exact: true }),
          page.getByLabel("取证请求类型", { exact: true }), page.getByLabel("请求的已安装能力", { exact: true }),
          page.getByRole("button", { name: "从当前来源选择", exact: true }), page.getByRole("button", { name: "按当前固定引用请求取证", exact: true })];
        for (let index = 0; index < core.length; index++) {
          timing.action = `core:${index}`; timing.actionStartedMs = Date.now() - startedAt;
          proof.hits.push({ tab, theme, size, index, ...(await target(page, core[index])) });
        }
        if (tab === "relations") {
          timing.action = "graph-hit-and-capture"; timing.actionStartedMs = Date.now() - startedAt;
          proof.graphHits.push({ theme, size, ...(await graphHit(page, fact.id)) });
          await page.screenshot({ path: path.join(directory, `canvas-graph-${theme}-${size.width}.png`) });
        }
        if (tab === "objects") {
          timing.action = "drawer-open-and-close"; timing.actionStartedMs = Date.now() - startedAt;
          const trigger = page.locator('button[title="部署诊断"]'); await trigger.click();
          const drawer = page.locator(".diagnostic-drawer"), close = drawer.locator(":scope > header button");
          const box = await drawer.boundingBox(), shell = await page.locator(".app-shell").boundingBox();
          assert.ok(box && shell); near(box.x + box.width, shell.x + shell.width, "drawer physical right edge");
          near(box.y, shell.y, "drawer physical top"); near(box.height, shell.height, "drawer physical height");
          proof.drawers.push({ theme, size, box, close: await target(page, close) });
          const button = await close.boundingBox(); await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
          assert.equal(await drawer.count(), 0, "physical close must retire the real overlay");
        }
        assert.deepEqual(proof.writes, [], "canvas verification may not start or cancel any task");
        timing.action = "complete"; timing.completedMs = Date.now() - startedAt;
      }
    }
    report.results.push({ case: `same-canvas-${tab}-two-themes-three-desktop-sizes-and-small-viewport-reachability`, passed: true });
  }
  proof.fixture = await read("/__f002_fixture/metadata");
  assert.equal(proof.fixture.sourceStable, true); assert.equal(proof.fixture.startRunCount, 0); assert.deepEqual(proof.writes, []);
  proof.accepted = true;
}

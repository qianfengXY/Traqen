import assert from "node:assert/strict";
import path from "node:path";
import { keyboardReach } from "./f002-accessibility-checks.mjs";
import { assertNativeFormControl } from "./f002-native-accessibility-checks.mjs";

export async function verifyRequestCatalog({ page, web, meta, metadata, report, directory, connect, evidence, readerToken }) {
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY");
  const mutations = [], controls = [], reads = [], fixed = page.url();
  report.requestCatalog = { mutations, controls, reads, osIme: "NOT_RUN", nativeZoom: "NOT_RUN" };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/deterministic-facts") && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) mutations.push({ method: request.method(), pathname });
  });
  const form = page.locator('details.f002-panel:has(select[aria-label="取证请求类型"])');
  const catalog = () => page.getByRole("region", { name: "调查预算与请求清单", exact: true });
  const refresh = () => catalog().getByRole("button", { name: "复验调查边界与请求清单", exact: true });
  const rows = () => catalog().getByRole("button", { name: /^读取请求 / });
  const ids = () => rows().evaluateAll(nodes => nodes.map(node => node.textContent.replace("读取请求 ", "")));
  const listResponse = cursor => page.waitForResponse(response => {
    const url = new URL(response.url()); return url.pathname.endsWith("/deterministic-facts/requests") && response.request().method() === "GET"
      && (cursor === undefined || url.searchParams.get("cursor") === cursor);
  });
  const open = async () => { if (!await form.evaluate(node => node.open)) await form.locator(":scope > summary").click(); };
  await open(); await page.getByRole("textbox", { name: "可信调查 ID", exact: true }).fill(meta.catalog.investigationId);
  let response = listResponse(null);
  await keyboardReach(page, refresh()); await refresh().press("Enter");
  const first = await response; assert.equal(first.status(), 200); const firstPage = await first.json(); reads.push(firstPage);
  await catalog().getByLabel("服务端调查边界", { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('section[aria-label="调查预算与请求清单"] ol')?.children.length === 20);
  assert.deepEqual(await ids(), meta.catalog.ids.slice(0, 20));
  assert.equal((await catalog().innerText()).includes(meta.catalog.hiddenId), false);
  assert.deepEqual(firstPage.items[0].scope, { materialRefs: [meta.noFact.materialId], factRefs: [] });
  assert.ok(firstPage.items.every(item => item.baseVersionId === meta.noFact.graphVersionId && Number.isFinite(Date.parse(item.updatedAt))));
  assert.ok(firstPage.items.every(item => !Object.hasOwn(item, "result")), "the list does not eagerly deliver full result artifacts");
  const boundaryText = await catalog().getByLabel("服务端调查边界").innerText();
  for (const value of Object.values(meta.catalog.trusted.budget)) assert.ok(boundaryText.includes(String(value)));
  assert.equal(meta.catalog.trusted.usage.attempts, 2, "the preview must report actual settled account usage, not a fake remaining allowance");
  assert.ok(boundaryText.includes("2 / 上限 2")); assert.equal(page.url(), fixed);
  report.results.push({ case: "actual-trusted-budget-and-account-usage-with-20-current-authorized-summaries-no-private-id-or-eager-result", passed: true });

  response = listResponse(firstPage.nextCursor);
  await catalog().getByRole("button", { name: "下一页获准请求", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() => document.querySelector('section[aria-label="调查预算与请求清单"] ol')?.children.length === 4);
  assert.deepEqual(await ids(), meta.catalog.ids.slice(20));
  response = listResponse(null); await refresh().click(); assert.equal((await response).status(), 200);
  await page.waitForFunction(() => document.querySelector('section[aria-label="调查预算与请求清单"] ol')?.children.length === 20);
  const selectedId = meta.catalog.ids[0];
  const exact = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/requests/${selectedId}`));
  await keyboardReach(page, rows().first()); await rows().first().press("Enter"); assert.equal((await exact).status(), 200);
  await page.getByRole("article", { name: "取证返回依据", exact: true }).getByRole("heading", { name: selectedId, exact: true }).waitFor();
  assert.equal(page.url(), fixed);
  report.results.push({ case: "actual-keyset-next-page-and-keyboard-selection-rechecks-the-original-request-without-submit-or-adoption", passed: true });

  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 225 }]) {
      await page.setViewportSize(viewport);
      for (const locator of [refresh(), rows().first()]) {
        await keyboardReach(page, locator); await locator.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await locator.evaluate(node => { const box = node.getBoundingClientRect(), style = getComputedStyle(node);
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight },
            focused: document.activeElement === node, visible: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
            hit: hit === node || node.contains(hit), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
        controls.push({ theme, viewport, ...state }); assertNativeFormControl(state);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await refresh().evaluate(node => node.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: path.join(directory, `request-catalog-${theme}.png`) });
  }
  report.results.push({ case: "two-theme-two-viewport-catalog-and-result-controls-retain-strict-keyboard-whole-bounds-hit-and-focus-ring", passed: true });

  await metadata("revoke-catalog-row", "POST");
  await page.waitForFunction(id => !Array.from(document.querySelectorAll('section[aria-label="调查预算与请求清单"] ol button')).some(node => node.textContent.includes(id)), meta.catalog.revokeTargetId);
  assert.equal((await catalog().innerText()).includes(meta.catalog.revokeTargetId), false);
  assert.ok((await ids()).includes(selectedId), "a separately revoked request does not replace the selected authorized receipt");
  await metadata("stop-catalog-investigation", "POST");
  await catalog().getByText("新取证预算未获确认", { exact: false }).waitFor();
  assert.equal(await catalog().getByLabel("服务端调查边界").count(), 0);
  assert.equal(await rows().count(), 20); assert.equal(page.url(), fixed);
  report.results.push({ case: "automatic-current-read-removes-an-independently-revoked-row-and-stopped-budget-without-hiding-authorized-history", passed: true });

  await page.goto(`${web}${evidence(meta)}`); await connect();
  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator('.f002-code [data-line="401"]').waitFor(); await open();
  assert.equal(await page.getByRole("textbox", { name: "可信调查 ID", exact: true }).inputValue(), "");
  assert.equal(await rows().count(), 0);
  await page.getByRole("textbox", { name: "可信调查 ID", exact: true }).fill(meta.catalog.investigationId);
  response = listResponse(null); await refresh().click(); assert.equal((await response).status(), 200);
  await catalog().getByText("新取证预算未获确认", { exact: false }).waitFor();
  await page.waitForFunction(() => document.querySelector('section[aria-label="调查预算与请求清单"] ol')?.children.length === 20);
  assert.equal(await page.getByRole("button", { name: "按当前固定引用请求取证", exact: true }).isDisabled(), true);
  assert.deepEqual(mutations, []);
  const after = await metadata(); assert.equal(after.sourceStable, true); assert.equal(after.originalDigest, meta.originalDigest); assert.equal(after.startRunCount, 0);
  report.requestCatalog.sourceStable = after.sourceStable; report.requestCatalog.originalDigest = after.originalDigest; report.requestCatalog.startRunCount = after.startRunCount;
  report.results.push({ case: "reader-isolated-draft-and-authorized-historical-catalog-never-create-a-request-or-modify-frozen-F001", passed: true });
}

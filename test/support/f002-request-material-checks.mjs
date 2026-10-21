import assert from "node:assert/strict";
import path from "node:path";
import { keyboardReach } from "./f002-accessibility-checks.mjs";
import { assertNativeFormControl } from "./f002-native-accessibility-checks.mjs";
import { settleWorkbenchTheme } from "./f002-theme-contrast-checks.mjs";

export async function verifyRequestMaterials({ page, meta, metadata, report, directory, connect, readerToken, ownerToken }) {
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY"); assert.equal(meta.requestMaterials.choices.length, 22);
  const panel = page.locator('details.f002-panel:has(select[aria-label="取证请求类型"])');
  const picker = panel.getByRole("region", { name: "取证材料重选", exact: true });
  const open = async () => { if (!await panel.evaluate(node => node.open)) await panel.locator(":scope > summary").click(); };
  const question = panel.getByRole("textbox", { name: "问题（不粘贴敏感原文）", exact: true });
  const investigation = panel.getByRole("textbox", { name: "可信调查 ID", exact: true });
  const purpose = panel.getByLabel("取证请求类型", { exact: true }), capabilities = panel.getByLabel("请求的已安装能力", { exact: true });
  const submit = panel.getByRole("button", { name: "按当前固定引用请求取证", exact: true });
  const choose = picker.getByRole("button", { name: "从当前来源选择", exact: true });
  const restore = picker.getByRole("button", { name: "恢复正在阅读的原引用", exact: true });
  const fixed = page.url(), target = meta.requestMaterials.replacement, text = "Owned material reselection preserves this question, purpose and capabilities.";
  const proof = report.requestMaterials = { posted: [], reads: [], pages: [], controls: [], nativeZoom: "NOT_RUN", osIme: "NOT_RUN" };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && pathname.includes("/deterministic-facts")) proof.posted.push({ pathname, body: request.postDataJSON() });
  });
  page.on("response", response => {
    const request = response.request(), url = new URL(response.url());
    if (request.method() === "GET" && url.pathname.includes("/deterministic-facts/versions/") && (url.pathname.endsWith("/materials") || url.pathname.includes("/records/MATERIAL/"))) proof.reads.push({ pathname: url.pathname, query: url.search, status: response.status() });
  });
  const assertDraft = async () => {
    assert.equal(await question.inputValue(), text); assert.equal(await investigation.inputValue(), meta.formInvestigations.SUSPECTED_ERROR);
    assert.equal(await purpose.inputValue(), "SUSPECTED_ERROR");
    assert.deepEqual(await capabilities.evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
    assert.equal(page.url(), fixed); assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId);
  };
  await open(); await investigation.fill(meta.formInvestigations.SUSPECTED_ERROR); await question.fill(text);
  await purpose.selectOption("SUSPECTED_ERROR"); await capabilities.selectOption(["properties"]);
  await choose.click(); await picker.getByText("当前为部分清单，每页至多20项；可继续下一页。", { exact: true }).waitFor();
  const first = await picker.locator("li small").allTextContents(); assert.deepEqual(first, meta.requestMaterials.choices.slice(0, 20).map(item => item.id));
  proof.pages.push(first);
  await picker.getByRole("button", { name: "下一页登记材料", exact: true }).click();
  await picker.getByText("已到此授权材料清单的最后一页。", { exact: true }).waitFor();
  const second = await picker.locator("li small").allTextContents(); assert.deepEqual(second, meta.requestMaterials.choices.slice(20).map(item => item.id));
  proof.pages.push(second);
  const targetButton = picker.locator("li").filter({ has: page.getByText(target.id, { exact: true }) }).getByRole("button");
  assert.equal(await targetButton.count(), 1); await targetButton.click();
  await picker.getByText(`已复验重选材料：${target.label} · ${target.id}`, { exact: true }).waitFor();
  assert.equal(await submit.isDisabled(), false); await assertDraft(); assert.equal(proof.posted.length, 0);
  report.results.push({ case: "actual-fixed-version22-material20-plus2-pagination-individual-read-and-selection-preserve-other-input-and-reading-without-write", passed: true });

  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 225 }]) {
      await page.setViewportSize(viewport);
      for (const control of [choose, restore, targetButton]) {
        await keyboardReach(page, control); await control.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await control.evaluate(node => { const box = node.getBoundingClientRect(), style = getComputedStyle(node), hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight },
            focused: document.activeElement === node, visible: node.checkVisibility(), hit: hit === node || node.contains(hit), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
        assertNativeFormControl(state); proof.controls.push({ theme, viewport, ...state });
      }
      await settleWorkbenchTheme(page, theme, report.themeSettles ??= []); await assertDraft();
      await picker.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(directory, `request-material-${theme}-${viewport.width}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const reads = proof.reads.length;
  await page.reload(); await connect(); await open();
  await picker.getByText(`已复验重选材料：${target.label} · ${target.id}`, { exact: true }).waitFor(); await assertDraft();
  assert.ok(proof.reads.slice(reads).some(row => row.pathname.endsWith(`/records/MATERIAL/${target.id}`) && row.status === 200));
  assert.equal(await picker.locator("li").count(), 0, "refresh must not restore an authorized list from storage");
  assert.equal(proof.posted.length, 0);
  report.results.push({ case: "two-theme-two-viewport-real-Tab-strict-hit-focus-and-refresh-revalidate-locator-without-caching-material-list-or-submitting", passed: true });

  const missing = "0".repeat(64); assert.equal(meta.requestMaterials.choices.some(item => item.id === missing), false);
  await page.evaluate(({ missing, fixedBase, original }) => {
    const key = Object.keys(localStorage).find(key => { if (!key.startsWith("traqen:f002:journal:")) return false; const record = JSON.parse(localStorage.getItem(key));
      return record.context.actorId === "owner" && record.context.baseVersionId === fixedBase && record.context.targetRef === `MATERIAL:${original}`; });
    if (!key) throw new Error("exact owned draft missing");
    const value = JSON.parse(localStorage.getItem(key)); value.draft.materialTargetId = missing; localStorage.setItem(key, JSON.stringify(value));
  }, { missing, fixedBase: meta.noFact.graphVersionId, original: meta.noFact.materialId });
  await page.reload(); await connect(); await open(); await picker.getByRole("alert").filter({ hasText: "材料位置未确认" }).waitFor();
  assert.equal(await submit.isDisabled(), true); await assertDraft(); assert.equal(proof.posted.length, 0);
  assert.ok(proof.reads.some(row => row.pathname.endsWith(`/records/MATERIAL/${missing}`) && row.status === 404));
  await restore.click(); await assertDraft(); assert.equal(await submit.isDisabled(), false);
  assert.match(await panel.getByLabel("当前固定取证目标", { exact: true }).textContent(), new RegExp(meta.noFact.materialId));
  report.results.push({ case: "saved-unavailable-material-receives-real404-blocks-submission-and-explicit-original-reference-recovery-keeps-question-and-fixed-base", passed: true });

  await choose.click(); await picker.getByRole("button", { name: "下一页登记材料", exact: true }).waitFor(); await picker.getByRole("button", { name: "下一页登记材料", exact: true }).click();
  await targetButton.click(); await picker.getByText(`已复验重选材料：${target.label} · ${target.id}`, { exact: true }).waitFor();
  const accepted = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/deterministic-facts/requests"));
  await submit.click(); assert.equal((await accepted).status(), 202);
  const actual = await metadata(); assert.equal(actual.submittedRequests.length, 1);
  assert.deepEqual(actual.submittedRequests[0].materialRefs, [target.id]); assert.deepEqual(actual.submittedRequests[0].factRefs, []);
  assert.equal(actual.submittedRequests[0].baseVersionId, meta.noFact.graphVersionId); assert.equal(proof.posted.length, 1);
  await panel.getByRole("article", { name: "取证返回依据", exact: true }).getByText("任务：处理结束", { exact: false }).waitFor();
  await assertDraft();
  report.results.push({ case: "single-real202-request-uses-only-explicit-replacement-with-original-investigation-purpose-capability-and-fixed-base", passed: true });

  const identity = page.locator(".f002-auth");
  const member = async token => { if (!await identity.evaluate(node => node.open)) await identity.locator("summary").click();
    await identity.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(token);
    const authenticated = page.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname === "/v1/workspaces/workspace/deterministic-facts" && response.request().headers().authorization === `Bearer ${token}`);
    await identity.getByRole("button", { name: "验证并连接", exact: true }).click(); assert.equal((await authenticated).status(), 200);
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="问题（不粘贴敏感原文）"]')?.value === expected, token === readerToken ? "" : text);
    await page.locator(".f002-reading").waitFor(); await open(); };
  await member(readerToken); assert.equal(await question.inputValue(), ""); assert.equal(await restore.isDisabled(), true); assert.equal(await submit.isDisabled(), true);
  await member(ownerToken); await picker.getByText(`已复验重选材料：${target.label} · ${target.id}`, { exact: true }).waitFor(); await assertDraft();
  await member(readerToken); await choose.click(); await picker.locator("li").first().waitFor();
  const revoked = page.waitForResponse(response => response.status() === 403 && new URL(response.url()).pathname.includes("/deterministic-facts"));
  await metadata("revoke-reader", "POST"); await revoked;
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor(); assert.equal(await picker.count(), 0);
  const final = await metadata(); assert.equal(final.submittedRequests.length, 1); assert.equal(proof.posted.length, 1); assert.equal(final.startRunCount, 0);
  assert.equal(final.sourceStable, true); assert.equal(final.additionalSourceStable, true); assert.equal(final.originalDigest, meta.originalDigest);
  proof.accepted = final.submittedRequests; proof.fixture = final;
  report.results.push({ case: "member-isolated-material-draft-owner-revalidation-and-live-reader403-retire-discovered-metadata-without-extra-write", passed: true });
}

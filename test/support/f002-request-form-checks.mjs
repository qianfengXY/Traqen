import assert from "node:assert/strict";
import path from "node:path";
import { buttonTextContrast, settleWorkbenchTheme } from "./f002-theme-contrast-checks.mjs";

export async function verifyRequestForm({ page, web, meta, metadata, report, directory, connect, authenticateEntry, evidence, readerToken }) {
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY");
  const panel = () => page.locator("details.f002-panel").filter({ has: page.getByText("受授权的定向取证与持久回执", { exact: true }) });
  const open = async () => { const value = panel(); if (!await value.evaluate(node => node.open)) await value.locator("summary").first().click(); return value; };
  const purpose = () => page.getByLabel("取证请求类型", { exact: true });
  const capabilities = () => page.getByLabel("请求的已安装能力", { exact: true });
  const investigation = () => page.getByLabel("可信调查 ID", { exact: true });
  const question = () => page.getByRole("textbox", { name: "问题（不粘贴敏感原文）", exact: true });
  const submit = () => page.getByRole("button", { name: "按当前固定引用请求取证", exact: true });
  const choices = ["TARGETED_EVIDENCE", "SUSPECTED_OMISSION", "SUSPECTED_ERROR"];
  const posted = [], fieldErrors = [];
  async function fieldFeedback(control, field) {
    await control.locator("xpath=..").locator(".f002-field-error").waitFor();
    const value = await control.evaluate(node => {
      const descriptions = (node.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map(id => document.getElementById(id));
      const feedback = descriptions.find(node => node?.classList.contains("f002-field-error"));
      return { invalid: node.getAttribute("aria-invalid"), descriptionCount: descriptions.length, allResolved: descriptions.every(Boolean),
        sameField: feedback?.closest("label") === node.closest("label"), message: feedback?.textContent.trim() ?? "" };
    });
    assert.equal(value.invalid, "true"); assert.equal(value.allResolved, true); assert.equal(value.sameField, true);
    assert.ok(value.message.length > 0); fieldErrors.push({ field, ...value });
  }
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/v1/workspaces/workspace/deterministic-facts/requests") {
      const body = request.postDataJSON();
      posted.push({ operationId: body.operationId, requestKind: body.requestKind, investigationId: body.investigationId, baseVersionId: body.baseVersionId,
        materialRefs: body.materialRefs, factRefs: body.factRefs, requestedCapabilities: body.requestedCapabilities });
    }
  });
  await open();
  await fieldFeedback(investigation(), "investigationId");
  assert.deepEqual(await purpose().locator("option").evaluateAll(nodes => nodes.map(node => node.value)), choices);
  await purpose().selectOption("SUSPECTED_OMISSION"); await capabilities().selectOption(["properties"]);
  await investigation().fill(meta.formInvestigations.SUSPECTED_OMISSION); await question().fill("Owned synthetic form check; suspicion is not a confirmed fact.");
  const fixed = page.url();
  await page.reload(); await connect(); await open();
  assert.equal(page.url(), fixed); assert.equal(await purpose().inputValue(), "SUSPECTED_OMISSION");
  assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
  assert.equal(await question().count(), 1, "the restored question keeps a unique exact accessible name");
  report.questionControl = { exactTextboxMatches: await question().count(), exactLabelMatches: await page.getByLabel("问题（不粘贴敏感原文）", { exact: true }).count() };
  assert.equal(await question().inputValue(), "Owned synthetic form check; suspicion is not a confirmed fact.");
  const controls = [];
  report.requestForm = { controls, posted, fieldErrors, osIme: "NOT_RUN", nativeZoom: "NOT_RUN" };
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 360, height: 225 }]) {
      await page.setViewportSize(viewport);
      await purpose().press("Tab");
      // Native focus and minimum scrolling can leave a stable fractional-pixel
      // clip. This check already permits explicit scrolling; center the whole
      // control and retain the strict bounds/hit/focus assertions below.
      await capabilities().evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" }));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const state = await capabilities().evaluate(node => { const box = node.getBoundingClientRect(), style = getComputedStyle(node);
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }, viewport: { width: innerWidth, height: innerHeight },
          focus: document.activeElement === node, visible: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
          hit: hit === node || node.contains(hit), outline: parseFloat(style.outlineWidth), outlineStyle: style.outlineStyle }; });
      controls.push({ theme, viewport, ...state });
      assert.equal(state.focus, true); assert.equal(state.visible, true); assert.equal(state.hit, true); assert.equal(state.outlineStyle, "solid"); assert.ok(state.outline >= 2);
      assert.equal(await purpose().inputValue(), "SUSPECTED_OMISSION");
      assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
      await question().fill(" \n "); await fieldFeedback(question(), "question");
      assert.equal(await submit().isDisabled(), true); assert.equal(posted.length, 0);
      assert.equal(await investigation().inputValue(), meta.formInvestigations.SUSPECTED_OMISSION);
      assert.equal(await purpose().inputValue(), "SUSPECTED_OMISSION");
      assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
      const message = question().locator("xpath=..").locator(".f002-field-error");
      await message.scrollIntoViewIfNeeded(); await settleWorkbenchTheme(page, theme, report.themeSettles ??= []);
      const colors = await message.evaluate(node => { const styles = []; for (let n = node; n; n = n.parentElement) styles.push(getComputedStyle(n));
        return { rendered: node.checkVisibility(), color: styles[0].color, backgrounds: styles.map(s => s.backgroundColor), opacity: styles.map(s => Number(s.opacity)), images: styles.map(s => s.backgroundImage) }; });
      const contrast = buttonTextContrast(colors); assert.ok(contrast >= 4.5, "field errors require actual readable text in both themes");
      fieldErrors.push({ field: "question", theme, viewport, contrast, ...colors });
      assert.equal(page.url(), fixed);
      await page.screenshot({ path: path.join(directory, `request-field-${theme}-${viewport.width}.png`), fullPage: true });
      await question().fill("Owned synthetic form check; suspicion is not a confirmed fact.");
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await open();
    await purpose().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(directory, `request-form-${theme}.png`), fullPage: true });
  }
  assert.equal(posted.length, 0, "draft edits theme reflow and refresh do not submit requests");
  report.requestForm.sourceStable = true;
  report.results.push({ case: "request-purpose-and-capability-draft-restores-current-binding-with-two-theme-keyboard-and-reflow-controls", passed: true });
  report.results.push({ case: "field-associated-invalid-input-retains-other-draft-fields-fixed-reading-and-readable-two-theme-feedback-without-post", passed: true });

  for (const requestKind of choices) {
    await purpose().selectOption(requestKind); await capabilities().selectOption(["properties"]);
    await investigation().fill(meta.formInvestigations[requestKind]); await question().fill(`Owned ${requestKind} request; do not infer correction or adoption.`);
    const response = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/workspaces/workspace/deterministic-facts/requests");
    await submit().click(); assert.equal((await response).status(), 202);
    const state = await metadata(), accepted = state.submittedRequests.at(-1);
    const result = page.getByRole("article", { name: "取证返回依据", exact: true }); await result.waitFor();
    await result.getByRole("heading", { name: accepted.id, exact: true }).waitFor();
    await result.getByText("任务：处理结束", { exact: false }).waitFor();
    assert.equal(accepted.requestKind, requestKind); assert.equal(accepted.investigationId, meta.formInvestigations[requestKind]);
    assert.equal(accepted.baseVersionId, meta.noFact.graphVersionId); assert.deepEqual(accepted.materialRefs, [meta.noFact.materialId]);
    assert.deepEqual(accepted.factRefs, []); assert.deepEqual(accepted.requestedCapabilities, ["properties"]);
    assert.equal(state.submittedRequests.length, choices.indexOf(requestKind) + 1); assert.equal(posted.length, state.submittedRequests.length);
    assert.equal(new URL(page.url()).searchParams.get("factset"), meta.noFact.graphVersionId);
    assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId);
    assert.equal(state.sourceStable, true); assert.equal(state.startRunCount, 0);
    report.results.push({ case: `actual-${requestKind}-single-accepted-request-keeps-base-and-uses-selected-capability-through-real-execution`, passed: true });
  }
  const missing = meta.formMissingBase, missingQuestion = "Owned missing-version rejection; retain this question and do not substitute latest.";
  await page.goto(`${web}${evidence(meta, { factset: missing.baseVersionId })}`); await authenticateEntry(); await open();
  await investigation().fill(missing.investigationId); await question().fill(missingQuestion);
  await purpose().selectOption("SUSPECTED_ERROR"); await capabilities().selectOption(["properties"]);
  const rejected = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === "/v1/workspaces/workspace/deterministic-facts/requests");
  await submit().click(); const response = await rejected, body = await response.json();
  assert.equal(response.status(), 404); assert.equal(body.error.code, "F002_VERSION_NOT_FOUND");
  const baseline = page.getByLabel("固定取证基准", { exact: true });
  await baseline.locator(".f002-field-error").waitFor();
  assert.match(await baseline.textContent(), new RegExp(missing.baseVersionId));
  assert.match(await baseline.locator(".f002-field-error").textContent(), /调查绑定的事实集版本不存在/);
  assert.equal(await question().inputValue(), missingQuestion); assert.equal(await investigation().inputValue(), missing.investigationId);
  assert.equal(await purpose().inputValue(), "SUSPECTED_ERROR"); assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
  assert.equal(new URL(page.url()).searchParams.get("factset"), missing.baseVersionId); assert.equal((await metadata()).submittedRequests.length, 3);
  report.requestForm.missingVersion = { status: response.status(), code: body.error.code, fixedBase: missing.baseVersionId, questionPreserved: true, acceptedCount: 3 };
  await baseline.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(directory, "request-version-rejected.png"), fullPage: true });
  await page.reload(); await authenticateEntry(); await open(); assert.equal(await question().inputValue(), missingQuestion);
  await page.goto(fixed); await connect(); await open();
  assert.equal(await question().inputValue(), "Owned SUSPECTED_ERROR request; do not infer correction or adoption.");
  assert.equal(posted.length, 4, "three accepted submissions plus one actual404, without automatic resubmission");
  report.results.push({ case: "actual-missing-version404-is-next-to-frozen-baseline-preserves-draft-on-rejection-refresh-and-return-without-new-request", passed: true });
  const identity = page.locator(".f002-auth"); await identity.locator("summary").click();
  await identity.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await identity.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator(".f002-reading").getByRole("heading", { name: "preview.application.properties", exact: true }).waitFor(); await open();
  assert.equal(await investigation().inputValue(), ""); assert.equal(await question().inputValue(), "");
  assert.equal(await purpose().inputValue(), "TARGETED_EVIDENCE");
  assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), []);
  assert.equal(await submit().isDisabled(), true);
  const final = await metadata(); assert.equal(final.submittedRequests.length, 3); assert.equal(final.sourceStable, true);
  assert.equal(new Set(final.submittedRequests.map(value => value.id)).size, 3);
  assert.equal(new Set(final.submittedRequests.map(value => value.operationId)).size, 3);
  assert.equal(final.originalDigest, meta.originalDigest); assert.equal(final.startRunCount, 0);
  report.requestForm.accepted = final.submittedRequests; report.requestForm.originalDigest = final.originalDigest;
  report.results.push({ case: "read-only-member-has-isolated-request-draft-and-cannot-submit-without-maintain-or-consumer-authority", passed: true });
}

import assert from "node:assert/strict";
import path from "node:path";

// Actual HTTP/browser acceptance, not a replacement for production F003 or
// running-worker cancellation tests. The queued cancellation is named as such.
export async function verifyRequestRecovery({ page, meta, metadata, report, directory, connect, readerToken, ownerToken }) {
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY");
  assert.ok(meta.requestRecovery, "only the explicit owned recovery fixture can inject faults");
  const route = "/v1/workspaces/workspace/deterministic-facts";
  const panel = () => page.locator("details.f002-panel").filter({ has: page.getByText("受授权的定向取证与持久回执", { exact: true }) });
  const open = async () => { if (!await panel().evaluate(node => node.open)) await panel().locator("summary").first().click(); };
  const investigation = () => panel().getByLabel("可信调查 ID", { exact: true });
  const question = () => panel().getByRole("textbox", { name: "问题（不粘贴敏感原文）", exact: true });
  const purpose = () => panel().getByLabel("取证请求类型", { exact: true });
  const capabilities = () => panel().getByLabel("请求的已安装能力", { exact: true });
  const lookup = () => panel().getByLabel("持久请求 ID", { exact: true });
  const submit = () => panel().getByRole("button", { name: "按当前固定引用请求取证", exact: true });
  const result = () => page.getByRole("article", { name: "取证返回依据", exact: true });
  const reconcile = () => panel().getByRole("button", { name: "对账原操作", exact: true });
  const posted = [], failed = [], operationReads = [], stages = [];
  report.requestRecovery = { posted, failed, operationReads, stages, osIme: "NOT_RUN", runningWorkerCancellation: "NOT_RUN" };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "POST" && (pathname === `${route}/requests` || pathname.startsWith(`${route}/requests/`))) posted.push({ pathname, body: request.postDataJSON() });
    if (request.method() === "GET" && pathname.startsWith(`${route}/operations/`)) operationReads.push(pathname);
  });
  page.on("requestfailed", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith(`${route}/requests`))
      failed.push({ pathname: new URL(request.url()).pathname, error: request.failure()?.errorText });
  });
  const fixed = page.url();
  const journal = () => page.evaluate(binding => {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith("traqen:f002:journal:"))) {
      const value = JSON.parse(localStorage.getItem(key));
      if (value.context?.namespace === "request" && value.context.actorId === "owner" && value.context.workspaceId === "workspace"
        && value.context.baseVersionId === binding.version && value.context.targetRef === `MATERIAL:${binding.material}`) return value;
    }
    return null;
  }, { version: meta.noFact.graphVersionId, material: meta.noFact.materialId });
  const prepare = async (kind, text) => {
    await open(); await investigation().fill(meta.formInvestigations[kind]); await question().fill(text);
    await purpose().selectOption(kind); await capabilities().selectOption(["properties"]);
  };
  const checkDraft = async (kind, text) => {
    assert.equal(await investigation().inputValue(), meta.formInvestigations[kind]); assert.equal(await question().inputValue(), text);
    assert.equal(await purpose().inputValue(), kind);
    assert.deepEqual(await capabilities().evaluate(node => Array.from(node.selectedOptions, option => option.value)), ["properties"]);
    assert.equal(page.url(), fixed);
  };
  const waitPending = async operationId => {
    await panel().locator(".f002-notice").filter({ hasText: `本次操作 ${operationId} 尚未确认` }).waitFor();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(node => node.textContent === "对账原操作" && !node.disabled));
    assert.equal(await submit().isDisabled(), true);
  };
  const switchActor = async token => {
    const auth = page.locator(".f002-auth");
    if (!await auth.evaluate(node => node.open)) await auth.locator("summary").click();
    await auth.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(token);
    const access = page.waitForResponse(response => new URL(response.url()).pathname === route
      && response.request().method() === "GET" && response.request().headers().authorization === `Bearer ${token}`);
    await auth.getByRole("button", { name: "验证并连接", exact: true }).click();
    assert.equal((await access).status(), 200);
    await page.locator('.f002-code [data-line="401"]').waitFor(); await open();
  };
  const lost = pathname => page.waitForEvent("requestfailed", request => request.method() === "POST" && new URL(request.url()).pathname === pathname);
  const readOperation = async operationId => {
    const response = page.waitForResponse(response => response.request().method() === "GET"
      && new URL(response.url()).pathname === `${route}/operations/${operationId}`);
    await reconcile().focus(); await reconcile().press("Enter");
    const actual = await response; assert.equal(actual.status(), 200);
    const envelope = await actual.json(); assert.equal(envelope.operationId, operationId); assert.equal(envelope.results.length, 1);
    assert.equal(envelope.results[0].kind, "REQUEST");
    await page.waitForFunction(() => !Array.from(document.querySelectorAll("button")).some(node => node.textContent === "对账原操作"));
    return envelope.results[0].value;
  };

  const firstText = "Owned accepted request response lost; preserve original input and operation without resubmission.";
  await prepare("TARGETED_EVIDENCE", firstText);
  await metadata("drop-next-request-response", "POST");
  const firstFailure = lost(`${route}/requests`); await submit().focus(); await submit().press("Enter");
  assert.equal((await firstFailure).failure()?.errorText, "net::ERR_CONTENT_LENGTH_MISMATCH");
  const firstMeta = await metadata(), accepted = firstMeta.submittedRequests[0];
  assert.equal(firstMeta.requestRecovery.submissionCount, 1); assert.equal(firstMeta.requestRecovery.droppedRequestResponses, 1);
  assert.equal(firstMeta.requestRecovery.lastDroppedRequest.status, 202); assert.equal(firstMeta.requestRecovery.lastDroppedRequest.requestId, accepted.id);
  assert.equal(posted.length, 1); assert.equal(posted[0].body.operationId, accepted.operationId);
  assert.deepEqual(posted[0].body, { operationId: accepted.operationId, investigationId: meta.formInvestigations.TARGETED_EVIDENCE,
    baseVersionId: meta.noFact.graphVersionId, requestKind: "TARGETED_EVIDENCE", question: firstText,
    factRefs: [], materialRefs: [meta.noFact.materialId], requestedCapabilities: ["properties"] });
  await waitPending(accepted.operationId); await checkDraft("TARGETED_EVIDENCE", firstText);
  const original = await journal(); assert.deepEqual(original.pending.body, posted[0].body); assert.equal(original.pending.path, "/requests");
  stages.push({ stage: "accepted-response-lost", requestId: accepted.id, pending: original.pending, draft: original.draft });
  await page.screenshot({ path: path.join(directory, "request-submit-unknown.png"), fullPage: true });
  report.results.push({ case: "actual-request-POST202-response-loss-persists-exact-operation-input-and-blocks-duplicate-submission", passed: true });

  await switchActor(readerToken);
  assert.equal(await investigation().inputValue(), ""); assert.equal(await question().inputValue(), "");
  assert.equal(await reconcile().count(), 0); assert.equal(await submit().isDisabled(), true);
  assert.deepEqual((await journal()).pending, original.pending, "another member cannot retire or consume the owner's unknown operation");
  await page.reload(); await connect(); await open(); await waitPending(accepted.operationId);
  await checkDraft("TARGETED_EVIDENCE", firstText); assert.deepEqual((await journal()).pending, original.pending);
  assert.equal(posted.length, 1); stages.push({ stage: "owner-refresh-restored", pending: (await journal()).pending });
  report.results.push({ case: "member-isolated-unknown-operation-and-owner-refresh-retain-the-same-journal-without-any-POST", passed: true });

  const restored = await readOperation(accepted.operationId);
  assert.equal(restored.id, accepted.id); assert.equal(restored.operationId, accepted.operationId); assert.equal(restored.baseVersionId, meta.noFact.graphVersionId);
  await result().getByRole("heading", { name: accepted.id, exact: true }).waitFor();
  await result().getByText("任务：处理结束", { exact: false }).waitFor();
  await result().getByRole("link", { name: "查看独立新事实集（不采用）", exact: true }).waitFor();
  assert.equal((await journal()).pending, null); await checkDraft("TARGETED_EVIDENCE", firstText);
  assert.equal(await lookup().inputValue(), accepted.id); assert.equal(posted.length, 1);
  stages.push({ stage: "creation-reconciled", requestId: restored.id, operationId: restored.operationId, status: restored.status, baseVersionId: restored.baseVersionId });
  report.results.push({ case: "actual-original-request-operation-GET-recovers-the-accepted-ID-and-real-result-without-resubmit-or-base-adoption", passed: true });

  assert.equal((await metadata("pause-request-executor", "POST")).requestRecovery.paused, true);
  const secondText = "Owned queued cancellation with lost response; retain the cancellation operation and original base.";
  await prepare("SUSPECTED_OMISSION", secondText);
  const secondResponse = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname === `${route}/requests`);
  await submit().focus(); await submit().press("Enter");
  const response = await secondResponse; assert.equal(response.status(), 202); const queued = (await response.json()).request;
  assert.equal(queued.status, "QUEUED"); await result().getByRole("heading", { name: queued.id, exact: true }).waitFor();
  const cancel = result().getByRole("button", { name: "按当前调查授权取消", exact: true }); await cancel.waitFor();
  const cancelPath = `${route}/requests/${queued.id}/cancel`;
  await metadata("drop-next-request-cancel-response", "POST"); const cancelFailure = lost(cancelPath);
  await cancel.focus(); await cancel.press("Enter"); assert.equal((await cancelFailure).failure()?.errorText, "net::ERR_CONTENT_LENGTH_MISMATCH");
  assert.equal(posted.length, 3); assert.equal(posted[2].pathname, cancelPath);
  const cancelId = posted[2].body.operationId;
  assert.notEqual(cancelId, queued.operationId); assert.deepEqual(posted[2].body, { operationId: cancelId, revision: queued.revision });
  await waitPending(cancelId); const cancellationJournal = await journal();
  assert.equal(cancellationJournal.pending.path, `/requests/${queued.id}/cancel`); assert.deepEqual(cancellationJournal.pending.body, posted[2].body);
  await page.reload(); await connect(); await open(); await waitPending(cancelId); await checkDraft("SUSPECTED_OMISSION", secondText);
  assert.deepEqual((await journal()).pending, cancellationJournal.pending);
  const cancelled = await readOperation(cancelId);
  assert.equal(cancelled.id, queued.id); assert.equal(cancelled.status, "CANCELLED"); assert.equal(cancelled.cancelOperationId, cancelId);
  assert.equal(cancelled.operationId, queued.operationId); assert.equal(cancelled.baseVersionId, meta.noFact.graphVersionId);
  await result().getByText("任务：已取消", { exact: false }).waitFor(); assert.equal(await result().getByRole("link").count(), 0);
  const resumed = await metadata("resume-request-executor", "POST");
  assert.equal(resumed.requestRecovery.submissionCount, 2); assert.equal(resumed.requestRecovery.cancellationCount, 1);
  assert.equal(resumed.requestRecovery.executedRequestIds.includes(queued.id), false);
  const rowResponse = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === `${route}/requests/${queued.id}`);
  await result().getByRole("button", { name: "刷新原请求状态", exact: true }).click();
  const actualCancelled = (await (await rowResponse).json()).request;
  assert.equal(actualCancelled.status, "CANCELLED"); assert.equal(actualCancelled.cancelOperationId, cancelId);
  assert.equal((await journal()).pending, null); assert.equal(posted.length, 3); await checkDraft("SUSPECTED_OMISSION", secondText);
  stages.push({ stage: "queued-cancellation-reconciled", requestId: queued.id, creationOperationId: queued.operationId, cancelOperationId: cancelId,
    revision: actualCancelled.revision, status: actualCancelled.status, schedulerResumed: !resumed.requestRecovery.paused, executed: false });
  await page.screenshot({ path: path.join(directory, "request-cancel-reconciled.png"), fullPage: true });
  report.results.push({ case: "actual-queued-cancel-POST200-response-loss-reconciles-its-distinct-operation-and-never-executes-after-dispatch-resumes", passed: true });

  await switchActor(readerToken); await lookup().fill(queued.id);
  await panel().getByRole("button", { name: "复验原绑定并读取", exact: true }).click();
  await result().getByRole("heading", { name: queued.id, exact: true }).waitFor();
  await result().getByText("任务：已取消", { exact: false }).waitFor(); assert.equal(await result().getByRole("link").count(), 0);
  const forbidden = page.waitForResponse(response => response.status() === 403 && new URL(response.url()).pathname.includes("/deterministic-facts"));
  await metadata("revoke-reader", "POST"); const denied = await forbidden;
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await result().count(), 0); assert.equal(await page.locator(".f002-code").count(), 0);
  report.requestRecovery.revocation = { status: denied.status(), pathname: new URL(denied.url()).pathname, automaticRetirement: true };
  await metadata("restore-reader", "POST"); await switchActor(ownerToken); await checkDraft("SUSPECTED_OMISSION", secondText);
  assert.equal(await lookup().inputValue(), queued.id); assert.equal((await journal()).pending, null);
  const final = await metadata();
  assert.equal(final.sourceStable, true); assert.equal(final.originalDigest, meta.originalDigest); assert.equal(final.startRunCount, 0);
  assert.equal(final.submittedRequests.length, 2); assert.equal(final.requestRecovery.submissionCount, 2); assert.equal(final.requestRecovery.cancellationCount, 1);
  assert.equal(final.requestRecovery.droppedRequestResponses, 1); assert.equal(final.requestRecovery.droppedCancelResponses, 1);
  assert.equal(final.requestRecovery.paused, false); assert.equal(posted.length, 3); assert.equal(failed.length, 2);
  report.requestRecovery.fixture = final;
  report.results.push({ case: "authorized-cancelled-receipt-remains-readable-without-fabricated-evidence-and-current403-retires-it-with-stable-source-and-owner-draft", passed: true });
}

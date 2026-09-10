// Small real-browser failure/recovery journeys; never a scale acceptance.
import assert from "node:assert/strict";
import path from "node:path";

export async function recoveryJourneys({ f, page, station, connect, picker, start, review, seal, mutations,
  evidenceDirectory, directoryBaseline, gitBaseline, record }) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const screenshot = (name) => page.screenshot({ path: path.join(evidenceDirectory, `${name}.png`), fullPage: true });
  const noPublished = async (workspace) => {
    assert.equal((await f.read(workspace, "/history/bundles?limit=50")).items.length, 0);
    assert.equal((await f.read(workspace, "/history/receipts?limit=50")).items.length, 0);
  };

  await connect("directory");
  await button("创建新版本").click(); await station(1);
  await start(); await station(7);
  const cancelled = (await f.read("directory")).activeRun;
  const beforeDismiss = mutations.length;
  page.once("dialog", (dialog) => dialog.dismiss());
  await button("取消本次任务").click();
  assert.equal(mutations.length, beforeDismiss, "dismissing cancellation cannot mutate the run");
  assert.equal((await f.read("directory")).activeRun.id, cancelled.id);
  page.once("dialog", (dialog) => dialog.accept());
  await button("取消本次任务").click();
  await page.getByText("任务已取消 · 检查点仍保留", { exact: true }).waitFor();
  assert.equal((await f.read("directory", `/runs/${cancelled.id}/view`)).run.status, "CANCELLED");
  assert.equal((await f.read("directory")).activeRun, null);
  assert.deepEqual(await f.read("directory", `/bundles/${directoryBaseline.id}`), directoryBaseline);
  assert.equal(await button("冻结包").count(), 0);
  await screenshot("cancelled-preserves-baseline");
  await button("编辑来源，创建新尝试").click(); await station(1);
  assert.equal(await button("确认清单与缺口").count(), 0);
  assert.equal(await button("冻结包").count(), 0);
  await record({ case: "cancel-before-freeze", run: cancelled.id, dismissNoMutation: true,
    terminalAuditRetained: true, baselineUnchanged: true, editingRestartsAtOne: true });

  await connect("git");
  await button("创建新版本").click(); await station(1);
  await page.getByRole("combobox", { name: "本版处理", exact: true }).selectOption("UPDATE");
  f.failNextGitCapture("git");
  await start();
  await button("保留原输入，创建重试").waitFor();
  const failed = (await f.read("git", "/history/runs?limit=50")).items[0];
  assert.equal(failed.status, "FAILED_RETRYABLE");
  assert.equal(failed.diagnostic.code, "SOURCE_GIT_UNAVAILABLE");
  assert.deepEqual(await f.read("git", `/bundles/${gitBaseline.id}`), gitBaseline);
  assert.equal((await f.read("git", "/history/receipts?limit=50")).items.length, 1);
  await button("保留原输入，创建重试").click(); await station(7);
  const retry = (await f.read("git")).activeRun;
  assert.notEqual(retry.id, failed.id); assert.equal(retry.retryOf, failed.id);
  assert.deepEqual(retry.input, failed.input);
  assert.equal((await f.read("git", `/runs/${failed.id}/view`)).run.status, "FAILED_RETRYABLE");
  await screenshot("retry-retains-original-attempt");
  await review(); const retried = await seal("git");
  assert.equal(retried.latestReceipt.status, "READY");
  assert.equal((await f.read("git", `/runs/${retry.id}/view`)).run.status, "SUCCEEDED");
  await record({ case: "transient-failure-retry", failure: failed.id, retry: retry.id,
    sameLockedInput: true, failedAttemptRetained: true, recoveredStatus: "SUCCEEDED" });

  await connect("changed"); await station(1);
  await page.getByRole("checkbox", { name: "上传目录", exact: true }).check();
  await picker("changed-directory", 2);
  await button("选择本机目录").click();
  const uploadRoute = /\/workspaces\/changed\/source-truth\/runs\/[^/]+\/sources\/[^/]+\/complete-file\?/;
  await page.route(uploadRoute, (route) => route.abort("failed"));
  await start(); await station(6);
  await page.locator('.st-workbench [role="alert"]').filter({ hasText: "SOURCE_NETWORK_UNCONFIRMED" }).waitFor();
  await page.unroute(uploadRoute);
  const waiting = (await f.read("changed")).activeRun;
  const original = await f.read("changed", `/runs/${waiting.id}/view`);
  assert.ok(original.sources[0].manifestId); assert.equal(original.run.status, "WAITING_FOR_CLIENT");
  await picker("changed-directory", 2, 2); // Same paths and sizes, different bytes.
  const beforeReselect = mutations.length;
  await button("重新选择目录并继续").click();
  await page.getByText("重新选择的目录与本次冻结清单不同。请恢复原材料，或取消后创建新版本；不能把缺项当删除继续续传。", { exact: true }).waitFor();
  assert.equal(mutations.length, beforeReselect, "mismatched full rescan must not upload, replace manifest or publish");
  const unchanged = await f.read("changed", `/runs/${waiting.id}/view`);
  assert.equal(unchanged.sources[0].manifestId, original.sources[0].manifestId);
  assert.equal(unchanged.run.status, "WAITING_FOR_CLIENT"); await noPublished("changed");
  await screenshot("changed-reselection-rejected");
  await picker("changed-directory", 2, 1);
  await button("重新选择目录并继续").click(); await station(7);
  assert.equal((await f.read("changed")).activeRun.id, waiting.id);
  await review(); const restored = await seal("changed");
  assert.equal(restored.counts.fileCount, "2");
  await record({ case: "changed-directory-reselection", run: waiting.id, changedBytesRejectedBeforeWrite: true,
    manifestUnchanged: true, originalBytesResumeSameRun: true, files: 2 });

  await connect("expiry"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
  await page.getByLabel("版本或分支", { exact: true }).fill(f.gapCommit);
  await start(); await station(7);
  const expiring = (await f.read("expiry")).activeRun;
  const candidate = (await f.read("expiry", `/runs/${expiring.id}/view`)).candidate;
  await page.getByRole("textbox", { name: "接受全部非阻断缺口的理由", exact: true }).fill("只接受到本次明确的短期限，不允许自动延期");
  const deadline = new Date(Date.now() + 8000);
  await page.getByLabel("接受失效时间（浏览器本地时间）", { exact: true })
    .fill(new Date(deadline.getTime() - deadline.getTimezoneOffset() * 60000).toISOString().slice(0, 19));
  await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).check();
  await button("确认清单与缺口").click(); await station(8);
  const accepted = (await f.read("expiry", `/runs/${expiring.id}/view`)).confirmation;
  assert.equal(accepted.currentlyValid, true);
  const expiryRoute = new RegExp(`/runs/${expiring.id}/seal$`);
  await page.route(expiryRoute, async (route) => {
    // Delay only transport, until the real server says this exact acceptance
    // has expired. No clock override or mutable confirmation fixture.
    const end = Date.now() + 15000;
    while ((await f.read("expiry", `/runs/${expiring.id}/view`)).confirmation.currentlyValid) {
      assert.ok(Date.now() < end, "server acceptance expiry exceeded the bounded wait");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await route.continue();
  });
  const rejected = page.waitForResponse((response) => expiryRoute.test(response.url()) && response.request().method() === "POST");
  await button("冻结包").click();
  const expiredResponse = await rejected;
  assert.equal(expiredResponse.status(), 409);
  assert.equal((await expiredResponse.json()).error.code, "SOURCE_ACCEPTANCE_EXPIRED");
  await page.unroute(expiryRoute); await station(7); await noPublished("expiry");
  const expired = await f.read("expiry", `/runs/${expiring.id}/view`);
  assert.equal(expired.confirmation.id, accepted.id); assert.equal(expired.confirmation.expiresAt, accepted.expiresAt);
  assert.equal(expired.confirmation.currentlyValid, false); assert.deepEqual(expired.candidate, candidate);
  assert.equal(await button("确认清单与缺口").isDisabled(), true);
  await screenshot("expired-acceptance-returns-review");
  const beforeRenewedConfirmation = mutations.length;
  await review(true); const renewed = await seal("expiry");
  assert.equal(renewed.id, candidate.id); assert.equal(renewed.latestReceipt.status, "READY_WITH_ACCEPTED_GAPS");
  assert.notEqual(renewed.latestReceipt.confirmationId, accepted.id);
  assert.ok(mutations.slice(beforeRenewedConfirmation).every(({ url }) => /\/(confirm|seal)$/.test(url)), "renewed acceptance cannot recapture or create another run");
  await record({ case: "acceptance-expires-before-seal", run: expiring.id, expiredConfirmation: accepted.id,
    serverRejected: "SOURCE_ACCEPTANCE_EXPIRED", noPublicationAtExpiry: true, sameCandidateWithoutRecapture: true, explicitNewConfirmation: true });
}

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { settleWorkbenchTheme } from "./f002-theme-contrast-checks.mjs";

export async function verifyDeliveryLifecycle({ page, api, meta, metadata, directory, report, connect, ownerToken, readerToken }) {
  const route = "/v1/workspaces/workspace/deterministic-facts";
  const proof = report.deliveryLifecycle = { writes: [], checks: [], exports: [], stages: [], accepted: false };
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith(route) && !["GET", "OPTIONS"].includes(request.method())) proof.writes.push({ pathname, method: request.method(), body: request.postDataJSON() });
  });
  const responseFor = (pathname, method = "POST") => page.waitForResponse(response => new URL(response.url()).pathname === pathname && response.request().method() === method);
  const read = async tail => {
    const response = await fetch(api + route + tail, { headers: { Authorization: `Bearer ${ownerToken}` }, signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200); return response.json();
  };
  const fixedBase = () => new URL(page.url()).searchParams.get("factset");
  const runRow = id => page.locator(".f002-delivery article").filter({ has: page.getByRole("heading", { name: `运行 ${id}`, exact: true }) });
  const versions = () => page.locator(".f002-delivery > section").last();
  const replayRow = id => versions().locator(":scope > div").filter({ has: page.getByText(id, { exact: true }) });
  const reconciled = () => page.getByText("已按原操作键核对持久回执；草稿保留，不自动采用业务结果。", { exact: true }).waitFor();
  const refresh = async () => { await page.getByRole("button", { name: "复验权限并刷新", exact: true }).click(); await page.getByRole("heading", { name: "新建技术提取", exact: true }).waitFor(); };
  const check = async run => {
    const response = responseFor(`${route}/runs/${run.id}/scopes/${run.scopes[0].scopeId}/check`);
    await runRow(run.id).getByRole("button", { name: "查看封存条件", exact: true }).click();
    const actual = await response; assert.equal(actual.status(), 200);
    const value = (await actual.json()).check; proof.checks.push(value); return value;
  };
  const start = async () => {
    const accepted = responseFor(`${route}/runs`);
    await page.getByRole("button", { name: "按固定输入开始提取", exact: true }).click();
    const actual = await accepted; assert.equal(actual.status(), 202);
    const run = (await actual.json()).run;
    await runRow(run.id).waitFor(); await reconciled(); return run;
  };
  const submitReplay = async versionId => {
    const accepted = responseFor(`${route}/versions/${versionId}/replays`);
    await versions().getByRole("button", { name: "启动真实重放", exact: true }).click();
    const actual = await accepted; assert.equal(actual.status(), 202);
    const replay = (await actual.json()).replay;
    await replayRow(replay.id).waitFor(); await reconciled(); return replay;
  };
  const exportCurrent = async versionId => {
    const downloaded = page.waitForEvent("download");
    await versions().getByRole("button", { name: "导出五部分交付", exact: true }).click();
    const download = await downloaded, bytes = await readFile(await download.path()), value = JSON.parse(bytes.toString("utf8"));
    assert.equal(download.suggestedFilename(), `f002-${versionId}.json`);
    assert.equal(value.workspaceId, "workspace"); assert.equal(value.graphVersionId, versionId); assert.equal(value.schemaVersion, 1);
    const manifest = (await read(`/versions/${versionId}/manifest`)).manifest;
    assert.deepEqual(value.manifest, manifest); assert.deepEqual(value.vocabulary, manifest.vocabulary);
    const records = []; let cursor = null;
    do {
      const chunk = await read(`/versions/${versionId}/records?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      records.push(...chunk.items); cursor = chunk.nextCursor;
    } while (cursor);
    for (const [part, kinds] of [["objects", ["MATERIAL", "OBJECT"]], ["facts", ["FACT"]], ["evidence", ["EVIDENCE"]], ["gaps", ["GAP"]]]) {
      assert.deepEqual(value[part], records.filter(record => kinds.includes(record.kind)), `export exact ${part}, no fabricated or truncated records`);
    }
    // Request IDs identify two different HTTP reads, not sealed domain data.
    const { requestId: exportedRead, ...exportedCoverage } = value.coverage;
    const { requestId: comparisonRead, ...currentCoverage } = await read(`/versions/${versionId}/coverage`);
    assert.equal(typeof exportedRead, "string"); assert.equal(typeof comparisonRead, "string");
    assert.deepEqual(exportedCoverage, currentCoverage);
    assert.equal(bytes.includes(Buffer.from("SYNTHETIC_BROWSER_PASSWORD")), false, "export cannot include original sensitive material bytes");
    const file = `delivery-export-${proof.exports.length + 1}.json`;
    await writeFile(path.join(directory, file), bytes, { flag: "wx" });
    proof.exports.push({ file, graphVersionId: versionId, counts: Object.fromEntries(["objects", "facts", "evidence", "gaps"].map(kind => [kind, value[kind].length])), originalBytesIncluded: false });
    return manifest;
  };

  assert.equal(meta.sourceStable, true); assert.equal(meta.startRunCount, 0);
  await metadata("pause-delivery-executor", "POST"); await metadata("pause-delivery-replays", "POST");
  await page.locator(".f002-tabs").getByRole("link", { name: "版本与交付", exact: true }).click();
  await page.getByRole("heading", { name: "新建技术提取", exact: true }).waitFor();
  await page.getByLabel("冻结来源", { exact: true }).selectOption(meta.sourceVersionId);
  await page.getByLabel("不可变能力配置", { exact: true }).selectOption(meta.delivery.profileId);
  await page.locator(".f002-delivery fieldset").getByRole("checkbox").first().check();
  const run = await start(); assert.equal(run.scopes[0].status, "QUEUED");
  assert.equal(fixedBase(), meta.noFact.graphVersionId);
  const blocked = await check(run); assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [{ code: "F002_SCOPE_COVERAGE_INCOMPLETE", count: 0 }, { code: "F002_SCOPE_NOT_READY", status: "QUEUED" }]);
  assert.equal(await runRow(run.id).getByRole("button", { name: "封存此范围", exact: true }).count(), 0);
  await page.reload(); await connect(); await runRow(run.id).waitFor();
  assert.equal(await page.getByLabel("冻结来源", { exact: true }).inputValue(), meta.sourceVersionId);
  assert.equal(await page.getByLabel("不可变能力配置", { exact: true }).inputValue(), meta.delivery.profileId);
  assert.equal(await page.locator(".f002-delivery fieldset").getByRole("checkbox").first().isChecked(), true);
  assert.equal(fixedBase(), meta.noFact.graphVersionId);
  proof.stages.push({ stage: "queued-authorized-refresh", runId: run.id, base: fixedBase(), blocked: blocked.blockers });
  report.results.push({ case: "real-queued-run-and-draft-refresh-retain-old-reading-and-disallow-premature-seal", passed: true });

  await metadata("resume-delivery-executor", "POST"); await refresh();
  await runRow(run.id).getByText(/^READY_TO_SEAL · revision/).waitFor();
  const ready = await check(run); assert.equal(ready.ready, true); assert.deepEqual(ready.blockers, []);
  const sealedResponse = responseFor(`${route}/runs/${run.id}/scopes/${run.scopes[0].scopeId}/seal`);
  await runRow(run.id).getByRole("button", { name: "封存此范围", exact: true }).click();
  const sealedActual = await sealedResponse; assert.equal(sealedActual.status(), 200);
  const sealed = (await sealedActual.json()).scope; assert.equal(sealed.status, "SEALED");
  await runRow(run.id).getByRole("button", { name: "查看独立封存版本", exact: true }).waitFor(); await reconciled();
  assert.equal(fixedBase(), meta.noFact.graphVersionId, "publication cannot silently replace the browser's fixed version");
  const originalManifest = (await read(`/versions/${meta.noFact.graphVersionId}/manifest`)).manifest;
  const sealedManifest = (await read(`/versions/${sealed.graphVersionId}/manifest`)).manifest;
  assert.notEqual(sealed.graphVersionId, meta.noFact.graphVersionId);
  await runRow(run.id).getByRole("button", { name: "查看独立封存版本", exact: true }).click();
  await page.waitForFunction(id => new URL(location.href).searchParams.get("factset") === id, sealed.graphVersionId);
  await versions().locator('button[aria-current="true"]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get("source"), meta.sourceVersionId);
  proof.sealed = { runId: run.id, ...sealed, fixedOldBase: meta.noFact.graphVersionId, recordDigest: sealedManifest.recordDigest };
  report.results.push({ case: "real-worker-check-and-seal-return-immutable-receipt-and-require-explicit-version-inspection", passed: true });

  await exportCurrent(sealed.graphVersionId);
  const replay = await submitReplay(sealed.graphVersionId); assert.equal(replay.status, "QUEUED");
  await metadata("resume-delivery-replays", "POST");
  const replayRead = responseFor(`${route}/replays/${replay.id}`, "GET");
  await replayRow(replay.id).getByRole("button", { name: "刷新固定重放状态", exact: true }).click();
  const complete = await replayRead; assert.equal(complete.status(), 200);
  const matched = (await complete.json()).replay; assert.equal(matched.status, "MATCH"); assert.equal(matched.candidateDigest, sealedManifest.recordDigest);
  await replayRow(replay.id).getByText(/^MATCH · candidateDigest/).waitFor();
  assert.equal(fixedBase(), sealed.graphVersionId);
  proof.replay = matched;
  report.results.push({ case: "actual-five-part-download-matches-current-authorized-records-and-real-fixed-rule-replay-matches-digest", passed: true });

  await metadata("pause-delivery-executor", "POST");
  const cancelledRun = await start(); assert.equal(cancelledRun.scopes[0].status, "QUEUED");
  const cancelResponse = responseFor(`${route}/runs/${cancelledRun.id}/cancel`);
  await runRow(cancelledRun.id).getByRole("button", { name: "取消此范围", exact: true }).click();
  const actualCancel = await cancelResponse; assert.equal(actualCancel.status(), 200);
  const cancelledScope = (await actualCancel.json()).scope; assert.equal(cancelledScope.status, "CANCELLED"); await reconciled();
  const resumed = await metadata("resume-delivery-executor", "POST");
  assert.equal(resumed.delivery.executedScopes.some(item => item.runId === cancelledRun.id), false);
  await metadata("pause-delivery-replays", "POST");
  const cancelledReplay = await submitReplay(sealed.graphVersionId); assert.equal(cancelledReplay.status, "QUEUED");
  const cancelReplayResponse = responseFor(`${route}/replays/${cancelledReplay.id}/cancel`);
  await replayRow(cancelledReplay.id).getByRole("button", { name: "取消重放", exact: true }).click();
  const actualReplayCancel = await cancelReplayResponse; assert.equal(actualReplayCancel.status(), 200);
  assert.equal((await actualReplayCancel.json()).replay.status, "CANCELLED"); await reconciled();
  const replayResumed = await metadata("resume-delivery-replays", "POST");
  assert.equal(replayResumed.delivery.executedReplayIds.includes(cancelledReplay.id), false);
  await page.reload(); await connect();
  const recall = page.getByLabel("按运行 ID 回查", { exact: true }); await recall.fill(cancelledRun.id); await recall.press("Enter");
  await runRow(cancelledRun.id).getByText(/^CANCELLED · revision/).waitFor();
  await replayRow(cancelledReplay.id).getByText(/^CANCELLED · candidateDigest/).waitFor();
  assert.deepEqual((await read(`/versions/${meta.noFact.graphVersionId}/manifest`)).manifest, originalManifest);
  assert.deepEqual((await read(`/versions/${sealed.graphVersionId}/manifest`)).manifest, sealedManifest);
  proof.cancelled = { runId: cancelledRun.id, scope: cancelledScope, replayId: cancelledReplay.id, neitherExecutedAfterResume: true };
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    await settleWorkbenchTheme(page, theme, report.themeSettles ??= []);
    await page.screenshot({ path: path.join(directory, `delivery-${theme}.png`), fullPage: true });
  }
  report.results.push({ case: "queued-scope-and-replay-cancellation-survive-refresh-and-resumed-schedulers-never-execute-them", passed: true });

  const writesBeforeReader = proof.writes.length;
  const auth = page.locator("details.f002-auth"); if (!await auth.evaluate(node => node.open)) await auth.locator(":scope > summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await auth.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.getByText("当前成员只读，可查历史；不能启动、重试、取消或封存。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "按固定输入开始提取", exact: true }).isDisabled(), true);
  assert.equal(await versions().getByRole("button", { name: "启动真实重放", exact: true }).isDisabled(), true);
  await exportCurrent(sealed.graphVersionId); assert.equal(proof.writes.length, writesBeforeReader);
  await metadata("revoke-reader", "POST"); await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await page.locator(".f002-delivery").count(), 0);
  assert.equal(await page.getByRole("button", { name: "导出五部分交付", exact: true }).count(), 0);
  proof.fixture = await metadata();
  assert.equal(proof.fixture.sourceStable, true); assert.equal(proof.fixture.additionalSourceStable, true);
  assert.equal(proof.fixture.originalDigest, meta.originalDigest); assert.equal(proof.fixture.startRunCount, 2);
  assert.equal(proof.writes.filter(item => item.pathname === `${route}/runs`).length, 2);
  assert.equal(proof.writes.filter(item => item.pathname.endsWith("/replays")).length, 2);
  assert.equal(proof.writes.length, 9, "two starts/checks/replays, one seal and two cancellations, no automatic resubmit");
  const operationIds = proof.writes.flatMap(item => item.body.operationId ? [item.body.operationId] : []);
  assert.equal(operationIds.length, 7); assert.equal(new Set(operationIds).size, 7);
  proof.accepted = true;
  report.results.push({ case: "read-only-member-can-export-current-authorized-history-without-writes-and-live-revocation-retires-delivery", passed: true });
}

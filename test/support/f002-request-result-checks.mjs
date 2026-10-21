import assert from "node:assert/strict";

export async function verifyRequestResultNavigation({ page, api, web, meta, metadata, report, connect, evidence, readerToken }) {
  assert.equal(meta.consumerFixture, "OWNED_RESOLVER_TEST_DOUBLE_ONLY");
  const returnTo = { page: "graph", workspaceId: "workspace", objectId: "owned-answer-entry", graphRevisionId: "owned-business-revision", focusId: "owned-answer-entry", scrollTop: 120 };
  const panel = () => page.locator(".f002-panel").filter({ has: page.getByText("受授权的定向取证与持久回执", { exact: true }) });
  const result = () => page.getByRole("article", { name: "取证返回依据", exact: true });
  const read = async receipt => {
    await panel().locator("summary").first().click();
    const lookup = panel().getByLabel("持久请求 ID", { exact: true });
    await lookup.fill(receipt.id);
    const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/requests/${receipt.id}`) && response.request().method() === "GET");
    await panel().getByRole("button", { name: "复验原绑定并读取", exact: true }).click();
    assert.equal((await response).status(), 200);
    await result().getByRole("heading", { name: receipt.id, exact: true }).waitFor();
  };
  const visit = async receipt => {
    await page.goto(`${web}${evidence(meta, { factset: receipt.baseVersionId, businessGraph: "owned-business-revision", return: JSON.stringify(returnTo) })}`);
    await connect(); await page.locator('.f002-code [data-line="401"]').waitFor();
  };
  const requests = [];
  page.on("request", request => { if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) && new URL(request.url()).pathname.includes("/deterministic-facts")) requests.push({ method: request.method(), pathname: new URL(request.url()).pathname }); });
  const existing = meta.requestReceipts.EXISTING_EVIDENCE;
  await visit(existing); await read(existing);
  const existingLinks = result().getByRole("link"); assert.equal(await existingLinks.count(), 2);
  const factLink = existingLinks.filter({ hasText: "查看 FACT" });
  const href = await factLink.getAttribute("href"), fixed = new URL(href, web);
  assert.equal(fixed.searchParams.get("factset"), existing.baseVersionId); assert.equal(fixed.searchParams.get("record"), existing.factId);
  assert.equal(fixed.searchParams.has("line"), false); assert.deepEqual(JSON.parse(fixed.searchParams.get("return")), returnTo);
  const actualFactRead = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/records/FACT/${existing.factId}`));
  await factLink.focus(); await page.keyboard.press("Enter");
  assert.equal((await actualFactRead).status(), 200);
  await page.waitForFunction(id => new URL(location.href).searchParams.get("record") === id, existing.factId);
  assert.equal(new URL(page.url()).searchParams.get("factset"), existing.baseVersionId);
  report.results.push({ case: "actual-existing-result-keyboard-link-reads-exact-Fact-and-retains-original-work-without-resubmit", passed: true });

  const next = meta.requestReceipts.NEW_VERSION;
  await visit(next); await read(next);
  assert.equal(new URL(page.url()).searchParams.get("factset"), next.baseVersionId, "arrival of a new result must not switch reading");
  const newLink = result().getByRole("link", { name: "查看独立新事实集（不采用）", exact: true });
  const nextUrl = new URL(await newLink.getAttribute("href"), web);
  assert.equal(nextUrl.searchParams.get("factset"), next.graphVersionId);
  for (const key of ["record", "kind", "line", "lineEnd", "windowLine", "graphRoot", "relationReturn", "source"]) assert.equal(nextUrl.searchParams.has(key), false);
  await newLink.focus(); await page.keyboard.press("Enter");
  await page.waitForFunction(id => new URL(location.href).searchParams.get("factset") === id, next.graphVersionId);
  assert.equal(new URL(page.url()).searchParams.get("businessGraph"), "owned-business-revision");
  assert.deepEqual(JSON.parse(new URL(page.url()).searchParams.get("return")), returnTo);
  report.results.push({ case: "actual-derived-new-version-is-explicit-inspection-not-upstream-adoption-or-stale-source-range", passed: true });

  for (const outcome of ["LIMITATION", "REJECTED"]) {
    await visit(meta.requestReceipts[outcome]); await read(meta.requestReceipts[outcome]);
    assert.equal(await result().getByRole("link").count(), 0);
    assert.match(await result().innerText(), outcome === "LIMITATION" ? /仍不确定|不支持/ : /拒绝|版本不符/);
  }
  report.results.push({ case: "actual-limitation-and-rejected-returns-preserve-original-base-without-fabricated-evidence-links", passed: true });

  await visit(next);
  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator('.f002-code [data-line="401"]').waitFor();
  await read(next);
  const probe = suffix => page.request.get(`${api}/v1/workspaces/workspace/deterministic-facts${suffix}`, { headers: { authorization: `Bearer ${readerToken}` } });
  assert.equal((await probe(`/requests/${next.id}`)).status(), 200);
  assert.ok(await result().getByRole("link").count() > 0);
  await metadata("revoke-request-read", "POST");
  report.independentRequestRevocation = { requestStatus: (await probe(`/requests/${next.id}`)).status(), overviewStatus: (await probe("")).status(),
    requestId: next.id, linksInitiallyDisplayed: await result().getByRole("link").count(), automaticRetirement: false };
  assert.equal(report.independentRequestRevocation.requestStatus, 403, "the actual service must reject investigation READ without a Workspace revoke");
  assert.equal(report.independentRequestRevocation.overviewStatus, 200, "do not substitute a global member revoke for request-specific authorization");
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await result().count(), 0, "current investigation READ loss must retire the old result without a manual refresh");
  report.independentRequestRevocation.automaticRetirement = true;
  await metadata("restore-request-read", "POST");
  report.results.push({ case: "independent-investigation-READ403-with-Workspace200-automatically-retires-displayed-receipt-and-actions", passed: true });

  await visit(next);
  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(readerToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator('.f002-code [data-line="401"]').waitFor();
  await read(next);
  const forbidden = page.waitForResponse(response => response.status() === 403 && new URL(response.url()).pathname.includes("/deterministic-facts"));
  await metadata("revoke-reader", "POST"); await forbidden;
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await result().count(), 0); assert.equal(await page.locator(".f002-code").count(), 0);
  assert.equal(await page.locator(".f002-directory").count(), 0); assert.deepEqual(requests, [], "result inspection cannot send a F002 mutation");
  const after = await metadata();
  assert.equal(after.sourceStable, true); assert.equal(after.originalDigest, meta.originalDigest); assert.equal(after.startRunCount, 0);
  report.requestNavigation = { consumerFixture: after.consumerFixture, requestReceipts: after.requestReceipts, sourceStable: after.sourceStable,
    originalDigest: after.originalDigest, startRunCount: after.startRunCount, mutations: requests, osIme: "NOT_RUN" };
  report.results.push({ case: "current-authorized-reader-result-and-live403-retire-result-links-directory-and-bytes-with-stable-F001", passed: true });
}

import assert from "node:assert/strict";

// Installed only in the owned disposable page. Never call the native system
// clipboard or request clipboard permissions; observe the real click's args.
function installClipboardRecorder() {
  const state = { calls: [], rejectNext: false };
  Object.defineProperty(window, "__f002ReferenceCopy", { value: state, configurable: true });
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    async writeText(text) {
      const rejected = state.rejectNext; state.rejectNext = false;
      state.calls.push({ text, outcome: rejected ? "rejected" : "captured" });
      if (rejected) throw new DOMException("Owned recorder refuses clipboard access", "NotAllowedError");
    },
  } });
}

// Diagnostic observation only: return the exact native Promise and never read
// or replace a response body, signal, request argument or rejection.
export function installReferenceFetchObserver(target = window) {
  const nativeFetch = target.fetch, state = target.__f002ReferenceCopy;
  state.fetches = []; state.markNext ??= null;
  target.fetch = function (...args) {
    const original = Reflect.apply(nativeFetch, this, args);
    const input = args[0], pathname = new URL(typeof input === "string" ? input : input.url ?? String(input), target.location.href).pathname;
    if (state.markNext?.pathname === pathname) {
      const signal = args[1]?.signal ?? input?.signal;
      const observation = { name: state.markNext.name, pathname, signalPresent: Boolean(signal), signalInitiallyAborted: signal?.aborted ?? null, events: ["started"] };
      state.markNext = null; state.fetches.push(observation);
      signal?.addEventListener("abort", () => {
        observation.events.push("abort");
        observation.abort = { aborted: signal.aborted, name: signal.reason?.name ?? null, message: signal.reason?.message ?? null };
      }, { once: true });
      original.then(response => {
        observation.events.push("fulfilled");
        observation.settlement = { outcome: "fulfilled", status: response.status, signalAborted: signal?.aborted ?? null };
      }, error => {
        observation.events.push("rejected");
        observation.settlement = { outcome: "rejected", name: error?.name ?? null, message: error?.message ?? null, signalAborted: signal?.aborted ?? null };
      });
    }
    return original;
  };
}

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

export async function verifyReferenceCopy({ page, api, web, meta, metadata, report, connect, evidence, readerToken, ownerToken }) {
  const receipt = report.referenceCopy = { accepted: false, clipboard: "RECORDER_ONLY_NO_SYSTEM_CLIPBOARD", reads: [], writes: [], checks: [], calls: [] };
  const observe = request => {
    const url = new URL(request.url());
    if (url.origin === api && !["GET", "OPTIONS"].includes(request.method()) && receipt.writes.length < 129) {
      receipt.writes.push({ method: request.method(), pathname: url.pathname });
    }
  };
  const passed = name => { receipt.checks.push(name); report.results.push({ case: name, passed: true }); };
  const pane = page.locator(".f002-detail");
  const copy = () => pane.getByRole("button", { name: "复制完整引用", exact: true });
  const calls = () => page.evaluate(() => window.__f002ReferenceCopy.calls);
  const snapshot = () => page.evaluate(() => ({ calls: window.__f002ReferenceCopy.calls,
    fetches: window.__f002ReferenceCopy.fetches ?? [],
    successNotice: document.querySelector(".f002-detail")?.textContent.includes("已复制完整版本引用，不是原文内容。") ?? false }));
  const fixedRoute = (version, kind, id) => `/v1/workspaces/workspace/deterministic-facts/versions/${version}/records/${kind}/${id}`;
  let route = fixedRoute(meta.noFact.graphVersionId, "MATERIAL", meta.noFact.materialId);
  const protocolIds = new WeakMap(); let protocolSequence = 0;
  const protocol = (event, request, status = null) => {
    if (!receipt.protocol || new URL(request.url()).origin !== api || new URL(request.url()).pathname !== route) return;
    if (!protocolIds.has(request)) protocolIds.set(request, ++protocolSequence);
    if (receipt.protocol.length >= 128) { receipt.protocolOverflow = true; return; }
    const headers = request.headers();
    receipt.protocol.push({ event, id: protocolIds.get(request), method: request.method(), pathname: route, status,
      authorizationPresent: Boolean(headers.authorization), ownerMatches: headers.authorization === `Bearer ${ownerToken}`,
      readerMatches: headers.authorization === `Bearer ${readerToken}`, failure: request.failure()?.errorText ?? null });
  };
  const requested = request => protocol("request", request);
  const responded = response => protocol("response", response.request(), response.status());
  const finished = request => protocol("requestfinished", request);
  const failed = request => protocol("requestfailed", request);
  async function login(token) {
    const auth = page.locator(".f002-auth");
    if (!await auth.evaluate(node => node.open)) await auth.locator("summary").click();
    await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(token);
    const readable = page.waitForResponse(response => new URL(response.url()).pathname === route && response.status() === 200
      && response.request().headers().authorization === `Bearer ${token}`);
    await auth.getByRole("button", { name: "验证并连接", exact: true }).click();
    await readable; await copy().waitFor();
  }
  async function expectCopy(expected, rejected = false) {
    const before = (await calls()).length;
    if (rejected) await page.evaluate(() => { window.__f002ReferenceCopy.rejectNext = true; });
    const reread = page.waitForResponse(response => new URL(response.url()).pathname === route && response.request().method() === "GET");
    await copy().click();
    const response = await reread;
    assert.equal(response.status(), 200, "each copy must revalidate the actual selected fixed record");
    receipt.reads.push({ pathname: route, status: response.status() });
    await page.waitForFunction(count => window.__f002ReferenceCopy.calls.length === count, before + 1);
    const call = (await calls()).at(-1);
    // Independent expected shape: do not import the production encoder.
    assert.deepEqual(JSON.parse(call.text), expected);
    assert.doesNotMatch(call.text, /SYNTHETIC_BROWSER_PASSWORD|password=|name=orders|synthetic fixture line|\[REDACTED\]/);
    assert.equal(call.outcome, rejected ? "rejected" : "captured");
    receipt.calls.push(call);
    await pane.getByText(rejected ? "引用或剪贴板权限未确认，复制未完成。" : "已复制完整版本引用，不是原文内容。", { exact: true }).waitFor();
  }
  page.on("request", observe);
  await page.addInitScript(installClipboardRecorder);
  await page.evaluate(installClipboardRecorder);
  try {
    await copy().waitFor();
    const materialReference = { workspaceId: "workspace", graphVersionId: meta.noFact.graphVersionId, materialId: meta.noFact.materialId };
    await expectCopy(materialReference);
    passed("actual-material-copy-rereads-current-fixed-record-and-records-only-the-complete-material-reference");

    const facts = await fetch(`${api}/v1/workspaces/workspace/deterministic-facts/versions/${meta.standard.graphVersionId}/facts?limit=1`, {
      headers: { Authorization: `Bearer ${ownerToken}` }, signal: AbortSignal.timeout(10_000),
    });
    assert.equal(facts.status, 200);
    const fact = (await facts.json()).items[0];
    assert.ok(fact, "the real sealed standard fixture must contain a Fact, not a fabricated browser record");
    assert.equal(fact.kind, "FACT"); assert.match(fact.id, /^[a-f0-9]{64}$/);
    route = fixedRoute(meta.standard.graphVersionId, "FACT", fact.id);
    await page.goto(`${web}${evidence(meta, { factset: meta.standard.graphVersionId, kind: "FACT", record: fact.id, line: "1" })}`);
    await connect(); await copy().waitFor();
    const factReference = { workspaceId: "workspace", graphVersionId: meta.standard.graphVersionId, factId: fact.id };
    await expectCopy(factReference);
    passed("actual-Fact-copy-preserves-the-distinct-complete-Fact-reference-without-source-or-material-substitution");
    await expectCopy(factReference, true);
    passed("actual-clipboard-rejection-remains-unconfirmed-and-never-announces-a-successful-copy");

    await login(readerToken);
    const beforeDenied = (await calls()).length, denied = deferred();
    let denyError = null;
    const deny = async intercepted => {
      try {
        assert.equal(intercepted.request().headers().authorization, `Bearer ${readerToken}`);
        // Revoke only after the visible-record copy request is captured. The
        // subsequent status comes from the actual authenticated API handler.
        await metadata("revoke-reader", "POST");
        const response = await intercepted.fetch();
        receipt.reads.push({ pathname: route, status: response.status(), scenario: "revoked-copy" });
        assert.equal(response.status(), 403);
        await intercepted.fulfill({ response });
      } catch (error) { denyError = error; await intercepted.abort().catch(() => {}); }
      finally { denied.resolve(); }
    };
    await page.route(`${api}${route}`, deny, { times: 1 });
    try { await copy().click(); await denied.promise; if (denyError) throw denyError; }
    finally { await page.unroute(`${api}${route}`, deny); }
    await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
    assert.equal((await calls()).length, beforeDenied, "a real403 cannot write a cached reference");
    assert.equal(await copy().count(), 0, "revocation must retire the copy control and old Inspector");
    passed("actual-copy-revalidation-403-retires-the-Inspector-without-a-clipboard-call");

    await metadata("restore-reader", "POST"); await login(ownerToken);
    const beforeAbort = (await calls()).length, arrived = deferred(), release = deferred(), delivered = deferred();
    receipt.protocol = []; receipt.snapshots = { beforeCopy: await snapshot() };
    page.on("request", requested); page.on("response", responded); page.on("requestfinished", finished); page.on("requestfailed", failed);
    await page.evaluate(installReferenceFetchObserver);
    await page.evaluate(pathname => { window.__f002ReferenceCopy.markNext = { pathname, name: "held-copy" }; }, route);
    let lateError = null;
    const late = async intercepted => {
      try {
        protocol("held-copy-route", intercepted.request()); receipt.heldRequestId = protocolIds.get(intercepted.request());
        const response = await intercepted.fetch();
        assert.equal(response.status(), 200);
        receipt.reads.push({ pathname: route, status: response.status(), scenario: "held-real200-before-member-abort" });
        arrived.resolve(); await release.promise;
        // Deliver only that real response, never a fabricated success body.
        try { await intercepted.fulfill({ response }); receipt.lateDelivery = "real200-released-after-member-abort"; }
        catch (error) { receipt.lateDelivery = "fulfill-threw"; receipt.lateDeliveryError = { name: error.name, message: error.message }; }
      } catch (error) { lateError = error; arrived.resolve(); await intercepted.abort().catch(() => {}); }
      finally { delivered.resolve(); }
    };
    await page.route(`${api}${route}`, late, { times: 1 });
    const aborted = page.waitForEvent("requestfailed", { predicate: request => new URL(request.url()).pathname === route
      && request.method() === "GET" && request.headers().authorization === `Bearer ${ownerToken}` })
      .then(request => ({ failure: request.failure()?.errorText }), error => ({ error }));
    try {
      await copy().click(); await arrived.promise; if (lateError) throw lateError;
      receipt.snapshots.beforeMember = await snapshot();
      assert.deepEqual(receipt.snapshots.beforeMember.fetches[0]?.events, ["started"], "the actual copy response must still be held before member replacement");
      assert.equal(receipt.snapshots.beforeMember.calls.length, beforeAbort);
      // Keep this page interceptor alive: removing the last page route makes
      // Playwright fall the pending request through to the context's loopback
      // continuation before the product can abort it. times:1 already prevents
      // the replacement member's reads from entering this held handler.
      await login(readerToken); // Replaces EvidenceSession and aborts the old client's pending read.
      receipt.snapshots.afterMember = await snapshot();
    } finally { release.resolve(); await delivered.promise; await page.unroute(`${api}${route}`, late); }
    receipt.snapshots.afterDelivery = await snapshot();
    if (lateError) throw lateError;
    const interruption = await aborted; if (interruption.error) throw interruption.error;
    assert.match(interruption.failure, /ERR_ABORTED/); receipt.abortFailure = interruption.failure;
    const observed = receipt.snapshots.afterMember.fetches[0];
    assert.equal(observed.signalPresent, true); assert.equal(observed.signalInitiallyAborted, false);
    assert.deepEqual(observed.events, ["started", "abort", "rejected"], "native fetch must abort before it can fulfill the held copy");
    assert.equal(observed.abort.aborted, true);
    assert.equal(observed.settlement.outcome, "rejected"); assert.equal(observed.settlement.name, "AbortError");
    assert.equal(observed.settlement.signalAborted, true);
    assert.ok(receipt.protocol.some(event => event.id === receipt.heldRequestId && event.event === "requestfailed" && /ERR_ABORTED/.test(event.failure)),
      "the protocol failure must belong to the held copy, not another read");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal((await calls()).length, beforeAbort, "a late actual200 cannot revive an aborted member's copy");
    assert.equal(await pane.getByText("已复制完整版本引用，不是原文内容。", { exact: true }).count(), 0);
    passed("member-abort-fences-a-held-real200-copy-response-without-a-clipboard-call-or-success-notice");

    const after = await metadata();
    assert.equal(after.sourceStable, true); assert.equal(after.additionalSourceStable, true);
    assert.equal(after.originalDigest, meta.originalDigest); assert.equal(after.sourceVersionId, meta.sourceVersionId);
    assert.equal(after.startRunCount, 0); assert.equal(after.droppedRunResponses, 0);
    assert.deepEqual(receipt.writes, [], "copy and identity revalidation must not send browser API writes");
    // The Fact navigation creates a new document/recorder. Keep all three
    // observations in the Node receipt without persisting page data to storage.
    assert.deepEqual(await calls(), receipt.calls.slice(1));
    assert.equal(receipt.calls.length, 3);
    receipt.fixture = { sourceStable: after.sourceStable, originalDigest: after.originalDigest, sourceVersionId: after.sourceVersionId, startRunCount: after.startRunCount };
    receipt.accepted = true;
  } catch (error) {
    try { receipt.failureSnapshot = await snapshot(); }
    catch (snapshotError) { receipt.failureSnapshotError = { name: snapshotError.name, message: snapshotError.message }; }
    throw error;
  } finally {
    page.off("request", observe); page.off("request", requested); page.off("response", responded);
    page.off("requestfinished", finished); page.off("requestfailed", failed);
  }
}

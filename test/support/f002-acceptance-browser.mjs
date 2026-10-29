// Actual Cookie/native PG/HTTPS Git acceptance. No API response replacement,
// executable fixture application, model, legacy token UI or seeded publication.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acceptanceNativeFixture } from "./f002-acceptance-native-fixture.js";
import { fixtureChildEnvironment } from "./source-truth-postgres.js";
import { cookieFixturePassword } from "./source-truth-browser-cookie-fixture.js";
import { acceptanceFilesA } from "./f002-acceptance-assets.js";
import { freezeGit, publishFacts, pages, json, factsPrefix, digest } from "./f002-acceptance-http.js";

const [modulePath, executablePath] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const environment = await fixtureChildEnvironment();
const root = await mkdtemp(path.join(environment.TMPDIR, "traqen-f002-acceptance-browser-"));
const downloads = path.join(root, "downloads"); await mkdir(downloads, { mode: 0o700 });
const project = fileURLToPath(new URL("../../", import.meta.url));
assert.ok((await realpath(project)).startsWith(environment.TMPDIR + path.sep), "browser compilation requires a validation-runs acceptance checkout");
const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
assert.ok(![3003, 3004, 3100, 3188, 6398, 6399].includes(port));
const origin = `http://127.0.0.1:${port}`, cleanups = [], frontendLog = [];
const report = { scope: "REAL_COOKIE_NATIVE_PG_HTTP_GIT_TECHNICAL_UI_AB_NO_MODEL_VOLUME_MECHANISM_DOUBLE", status: "RUNNING", origin,
  checks: [], predicateTraversals: [], originalReads: [], pageErrors: [], errors: [], writes: [], legacyRequestsDuringF2: [], screenshots: [], viewports: [], cleanupErrors: [] };
let fixture, frontend, frontendExit, browser, page, phase = "SETUP", ta, a;
const sourcesByVersion = new Map();
const deadline = setTimeout(() => { report.errors.push("bounded acceptance browser deadline"); void browser?.close(); frontend?.kill("SIGTERM"); }, 300000);
async function screenshot(name) { await page.screenshot({ path: path.join(root, name), fullPage: true }); report.screenshots.push(name); }
async function selected(id) { await page.locator(".f002-detail > code.f002-id").filter({ hasText: id }).waitFor(); assert.equal(new URL(page.url()).searchParams.get("record"), id); }
async function loadAll(label) {
  for (let n = 0; n < 25; n++) {
    const button = page.getByRole("button", { name: label, exact: true });
    if (!await button.count()) return;
    await button.click(); await delay(100);
    if (await button.count()) await button.waitFor({ state: "visible" });
  }
  assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 0, "small fixture pagination must finish");
}
try {
  fixture = await acceptanceNativeFixture({ after: fn => cleanups.push(fn) }, { origin });
  report.fixtureRoot = fixture.root;
  const client = await fixture.client();
  a = await freezeGit(client, fixture, fixture.commitA);
  frontend = spawn(process.execPath, [path.join(project, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(project, "web"), env: { ...environment, TRAQEN_API_PROXY_TARGET: fixture.base, NEXT_PUBLIC_TRAQEN_API_BASE: "/api", WRANGLER_LOG_PATH: path.join(root, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"] });
  frontendExit = once(frontend, "exit"); report.frontendPid = frontend.pid;
  for (const stream of [frontend.stdout, frontend.stderr]) stream.on("data", b => frontendLog.push(b.toString()));
  const until = Date.now() + 60000;
  while (true) { try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    assert.ok(frontend.exitCode === null && Date.now() < until, "owned frontend did not start"); await delay(100); }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launchPersistentContext(path.join(root, "profile"), { executablePath, headless: true, env: environment, downloadsPath: downloads,
    viewport: { width: 1440, height: 900 }, args: ["--disk-cache-dir=" + path.join(root, "disk-cache"), "--crash-dumps-dir=" + path.join(root, "crash-dumps")] });
  const context = browser;
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", e => report.pageErrors.push(e.message));
  page.on("request", req => {
    const pathname = new URL(req.url()).pathname;
    if (phase === "F002" && pathname.startsWith("/api/") && /business-knowledge|workspace-analysis-jobs/.test(pathname)) report.legacyRequestsDuringF2.push(pathname);
    if (pathname.includes("/deterministic-facts") && !["GET", "OPTIONS"].includes(req.method())) report.writes.push({ pathname, method: req.method(), csrf: Boolean(req.headers()["x-traqen-csrf"]), bearer: Boolean(req.headers().authorization) });
  });
  page.on("response", res => {
    const match = /\/deterministic-facts\/versions\/([a-f0-9]{64})\/materials\/([a-f0-9]{64})\/content$/.exec(new URL(res.url()).pathname);
    if (match && res.status() === 200) {
      try {
      const source = sourcesByVersion.get(match[1]); assert.ok(source, "rendered original must belong to a known exact capture");
      const headers = res.headers();
      assert.equal(headers["x-source-bundle-id"], source.bundleId); assert.equal(headers["x-source-receipt-id"], source.receiptId);
      } catch (e) { report.errors.push(`UI original response ${new URL(res.url()).pathname}: ${e.message}`); }
    }
  });
  await page.goto(origin);
  await page.getByLabel("账号", { exact: true }).fill("owner"); await page.getByLabel("密码", { exact: true }).fill(cookieFixturePassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  phase = "F002";
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "技术证据", exact: true }).click();
  await page.getByRole("heading", { name: "选择冻结材料", exact: true }).waitFor();
  assert.equal(await page.getByRole("navigation", { name: "技术分析五步旅程" }).getByRole("button").count(), 5);
  await screenshot("journey-01-select.png");
  await page.getByLabel("冻结来源", { exact: true }).selectOption(a.reference.bundleId);
  const profileId = await page.getByLabel("不可变能力配置", { exact: true }).inputValue();
  const profiles = (await json(client, `${factsPrefix}/profiles`)).profiles;
  assert.equal(profiles.find(p => p.id === profileId)?.name, "technical-review-v5");
  await page.locator(".f002-delivery fieldset").getByRole("checkbox").first().check();
  // Observe real in-flight feedback without replacing the request or response.
  await page.route("**/deterministic-facts/runs", async route => { await delay(1200); await route.continue(); });
  const ack = page.waitForResponse(res => res.request().method() === "POST" && new URL(res.url()).pathname.endsWith("/deterministic-facts/runs"));
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await page.getByRole("button", { name: "正在提交分析…", exact: true }).waitFor();
  assert.ok((await page.locator('.f002-delivery [role="status"]').allTextContents()).some(text => text.includes("正在提交")));
  assert.equal(await page.getByText("提交结果待对账", { exact: true }).isVisible(), false);
  await screenshot("journey-02-submitting.png");
  const accepted = await ack; assert.equal(accepted.status(), 202);
  const run = (await accepted.json()).run;
  await page.locator(".f002-delivery").getByRole("heading", { name: "技术分析", exact: true }).waitFor();
  const row = page.locator(".f002-delivery article").filter({ hasText: run.id });
  await row.getByRole("button", { name: "查看待检查成果", exact: true }).waitFor({ timeout: 60000 });
  const stored = (await json(client, `${factsPrefix}/runs/${run.id}`)).run;
  assert.equal(stored.scopes[0].status, "READY_TO_SEAL"); assert.equal(stored.scopes[0].graphVersionId, null);
  const scope = stored.scopes[0], previewBase = `${factsPrefix}/runs/${run.id}/scopes/${scope.scopeId}/preview/${scope.revision}`;
  const before = await pages(client, `${previewBase}/records`);
  assert.ok(scope.selections.every(selection => selection.kind === "COMPONENT"));
  const selectedComponents = new Set(scope.selections.map(selection => selection.componentId));
  const expectedEntries = a.inventory.filter(item => selectedComponents.has(item.componentId));
  report.progressInput = { source: a.reference, componentIds: [...selectedComponents], inventoryEntries: expectedEntries.length,
    files: expectedEntries.filter(item => item.entry.kind === "FILE").length, directories: expectedEntries.filter(item => item.entry.kind === "DIRECTORY").length };
  report.progress = (await json(client, `${factsPrefix}/runs/${run.id}/scopes/${scope.scopeId}/progress`)).progress;
  assert.ok(report.progress.events.some(e => e.phase === "MATERIALS" && e.completed === expectedEntries.length && e.total === expectedEntries.length));
  assert.ok(report.progress.events.some(e => e.phase === "JAVASCRIPT_MODULES"));
  assert.equal(report.progress.latest.phase, "READY");
  await row.getByText(`已处理材料条目 ${expectedEntries.length} / ${expectedEntries.length}（含目录及不可解析项）`, { exact: true }).waitFor();
  await screenshot("journey-03-real-progress.png");
  await page.reload();
  await page.locator(".f002-delivery article").filter({ hasText: run.id }).getByRole("button", { name: "查看待检查成果", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("run"), run.id);
  assert.equal(report.writes.filter(w => w.pathname.endsWith("/runs")).length, 1, "refresh never resubmits");
  await page.locator(".f002-delivery article").filter({ hasText: run.id }).getByRole("button", { name: "查看待检查成果", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has("factset"), false);
  const opaque = before.find(r => r.kind === "MATERIAL" && r.payload.displayPath === "docs/opaque.custom"); assert.ok(opaque);
  await page.locator(`[data-directory-material="${opaque.id}"] > button`).click(); await selected(opaque.id);
  await page.locator('.f002-code [data-line="1"] > code').filter({ hasText: "OWNED_UNSUPPORTED_FORMAT_ORIGINAL_A" }).waitFor();
  const noFactIds = new Set(before.filter(r => r.kind === "OBJECT" && r.payload.materialId === opaque.id).map(r => r.id));
  assert.equal(before.some(r => r.kind === "FACT" && noFactIds.has(r.payload.subjectId)), false);
  await page.getByRole("button", { name: "关系", exact: true }).click();
  await loadAll("加载更多关系");
  const relation = before.find(r => r.kind === "FACT" && r.payload.predicate === "callsDeclaration"); assert.ok(relation);
  await page.locator(`[data-relation-select="${relation.id}"]`).click(); await selected(relation.id);
  await page.getByRole("group", { name: "局部关系图，节点与关系可用键盘选择", exact: true }).waitFor();
  await page.getByRole("group", { name: "局部关系图，节点与关系可用键盘选择", exact: true }).scrollIntoViewIfNeeded();
  await screenshot("journey-04-unsealed-graph.png");
  await page.locator('[data-extraction-rule]').filter({ hasText: relation.payload.ruleRef.id }).waitFor();
  const relationDetail = await json(client, `${previewBase}/records/FACT/${relation.id}`);
  const evidence = relationDetail.references.find(r => r.kind === "EVIDENCE" && r.payload.anchor.kind === "TEXT"); assert.ok(evidence);
  await page.locator(".f002-detail .f002-ref").filter({ hasText: evidence.id.slice(0, 12) }).click(); await selected(evidence.id);
  await page.locator(`.f002-code [data-line="${evidence.payload.anchor.lineStart}"].selected`).waitFor();
  await screenshot("journey-04-unsealed-relation-original.png");
  await page.getByRole("button", { name: "继续检查覆盖与缺口", exact: true }).click();
  const unsupported = before.find(r => r.kind === "GAP" && r.payload.materialId === opaque.id && r.payload.code === "FORMAT_UNSUPPORTED"); assert.ok(unsupported);
  await loadAll("加载更多缺口"); await page.locator(`[data-gap-id="${unsupported.id}"]`).getByRole("button").click(); await selected(unsupported.id);
  await page.locator('[data-gap-explanation]').filter({ hasText: "FORMAT_UNSUPPORTED" }).waitFor();
  await screenshot("journey-05-unsealed-gap.png");
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    const actual = await page.evaluate(() => ({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:visualViewport.scale,scrollWidth:document.documentElement.scrollWidth}));
    report.viewports.push(actual); assert.equal(actual.width, viewport.width); assert.equal(actual.scale, 1);
    assert.ok(actual.scrollWidth <= actual.width + 1, "no document-wide horizontal overflow");
    await screenshot(`journey-gap-${viewport.width}.png`);
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole("button", { name: "继续封存与交付", exact: true }).click();
  const sealRow = page.locator(".f002-delivery article").filter({ hasText: run.id });
  assert.equal(await sealRow.getByRole("button", { name: "封存此范围", exact: true }).isDisabled(), true);
  await sealRow.getByRole("button", { name: "查看封存条件", exact: true }).click();
  await sealRow.getByLabel("我已检查本次事实、关联与缺口", { exact: true }).check();
  const sealAck = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/scopes/${scope.scopeId}/seal`));
  await sealRow.getByRole("button", { name: "封存此范围", exact: true }).click(); assert.equal((await sealAck).status(), 200);
  await page.waitForURL(url => url.searchParams.has("factset"));
  const sealed = (await json(client, `${factsPrefix}/runs/${run.id}`)).run;
  ta = { version: sealed.scopes[0].graphVersionId, records: await pages(client, `${factsPrefix}/versions/${sealed.scopes[0].graphVersionId}/records`) };
  assert.deepEqual(ta.records, before, "explicit seal publishes the exact inspected records");
  sourcesByVersion.set(ta.version, a.reference);
  report.a = { ...a.reference, runId: run.id, version: ta.version, profileId, previewRevision: scope.revision };
  report.checks.push("five-stage-real-progress-refresh-same-run-unsealed-relation-original-unsupported-gap-explicit-seal-same-records");
  await screenshot("journey-06-sealed.png");
  await page.getByRole("button", { name: "对象与事实", exact: true }).click();
  await loadAll("加载下一页"); await loadAll("加载更多事实");

  for (const name of Object.keys(acceptanceFilesA)) {
    const material = ta.records.find(r => r.kind === "MATERIAL" && r.payload.pathBytes === Buffer.from(name).toString("base64url")); assert.ok(material);
    await page.locator(`[data-directory-material="${material.id}"] > button`).click(); await selected(material.id);
    await page.locator(".f002-reading h2").filter({ hasText: name }).waitFor();
    await page.locator(".f002-reading .f002-digests").waitFor();
    // CDP Network.getResponseBody can decode text/plain without charset as
    // Windows-1252. Hash actual in-page ArrayBuffer bytes, not that lossy copy.
    const read = await page.evaluate(async url => {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", redirect: "error" });
      const bytes = await response.arrayBuffer();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
      return { status: response.status, bytes: bytes.byteLength, sha256,
        originalDigest: response.headers.get("x-f002-original-digest"), displayDigest: response.headers.get("x-f002-display-digest"),
        bundleId: response.headers.get("x-source-bundle-id"), receiptId: response.headers.get("x-source-receipt-id") };
    }, `/api${factsPrefix}/versions/${ta.version}/materials/${material.id}/content`);
    assert.equal(read.status, 200); assert.equal(read.sha256, read.displayDigest);
    assert.equal(read.originalDigest, digest(acceptanceFilesA[name]));
    assert.equal(read.bundleId, a.reference.bundleId); assert.equal(read.receiptId, a.reference.receiptId);
    await page.locator(".f002-reading .f002-digests").getByText(read.displayDigest, { exact: true }).first().waitFor();
    report.originalReads.push({ name, version: ta.version, materialId: material.id, ...read });
    if (name === "config/app.properties") {
      assert.match(await page.locator(".f002-reading").innerText(), /脱敏副本/);
      assert.equal((await page.locator("body").innerText()).includes("OWNED_FIXTURE_SECRET_NEVER_INDEX"), false);
    } else assert.ok((await page.locator(".f002-reading .f002-code").innerText()).length > 0);
    if (name === "docs/opaque.custom") {
      const objects = new Set(ta.records.filter(r => r.kind === "OBJECT" && r.payload.materialId === material.id).map(r => r.id));
      assert.equal(ta.records.some(r => r.kind === "FACT" && (objects.has(r.payload.subjectId) || objects.has(r.payload.targetId))), false);
      assert.ok(ta.records.some(r => r.kind === "GAP" && r.payload.materialId === material.id && r.payload.code === "FORMAT_UNSUPPORTED"));
      assert.equal(await page.locator('.f002-reading .f002-code [data-line="1"] > code').textContent(), acceptanceFilesA[name].trim());
      report.checks.push("same-version-unsupported-no-Fact-material-remains-directory-readable-with-explicit-Gap");
    }
  }
  report.checks.push("original-ten-plus-unsupported-material-readable-from-real-directory-with-sensitive-config-redacted");
  // Initial record requests are asynchronous: no pagination button before the
  // initial page resolves is not proof that all records have been loaded.
  await page.locator(".f002-records table").first().waitFor();
  await page.getByText("读取事实…", { exact: true }).waitFor({ state: "hidden" });
  await loadAll("加载下一页"); await loadAll("加载更多事实");
  await page.waitForFunction(count => document.querySelectorAll(".f002-records tr code[title]").length === count,
    ta.records.filter(r => ["OBJECT", "FACT"].includes(r.kind)).length);
  const object = ta.records.find(r => r.kind === "OBJECT" && r.payload.kind === "FUNCTION" && r.payload.parentId && r.payload.anchor?.kind === "TEXT");
  assert.ok(object, "actual declared parent/child object");
  const group = page.locator(`[data-directory-material="${object.payload.materialId}"]`);
  const objectButton = group.locator(`[data-directory-object="${object.id}"] > button`);
  for (let n = 0; n < 32 && !await objectButton.isVisible(); n++) {
    const disclosure = group.locator("details:not([open]) > summary").filter({ visible: true }).first();
    await disclosure.press("Enter");
  }
  await objectButton.click(); await selected(object.id);
  await page.locator(`.f002-code [data-line="${object.payload.anchor.lineStart}"].selected`).waitFor();
  report.checks.push("actual-keyboard-directory-parent-child-object-selection-and-physical-original-line");
  const predicates = ["contains", "withinBranch", "readsBinding", "matchesConfigKey", "embedsSql", "writesTable", "matchesSqlTable", "callsDeclaration", "declaredTestBody", "declaredAssertion", "refersTo", "reportsResult"];
  for (const predicate of predicates) {
    const fact = ta.records.find(r => r.kind === "FACT" && r.payload.predicate === predicate
      && r.payload.evidenceIds.some(id => ta.records.some(e => e.kind === "EVIDENCE" && e.id === id && e.payload.anchor?.kind === "TEXT"))); assert.ok(fact, predicate);
    const factRow = page.locator(".f002-records tr").filter({ has: page.locator(`code[title="${fact.id}"]`) });
    await factRow.getByRole("button").click(); await selected(fact.id);
    await page.locator("[data-predicate-meaning]").waitFor();
    assert.ok((await page.locator("[data-extraction-rule]").innerText()).includes(fact.payload.ruleRef.id));
    const detail = await json(client, `${factsPrefix}/versions/${ta.version}/records/FACT/${fact.id}`);
    const evidence = detail.references.find(r => r.kind === "EVIDENCE" && r.payload.anchor?.kind === "TEXT"); assert.ok(evidence, predicate);
    if (fact.payload.premiseFactIds.length) {
      const premise = fact.payload.premiseFactIds[0];
      await page.getByRole("button", { name: `查看前提 ${premise}`, exact: true }).click(); await selected(premise);
      await factRow.getByRole("button").click(); await selected(fact.id);
    }
    await page.locator(".f002-detail .f002-ref").filter({ hasText: evidence.id.slice(0, 12) }).click(); await selected(evidence.id);
    await page.locator(`.f002-code [data-line="${evidence.payload.anchor.lineStart}"].selected`).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("line"), String(evidence.payload.anchor.lineStart));
    report.predicateTraversals.push({ predicate, factId: fact.id, basis: fact.payload.basis, premiseCount: fact.payload.premiseFactIds.length, evidenceId: evidence.id, anchor: evidence.payload.anchor });
  }
  report.checks.push("twelve-actual-predicate-facts-premises-and-evidence-physical-line-traversals-not-source-hit-or-report-execution-promotion");
  await screenshot("cross-asset-original-1440.png");

  await page.getByRole("navigation", { name: "技术分析五步旅程" }).getByRole("button").nth(3).click();
  for (const code of ["EXECUTION_BINDING_MISSING", "DOCUMENT_FRAGMENT_AMBIGUOUS"]) {
    const gap = ta.records.find(r => r.kind === "GAP" && r.payload.code === code); assert.ok(gap, code);
    await loadAll("加载更多缺口"); await page.locator(`[data-gap-id="${gap.id}"]`).getByRole("button").click(); await selected(gap.id);
    await page.locator("[data-gap-explanation]").filter({ hasText: code }).waitFor();
  }
  const fixed = new URL(page.url()).search;
  await screenshot("explicit-unexecuted-ambiguous-gaps.png");
  const b = await freezeGit(client, fixture, await fixture.advanceGit(), a.reference.bundleId), tb = await publishFacts(client, b);
  sourcesByVersion.set(tb.version, b.reference); report.b = { ...b.reference, version: tb.version, runId: tb.run.id };
  await page.getByRole("button", { name: "复验权限并刷新", exact: true }).click();
  await page.getByRole("button", { name: "明确查看新版本", exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, fixed, "new B cannot change selected A Gap/version");
  await page.reload(); await page.locator("[data-gap-explanation]").waitFor();
  assert.equal(new URL(page.url()).search, fixed);
  await page.getByText("固定来源、规则与历史版本", { exact: true }).click();
  await page.getByLabel("选择固定事实集", { exact: true }).selectOption(tb.version);
  await page.getByRole("button", { name: "对象与事实", exact: true }).click();
  const bPaths = tb.records.filter(r => r.kind === "MATERIAL").map(r => r.payload.displayPath);
  assert.ok(bPaths.includes("src/added.ts")); assert.equal(bPaths.includes("test/legacy.test.js"), false);
  const added = tb.records.find(r => r.kind === "MATERIAL" && r.payload.displayPath === "src/added.ts");
  await page.locator(`[data-directory-material="${added.id}"] > button`).click(); await selected(added.id);
  await page.locator(".f002-code").filter({ hasText: "newlyAdded" }).waitFor();
  await screenshot("B-explicit-selection-added-asset.png");
  await page.getByLabel("选择固定事实集", { exact: true }).selectOption(ta.version);
  const legacy = ta.records.find(r => r.kind === "MATERIAL" && r.payload.displayPath === "test/legacy.test.js");
  await page.locator(`[data-directory-material="${legacy.id}"] > button`).click(); await selected(legacy.id);
  await page.locator(".f002-code").filter({ hasText: "legacy declaration" }).waitFor();
  await page.reload(); await page.locator(".f002-code").filter({ hasText: "legacy declaration" }).waitFor();
  report.checks.push("new-B-does-not-adopt-or-replace-A-gap-refresh-explicit-B-and-return-to-deleted-historical-A-original");
  assert.ok(report.originalReads.length >= 10); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.legacyRequestsDuringF2, []);
  assert.equal(report.writes.filter(w => w.pathname.endsWith("/runs")).length, 1);
  assert.equal(report.writes.filter(w => w.pathname.endsWith("/seal")).length, 1); assert.ok(report.writes.every(w => w.csrf && !w.bearer));
  // A real database write fault at the existing ready transition exercises
  // failed -> retry without replacing HTTP, parser output or worker execution.
  // This constraint exists only in this newly owned, synthetic fixture DB.
  const faultPool = fixture.pool();
  const startSameInput = async () => {
    await page.getByRole("navigation", { name: "技术分析五步旅程" }).getByRole("button").nth(0).click();
    await page.waitForFunction(id => document.querySelector('select[aria-label="冻结来源"]')?.value === id, a.reference.bundleId);
    assert.equal(await page.getByLabel("冻结来源", { exact: true }).inputValue(), a.reference.bundleId);
    const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/deterministic-facts/runs"));
    await page.getByRole("button", { name: "开始分析", exact: true }).click();
    const accepted = await response; assert.equal(accepted.status(), 202); return (await accepted.json()).run;
  };
  try {
    await faultPool.query("ALTER TABLE f002_scope ADD CONSTRAINT f002_journey_ready_fault CHECK (status <> 'READY_TO_SEAL') NOT VALID");
    const failedRun = await startSameInput();
    const failedRow = page.locator(".f002-delivery article").filter({ hasText: failedRun.id });
    await failedRow.getByRole("button", { name: "重试原范围", exact: true }).waitFor({ timeout: 60000 });
    const failed = (await json(client, `${factsPrefix}/runs/${failedRun.id}`)).run;
    assert.equal(failed.scopes[0].status, "FAILED_RETRYABLE");
    const failureProgress = (await json(client, `${factsPrefix}/runs/${failedRun.id}/scopes/${failed.scopes[0].scopeId}/progress`)).progress;
    assert.notEqual(failureProgress.latest.phase, "READY");
    await screenshot("journey-07-real-database-write-failure.png");
    await faultPool.query("ALTER TABLE f002_scope DROP CONSTRAINT f002_journey_ready_fault");
    const retried = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/runs/${failedRun.id}/retry`));
    await failedRow.getByRole("button", { name: "重试原范围", exact: true }).click(); assert.equal((await retried).status(), 200);
    await failedRow.getByRole("button", { name: "查看待检查成果", exact: true }).waitFor({ timeout: 60000 });
    const recovered = (await json(client, `${factsPrefix}/runs/${failedRun.id}`)).run;
    assert.equal(recovered.scopes[0].generation, 2); assert.equal(recovered.scopes[0].status, "READY_TO_SEAL");
    const recoveredBase = `${factsPrefix}/runs/${failedRun.id}/scopes/${recovered.scopes[0].scopeId}/preview/${recovered.scopes[0].revision}`;
    const recoveredRecords = await pages(client, `${recoveredBase}/records`);
    assert.deepEqual(recoveredRecords, before, "retry retains the same fixed source/profile records, not an empty current-generation view");
    await failedRow.getByRole("button", { name: "查看待检查成果", exact: true }).click();
    await page.locator(`[data-directory-material="${opaque.id}"] > button`).click();
    await page.locator('.f002-code [data-line="1"] > code').filter({ hasText: "OWNED_UNSUPPORTED_FORMAT_ORIGINAL_A" }).waitFor();
    await screenshot("journey-08-retried-unsealed-original.png");
    report.retry = { runId: failedRun.id, fault: "OWNED_DB_CHECK_CONSTRAINT_AT_READY_TRANSITION", failedRevision: failed.scopes[0].revision,
      recoveredRevision: recovered.scopes[0].revision, generation: 2, sameRecordCount: recoveredRecords.length };
  } finally {
    try { await faultPool.query("ALTER TABLE f002_scope DROP CONSTRAINT IF EXISTS f002_journey_ready_fault"); }
    finally { await faultPool.end(); }
  }
  const cancelledRun = await startSameInput();
  let cancelledRow = page.locator(".f002-delivery article").filter({ hasText: cancelledRun.id });
  await cancelledRow.getByRole("button", { name: "查看待检查成果", exact: true }).waitFor({ timeout: 60000 });
  phase = "LEAVE";
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "来源快照", exact: true }).click();
  phase = "F002";
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "技术证据", exact: true }).click();
  await page.waitForFunction(id => document.querySelector('select[aria-label="冻结来源"]')?.value === id, a.reference.bundleId);
  assert.equal(await page.getByLabel("冻结来源", { exact: true }).inputValue(), a.reference.bundleId);
  await page.getByRole("navigation", { name: "技术分析五步旅程" }).getByRole("button").nth(1).click();
  cancelledRow = page.locator(".f002-delivery article").filter({ hasText: cancelledRun.id });
  await cancelledRow.getByRole("button", { name: "取消此范围", exact: true }).waitFor();
  page.once("dialog", dialog => dialog.accept());
  const cancelledAck = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/runs/${cancelledRun.id}/cancel`));
  await cancelledRow.getByRole("button", { name: "取消此范围", exact: true }).click(); assert.equal((await cancelledAck).status(), 200);
  await cancelledRow.getByText("已取消", { exact: true }).first().waitFor();
  const cancelled = (await json(client, `${factsPrefix}/runs/${cancelledRun.id}`)).run;
  assert.equal(cancelled.scopes[0].status, "CANCELLED"); assert.equal(cancelled.scopes[0].graphVersionId, null);
  report.cancel = { runId: cancelledRun.id, revision: cancelled.scopes[0].revision, status: cancelled.scopes[0].status };
  await page.getByLabel("全局主题配色", { exact: true }).selectOption("dark");
  await screenshot("journey-09-dark-cancelled.png");
  await page.getByLabel("全局主题配色", { exact: true }).selectOption("light");
  report.checks.push("real-owned-DB-ready-failure-visible-retry-same-run-generation2-retained-preview-original-leave-return-no-resubmit-real-cancel-dark-theme");
  assert.deepEqual(report.pageErrors, []); assert.ok(report.writes.every(w => w.csrf && !w.bearer));
  assert.equal(report.writes.filter(w => w.pathname.endsWith("/runs")).length, 3);
  assert.deepEqual(report.errors, []); report.status = "ASSERTIONS_PASSED_CLEANUP_PENDING";
} catch (e) {
  report.status = "FAILED"; report.errors.push(e.stack ?? e.message);
  if (page && !page.isClosed()) { report.failure = { url: page.url(), text: (await page.locator("body").innerText().catch(() => "unavailable")).slice(-24000) }; await screenshot("failure.png").catch(() => {}); }
} finally {
  clearTimeout(deadline); try { await browser?.close(); } catch (e) { report.cleanupErrors.push("browser: " + e.message); }
  if (frontend && frontend.exitCode === null) { frontend.kill("SIGTERM"); const kill = setTimeout(() => frontend.exitCode === null && frontend.kill("SIGKILL"), 10000); try { await frontendExit; } finally { clearTimeout(kill); } }
  for (const cleanup of cleanups) try { await cleanup(); } catch (e) { report.cleanupErrors.push(e.message); }
  if (report.cleanupErrors.length) report.status = "FAILED";
  else if (report.status === "ASSERTIONS_PASSED_CLEANUP_PENDING") report.status = "PASSED";
  report.frontendExit = frontend ? { code: frontend.exitCode, signal: frontend.signalCode } : null;
  await writeFile(path.join(root, "frontend.log"), frontendLog.join(""), { mode: 0o600 });
  await writeFile(path.join(root, "summary.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...report, parentPath: root + "/", childPath: "summary.json" }));
}
if (report.status !== "PASSED") process.exitCode = 1;

// Bounded product traversal of worker-sealed synthetic JavaScript. No fake
// API responses, production stores, dependency installation or Hub preview.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { f002BrowserFixture, fixtureToken, fixtureReaderToken } from "./f002-browser-fixture.js";
import { traversalDeadlineMs, verifyCanvasMatrix } from "./f002-canvas-checks.mjs";

const [modulePath, executablePath, diagnosticMode] = process.argv.slice(2);
assert.ok(diagnosticMode === undefined || diagnosticMode === "--scroll-anchoring-diagnostic" || diagnosticMode === "--canvas-matrix" || diagnosticMode === "--canvas-disclosure-diagnostic");
const diagnoseAnchoring = diagnosticMode === "--scroll-anchoring-diagnostic";
const canvasOnly = diagnosticMode === "--canvas-matrix" || diagnosticMode === "--canvas-disclosure-diagnostic";
const diagnoseDisclosure = diagnosticMode === "--canvas-disclosure-diagnostic";
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-traversal-browser-"));
const api = "http://127.0.0.1:6225", web = "http://127.0.0.1:6226";
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const results = [], errors = [], log = [];
const report = { scope: "OWNED_SYNTHETIC_F001_F002_TRAVERSAL", status: "RUNNING", results, errors, diagnosticOnly: false, hubPreview: "NOT_OPENED", yamlSecurity: "NOT_RUN", f003Runtime: "NOT_CONFIGURED" };
if (diagnoseAnchoring) { report.scope = "OWNED_SYNTHETIC_F001_F002_SCROLL_ANCHORING_DIAGNOSTIC"; report.diagnosticOnly = true; }
if (canvasOnly) report.scope = "OWNED_SYNTHETIC_F001_F002_CANVAS_MATRIX";
if (diagnoseDisclosure) { report.scope = "OWNED_SYNTHETIC_F001_F002_CANVAS_DISCLOSURE_DIAGNOSTIC"; report.diagnosticOnly = true; }
let fixture, child, browser, page;
let delayMetadata = false, releaseMetadata;
const metadataGate = new Promise(resolve => { releaseMetadata = resolve; });
const deadlineMs = report.deadlineMs = traversalDeadlineMs(diagnosticMode);
const deadline = setTimeout(() => { errors.push("bounded traversal browser timed out"); child?.kill("SIGTERM"); void browser?.close(); }, deadlineMs);
async function read(route, method = "GET") {
  const response = await fetch(`${api}${route}`, { method, headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, "only owned authenticated fixture/API controls may be used"); return response.json();
}
async function authenticate() {
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(fixtureToken);
  const verified = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/workspaces" && value.request().headers()["x-traqen-api-token"] === fixtureToken);
  await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
  assert.equal((await verified).status(), 200);
}
async function scrollStage(stage) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const snapshot = await page.locator(".f002-relation-list").evaluate((node, stage) => ({ stage, top: node.scrollTop,
    height: node.scrollHeight, viewport: node.clientHeight, width: node.clientWidth, overflowAnchor: getComputedStyle(node).overflowAnchor,
    saved: Object.keys(localStorage).filter(key => key.startsWith("traqen:f002:view:")).map(key => JSON.parse(localStorage.getItem(key)).relationScrollTop) }), stage);
  (report.scrollStages ??= []).push(snapshot); return snapshot;
}
async function setScroll120() {
  await page.locator(".f002-relation-list").evaluate(node => { node.scrollTop = 120; });
  await page.waitForFunction(() => document.querySelector(".f002-relation-list")?.scrollTop === 120
    && Object.keys(localStorage).filter(key => key.startsWith("traqen:f002:view:")).every(key => JSON.parse(localStorage.getItem(key)).relationScrollTop === 120));
}
async function inspectorLayoutCycle(label) {
  const transform = await page.locator("[data-graph-viewport]").getAttribute("transform");
  await page.getByRole("button", { name: "关闭依据面板", exact: true }).click();
  const closed = await scrollStage(`${label}-closed`);
  assert.equal(await page.locator("[data-graph-viewport]").getAttribute("transform"), transform);
  if (!diagnoseAnchoring) assertSavedPosition(closed);
  await page.getByRole("button", { name: "重开依据面板", exact: true }).click();
  const reopened = await scrollStage(`${label}-reopened`);
  assert.equal(await page.locator("[data-graph-viewport]").getAttribute("transform"), transform);
  if (!diagnoseAnchoring) assertSavedPosition(reopened);
  return [closed, reopened];
}
function assertSavedPosition(snapshot) {
  assert.equal(snapshot.overflowAnchor, "none", `${snapshot.stage}: the product stylesheet must exclude native anchoring without a test intervention`);
  assert.equal(snapshot.top, 120, `${snapshot.stage}: Inspector reflow cannot change the chosen position`);
  assert.ok(snapshot.saved.length > 0 && snapshot.saved.every(top => top === 120), `${snapshot.stage}: layout must not replace the persisted position`);
}
try {
  const { chromium } = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof chromium?.launch, "function");
  const content = ["import express from 'express';", "const router = express.Router();", "export function target() { return 1; }",
    ...Array.from({ length: 35 }, (_, index) => `export function caller${index}() { return target(); }`), "router.get(dynamicPath, target);"].join("\n");
  fixture = await f002BrowserFixture({ content, entryPath: "synthetic-traversal.js", requestForm: canvasOnly });
  const meta = await read("/__f002_fixture/metadata");
  const route = `/v1/workspaces/workspace/deterministic-facts/versions/${meta.standard.graphVersionId}`;
  const relations = (await read(`${route}/relations?limit=100`)).items;
  assert.equal(relations.length, 35, "the real extractor must produce the fixture's explicit static-call relations");
  const fact = relations[0]; assert.equal(fact.kind, "FACT"); assert.equal(fact.payload.predicate, "staticCalls");
  const factDetail = await read(`${route}/records/FACT/${fact.id}`), manifest = (await read(`${route}/manifest`)).manifest;
  const meaning = manifest.vocabulary.predicates.find(item => item.predicate === fact.payload.predicate).meaning;
  const factEvidence = factDetail.references.find(item => item.kind === "EVIDENCE" && fact.payload.evidenceIds.includes(item.id));
  assert.ok(factEvidence); assert.equal(fact.payload.ruleRef.version, "1"); assert.deepEqual(fact.payload.premiseFactIds, []);
  const gaps = (await read(`${route}/gaps?limit=100`)).items;
  const gap = gaps.find(record => record.payload.code === "EXPRESS_ROUTE_DYNAMIC");
  assert.ok(gap, "the actual worker must also produce a known limitation, never an injected Gap");
  const coverage = (await read(`${route}/coverage`)).coverage;
  const disposition = coverage.items.find(item => item.capabilityId === "javascript" && item.gapIds.includes(gap.id));
  assert.ok(disposition, "Gap status must be bound to the real extraction work item, not gap-index DONE");
  report.fixture = { graphVersionId: meta.standard.graphVersionId, factId: fact.id, gapId: gap.id, relationCount: relations.length, disposition: disposition.status, sourceStable: meta.sourceStable };
  child = spawn(process.execPath, [path.join(root, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", "6226"], {
    cwd: path.join(root, "web"), env: { ...environment, NEXT_PUBLIC_TRAQEN_API_BASE: api, WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => log.push(chunk.toString())); child.stderr.on("data", chunk => log.push(chunk.toString()));
  child.on("error", error => errors.push(error.message));
  report.startup = { pid: child.pid, startedAt: new Date().toISOString(), port: 6226, lastProbe: null };
  let ready = false; const until = Date.now() + 30_000;
  while (!ready && Date.now() < until && child.exitCode === null) {
    try { const response = await fetch(web, { signal: AbortSignal.timeout(1000) }); ready = response.ok; report.startup.lastProbe = response.status; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true);
  if (canvasOnly) {
    const listeners = execFileSync("lsof", ["-nP", "-iTCP:6226", "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
    const pids = [...listeners.matchAll(/^p(\d+)$/gm)].map(match => Number(match[1]));
    assert.deepEqual(pids, [child.pid], "only the exact owned frontend may serve matrix verification");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const commitTime = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    report.runtimePreflight = { port: 6226, pid: child.pid, listenerPids: pids,
      startTime: execFileSync("ps", ["-p", String(child.pid), "-o", "lstart="], { encoding: "utf8" }).trim(),
      head, targetCommit: head, processAfterTarget: Date.parse(report.startup.startedAt) > Date.parse(commitTime),
      logEvidence: log.join("").split("\n").filter(line => line.includes(String(child.pid))).length, httpProbe: report.startup.lastProbe };
  }
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const metadataPaths = new Set([`${route}/objects`, `${route}/materials`, `${route}/graph`]);
  await context.route("**/*", async request => {
    const url = new URL(request.request().url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname)) return request.abort();
    if (delayMetadata && metadataPaths.has(url.pathname)) {
      (report.delayedMetadataRequests ??= []).push(url.pathname);
      await metadataGate;
    }
    return request.continue(); // Actual backend bytes and status are never replaced.
  });
  page = await context.newPage(); page.setDefaultTimeout(20_000); page.on("pageerror", error => errors.push(error.message));
  // Metadata-only diagnostic timeline. Never capture tokens, record payloads
  // or source bytes; this distinguishes missing layout restoration from loss
  // of the saved position before/after the authorized refresh.
  await page.addInitScript(() => {
    const timeline = [];
    window.__f002ScrollDiagnostic = timeline;
    const capture = () => {
      const list = document.querySelector(".f002-relation-list");
      const saved = Object.keys(localStorage).filter(key => key.startsWith("traqen:f002:view:")).flatMap(key => {
        try { return [{ key, top: JSON.parse(localStorage.getItem(key)).relationScrollTop }]; } catch { return []; }
      });
      const next = { top: list?.scrollTop ?? null, height: list?.scrollHeight ?? null, viewport: list?.clientHeight ?? null,
        rows: document.querySelectorAll("[data-relation-id]").length, saved };
      if (JSON.stringify(next) !== JSON.stringify(timeline.at(-1))) { timeline.push(next); if (timeline.length > 100) timeline.shift(); }
    };
    new MutationObserver(capture).observe(document, { subtree: true, childList: true, attributes: true });
    document.addEventListener("scroll", () => queueMicrotask(capture), true);
  });
  const href = `/?${new URLSearchParams({ page: "evidence", workspace: "workspace", tab: "relations", factset: meta.standard.graphVersionId,
    source: meta.sourceVersionId, kind: "FACT", record: fact.id, graphRoot: fact.payload.subjectId })}`;
  await page.goto(`${web}${href}`); await authenticate();
  const edge = page.locator(`[data-edge-fact-id="${fact.id}"]`), row = page.locator(`[data-relation-id="${fact.id}"]`);
  await edge.waitFor();
  if (canvasOnly) {
    await verifyCanvasMatrix({ page, meta, fact, report, directory, read, diagnosticOnly: diagnoseDisclosure });
  } else {
  const selectedObject = (await read(`${route}/records/OBJECT/${fact.payload.subjectId}`)).record;
  await page.locator(".f002-tabs").getByRole("link", { name: "对象与事实", exact: true }).click();
  const directoryMaterial = page.locator(`[data-directory-material="${meta.standard.materialId}"]`);
  await directoryMaterial.locator("summary").focus(); await directoryMaterial.locator("summary").press("Enter");
  const directoryObject = directoryMaterial.locator(`[data-directory-object="${selectedObject.id}"] [data-directory-select]`);
  await directoryObject.waitFor(); await directoryObject.focus(); await directoryObject.press("Enter");
  assert.equal(new URL(page.url()).searchParams.get("record"), selectedObject.id);
  assert.equal(new URL(page.url()).searchParams.get("kind"), "OBJECT");
  assert.equal(new URL(page.url()).searchParams.get("line"), String(selectedObject.payload.anchor.lineStart));
  await page.locator(`.f002-code [data-line="${selectedObject.payload.anchor.lineStart}"].selected`).waitFor();
  await page.locator(".f002-search input").fill(selectedObject.payload.name);
  await directoryObject.waitFor();
  assert.equal(await directoryMaterial.count(), 1, "symbol search must keep its real material even when its path does not match the symbol");
  await page.reload(); await authenticate(); await directoryObject.waitFor();
  assert.equal(await directoryMaterial.locator("details").first().evaluate(node => node.open), true);
  assert.equal(await page.locator(".f002-search input").inputValue(), selectedObject.payload.name);
  assert.equal(new URL(page.url()).searchParams.get("record"), selectedObject.id);
  await page.screenshot({ path: path.join(directory, "directory-object.png"), fullPage: true });
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  assert.equal((await read("/__f002_fixture/metadata")).startRunCount, 0);
  results.push({ case: "admitted-material-object-directory-keyboard-disclosure-symbol-search-source-line-and-authorized-refresh", passed: true });
  await page.locator(".f002-tabs").getByRole("link", { name: "关系", exact: true }).click();
  await edge.waitFor(); await edge.locator("path.f002-edge-hit").click();
  assert.equal(new URL(page.url()).searchParams.get("record"), fact.id);
  assert.equal(await row.getAttribute("aria-selected"), "true");
  assert.equal(await edge.getAttribute("aria-pressed"), "true");
  await edge.focus(); await edge.press("Enter");
  await page.locator(".f002-detail").getByText(fact.id, { exact: true }).waitFor();
  results.push({ case: "real-worker-nonempty-flat-graph-pointer-and-keyboard-select-the-same-Fact-as-table-and-Inspector", passed: true });

  const explanation = page.locator(".f002-explanation");
  await explanation.locator("[data-predicate-meaning]").filter({ hasText: meaning }).waitFor();
  assert.ok((await explanation.locator("[data-evidence-statement]").innerText()).includes(fact.payload.predicate));
  assert.ok((await explanation.locator("[data-extraction-rule]").innerText()).includes(`${fact.payload.ruleRef.id}@1`));
  assert.match(await explanation.locator("[data-premise-notice]").innerText(), /未列出.*不能/);
  const sourceLink = explanation.locator("[data-source-location]").first().getByRole("button");
  assert.match(await sourceLink.innerText(), new RegExp(`UTF-8.*${factEvidence.payload.anchor.byteStart}.*${factEvidence.payload.anchor.byteEnd}`));
  await sourceLink.focus(); await sourceLink.press("Enter");
  await page.waitForFunction(id => new URLSearchParams(location.search).get("record") === id, factEvidence.id);
  await page.locator(`.f002-code [data-line="${factEvidence.payload.anchor.lineStart}"].selected`).waitFor();
  await edge.focus(); await edge.press("Enter");
  await explanation.locator("[data-predicate-meaning]").filter({ hasText: meaning }).waitFor();
  await page.screenshot({ path: path.join(directory, "inspector-readable.png"), fullPage: true });
  results.push({ case: "real-static-Fact-readable-rule-empty-premise-warning-server-vocabulary-and-keyboard-physical-evidence-anchor", passed: true });

  const outage = await read("/__f002_fixture/fail-manifest", "POST"); assert.equal(outage.manifestUnavailable, true);
  const unavailable = page.waitForResponse(value => new URL(value.url()).pathname === `${route}/manifest` && value.status() === 503);
  await page.reload(); await authenticate(); await unavailable;
  await explanation.locator("[data-predicate-meaning]").filter({ hasText: "本版本的谓词词义尚未载入或未确认；不套用其他版本解释。" }).waitFor();
  await page.locator(".f002-detail").getByRole("alert").filter({ hasText: "版本说明读取未完成" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("record"), fact.id);
  assert.equal(new URL(page.url()).searchParams.get("factset"), meta.standard.graphVersionId);
  const restored = await read("/__f002_fixture/restore-manifest", "POST"); assert.ok(restored.manifestFaults > 0);
  await page.getByRole("button", { name: "重读版本说明", exact: true }).click();
  await explanation.locator("[data-predicate-meaning]").filter({ hasText: meaning }).waitFor();
  assert.equal((await read("/__f002_fixture/metadata")).startRunCount, 0);
  report.manifestOutage = { status: 503, faultCount: restored.manifestFaults, restored: true, unchangedFactId: fact.id };
  results.push({ case: "actual-manifest-503-keeps-fixed-record-unconfirmed-semantics-and-read-only-retry-restores-same-version", passed: true });

  await page.getByLabel("关系类型筛选", { exact: true }).selectOption("staticCalls");
  await page.getByLabel("关系起点筛选", { exact: true }).fill(fact.payload.subjectId);
  await page.getByLabel("关系终点筛选", { exact: true }).fill(fact.payload.targetId);
  await page.getByLabel("关系路径筛选", { exact: true }).fill("synthetic-traversal.js");
  assert.equal(await page.locator("[data-relation-id]").count(), 1);
  await page.getByLabel("关系起点筛选", { exact: true }).fill("");
  await page.getByLabel("关系终点筛选", { exact: true }).fill("");
  await setScroll120();
  await page.getByRole("button", { name: "放大局部关系图", exact: true }).click();
  await page.getByRole("button", { name: "向左平移局部关系图", exact: true }).press("Enter");
  const transform = await page.locator("[data-graph-viewport]").getAttribute("transform");
  assert.ok(transform.includes("scale(1.25)")); assert.ok(transform.includes("translate(-40 0)"));
  for (const theme of ["dark", "light"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    assert.equal(await page.locator("[data-graph-viewport]").getAttribute("transform"), transform);
    await scrollStage(`theme-${theme}`);
  }
  const baseline = await inspectorLayoutCycle("baseline");
  if (diagnoseAnchoring) {
    // Test-only single-variable intervention, not a product fix or a GREEN
    // claim. API bytes, layout and scroll handlers remain unchanged.
    await page.locator(".f002-relation-list").evaluate(node => { node.style.overflowAnchor = "none"; });
    await setScroll120();
    const excluded = await inspectorLayoutCycle("anchor-excluded");
    report.anchorDiagnostic = { baseline, excluded, outcome: baseline.some(value => value.top !== 120 || value.saved.some(top => top !== 120))
      && excluded.every(value => value.top === 120 && value.saved.every(top => top === 120) && value.overflowAnchor === "none") ? "CONFIRMED" : "INCONCLUSIVE" };
    await page.locator(".f002-relation-list").evaluate(node => { node.style.removeProperty("overflow-anchor"); });
  }
  report.scrollBeforeReload = await page.evaluate(() => window.__f002ScrollDiagnostic);
  delayMetadata = true;
  const reloadedRelations = page.waitForResponse(value => new URL(value.url()).pathname === `${route}/relations` && value.status() === 200);
  await page.reload(); await authenticate();
  await (await reloadedRelations).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  report.scrollWithMetadataHeld = await page.evaluate(() => window.__f002ScrollDiagnostic);
  assert.equal(new Set(report.delayedMetadataRequests).size, 3, "all three real metadata reads must be delayed after the real relation page, not faked");
  delayMetadata = false; releaseMetadata();
  await edge.waitFor();
  assert.equal(await page.getByLabel("关系路径筛选", { exact: true }).inputValue(), "synthetic-traversal.js");
  assert.equal(await page.locator("[data-graph-viewport]").getAttribute("transform"), transform);
  await page.waitForFunction(() => document.querySelector(".f002-relation-list")?.scrollTop === 120);
  report.scrollAfterReload = await page.evaluate(() => window.__f002ScrollDiagnostic);
  const endpoint = row.locator("td").first().getByRole("button").last(); await endpoint.click();
  await page.getByRole("button", { name: "返回原关系与列表位置", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("record"), fact.payload.targetId);
  await page.getByRole("button", { name: "返回原关系与列表位置", exact: true }).click();
  await page.waitForFunction(id => document.activeElement?.getAttribute("data-relation-select") === id, fact.id);
  assert.equal(new URL(page.url()).searchParams.get("record"), fact.id);
  await page.waitForFunction(() => document.querySelector(".f002-relation-list")?.scrollTop === 120);
  assert.equal(await page.locator("[data-graph-viewport]").getAttribute("transform"), transform);
  await page.screenshot({ path: path.join(directory, "relation-return.png"), fullPage: true });
  results.push({ case: "relation-filters-viewport-themes-close-refresh-and-endpoint-return-retain-original-Fact-row-focus-and-scroll", passed: true });

  await page.locator(".f002-tabs").getByRole("link", { name: "覆盖与缺口", exact: true }).click();
  await page.getByLabel("缺口来源筛选", { exact: true }).selectOption("F002");
  await page.getByLabel("缺口材料类型筛选", { exact: true }).selectOption("JAVASCRIPT");
  await page.getByLabel("缺口原因筛选", { exact: true }).selectOption("EXPRESS_ROUTE_DYNAMIC");
  await page.getByLabel("缺口处置状态筛选", { exact: true }).selectOption(disposition.status);
  const gapRow = page.locator(`[data-gap-id="${gap.id}"]`); await gapRow.waitFor();
  await gapRow.getByRole("button", { name: "EXPRESS_ROUTE_DYNAMIC", exact: true }).click();
  await page.reload(); await authenticate(); await gapRow.waitFor();
  assert.equal(await page.getByLabel("缺口原因筛选", { exact: true }).inputValue(), "EXPRESS_ROUTE_DYNAMIC");
  assert.equal(await page.getByLabel("缺口处置状态筛选", { exact: true }).inputValue(), disposition.status);
  assert.equal(new URL(page.url()).searchParams.get("record"), gap.id);
  await page.getByLabel("缺口来源筛选", { exact: true }).selectOption("F001");
  assert.equal(await page.locator("[data-gap-id]").count(), 0);
  assert.equal(new URL(page.url()).searchParams.get("record"), gap.id, "an empty filter cannot select another Gap or change its reference");
  await page.getByRole("button", { name: "清除缺口筛选", exact: true }).click(); await gapRow.waitFor();
  await explanation.locator("[data-gap-explanation]").waitFor();
  assert.ok((await explanation.locator("[data-gap-explanation]").innerText()).includes("F002 提取限制"));
  assert.ok((await explanation.locator("[data-gap-explanation]").innerText()).includes(gap.payload.code));
  assert.match(await explanation.locator("[data-gap-explanation]").innerText(), /动态路径表达式.*不能确认路由可达/);
  assert.equal(new URL(page.url()).searchParams.get("record"), gap.id);
  assert.equal((await read("/__f002_fixture/metadata")).startRunCount, 0);
  await page.screenshot({ path: path.join(directory, "gap-filter.png"), fullPage: true });
  results.push({ case: "actual-Express-Gap-origin-material-and-work-item-disposition-filter-refresh-empty-clear-without-mutation", passed: true });

  await page.locator(".f002-tabs").getByRole("link", { name: "关系", exact: true }).click();
  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(fixtureReaderToken);
  const readerAuthorized = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/workspaces/workspace/deterministic-facts"
    && value.request().headers().authorization === `Bearer ${fixtureReaderToken}`);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  assert.equal((await readerAuthorized).status(), 200, "the new member must actually be authorized before its metadata is inspected");
  await page.getByLabel("关系路径筛选", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("关系路径筛选", { exact: true }).inputValue(), "", "reader may not inherit owner's filters or viewport");
  assert.equal(await page.locator(`[data-directory-material="${meta.standard.materialId}"] details`).first().evaluate(node => node.open), false, "reader may not inherit owner's expanded directory");
  // Revalidation may already have retired this session by the time an action
  // is attempted. Assert automatic revocation; never click a retired control.
  const denied = page.waitForResponse(value => new URL(value.url()).pathname.startsWith("/v1/workspaces/workspace/")
    && value.request().headers().authorization === `Bearer ${fixtureReaderToken}` && value.status() === 403, { timeout: 15_000 });
  const [revoked, rejected] = await Promise.all([read("/__f002_fixture/revoke-reader", "POST"), denied]);
  assert.equal(revoked.sourceStable, true);
  report.revocation = { mode: "automatic-current-access-revalidation", status: rejected.status(), pathname: new URL(rejected.url()).pathname };
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "复验权限并刷新", exact: true }).isDisabled(), true, "a retired session cannot reopen its old transport");
  assert.equal(await page.locator("[data-edge-fact-id]").count(), 0); assert.equal(await page.locator(".f002-detail").count(), 0);
  const final = await read("/__f002_fixture/metadata"); assert.equal(final.sourceStable, true); assert.equal(final.startRunCount, 0);
  report.sourceStable = final.sourceStable;
  results.push({ case: "graph-filter-member-isolation-current-revocation-and-real-F001-reread-stable", passed: true });
  }
  report.status = errors.length ? "FAILED" : "PASSED";
} catch (error) {
  errors.push(String(error.stack ?? error)); report.status = "FAILED";
  if (fixture) report.fixtureAtFailure = await read("/__f002_fixture/metadata").catch(() => ({ available: false }));
  if (page) report.scrollAtFailure = await page.evaluate(() => window.__f002ScrollDiagnostic).catch(() => null);
  if (page) await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  releaseMetadata(); clearTimeout(deadline); await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => { child.once("exit", resolve); setTimeout(resolve, 3000); }); if (child.exitCode === null) child.kill("SIGKILL"); }
  await fixture?.close().catch(error => errors.push(error.message));
  if (errors.length) report.status = "FAILED";
  await writeFile(path.join(directory, "frontend.log"), log.join(""));
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" }));
  process.exitCode = report.status === "PASSED" && errors.length === 0 ? 0 : 1;
}

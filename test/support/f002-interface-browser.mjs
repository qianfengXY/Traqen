// Bounded, headless browser verification, NOT a durable Hub preview. Every
// service/browser is an owned child/fixture and is closed in finally.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { f002BrowserFixture, fixtureToken, fixtureReaderToken } from "./f002-browser-fixture.js";
import { verifyEvidenceAccessibility } from "./f002-accessibility-checks.mjs";
import { verifyNativeEvidenceAccessibility } from "./f002-native-accessibility-checks.mjs";
import { verifyRequestResultNavigation } from "./f002-request-result-checks.mjs";
import { verifyRequestForm } from "./f002-request-form-checks.mjs";
import { verifyRequestCatalog } from "./f002-request-catalog-checks.mjs";
import { verifyRequestRecovery } from "./f002-request-recovery-checks.mjs";
import { settleWorkbenchTheme, verifyThemeContrast } from "./f002-theme-contrast-checks.mjs";
import { verifyDeliveryLifecycle } from "./f002-delivery-lifecycle-checks.mjs";
import { verifyRequestMaterials } from "./f002-request-material-checks.mjs";
import { verifyInspectorHeaderPaint } from "./f002-inspector-paint-checks.mjs";
import { verifyReferenceCopy } from "./f002-reference-copy-checks.mjs";

const [modulePath, executablePath, mode] = process.argv.slice(2);
assert.ok(process.argv.length <= 5 && [undefined, "--accessibility", "--native-accessibility", "--request-results", "--request-form", "--request-catalog", "--request-recovery", "--theme-contrast", "--delivery-lifecycle", "--request-materials", "--reference-copy", "--shell-diagnostics"].includes(mode), "unsupported browser verifier mode");
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""), "use an already installed browser/module, never install a product dependency");
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-browser-"));
const api = "http://127.0.0.1:6225", web = "http://127.0.0.1:6226";
const testEnvironment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"]
  .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const results = [], errors = [], log = [];
const report = { scope: "OWNED_SYNTHETIC_F001_F002_PGLITE_BROWSER", status: "RUNNING", results, errors, hubPreview: "NOT_OPENED", securityMaterialSuite: "NOT_RUN", f003Runtime: "NOT_CONFIGURED", authorization: [] };
if (mode) report.scope = "OWNED_SYNTHETIC_F001_F002_ACCESSIBILITY_BROWSER";
if (mode === "--native-accessibility") report.scope = "OWNED_SYNTHETIC_F001_F002_NATIVE_ACCESSIBILITY_BROWSER";
if (mode === "--request-results") report.scope = "OWNED_SYNTHETIC_F001_F002_REQUEST_RESULTS_BROWSER";
if (mode === "--request-form") report.scope = "OWNED_SYNTHETIC_F001_F002_REQUEST_FORM_BROWSER";
if (mode === "--request-catalog") report.scope = "OWNED_SYNTHETIC_F001_F002_REQUEST_CATALOG_BROWSER";
if (mode === "--request-recovery") report.scope = "OWNED_SYNTHETIC_F001_F002_REQUEST_RECOVERY_BROWSER";
if (mode === "--theme-contrast") report.scope = "OWNED_SYNTHETIC_F001_F002_THEME_CONTRAST_BROWSER";
if (mode === "--delivery-lifecycle") report.scope = "OWNED_SYNTHETIC_F001_F002_DELIVERY_LIFECYCLE_BROWSER";
if (mode === "--request-materials") report.scope = "OWNED_SYNTHETIC_F001_F002_REQUEST_MATERIAL_BROWSER";
if (mode === "--reference-copy") report.scope = "OWNED_SYNTHETIC_F001_F002_REFERENCE_COPY_BROWSER";
if (mode === "--shell-diagnostics") {
  report.scope = "OWNED_SYNTHETIC_F001_F002_SHELL_DIAGNOSTIC";
  report.shellDiagnostics = { diagnosticOnly: true, responses: [], failures: [], nonGet: [] };
}
let fixture, child, browser, page, ownedContext;
const deadline = setTimeout(() => {
  errors.push("bounded browser verifier timed out"); child?.kill("SIGTERM");
  void browser?.close(); // Retire reads so catch/finally can persist failure and close owned fixtures.
  void ownedContext?.close();
}, 180_000);
async function metadata(action = "metadata", method = "GET") {
  const response = await fetch(`${api}/__f002_fixture/${action}`, { method, headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, "owned fixture controls must never target a production app");
  return response.json();
}
const evidence = (meta, extras = {}) => `/?${new URLSearchParams({ page: "evidence", workspace: "workspace", tab: "objects",
  factset: meta.noFact.graphVersionId, source: meta.sourceVersionId, kind: "MATERIAL", record: meta.noFact.materialId, line: "401", ...extras })}`;
async function authenticateEntry() {
  // This condition is set by the initial anonymous GET after hydration. An
  // SSR input being visible alone does not prove React is accepting edits yet.
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  const input = page.getByLabel("访问令牌（仅当前页面内存）", { exact: true });
  await input.fill(fixtureToken);
  const attempt = { inputMatches: await input.inputValue() === fixtureToken, requestMatches: false, status: null };
  report.authorization.push(attempt);
  assert.equal(attempt.inputMatches, true, "the access input must retain the fixture credential after hydration");
  const authenticated = page.waitForResponse(response => {
    const request = response.request();
    return new URL(request.url()).pathname === "/v1/workspaces" && request.method() === "GET"
      && request.headers()["x-traqen-api-token"] === fixtureToken;
  });
  await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
  const response = await authenticated;
  attempt.requestMatches = true; attempt.status = response.status();
  assert.equal(response.status(), 200, "the actual browser workspace GET must authenticate before material acceptance");
}
async function connect() {
  await authenticateEntry();
  if (new URL(page.url()).searchParams.get("tab") === "delivery") await page.getByRole("heading", { name: "新建技术提取", exact: true }).waitFor();
  else await page.locator(".f002-reading").getByRole("heading", { name: "preview.application.properties", exact: true }).waitFor();
}
try {
  const { chromium } = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof chromium?.launch, "function", "provide the installed package's ESM import entry, not its CommonJS require entry");
  fixture = await f002BrowserFixture({ requestResults: mode === "--request-results", requestForm: mode === "--request-form" || mode === "--native-accessibility" || mode === "--request-recovery" || mode === "--request-materials",
    requestCatalog: mode === "--request-catalog", requestRecovery: mode === "--request-recovery", deliveryLifecycle: mode === "--delivery-lifecycle",
    requestMaterials: mode === "--request-materials", additionalFiles: mode === "--request-materials" ? Array.from({ length: 21 }, (_, index) => ({ entryPath: `picker-${String(index).padStart(2, "0")}.properties`, content: `name=owned-picker-${index}\n` })) : [] });
  const probe = async headers => fetch(`${api}/v1/workspaces?userId=WEB-OPERATOR`, { headers, signal: AbortSignal.timeout(10_000) });
  const anonymous = await probe({}), invalid = await probe({ "x-traqen-api-token": "invalid-owned-fixture-token" });
  const authorized = await probe({ "x-traqen-api-token": fixtureToken });
  report.apiPreflight = { anonymous: anonymous.status, invalid: invalid.status, legacyHeader: authorized.status };
  assert.equal(anonymous.status, 401); assert.equal(invalid.status, 401); assert.equal(authorized.status, 200);
  assert.ok((await authorized.json()).workspaces.some(workspace => workspace.id === "workspace"), "the real API must expose the exact fixture Workspace, not an invented browser response");
  const factsRoute = `${api}/v1/workspaces/workspace/deterministic-facts`;
  const options = await fetch(factsRoute, { method: "OPTIONS", headers: { origin: web,
    "access-control-request-method": "GET", "access-control-request-headers": "authorization" }, signal: AbortSignal.timeout(10_000) });
  const disallowed = await fetch(factsRoute, { method: "OPTIONS", headers: { origin: "https://untrusted.example.test",
    "access-control-request-method": "GET", "access-control-request-headers": "authorization" }, signal: AbortSignal.timeout(10_000) });
  report.factsPreflight = { status: options.status, origin: options.headers.get("access-control-allow-origin"),
    headers: options.headers.get("access-control-allow-headers"), rejectedOrigin: disallowed.headers.get("access-control-allow-origin") };
  assert.equal(options.status, 204);
  assert.equal(report.factsPreflight.origin, web, "the real F002 OPTIONS route must permit the exact owned frontend origin before browser reads");
  assert.ok(report.factsPreflight.headers?.split(/\s*,\s*/).includes("authorization"));
  assert.equal(report.factsPreflight.rejectedOrigin, null, "never widen the fixture's origin boundary to permit a test");
  child = spawn(process.execPath, [path.join(root, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", "6226"], {
    cwd: path.join(root, "web"), env: { ...testEnvironment, NEXT_PUBLIC_TRAQEN_API_BASE: api, WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => log.push(chunk.toString())); child.stderr.on("data", chunk => log.push(chunk.toString()));
  child.on("error", error => errors.push(error.message));
  report.startup = { port: 6226, pid: child.pid, startedAt: new Date().toISOString(), target: web, lastProbe: "not_probed" };
  const startupDeadline = Date.now() + 30_000;
  let ready = false;
  while (!ready && Date.now() < startupDeadline && child.exitCode === null) {
    try { const response = await fetch(web, { signal: AbortSignal.timeout(1000) }); ready = response.ok; report.startup.lastProbe = `HTTP_${response.status}`; }
    catch (error) { report.startup.lastProbe = error.cause?.code ?? error.name; }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "owned frontend must actually respond before testing");
  if (!mode || mode === "--native-accessibility" || mode === "--theme-contrast" || mode === "--delivery-lifecycle" || mode === "--request-materials" || mode === "--reference-copy" || mode === "--shell-diagnostics") {
    const listeners = execFileSync("lsof", ["-nP", "-iTCP:6226", "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
    const pids = [...listeners.matchAll(/^p(\d+)$/gm)].map(match => Number(match[1]));
    assert.ok(pids.includes(child.pid), "the responding frontend listener must be the exact owned child, not another runtime");
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const commitTime = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    report.runtimePreflight = { port: 6226, pid: child.pid, listenerPids: pids,
      startTime: execFileSync("ps", ["-p", String(child.pid), "-o", "lstart="], { encoding: "utf8" }).trim(),
      head, targetCommit: head, processAfterTarget: Date.parse(report.startup.startedAt) > Date.parse(commitTime),
      logEvidence: log.join("").split("\n").filter(line => line.includes(String(child.pid))).length, httpProbe: report.startup.lastProbe };
  }
  let context;
  if (mode === "--native-accessibility") {
    const profile = await mkdtemp(path.join(tmpdir(), "traqen-f002-native-browser-profile-"));
    report.nativeProfile = { parentPath: `${profile}/`, childPath: "Default/", disposable: true, userProfile: false };
    ownedContext = context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, env: testEnvironment,
      viewport: null, args: ["--window-size=1440,900"] });
  } else {
    browser = await chromium.launch({ executablePath, headless: true, env: testEnvironment });
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  }
  await context.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(20_000);
  report.workspaceRequests = [];
  report.factsRequests = [];
  page.on("request", request => {
    if (report.shellDiagnostics && new URL(request.url()).origin === api && request.method() !== "GET" && report.shellDiagnostics.nonGet.length < 32) {
      report.shellDiagnostics.nonGet.push({ method: request.method(), pathname: new URL(request.url()).pathname });
    }
    if (new URL(request.url()).pathname !== "/v1/workspaces" || report.workspaceRequests.length >= 32) return;
    const headers = request.headers();
    // Bounded credential-shape diagnostics only: never persist header values.
    report.workspaceRequests.push({ method: request.method(), hasCredential: Boolean(headers["x-traqen-api-token"]), matchesFixture: headers["x-traqen-api-token"] === fixtureToken });
  });
  page.on("response", response => {
    const pathname = new URL(response.url()).pathname;
    if (report.shellDiagnostics && new URL(response.url()).origin === api && report.shellDiagnostics.responses.length < 128) {
      // Paths/status only: no credential, raw body or source content in shell diagnostics.
      report.shellDiagnostics.responses.push({ method: response.request().method(), pathname, status: response.status() });
    }
    if (!pathname.startsWith("/v1/workspaces/") || !pathname.includes("/deterministic-facts") || report.factsRequests.length >= 64) return;
    report.factsRequests.push({ method: response.request().method(), pathname, status: response.status() });
  });
  page.on("requestfailed", request => {
    const pathname = new URL(request.url()).pathname;
    if (report.shellDiagnostics && new URL(request.url()).origin === api && report.shellDiagnostics.failures.length < 128) {
      report.shellDiagnostics.failures.push({ method: request.method(), pathname, failure: request.failure()?.errorText ?? "failed" });
    }
    if (!pathname.startsWith("/v1/workspaces/") || !pathname.includes("/deterministic-facts") || report.factsRequests.length >= 64) return;
    report.factsRequests.push({ method: request.method(), pathname, failure: request.failure()?.errorText ?? "failed" });
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept());
  const meta = await metadata();
  assert.equal(meta.noFact.factCount, 0); assert.equal(meta.sourceStable, true);
  await page.goto(`${web}${evidence(meta)}`); await connect();
  await page.locator('.f002-code [data-line="401"]').waitFor();
  if (mode === "--reference-copy") {
    await verifyReferenceCopy({ page, api, web, meta, metadata, report, connect, evidence, readerToken: fixtureReaderToken, ownerToken: fixtureToken });
  } else if (mode === "--shell-diagnostics") {
    const alert = page.locator(".toast-message.error");
    await alert.waitFor();
    report.shellDiagnostics.alert = await alert.innerText();
    assert.ok(report.shellDiagnostics.alert.includes("部分 Workspace 数据暂时不可用，请检查连接诊断。"), "record the actual targeted shell warning, not an unrelated alert");
    report.shellDiagnostics.auxiliary = await page.locator(".connection-notice").evaluateAll(nodes => nodes.map(node => ({ state: node.getAttribute("data-auxiliary-state"), text: node.textContent })));
    report.shellDiagnostics.fixedUrl = page.url();
    report.shellDiagnostics.fixture = await metadata();
    assert.equal(report.shellDiagnostics.fixture.startRunCount, 0);
    assert.equal(report.shellDiagnostics.fixture.sourceStable, true);
    assert.deepEqual(report.shellDiagnostics.nonGet, [], "shell diagnosis must not mutate the browser API");
    await page.screenshot({ path: path.join(directory, "shell-diagnostic.png"), fullPage: true });
    results.push({ case: "read-only-shell-warning-captured-with-actual-request-statuses-not-a-product-verdict", passed: true });
  } else if (mode === "--request-materials") {
    await verifyRequestMaterials({ page, meta, metadata, report, directory, connect, readerToken: fixtureReaderToken, ownerToken: fixtureToken });
  } else if (mode === "--delivery-lifecycle") {
    await verifyDeliveryLifecycle({ page, api, meta, metadata, directory, report, connect, ownerToken: fixtureToken, readerToken: fixtureReaderToken });
  } else if (mode === "--theme-contrast") {
    await verifyThemeContrast({ page, metadata, directory, report });
  } else if (mode === "--request-recovery") {
    await verifyRequestRecovery({ page, meta, metadata, report, directory, connect, readerToken: fixtureReaderToken, ownerToken: fixtureToken });
  } else if (mode === "--request-catalog") {
    await verifyRequestCatalog({ page, web, meta, metadata, report, directory, connect, evidence, readerToken: fixtureReaderToken });
  } else if (mode === "--request-results") {
    await verifyRequestResultNavigation({ page, api, web, meta, metadata, report, connect, evidence, readerToken: fixtureReaderToken });
  } else if (mode === "--request-form") {
    await verifyRequestForm({ page, web, meta, metadata, report, directory, connect, authenticateEntry, evidence, readerToken: fixtureReaderToken });
  } else if (mode === "--native-accessibility") {
    await verifyNativeEvidenceAccessibility({ page, context, meta, metadata, directory, report, connect,
      readerToken: fixtureReaderToken, ownerToken: fixtureToken });
  } else if (mode) {
    await verifyEvidenceAccessibility({ page, context, meta, metadata, directory, report, runId: fixture.metadata.noFact.runId });
  } else {
  assert.equal(await page.locator(".f002-code > div").count(), 50);
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.locator('.f002-code [data-line="201"]').waitFor();
  await page.getByRole("button", { name: "上一页", exact: true }).click();
  await page.locator('.f002-code [data-line="1"]').waitFor();
  assert.equal((await page.locator(".f002-code").innerText()).includes("SYNTHETIC_BROWSER_PASSWORD"), false);
  assert.equal((await page.locator(".f002-code").innerText()).includes("[REDACTED]"), true);
  results.push({ case: "actual-worker-sealed-no-Fact-material-controlled-read-and-200-line-window", passed: true });

  const rangeReader = page.locator(".f002-reading");
  await rangeReader.getByRole("button", { name: "定位第 195 行", exact: true }).click();
  await rangeReader.getByRole("button", { name: "下一页", exact: true }).click();
  const rangeEnd = rangeReader.getByRole("button", { name: "定位第 205 行", exact: true });
  await rangeEnd.focus(); await rangeEnd.press("Shift+Enter");
  await page.waitForFunction(() => document.querySelector('[data-selected-range="195:205"]') !== null);
  const selectedLines = () => page.locator(".f002-code > .selected").evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("data-line"))));
  assert.deepEqual(await selectedLines(), [201, 202, 203, 204, 205]);
  assert.equal(await page.locator(".f002-code > div").count(), 200);
  assert.equal(new URL(page.url()).searchParams.get("line"), "195");
  assert.equal(new URL(page.url()).searchParams.get("lineEnd"), "205");
  assert.equal(new URL(page.url()).searchParams.get("windowLine"), "201");
  await rangeReader.getByRole("button", { name: "上一页", exact: true }).click();
  assert.deepEqual(await selectedLines(), [195, 196, 197, 198, 199, 200]);
  assert.equal(new URL(page.url()).searchParams.get("lineEnd"), "205", "paging must not collapse the selection to a new line");
  await rangeReader.getByRole("button", { name: "下一页", exact: true }).click();
  await page.reload(); await connect();
  await page.locator('[data-selected-range="195:205"]').waitFor();
  await page.locator('.f002-code [data-line="201"]').waitFor();
  assert.deepEqual(await selectedLines(), [201, 202, 203, 204, 205]);
  assert.equal(new URL(page.url()).searchParams.get("factset"), meta.noFact.graphVersionId);
  assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId);
  await page.screenshot({ path: path.join(directory, "range-restored.png"), fullPage: true });
  const unavailableRange = new URL(page.url()); unavailableRange.searchParams.set("lineEnd", "451");
  await page.goto(unavailableRange.href); await connect();
  await rangeReader.getByRole("alert").filter({ hasText: /固定的展示行范围 195–451/ }).waitFor();
  assert.equal(await page.locator(".f002-code").count(), 0, "an unavailable range may not look like an approved partial selection");
  assert.equal(new URL(page.url()).searchParams.get("lineEnd"), "451");
  await rangeReader.getByRole("button", { name: "明确查看展示首行", exact: true }).click();
  await page.locator('.f002-code [data-line="1"].selected').waitFor();
  assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId);
  assert.equal((await metadata()).startRunCount, 0);
  report.rangeEvidence = { startLine: 195, endLine: 205, windowLine: 201, rowsPerPage: 200, fixedVersion: meta.noFact.graphVersionId, unavailableEnd: 451 };
  results.push({ case: "cross-window-physical-range-keyboard-selection-refresh-and-unavailable-end-retain-exact-authorized-material", passed: true });

  const pane = page.locator(".f002-detail"), code = page.locator(".f002-code"), directoryPane = page.locator(".f002-directory");
  await pane.getByRole("button", { name: "复制完整引用", exact: true }).waitFor();
  const fixedReadingUrl = page.url();
  assert.equal(await code.evaluate(node => { node.scrollTop = 64; return node.scrollTop; }), 64);
  const directoryTop = await directoryPane.evaluate(node => node.scrollTop);
  assert.equal(await pane.evaluate(node => { node.scrollTop = 120; return node.scrollTop; }), 120, "the Inspector must have a real independent scroll container");
  await page.waitForFunction(id => Object.values(localStorage).some(raw => {
    try { const value = JSON.parse(raw); return value.recordId === id && value.recordKind === "MATERIAL" && value.inspectorScrollTop === 120; } catch { return false; }
  }), meta.noFact.materialId);
  await page.getByRole("button", { name: "关闭依据面板", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "重开依据面板");
  assert.equal(await pane.count(), 0, "closed detail and copy controls must be retired, not just hidden by CSS");
  assert.equal(page.url(), fixedReadingUrl);
  assert.equal(await code.evaluate(node => node.scrollTop), 64);
  assert.equal(await directoryPane.evaluate(node => node.scrollTop), directoryTop);
  await page.setViewportSize({ width: 2560, height: 1440 });
  assert.equal(await pane.count(), 0, "window growth cannot reopen a manually closed Inspector");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "重开依据面板", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute("data-inspector-heading") === "true");
  await page.waitForFunction(() => document.querySelector(".f002-detail")?.scrollTop === 120);
  assert.equal(await code.evaluate(node => node.scrollTop), 64);
  await page.getByRole("button", { name: "关闭依据面板", exact: true }).press("Escape");
  await page.getByRole("button", { name: "重开依据面板", exact: true }).waitFor();
  await page.locator(".f002-tabs").getByRole("link", { name: "覆盖与缺口", exact: true }).click();
  assert.equal(await pane.count(), 0, "the authorized panel preference also applies to the Gap view");
  await page.getByRole("button", { name: "重开依据面板", exact: true }).waitFor();
  await page.locator(".f002-tabs").getByRole("link", { name: "对象与事实", exact: true }).click();
  await page.reload();
  assert.equal(await pane.count(), 0, "refresh cannot restore Inspector content before current authorization");
  await connect();
  assert.equal(await pane.count(), 0, "the authorized refresh must retain the manual closed choice");
  await page.getByRole("button", { name: "重开依据面板", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".f002-detail")?.scrollTop === 120);
  assert.equal(page.url(), fixedReadingUrl);
  assert.equal((await metadata()).startRunCount, 0);
  await page.screenshot({ path: path.join(directory, "inspector-restored.png"), fullPage: true });
  await verifyInspectorHeaderPaint(page, report);
  results.push({ case: "manual-inspector-close-reopen-scroll-focus-and-authorized-refresh-preserve-fixed-reading", passed: true });

  const search = page.locator(".f002-search input"); await search.fill("preview");
  const materialType = page.getByLabel("材料类型筛选", { exact: true });
  const processingStatus = page.getByLabel("能力处置状态筛选", { exact: true });
  await materialType.selectOption("PROPERTIES");
  await processingStatus.selectOption("DONE");
  await page.locator(".f002-directory").getByText("命中：路径", { exact: true }).waitFor();
  await page.locator(".f002-tabs").getByRole("link", { name: "关系", exact: true }).click();
  assert.equal(await search.inputValue(), "preview");
  assert.equal(await materialType.inputValue(), "PROPERTIES");
  assert.equal(await processingStatus.inputValue(), "DONE");
  await page.locator(".f002-tabs").getByRole("link", { name: "对象与事实", exact: true }).click();
  await page.reload();
  assert.equal(await page.locator(".f002-search input").count(), 0, "metadata cannot be revealed before fresh authorization");
  assert.equal(await materialType.count(), 0, "filter metadata is unavailable before current authorization");
  await connect(); assert.equal(await search.inputValue(), "preview");
  assert.equal(await materialType.inputValue(), "PROPERTIES");
  assert.equal(await processingStatus.inputValue(), "DONE");
  const persisted = await page.evaluate(() => Object.values(localStorage).join("\n"));
  assert.equal(persisted.includes(fixtureToken) || persisted.includes("SYNTHETIC_BROWSER_PASSWORD"), false);
  results.push({ case: "filter-tab-refresh-and-current-authorization-without-persisting-token-or-material", passed: true });
  await processingStatus.selectOption("PARSE_FAILED");
  await page.locator(".f002-directory").getByText(/没有匹配材料/).waitFor();
  await page.locator(".f002-records").getByText(/本加载页没有已提取事实/).waitFor();
  await page.locator(".f002-reading").getByRole("heading", { name: "preview.application.properties", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("factset"), meta.noFact.graphVersionId);
  assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId, "an empty filter must not silently select another material");
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await materialType.inputValue(), "");
  assert.equal(await processingStatus.inputValue(), "");
  assert.equal(new URL(page.url()).searchParams.get("record"), meta.noFact.materialId);
  assert.equal((await metadata()).startRunCount, 0, "filtering and clearing cannot start a mutation");
  // Retain nonempty owner preferences to make the later member-isolation
  // checks meaningful, rather than comparing two identical empty defaults.
  await search.fill("preview"); await materialType.selectOption("PROPERTIES"); await processingStatus.selectOption("DONE");
  results.push({ case: "directory-type-real-disposition-empty-state-and-clearing-preserve-fixed-reading-without-mutation", passed: true });
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    await settleWorkbenchTheme(page, theme, report.themeSettles ??= []);
    await page.screenshot({ path: path.join(directory, `evidence-${theme}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.waitForFunction(() => Math.abs(document.querySelector(".app-shell").getBoundingClientRect().width / 1440 - 1.6) < .001);
  assert.equal(await page.locator(".f002-tabs a").count(), 4);
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.locator(".f002-tabs a").count(), 4);
  assert.equal(await materialType.isVisible(), true);
  assert.equal(await processingStatus.isVisible(), true);
  await page.setViewportSize({ width: 1440, height: 900 });
  results.push({ case: "two-themes-uniform-desktop-scale-and-small-window-controls-remain-present", passed: true });

  await page.locator(".f002-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(fixtureReaderToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator(".f002-search input").waitFor(); assert.equal(await search.inputValue(), "");
  assert.equal(await materialType.inputValue(), "");
  assert.equal(await processingStatus.inputValue(), "");
  await metadata("revoke-reader", "POST");
  await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
  assert.equal(await page.locator(".f002-code").count(), 0);
  results.push({ case: "member-isolated-metadata-and-live-permission-revocation-retire-displayed-bytes", passed: true });
  await metadata("restore-reader", "POST");
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(fixtureToken);
  await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.locator(".f002-tabs").getByRole("link", { name: "版本与交付", exact: true }).click();
  await page.getByRole("combobox", { name: "冻结来源", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "冻结来源", exact: true }).count(), 1, "the source picker must have a stable accessible name independent of its options");
  assert.equal(await page.getByRole("combobox", { name: "不可变能力配置", exact: true }).count(), 1);
  await page.getByLabel("冻结来源", { exact: true }).selectOption(meta.sourceVersionId);
  await page.locator("fieldset").getByRole("checkbox").first().check();
  const armed = await metadata("drop-next-run-response", "POST");
  assert.equal(armed.dropNextRunResponse, true, "a fault must actually be armed before asserting unknown-commit recovery");
  const responseLoss = page.waitForEvent("requestfailed", { predicate: request => request.method() === "POST"
    && new URL(request.url()).pathname === "/v1/workspaces/workspace/deterministic-facts/runs", timeout: 10_000 })
    .then(request => ({ request }), error => ({ error }));
  await page.getByRole("button", { name: "按固定输入开始提取", exact: true }).click();
  const observed = await responseLoss;
  if ("error" in observed) throw observed.error;
  const interrupted = observed.request;
  report.responseLoss = { failure: interrupted.failure()?.errorText ?? "unknown", ...(await metadata()) };
  assert.equal(report.responseLoss.droppedRunResponses, 1);
  assert.equal(report.responseLoss.lastDroppedResponse?.status, 202, "the real handler must commit before the fixture interrupts its response");
  assert.equal(report.responseLoss.startRunCount, 1, "the transport must not silently replay the POST before unknown-operation acceptance");
  await page.getByText("提交结果待对账", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "按固定输入开始提取", exact: true }).isDisabled(), true);
  await page.reload(); await connect();
  await page.getByText("提交结果待对账", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查询同次操作", exact: true }).click();
  await page.getByText("已按原操作键核对持久回执；草稿保留，不自动采用业务结果。", { exact: true }).waitFor();
  assert.equal((await metadata()).startRunCount, 1);
  results.push({ case: "actual-committed-write-response-loss-refresh-reconciles-original-operation-without-resubmit", passed: true });

  await page.goto(`${web}/?evidenceReturn=1&page=graph&workspace=workspace&graphRevision=missing-original&object=original-entry&focus=original-entry&scrollTop=120`);
  await authenticateEntry();
  await page.getByRole("heading", { name: "返回原工作定位", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("graphRevision"), "missing-original");
  assert.equal(await page.getByRole("heading", { name: "当前没有可读取的发布结果", exact: true }).count(), 0);
  assert.equal((await metadata()).sourceStable, true);
  assert.deepEqual(errors, [], "no browser runtime errors may be hidden by unit checks");
  results.push({ case: "unavailable-original-entry-retained-without-latest-substitution-and-real-F001-re-read-stable", passed: true });
  }
  assert.deepEqual(errors, [], "no runtime error can be counted as an accessibility pass");
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED"; errors.push(error.stack ?? error.message);
  if (fixture) report.fixtureAtFailure = await metadata().catch(() => ({ available: false }));
  if (page) await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  clearTimeout(deadline);
  if (ownedContext) await ownedContext.close();
  if (browser) await browser.close();
  if (child && child.exitCode === null) {
    const closed = new Promise(resolve => child.once("close", resolve)); child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 3000); await closed; clearTimeout(kill);
  }
  if (fixture) await fixture.close();
  await writeFile(path.join(directory, "frontend.log"), log.join(""));
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" }));
  // PGlite.close() calls Emscripten's force_exit(0), which resets Node's
  // process.exitCode. Publish this verifier's truth only AFTER every cleanup.
  process.exitCode = report.status === "PASSED" && errors.length === 0 ? 0 : 1;
}

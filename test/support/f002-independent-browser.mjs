import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { independentNativeFixture, independentPassword } from "./f002-independent-native-fixture.js";

const [modulePath, executablePath] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const temporary = await mkdtemp(path.join(tmpdir(), "traqen-f002-independent-browser-"));
const project = fileURLToPath(new URL("../../", import.meta.url));
const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
assert.ok(![3003, 3004, 6398, 6399].includes(port));
const origin = `http://127.0.0.1:${port}`;
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const cleanups = [], logs = [];
const report = { scope: "ACTUAL_BRANCH_DEV_ENTRY_F001_F008_F002_NATIVE_PG_VOLUME_MECHANISM_DOUBLE_NO_MODEL", status: "RUNNING",
  checks: [], errors: [], apiWrites: [], legacyAnalysisRequests: [], screenshots: [], origin, ownedApiChildren: [] };
let fixture, child, browser, page, frontendExit;
const deadline = setTimeout(() => { report.errors.push("owned browser journey deadline"); child?.kill("SIGTERM"); void browser?.close(); }, 240000);
try {
  fixture = await independentNativeFixture({ after: cleanup => cleanups.push(cleanup) }, { origin });
  report.ownedApiChildren = fixture.children;
  report.fixtureParent = fixture.root;
  child = spawn(process.execPath, [path.join(project, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: path.join(project, "web"), env: { ...environment, TRAQEN_API_PROXY_TARGET: fixture.base, NEXT_PUBLIC_TRAQEN_API_BASE: "/api",
      WRANGLER_LOG_PATH: path.join(temporary, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  frontendExit = once(child, "exit"); report.frontendPid = child.pid;
  child.stdout.on("data", bytes => logs.push(bytes.toString())); child.stderr.on("data", bytes => logs.push(bytes.toString()));
  const started = Date.now();
  while (true) {
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    assert.ok(child.exitCode === null && Date.now() - started < 45000, "owned frontend startup failed"); await delay(100);
  }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("pageerror", error => report.errors.push(error.message));
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (/workspace-analysis-jobs|business-knowledge/.test(pathname)) report.legacyAnalysisRequests.push(pathname);
    if (pathname.includes("/deterministic-facts") && !["GET", "OPTIONS"].includes(request.method()))
      report.apiWrites.push({ pathname, method: request.method(), bearer: Boolean(request.headers().authorization), csrf: Boolean(request.headers()["x-traqen-csrf"]) });
  });
  await page.goto(origin);
  await page.getByLabel("账号", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill(independentPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  report.legacyAnalysisRequests.length = 0;
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "技术证据", exact: true }).click();
  await page.getByRole("heading", { name: "尚无分析结果", exact: true }).waitFor();
  assert.equal(await page.getByLabel("成员访问令牌（仅本页内存）").count(), 0);
  await page.screenshot({ path: path.join(temporary, "empty-1440.png"), fullPage: true }); report.screenshots.push("empty-1440.png");
  await page.getByRole("link", { name: "分析任务", exact: true }).click();
  await page.getByLabel("冻结来源", { exact: true }).selectOption(fixture.metadata.bundleId);
  assert.equal(await page.getByLabel("不可变能力配置", { exact: true }).inputValue(), fixture.metadata.profileId);
  report.checks.push("ordinary-owner-login-main-navigation-exact-frozen-source-and-structured-current-profile");
  await page.locator(".f002-delivery fieldset").getByRole("checkbox").first().check();
  await page.getByText("按目录或文件缩小提取范围", { exact: true }).click();
  await page.getByLabel("提取范围", { exact: true }).selectOption("ENTRY");
  await page.getByLabel("冻结组件内的相对路径", { exact: true }).fill("evidence-sentinel.js");
  const acknowledgement = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith("/deterministic-facts/runs"));
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  const accepted = await acknowledgement; assert.equal(accepted.status(), 202);
  const run = (await accepted.json()).run; report.runId = run.id;
  assert.equal(run.scopes[0].selections[0].kind, "ENTRY");
  assert.equal(Buffer.from(run.scopes[0].selections[0].pathBytes, "base64url").toString(), "evidence-sentinel.js");
  const row = page.locator(".f002-delivery article").filter({ has: page.getByRole("heading", { name: `运行 ${run.id}`, exact: true }) });
  await page.getByRole("button", { name: "复验权限并刷新", exact: true }).click();
  await row.getByRole("button", { name: "查看分析结果", exact: true }).waitFor();
  assert.equal(await row.getByRole("button", { name: "查看封存条件", exact: true }).count(), 0);
  assert.equal(await row.getByRole("button", { name: "封存此范围", exact: true }).count(), 0);
  const stored = (await fixture.pool().query("SELECT status,graph_version_id FROM f002_scope WHERE run_id=$1", [run.id])).rows[0];
  assert.equal(stored.status, "SEALED"); report.graphVersionId = stored.graph_version_id;
  assert.equal(new URL(page.url()).searchParams.has("factset"), false, "no implicit result adoption or forced delivery remount");
  await page.screenshot({ path: path.join(temporary, "automatic-sealed-1440.png"), fullPage: true }); report.screenshots.push("automatic-sealed-1440.png");
  await row.getByRole("button", { name: "查看分析结果", exact: true }).click();
  await page.getByRole("link", { name: "对象与事实", exact: true }).click();
  await page.getByRole("button", { name: /evidence-sentinel.js/ }).first().click();
  await page.locator(".f002-reading").getByText(/EvidenceSentinelOct21/).first().waitFor();
  report.checks.push("real-202-automatic-SEALED-and-original-read-without-browser-check-or-seal");
  await page.reload();
  await page.locator(".f002-reading").getByText(/EvidenceSentinelOct21/).first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("factset"), report.graphVersionId);
  await page.screenshot({ path: path.join(temporary, "exact-original-refresh-1440.png"), fullPage: true }); report.screenshots.push("exact-original-refresh-1440.png");
  report.checks.push("authorized-reopen-retains-the-exact-sealed-version-and-original-selection");
  assert.equal(report.legacyAnalysisRequests.length, 0);
  assert.ok(report.apiWrites.length > 0 && report.apiWrites.every(write => !write.bearer && write.csrf));
  assert.equal(report.apiWrites.some(write => /\/(check|seal)$/.test(write.pathname)), false);
  const published = (await fixture.pool().query("SELECT payload FROM f002_record WHERE graph_version_id=$1 AND kind='MATERIAL'", [report.graphVersionId])).rows;
  assert.equal(published.length, 1);
  assert.equal(published[0].payload.pathBytes, Buffer.from("evidence-sentinel.js").toString("base64url"));
  assert.equal(published[0].payload.contentDigest, fixture.metadata.originalDigest);
  report.checks.push("unselected-sibling-not-processed-F001-digest-retained-no-model-or-private-F003-fallback");
  report.status = report.errors.length ? "FAILED" : "PASSED";
} catch (error) {
  report.status = "FAILED"; report.errors.push(error.stack ?? error.message);
  if (page && !page.isClosed()) {
    report.failure = { url: page.url(), text: (await page.locator("body").innerText().catch(() => "unavailable")).slice(-16000) };
    await page.screenshot({ path: path.join(temporary, "failure.png"), fullPage: true }).catch(() => {});
  }
} finally {
  clearTimeout(deadline); await browser?.close().catch(() => {});
  if (child && child.exitCode === null) {
    child.kill("SIGTERM"); const timer = setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 10000);
    try { await frontendExit; } finally { clearTimeout(timer); }
  }
  // Preserve fixture registration order: API drain, then PG stop.
  for (const cleanup of cleanups) await cleanup().catch(error => { report.status = "FAILED"; report.errors.push(error.message); });
  report.frontendExit = child ? { code: child.exitCode, signal: child.signalCode } : null;
  await writeFile(path.join(temporary, "frontend.log"), logs.join(""), { flag: "wx" });
  await writeFile(path.join(temporary, "summary.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...report, parentPath: temporary + "/", childPath: "summary.json" }));
}
if (report.status !== "PASSED") process.exitCode = 1;

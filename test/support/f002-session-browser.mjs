import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sessionEvidenceFixture, isolatedPassword } from "./f002-session-fixture.js";

const [modulePath, executablePath] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-session-entry-"));
const root = fileURLToPath(new URL("../../", import.meta.url)), web = "http://127.0.0.1:6226";
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const report = { scope: "OWNED_PASSWORD_SESSION_F001_TO_F002_DEFAULT_ENTRY", status: "RUNNING", checks: [], errors: [], apiWrites: [], legacyReads: [], screenshots: [] };
let fixture, child, browser, page;
const logs = [];
const deadline = setTimeout(() => { report.errors.push("bounded session verification timed out"); child?.kill("SIGTERM"); void browser?.close(); }, 180000);
try {
  fixture = await sessionEvidenceFixture();
  child = spawn(process.execPath, [path.join(root, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", "6226"], {
    cwd: path.join(root, "web"), env: { ...environment, TRAQEN_API_PROXY_TARGET: "http://127.0.0.1:6225", NEXT_PUBLIC_TRAQEN_API_BASE: "/api", WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", bytes => logs.push(bytes.toString())); child.stderr.on("data", bytes => logs.push(bytes.toString()));
  const started = Date.now();
  while (true) {
    try { if ((await fetch(web, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Wait for this owned child only. */ }
    assert.ok(child.exitCode === null && Date.now() - started < 30000, "owned frontend did not start");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await context.newPage(); page.setDefaultTimeout(20000);
  page.on("request", request => {
    const pathname = new URL(request.url()).pathname;
    if (/workspace-analysis-jobs/.test(pathname)) report.legacyReads.push(pathname);
    if (pathname.includes("/deterministic-facts") && !["GET", "OPTIONS"].includes(request.method())) report.apiWrites.push({ pathname, method: request.method(), authorizationPresent: Boolean(request.headers().authorization) });
  });
  page.on("pageerror", error => report.errors.push(error.message));
  await page.goto(web);
  await page.getByLabel("账号", { exact: true }).fill("owner");
  await page.getByLabel("密码", { exact: true }).fill(isolatedPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("workspace");
  // Follow the actual product navigation; no hand-crafted evidence URL.
  report.legacyReads.length = 0;
  await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("link", { name: "技术证据", exact: true }).click();
  await page.getByRole("navigation", { name: "技术证据页签", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("page"), "evidence");
  assert.equal(await page.getByLabel("成员访问令牌（仅本页内存）").count(), 0);
  await page.getByRole("heading", { name: "尚无已封存事实集", exact: true }).waitFor();
  report.checks.push("default-navigation-empty-facts-with-existing-frozen-source-and-one-login");
  await page.getByRole("link", { name: "版本与交付", exact: true }).click();
  await page.getByLabel("冻结来源", { exact: true }).selectOption(fixture.metadata.bundleId);
  await page.getByLabel("不可变能力配置", { exact: true }).selectOption(fixture.metadata.profileId);
  await page.locator(".f002-delivery fieldset").getByRole("checkbox").first().check();
  await page.getByText("按目录或文件缩小提取范围", { exact: true }).click();
  await page.getByLabel("提取范围", { exact: true }).selectOption("ENTRY");
  await page.getByLabel("冻结组件内的相对路径", { exact: true }).fill("evidence-sentinel.js");
  const accepted = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/deterministic-facts/runs"));
  await page.getByRole("button", { name: "按固定输入开始提取", exact: true }).click();
  const response = await accepted; assert.equal(response.status(), 202);
  const run = (await response.json()).run;
  assert.equal(run.scopes[0].selections[0].kind, "ENTRY");
  assert.equal(Buffer.from(run.scopes[0].selections[0].pathBytes, "base64url").toString(), "evidence-sentinel.js");
  report.runId = run.id;
  const row = page.locator(".f002-delivery article").filter({ has: page.getByRole("heading", { name: `运行 ${run.id}`, exact: true }) });
  await page.getByRole("button", { name: "复验权限并刷新", exact: true }).click();
  await row.getByText(/^READY_TO_SEAL · revision/).waitFor();
  await row.getByRole("button", { name: "查看封存条件", exact: true }).click();
  const sealed = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/seal"));
  await row.getByRole("button", { name: "封存此范围", exact: true }).click();
  const seal = await sealed; assert.equal(seal.status(), 200); report.graphVersionId = (await seal.json()).scope.graphVersionId;
  assert.equal(new URL(page.url()).searchParams.has("factset"), false, "the first publication must not silently adopt itself or remount the current delivery");
  await row.getByRole("button", { name: "查看独立封存版本", exact: true }).click();
  await page.getByRole("link", { name: "对象与事实", exact: true }).click();
  await page.getByRole("button", { name: /evidence-sentinel.js/ }).first().click();
  await page.locator(".f002-reading").getByText(/EvidenceSentinelOct21/).first().waitFor();
  report.checks.push("real-browser-extract-check-seal-read-original-material");
  await page.reload();
  await page.locator(".f002-reading").getByText(/EvidenceSentinelOct21/).first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("factset"), report.graphVersionId);
  report.checks.push("authorized-refresh-retains-fixed-version-and-selection");
  for (const [width, height] of [[1440, 900], [1920, 1080], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(({ width, height }) => {
      const expected = width >= 1440 && height >= 900 ? Math.min(width / 1440, height / 900) : 1;
      return Math.abs(Number(document.querySelector(".desktop-frame")?.style.getPropertyValue("--desktop-scale")) - expected) < 0.001;
    }, { width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const filename = `evidence-${width}.png`; await page.screenshot({ path: path.join(directory, filename), fullPage: true }); report.screenshots.push(filename);
  }
  assert.equal(report.legacyReads.length, 0, "F002 navigation cannot invoke the unavailable legacy analysis jobs");
  assert.equal(report.apiWrites.some(write => write.authorizationPresent), false);
  const after = await fixture.facts.services.admission.inventory({ actorId: "owner", tenantId: "tenant" }, "workspace", run.id);
  assert.equal(after.items.length, 2, "the original frozen inventory still contains the non-selected file");
  const published = await fixture.source.db.query("SELECT kind,payload FROM f002_record WHERE workspace_id='workspace' AND graph_version_id=$1 AND kind='MATERIAL'", [report.graphVersionId]);
  assert.equal(published.rows.length, 1, "a file-scoped run cannot publish its sibling as processed");
  assert.equal(published.rows[0].payload.pathBytes, Buffer.from("evidence-sentinel.js").toString("base64url"));
  assert.equal(fixture.source.digest, fixture.metadata.originalDigest);
  report.checks.push("no-second-credential-no-legacy-runtime-and-fixed-source-preserved");
  report.status = report.errors.length ? "FAILED" : "PASSED";
} catch (error) {
  report.status = "FAILED"; report.errors.push(error.stack ?? error.message);
  if (page && !page.isClosed()) {
    report.failure = { url: page.url(), text: (await page.locator("body").innerText().catch(() => "unavailable")).slice(-16000) };
    await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
  }
}
finally {
  clearTimeout(deadline); await browser?.close().catch(() => {});
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  await fixture?.close().catch(error => { report.status = "FAILED"; report.errors.push(error.message); });
  await writeFile(path.join(directory, "frontend.log"), logs.join(""), { flag: "wx" });
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" }));
}
if (report.status !== "PASSED") process.exitCode = 1;

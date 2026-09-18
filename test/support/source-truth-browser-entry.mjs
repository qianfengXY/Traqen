// Real isolated API; no user credentials, source directories or deployment data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserFixture } from "./source-truth-browser-fixture.js";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(evidenceDirectory));
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], results = [], pageErrors = [];
const report = { status: "RUNNING", scope: "ISOLATED_ENTRY_AND_PRESENTATION", nativePickerVerified: false, results };
let page;
try {
  const f = await browserFixture({ after: (fn) => cleanups.push(fn) });
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version(); report.webOrigin = f.webOrigin;
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("http://127.0.0.1:3100/**", (route) => route.abort());
  await page.goto(f.webOrigin);
  await page.waitForSelector(".connection-button.unavailable");
  await page.getByTitle("部署诊断", { exact: true }).click();
  await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
  await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
  await page.waitForSelector(".connection-button.unavailable");
  await page.locator(".diagnostic-drawer header button").click();
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Workspace 名称", { exact: true }).count(), 0);
  await page.screenshot({ path: path.join(evidenceDirectory, "entry-authentication.png") });
  results.push({ case: "anonymous-401-is-not-empty-workspace", passed: true });

  const access = page.getByLabel("访问令牌（仅当前页面内存）", { exact: true });
  await access.fill("fixture-invalid-token");
  await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.waitForSelector(".connection-button.unavailable");
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  await access.fill(f.token);
  await access.press("Enter");
  await page.waitForSelector(".connection-button.healthy");
  assert.equal(await page.locator(".workspace-connection").count(), 0);
  assert.equal(await page.evaluate((token) => Object.values({ ...localStorage, ...sessionStorage }).some((value) => String(value).includes(token)), f.token), false);
  assert.equal(page.url().includes(f.token), false);
  results.push({ case: "keyboard-authentication-recovery-without-token-persistence", passed: true });

  await page.getByTitle("新建 Workspace", { exact: true }).click();
  await page.getByLabel("Workspace 名称", { exact: true }).fill("Entry verification only");
  let requests = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route(`${f.apiBase}/v1/workspaces`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    requests++;
    if (requests !== 1) return route.continue();
    await gate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "FIXTURE_UNAVAILABLE", message: "隔离验证：稍后重试" } }) });
  });
  await page.locator(".onboarding-form").getByRole("button", { name: "新建 Workspace", exact: true }).evaluate((button) => { button.click(); button.click(); });
  await page.getByRole("button", { name: "正在创建…", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "正在创建…", exact: true }).isDisabled(), true);
  release();
  await page.locator(".onboarding-form [role=alert]").getByText("隔离验证：稍后重试", { exact: true }).waitFor();
  assert.equal(requests, 1);
  assert.equal(await page.getByLabel("Workspace 名称", { exact: true }).inputValue(), "Entry verification only");
  await page.screenshot({ path: path.join(evidenceDirectory, "entry-retained-create-error.png") });
  results.push({ case: "create-failure-retains-input-and-blocks-duplicate-submit", passed: true });

  await page.locator(".onboarding-form").getByRole("button", { name: "新建 Workspace", exact: true }).click();
  await page.getByRole("heading", { name: "来源访问尚未就绪", exact: true }).waitFor();
  assert.equal(requests, 2);
  assert.equal(await page.getByText("正在验证来源访问权限和存储状态…", { exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).count(), 0);
  const list = await fetch(`${f.apiBase}/v1/workspaces?userId=WEB-OPERATOR`, { headers: { "x-traqen-api-token": f.token } });
  assert.equal(list.status, 200);
  const created = (await list.json()).workspaces.filter((item) => item.name === "Entry verification only");
  assert.equal(created.length, 1);
  const denied = await fetch(`${f.apiBase}/v1/workspaces/${created[0].id}/source-truth`, { headers: { authorization: `Bearer ${f.token}` } });
  assert.equal(denied.status, 403, "creation must not escalate source access");
  await page.screenshot({ path: path.join(evidenceDirectory, "entry-source-access-denied.png") });
  results.push({ case: "created-workspace-is-visible-but-does-not-auto-grant-source-permissions", passed: true });

  await page.getByLabel("切换工作区", { exact: true }).selectOption("directory");
  await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
  await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).isDisabled(), true);
  for (const width of [320, 390, 768, 1280, 1440, 1600, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator(".st-heading").scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.equal(geometry.scroll, width, `page must not overflow at ${width}px; the rail has its own scroll container`);
    await page.screenshot({ path: path.join(evidenceDirectory, `sources-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const step = page.getByRole("button", { name: "第 2 站 确认范围（只读预览）", exact: true });
  await step.focus(); await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).count(), 0);
  await page.getByRole("button", { name: "回到当前 · 第 1 站", exact: true }).click();
  assert.equal((await f.read("directory")).activeRun, null);
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    assert.equal(await page.getByRole("heading", { name: "快照旅程", exact: true }).isVisible(), true);
  }
  results.push({ case: "source-layout-eight-viewports-two-f005-themes-and-keyboard-preview", passed: true });
  assert.deepEqual(pageErrors, []);
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.page = await page.locator("body").innerText();
    await page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true });
  }
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

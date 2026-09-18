// Regression journeys for PR37 review141. Synthetic isolated data only.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserFixture } from "./source-truth-browser-fixture.js";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(evidenceDirectory));
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], results = [];
const report = { status: "RUNNING", scope: "ISOLATED_ENTRY_RECOVERY", results, nativePickerVerified: false, scale100kBrowserVerified: false };
try {
  const f = await browserFixture({ after: (fn) => cleanups.push(fn) });
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version(); report.webOrigin = f.webOrigin;

  async function check(name, exercise) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    let stage = "setup";
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/http:\/\/(127\.0\.0\.1|localhost):(3100|3188|3189)\//, (route) => route.abort());
    try {
      await page.goto(f.webOrigin);
      await page.waitForSelector(".connection-button.unavailable");
      await page.getByTitle("部署诊断", { exact: true }).click();
      await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
      await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill(f.token);
      await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
      await page.waitForSelector(".connection-button.healthy");
      await page.locator(".diagnostic-drawer header button").click();
      stage = "exercise";
      await exercise(page);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(evidenceDirectory, `${name}.png`) });
      results.push({ case: name, passed: true });
    } catch (error) {
      results.push({ case: name, passed: false, stage, error: error.message });
      await page.screenshot({ path: path.join(evidenceDirectory, `${name}-FAILED.png`) });
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.close();
    }
  }
  const reconnect = (page) => page.getByTitle("刷新 Workspace", { exact: true }).click();
  await check("auxiliary-404-does-not-block-sources", async (page) => {
    await page.route(`${f.apiBase}/v1/workspace-executable-skills`, (route) => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }));
    await reconnect(page);
    await page.waitForSelector(".connection-button.healthy");
    await page.getByLabel("切换工作区", { exact: true }).selectOption("directory");
    await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
    await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
    assert.equal(await page.locator(".workspace-connection").count(), 0);
  });
  await check("workspace-401-wins-over-auxiliary-failure", async (page) => {
    await page.route(`${f.apiBase}/v1/workspace-executable-skills`, (route) => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }));
    await page.route(`${f.apiBase}/v1/workspaces?**`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } });
    });
    await reconnect(page);
    await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
    assert.equal(await page.locator(".onboarding").count(), 0);
  });
  await check("list-refresh-clears-create-error-retains-name", async (page) => {
    await page.getByTitle("新建 Workspace", { exact: true }).click();
    await page.getByLabel("Workspace 名称", { exact: true }).fill("Recovery fixture only");
    await page.route(`${f.apiBase}/v1/workspaces`, (route) => route.fulfill({ status: 503, json: { error: { code: "TEST_UNAVAILABLE", message: "刷新列表后核对" } } }));
    await page.locator(".onboarding-form").getByRole("button", { name: "新建 Workspace", exact: true }).click();
    await page.locator(".onboarding-form [role=alert]").waitFor();
    await reconnect(page);
    await page.waitForSelector(".connection-button.healthy");
    assert.equal(await page.locator(".onboarding-form [role=alert]").count(), 0);
    assert.equal(await page.getByLabel("Workspace 名称", { exact: true }).inputValue(), "Recovery fixture only");
  });
  await check("hanging-list-has-visible-and-bounded-recovery", async (page) => {
    await page.route(`${f.apiBase}/v1/workspaces?**`, () => {});
    await reconnect(page);
    await page.locator(".workspace-connection [role=status]").waitFor();
    assert.equal(await page.locator(".workspace-connection #workspace-access-token").count(), 1);
    assert.equal(await page.locator(".workspace-connection").getByRole("button", { name: "连接设置", exact: true }).isEnabled(), true);
    await page.waitForSelector(".connection-button.unavailable", { timeout: 20000 });
    await page.unroute(`${f.apiBase}/v1/workspaces?**`);
    await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
    await page.waitForSelector(".connection-button.healthy");
    assert.equal(await page.locator(".workspace-connection").count(), 0);
  });
  await check("hanging-auxiliary-does-not-delay-source-entry", async (page) => {
    await page.route(`${f.apiBase}/v1/workspace-executable-skills`, () => {});
    await reconnect(page);
    await page.waitForSelector(".connection-button.healthy");
    await page.getByLabel("切换工作区", { exact: true }).selectOption("directory");
    await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
    await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
    await page.locator('[data-auxiliary-state="partial"]').waitFor({ timeout: 15000 });
    assert.match(await page.locator('[data-auxiliary-state="partial"]').innerText(), /workspace-executable-skills/);
    assert.equal(await page.locator(".workspace-connection").count(), 0);
    assert.equal(await page.locator(".connection-button.healthy").count(), 1);
  });
  await check("superseded-list-cannot-restore-previous-identity", async (page) => {
    const original = await page.request.get(`${f.apiBase}/v1/workspaces?userId=WEB-OPERATOR`, { headers: { 'x-traqen-api-token': f.token } });
    assert.equal(original.status(), 200);
    const originalBody = await original.json();
    let firstRoute;
    await page.route(`${f.apiBase}/v1/workspaces?**`, (route) => {
      if (!firstRoute) { firstRoute = route; return; }
      return route.fulfill({ status: 401, json: { error: { code: "UNAUTHORIZED" } } });
    });
    const pending = page.waitForRequest((request) => request.url().startsWith(`${f.apiBase}/v1/workspaces?`));
    await reconnect(page); await pending;
    await page.locator(".workspace-connection [role=status]").waitFor();
    assert.ok(firstRoute);
    assert.equal(await page.locator('#workspace-switcher option:not([value=""])').count(), 0);
    const cancelled = page.waitForEvent("requestfailed", { predicate: (request) => request === firstRoute.request() });
    await page.locator("#workspace-access-token").fill("isolated-invalid-identity");
    await reconnect(page);
    await firstRoute.fulfill({ status: 200, json: originalBody });
    assert.match((await cancelled).failure().errorText, /ABORTED|CANCEL/i);
    await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
    assert.equal(await page.locator('#workspace-switcher option:not([value=""])').count(), 0);
    assert.equal(await page.locator(".connection-button.healthy").count(), 0);
  });
  report.status = results.every(({ passed }) => passed) ? "PASSED" : "FAILED";
  if (report.status !== "PASSED") process.exitCode = 1;
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

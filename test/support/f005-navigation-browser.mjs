// Real rendered navigation against an owned PostgreSQL/Git fixture; no production data.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserFixture } from "./source-truth-browser-fixture.js";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(evidenceDirectory));
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], results = [], pageErrors = [];
const report = { status: "RUNNING", scope: "ISOLATED_F005_NAVIGATION_F001_UX", results };
let page;
try {
  const f = await browserFixture({ after: (fn) => cleanups.push(fn) });
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close());
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(f.webOrigin);
  await page.getByText("需要访问令牌", { exact: true }).waitFor();
  await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
  assert.equal(new URL(page.url()).searchParams.get("page"), "sources", "navigation must create a deep link even before authentication");
  await page.getByRole("heading", { name: "来源快照", exact: true }).waitFor();
  assert.equal(await page.locator('.nav-button[aria-current="page"]').textContent().then(s => s.trim()), "来源快照");
  results.push({ case: "anonymous-navigation-has-destination-url-and-heading", passed: true });
  const destinations = [["overview", "工作区概览"], ["sources", "来源快照"], ["evidence", "技术证据"], ["graph", "业务图谱"], ["impact", "变更影响"], ["settings", "设置中心"]];
  for (const [key, name] of destinations) {
    const link = page.locator(".sidebar .nav-button").filter({ hasText: name });
    await link.focus(); await page.keyboard.press("Enter");
    assert.equal(new URL(page.url()).searchParams.get("page"), key);
    await page.getByRole("heading", { name, exact: true }).waitFor();
    assert.equal(await link.getAttribute("aria-current"), "page");
    assert.notEqual(await link.evaluate(node => getComputedStyle(node).outlineStyle), "none");
  }
  await page.goBack(); await page.getByRole("heading", { name: "变更影响", exact: true }).waitFor();
  await page.goForward(); await page.getByRole("heading", { name: "设置中心", exact: true }).waitFor();
  await page.reload(); await page.getByRole("heading", { name: "设置中心", exact: true }).waitFor();
  results.push({ case: "all-six-destinations-keyboard-focus-history-and-refresh-before-auth", passed: true });

  await page.goto(`${f.webOrigin}/?page=sources&workspace=directory`);
  await page.getByText("需要访问令牌", { exact: true }).waitFor();
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(f.token);
  await page.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  assert.equal(await page.getByLabel("切换工作区", { exact: true }).inputValue(), "directory");
  results.push({ case: "authenticated-deep-link-selects-exact-workspace-and-source-page", passed: true });

  for (const name of ["技术证据", "业务图谱", "变更影响"]) {
    await page.locator(".sidebar .nav-button").filter({ hasText: name }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
    await page.getByRole("heading", { name: "当前没有可读取的发布结果", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "重新读取结果", exact: true }).count(), 1);
    await page.getByRole("button", { name: "查看来源快照", exact: true }).click();
    await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  }
  results.push({ case: "authenticated-unavailable-destinations-explain-state-and-offer-working-next-action", passed: true });

  const geometry = () => page.evaluate(() => {
    const shell = document.querySelector(".app-shell").getBoundingClientRect();
    const scale = shell.width / 1440;
    const nodes = [".sidebar", ".topbar", ".st-heading", ".st-metro", ".st-current", ".st-side"];
    return { scale, text: document.querySelector(".st-workbench").innerText, boxes: Object.fromEntries(nodes.map(selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect();
      return [selector, { x: (r.x - shell.x) / scale, y: (r.y - shell.y) / scale, width: r.width / scale, height: r.height / scale, font: getComputedStyle(el).fontSize }];
    })) };
  });
  report.comparisons = [];
  for (const theme of ["light", "dark"]) {
    await page.getByRole("combobox", { name: "全局主题配色", exact: true }).selectOption(theme);
    let baseline;
    for (const [label, width, height] of [["14", 1440, 900], ["27", 2560, 1440]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(expected => Math.abs(document.querySelector(".app-shell").getBoundingClientRect().width / 1440 - expected) < .001, label === "14" ? 1 : 1.6);
      const state = await geometry();
      await page.screenshot({ path: path.join(evidenceDirectory, `sources-${label}-${theme}.png`) });
      report.comparisons.push({ theme, label, ...state });
      if (!baseline) baseline = state;
      else {
        assert.equal(state.text, baseline.text, "desktop size must not add or hide content");
        for (const [selector, box] of Object.entries(baseline.boxes)) {
          assert.equal(state.boxes[selector].font, box.font);
          for (const dimension of ["x", "y", "width", "height"]) assert.ok(Math.abs(state.boxes[selector][dimension] - box[dimension]) < .75, `${selector} ${dimension} must scale uniformly`);
        }
      }
    }
  }
  results.push({ case: "same-source-state-light-dark-and-uniform-14-27-scaling", passed: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("来源名称", { exact: true }).fill("未保存来源编辑");
  await page.locator(".sidebar .nav-button").filter({ hasText: "技术证据" }).click();
  await page.locator(".sidebar .nav-button").filter({ hasText: "来源快照" }).click();
  assert.equal(await page.getByLabel("来源名称", { exact: true }).inputValue(), "未保存来源编辑");
  await page.goBack(); await page.goForward();
  assert.equal(await page.getByLabel("来源名称", { exact: true }).inputValue(), "未保存来源编辑");
  page.once("dialog", dialog => dialog.dismiss());
  await page.getByLabel("切换工作区", { exact: true }).selectOption("git");
  assert.equal(await page.getByLabel("切换工作区", { exact: true }).inputValue(), "directory");
  assert.equal(await page.getByLabel("来源名称", { exact: true }).inputValue(), "未保存来源编辑");
  page.once("dialog", dialog => dialog.accept());
  await page.getByLabel("切换工作区", { exact: true }).selectOption("git");
  await page.waitForFunction(() => document.querySelector("#workspace-switcher").value === "git");
  await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("workspace"), "git");
  results.push({ case: "draft-survives-navigation-and-workspace-switch-requires-disposition", passed: true });
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
  await page.getByLabel("版本或分支", { exact: true }).fill(f.source.commitA);
  await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).click();
  await page.getByRole("button", { name: "确认范围并开始", exact: true }).click();
  await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).waitFor({ timeout: 45000 });
  await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).check();
  await page.getByRole("button", { name: "确认清单与缺口", exact: true }).click();
  await page.getByRole("button", { name: "冻结包", exact: true }).click();
  await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor({ timeout: 45000 });
  const history = await f.read("git", "/history/bundles?limit=50");
  assert.equal(history.items.length, 1);
  report.bundle = history.items[0].id;
  await page.getByRole("button", { name: "查看冻结版本", exact: true }).click();
  await page.screenshot({ path: path.join(evidenceDirectory, "frozen-history.png") });
  results.push({ case: "real-git-eight-stations-freeze-and-history", passed: true });
  await page.reload();
  await page.getByText("需要访问令牌", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("workspace"), "git");
  assert.equal(await page.getByRole("combobox", { name: "全局主题配色", exact: true }).inputValue(), "dark");
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(f.token);
  await page.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor();
  assert.equal((await f.read("git", "/history/bundles?limit=50")).items[0].id, report.bundle);
  results.push({ case: "refresh-restores-page-workspace-theme-and-durable-frozen-history", passed: true });
  await page.getByLabel("切换工作区", { exact: true }).selectOption("directory");
  await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  await page.getByLabel("切换工作区", { exact: true }).selectOption("git");
  await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor();
  await page.goBack();
  await page.waitForFunction(() => document.querySelector("#workspace-switcher").value === "directory");
  await page.goForward();
  await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor();
  assert.equal(await page.getByLabel("切换工作区", { exact: true }).inputValue(), "git");
  results.push({ case: "browser-history-restores-exact-workspace-and-its-source-session", passed: true });
  await page.goto(`${f.webOrigin}/?page=not-a-page&workspace=git`);
  await page.getByRole("heading", { name: "无法识别这个页面", exact: true }).waitFor();
  assert.equal(await page.locator('.sidebar [aria-current="page"]').count(), 0);
  await page.goto(`${f.webOrigin}/?page=sources&workspace=not-accessible`);
  await page.getByText("需要访问令牌", { exact: true }).waitFor();
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(f.token);
  await page.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.getByText("当前身份无法打开链接中的工作区。请选择一个可访问的工作区，或联系管理员核对访问权限。", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("切换工作区", { exact: true }).inputValue(), "");
  assert.equal(new URL(page.url()).searchParams.get("workspace"), "not-accessible");
  results.push({ case: "unknown-page-and-inaccessible-workspace-never-silently-fall-back", passed: true });
  assert.deepEqual(pageErrors, []);
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    report.page = await page.locator("body").innerText();
    await page.screenshot({ path: path.join(evidenceDirectory, "failure.png") });
  }
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
  await writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(report));
}

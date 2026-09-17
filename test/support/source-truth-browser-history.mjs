// Read-only UI load against three COMPLETE captured 100k-file versions.
// This does not test browser capture, the native picker, or disaster deployment.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { platform, release } from "node:os";
import { browserHistoryFixture } from "./source-truth-browser-history-fixture.js";

const [modulePath, executablePath, evidenceDirectory, pilotRoot, clusterRoot, binaries] = process.argv.slice(2);
assert.ok([modulePath, executablePath, evidenceDirectory, pilotRoot, clusterRoot, binaries].every((value) => value && path.isAbsolute(value)));
const bundleIds = ["be15695e00830de24ec09f4dbde7daee6306a9fd4e3fc5a3f43cf72faba61026", "b31723f1d01529355f7444fa111b80c4472bff7ab8cfc9b93aaefbadf1294add", "37d1734b353bbdbc1f58b1b40d9433424bb696e044fddb5ddf3e67f48cedf664"];
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], measurements = [], requests = [], mutations = [], pageErrors = [];
const report = { status: "RUNNING", scope: "RETAINED_39d6247_100K_READ_ONLY_BROWSER_HISTORY", platform: platform(), release: release(),
  nativePickerVerified: false, browserCaptureVerified: false, disasterDeploymentVerified: false, totalFilesPerVersion: 100000, bundleIds, measurements };
const save = () => writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
let page;
try {
  console.log(JSON.stringify({ phase: "clone-owned-cold-fixture", state: "STARTED" }));
  const f = await browserHistoryFixture({ after: (fn) => cleanups.push(fn) }, { pilotRoot, clusterRoot, binaries, expectedBundleIds: bundleIds, expectedFiles: 100000 });
  report.fixtureRoot = f.root; report.sourceReportHash = f.sourceReportHash;
  console.log(JSON.stringify({ phase: "clone-owned-cold-fixture", state: "FINISHED", root: f.root }));
  const originalHistory = await f.read("/history/bundles?limit=50");
  assert.equal(originalHistory.items.length, 3);
  for (const item of originalHistory.items) assert.equal(item.counts.fileCount, "100000");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => { if (request.url().startsWith(f.apiBase)) requests.push({ method: request.method(), url: request.url() }); });
  await page.route("http://127.0.0.1:3100/**", (route) => route.abort());
  await page.route(`${f.apiBase}/**`, (route) => {
    if (["GET", "OPTIONS"].includes(route.request().method())) return route.continue();
    mutations.push({ method: route.request().method(), url: route.request().url() }); return route.abort();
  });
  const connect = async () => {
    await page.goto(f.webOrigin);
    await page.waitForSelector(".connection-button.unavailable");
    await page.getByTitle("部署诊断", { exact: true }).click();
    await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
    await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill(f.token);
    await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
    await page.waitForSelector(".connection-button.healthy");
    await page.locator(".diagnostic-drawer header button").click();
    await page.locator(".workspace-project-open").filter({ has: page.locator("strong", { hasText: /^Workspace$/ }) }).click();
    await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
    await page.getByText("当前成员为只读权限，可查看历史与证据，不能创建任务、上传、确认或冻结。", { exact: true }).waitFor();
  };
  const view = () => page.locator(".st-version-view");
  const selectVersion = async (id) => {
    await page.locator(".st-history-columns > div").first().locator(".st-history-row").filter({ hasText: id.slice(0, 12) }).click();
    await view().getByRole("heading", { name: `冻结包 ${id.slice(0, 12)}…`, exact: true }).waitFor();
    await view().getByRole("button", { name: "完整材料清单", exact: true }).click();
    await view().locator("tbody tr").first().waitFor();
  };
  const measure = async (name, since) => {
    const value = await page.evaluate(() => ({ domNodes: document.querySelectorAll("*").length,
      renderedRows: document.querySelectorAll(".st-version-view tbody tr").length,
      browserHeapBytes: performance.memory?.usedJSHeapSize ?? null }));
    assert.ok(value.renderedRows <= 100, "a bounded page must not render the entire 100k inventory");
    assert.ok(value.domNodes < 5000, "history UI DOM must stay bounded");
    measurements.push({ name, milliseconds: Math.round(performance.now() - since), ...value }); await save();
    console.log(JSON.stringify({ phase: name, state: "FINISHED", ...measurements.at(-1) }));
  };
  const search = async (text, count) => {
    await view().getByLabel("路径搜索", { exact: true }).fill(text);
    await view().getByRole("button", { name: "搜索清单", exact: true }).click();
    await view().getByText(`当前筛选匹配 ${count} 项 · 本页 ${Math.min(count, 100)} 项`, { exact: true }).waitFor();
  };
  await connect();
  for (const id of bundleIds) {
    const since = performance.now();
    await selectVersion(id);
    const version = originalHistory.items.find((item) => item.id === id), entries = Number(version.counts.fileCount) + Number(version.counts.directoryCount);
    await view().getByText(`当前筛选匹配 ${entries} 项 · 本页 100 项`, { exact: true }).waitFor();
    assert.equal(await view().locator("tbody tr").count(), 100);
    const firstPath = await view().locator("tbody tr").first().innerText();
    const nextPage = page.waitForResponse((response) => response.url().includes("/inventory-history?") && new URL(response.url()).searchParams.has("cursor"));
    await view().getByRole("button", { name: "下一页", exact: true }).click(); await nextPage;
    await page.waitForFunction((previous) => document.querySelector(".st-version-view tbody tr")?.innerText !== previous, firstPath);
    assert.equal(await view().locator("tbody tr").count(), 100);
    await search("f049999.txt", 1);
    assert.ok((await view().locator("tbody").innerText()).includes("f049999.txt"));
    await measure(`100k-version-${bundleIds.indexOf(id) + 1}-page-and-tail-search`, since);
  }
  await search("new-document.txt", 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 390), true);
  await view().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidenceDirectory, "100k-history-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await view().getByRole("button", { name: "清除筛选", exact: true }).click();
  const third = originalHistory.items.find((item) => item.id === bundleIds[2]);
  for (const component of third.components) {
    const count = Number(component.fileCount) + Number(component.directoryCount);
    await view().getByRole("combobox", { name: "组件筛选", exact: true }).selectOption(component.id);
    await view().getByRole("button", { name: "搜索清单", exact: true }).click();
    await view().getByText(`当前筛选匹配 ${count} 项 · 本页 100 项`, { exact: true }).waitFor();
  }
  await view().getByRole("button", { name: "文件级版本差异", exact: true }).click();
  await view().getByRole("combobox", { name: "从哪个冻结包比较", exact: true }).selectOption(bundleIds[1]);
  await view().getByRole("combobox", { name: "来源", exact: true }).selectOption("directory");
  const deltaStart = performance.now();
  await view().getByRole("button", { name: "比较文件级变化", exact: true }).click();
  await view().getByText(/added 1 · modified 1 · deleted 1/).waitFor();
  assert.equal(await view().locator("tbody tr").count(), 3);
  const differences = await view().locator("tbody").innerText();
  for (const word of ["f000002.txt", "f000003.txt", "new-document.txt", "DELETED", "MODIFIED", "ADDED"]) assert.ok(differences.includes(word));
  await measure("100k-complete-version-delta", deltaStart);
  await view().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(evidenceDirectory, "100k-version-delta.png") });
  await selectVersion(bundleIds[0]); await search("new-document.txt", 0);
  await connect(); await selectVersion(bundleIds[2]); await search("new-document.txt", 1);
  assert.deepEqual(await f.read("/history/bundles?limit=50"), originalHistory);
  await f.assertHistoryUnchanged(); assert.deepEqual(mutations, []); assert.deepEqual(pageErrors, []);
  const inventoryRequests = requests.filter((item) => item.url.includes("/inventory-history?"));
  assert.ok(inventoryRequests.length >= 10);
  for (const item of inventoryRequests) assert.equal(new URL(item.url).searchParams.get("limit"), "100");
  report.status = "PASSED"; report.noMutation = true; report.isolatedCopyUsed = true; report.sourceFixturesReopenedInPlace = false;
  report.inventoryRequestCount = inventoryRequests.length; report.historyAfterReloadVerified = true;
  await save(); console.log(JSON.stringify(report));
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack };
  if (page && !page.isClosed()) {
    try { report.page = await page.locator("body").ariaSnapshot(); await page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true }); }
    catch (diagnostic) { report.diagnosticError = diagnostic.message; }
  }
  await save(); console.error(JSON.stringify(report)); process.exitCode = 1;
} finally { for (const cleanup of cleanups.reverse()) await cleanup(); }

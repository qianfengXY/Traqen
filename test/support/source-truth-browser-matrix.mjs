// Browser UI acceptance with real PostgreSQL/HTTPS Git and browser OPFS handles.
// OPFS exercises native FileSystemHandle reads, NOT the operating-system picker.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { platform, release } from "node:os";
import { browserFixture } from "./source-truth-browser-fixture.js";
import { recoveryJourneys } from "./source-truth-browser-recovery.mjs";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(evidenceDirectory), "expected Playwright module, Chromium executable and absolute evidence directory");
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], results = [], issues = [];
let diagnosticPage;
const report = { status: "RUNNING", platform: platform(), release: release(), nativePickerVerified: false, scale100kBrowserVerified: false, results, issues };
const save = () => writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
try {
  const f = await browserFixture({ after: (fn) => cleanups.push(fn) });
  const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version(); report.fixtureRoot = f.root;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  diagnosticPage = page;
  // Force the unconfigured diagnostic state without contacting another local service.
  await page.route("http://127.0.0.1:3100/**", (route) => route.abort());
  const mutations = [], pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => { if (request.url().startsWith(f.apiBase) && !["GET", "OPTIONS"].includes(request.method())) mutations.push({ method: request.method(), url: request.url() }); });
  const station = async (n) => page.waitForFunction((value) => document.querySelector('.st-rail [aria-current="step"]')?.getAttribute("data-station") === String(value), n, { timeout: 45000 });
  const connect = async (workspace) => {
    await page.goto("http://127.0.0.1:3188/");
    // The SSR diagnostic button is present before React event handlers attach.
    await page.waitForSelector(".connection-button.unavailable");
    await page.getByTitle("部署诊断", { exact: true }).click();
    await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
    await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill(f.token);
    await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
    await page.waitForSelector(".connection-button.healthy");
    await page.locator(".diagnostic-drawer header button").click();
    await page.locator(".workspace-project-open").filter({ has: page.locator("strong", { hasText: new RegExp(`^${f.names[workspace]}$`) }) }).click();
    await page.locator(".nav-button").filter({ hasText: "Workspace 分析" }).click();
    await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  };
  const picker = async (name, count, version = 1) => page.evaluate(async ({ name, count, version }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    await root.getDirectoryHandle("empty", { create: true });
    for (let i = 0; i < count; i++) {
      const file = i === 0 ? "README.md" : `file-${String(i).padStart(3, "0")}.txt`;
      const writer = await (await root.getFileHandle(file, { create: true })).createWritable();
      await writer.write(i === 0 ? `directory version ${version}\n` : `directory evidence ${i}\n`); await writer.close();
    }
    window.showDirectoryPicker = async () => root;
  }, { name, count, version });
  const start = async () => {
    await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).click(); await station(2);
    await page.getByRole("button", { name: "确认范围并开始", exact: true }).click();
  };
  const review = async (gaps = false) => {
    await station(7);
    assert.equal(await page.getByRole("button", { name: "确认清单与缺口", exact: true }).isDisabled(), true);
    if (gaps) {
      // After a remount, textarea child text contains the prior value. Match
      // its accessible name, not the implicit label's value-bearing full text.
      await page.getByRole("textbox", { name: "接受全部非阻断缺口的理由", exact: true }).fill("浏览器试点明确接受未取得的 LFS 外部正文");
      const date = new Date(Date.now() + 3600000);
      const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      await page.locator('.st-current input[type="datetime-local"]').fill(local);
    }
    await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).check();
    await page.getByRole("button", { name: "确认清单与缺口", exact: true }).click(); await station(8);
  };
  const seal = async (workspace) => {
    await page.getByRole("button", { name: "冻结包", exact: true }).click();
    await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor({ timeout: 45000 });
    const history = await f.read(workspace, "/history/bundles?limit=50");
    return history.items[0];
  };
  await connect("directory"); await station(1);
  assert.equal(await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).isDisabled(), true);
  assert.equal(await page.locator(".st-source-card").count(), 2);
  const beforePreview = mutations.length;
  for (let i = 2; i <= 8; i++) {
    await page.getByRole("button", { name: new RegExp(`^第 ${i} 站`) }).click();
    assert.equal(await page.getByRole("button", { name: "冻结包", exact: true }).count(), 0);
  }
  assert.equal(mutations.length, beforePreview);
  await page.getByRole("button", { name: "回到当前 · 第 1 站", exact: true }).click();
  await page.screenshot({ path: path.join(evidenceDirectory, "empty-eight-stations.png"), fullPage: true });
  await page.getByRole("checkbox", { name: "上传目录", exact: true }).check();
  await start(); await station(4);
  const paused = (await f.read("directory")).activeRun;
  assert.equal(paused.status, "WAITING_FOR_CLIENT");
  await connect("directory"); await station(4);
  assert.equal((await f.read("directory")).activeRun.id, paused.id);
  await picker("directory-v1", 105);
  await page.getByRole("button", { name: "重新选择目录并继续", exact: true }).click(); await station(7);
  const completed = await f.read("directory", `/runs/${paused.id}/view`);
  assert.equal(completed.candidate.fileCount, "105"); assert.equal(completed.candidate.directoryCount, "1"); assert.equal(completed.result, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".st-rail").evaluate((rail) => { rail.scrollLeft = 0; });
  await page.getByRole("button", { name: "回到当前 · 第 7 站", exact: true }).click();
  assert.equal(await page.evaluate(() => { const r = document.querySelector(".st-rail").getBoundingClientRect(), s = document.querySelector('.st-rail [aria-current="step"]').getBoundingClientRect(); return s.left >= r.left - 1 && s.right <= r.right + 1 && document.documentElement.scrollWidth === 390; }), true);
  await page.screenshot({ path: path.join(evidenceDirectory, "directory-review-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await review();
  let lost = false;
  await page.route(/\/runs\/[^/]+\/seal$/, async (route) => {
    if (lost) return route.continue();
    lost = true; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed");
  });
  const d1 = await seal("directory"); await page.unroute(/\/runs\/[^/]+\/seal$/);
  assert.equal((await f.read("directory", "/history/bundles?limit=50")).items.length, 1);
  assert.equal((await f.read("directory", "/history/receipts?limit=50")).items.length, 1);
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").first().click();
  await page.getByRole("button", { name: "完整材料清单", exact: true }).click();
  await page.locator(".st-version-view tbody tr").first().waitFor();
  assert.equal(await page.locator(".st-version-view tbody tr").count(), 100);
  await page.locator(".st-version-view").getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".st-version-view tbody tr").length === 6);
  const inventoryView = page.locator(".st-version-view");
  const beforeSearch = mutations.length;
  await inventoryView.getByLabel("路径搜索", { exact: true }).fill("file-104");
  await inventoryView.getByRole("button", { name: "搜索清单", exact: true }).click();
  await inventoryView.getByText("当前筛选匹配 1 项 · 本页 1 项", { exact: true }).waitFor();
  assert.ok((await inventoryView.locator("tbody").innerText()).includes("file-104.txt"));
  await inventoryView.getByRole("button", { name: "清除筛选", exact: true }).click();
  await inventoryView.getByText("当前筛选匹配 106 项 · 本页 100 项", { exact: true }).waitFor();
  await inventoryView.getByRole("combobox", { name: "处置筛选", exact: true }).selectOption("METADATA");
  await inventoryView.getByRole("button", { name: "搜索清单", exact: true }).click();
  await inventoryView.getByText("当前筛选匹配 1 项 · 本页 1 项", { exact: true }).waitFor();
  assert.ok((await inventoryView.locator("tbody").innerText()).includes("empty"));
  assert.equal(mutations.length, beforeSearch, "search and clearing filters are reads only");
  await page.screenshot({ path: path.join(evidenceDirectory, "directory-inventory-filter.png"), fullPage: true });
  results.push({ case: "directory", run: paused.id, bundle: d1.id, files: 105, emptyDirectories: 1, refreshResumedSameRun: true, responseLossRecoveredOneReceipt: lost, inventoryPages: [100, 6], mobileCurrentVisible: true });
  await save();

  await page.getByRole("button", { name: "从选中的冻结包创建新版本", exact: true }).click(); await station(1);
  assert.equal(await page.getByRole("combobox", { name: "版本基线", exact: true }).inputValue(), d1.id);
  await page.getByRole("combobox", { name: "本版处理", exact: true }).selectOption("UPDATE");
  await picker("directory-v1", 105, 2);
  await page.getByRole("button", { name: /^(选择本机目录|重新选择目录)$/ }).click();
  await start(); await review(); const d2 = await seal("directory");
  assert.notEqual(d2.id, d1.id); assert.equal(d2.counts.fileCount, "105");
  assert.equal((await f.read("directory", "/history/bundles?limit=50")).items.length, 2);
  const prior = await f.read("directory", `/bundles/${d1.id}`);
  assert.deepEqual(prior, d1, "new directory capture must not rewrite its selected historical baseline");
  results.push({ case: "directory-new-version", from: d1.id, to: d2.id, fullFiles: 105, priorUnchanged: true }); await save();

  await connect("git"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
  await page.getByLabel("版本或分支", { exact: true }).fill(f.source.commitA);
  await start(); await review(); const g1 = await seal("git");
  assert.equal(g1.components.length, 1); assert.equal(g1.components[0].kind, "GIT");
  assert.equal(g1.components[0].nativeIdentity.commit, f.source.commitA);
  results.push({ case: "git", bundle: g1.id, commit: f.source.commitA, status: g1.latestReceipt.status });
  await save();

  await connect("combined"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
  await page.getByLabel("版本或分支", { exact: true }).fill(f.gapCommit);
  await page.getByRole("checkbox", { name: "上传目录", exact: true }).check();
  await picker("combined-v1", 2);
  await page.getByRole("button", { name: "选择本机目录", exact: true }).click();
  await start(); await review(true); const combined = await seal("combined");
  assert.equal(combined.components.length, 2); assert.equal(combined.latestReceipt.status, "READY_WITH_ACCEPTED_GAPS");
  // Completion describes the run; the immutable Receipt describes accepted gaps.
  const frozenResult = page.locator(".st-current .st-callout").filter({ has: page.getByRole("heading", { name: "冻结包已建立", exact: true }) });
  assert.equal(await frozenResult.count(), 1);
  assert.match(await frozenResult.getAttribute("class"), /\bwarning\b/);
  assert.equal(await frozenResult.getByText("READY_WITH_ACCEPTED_GAPS", { exact: true }).count(), 1);
  assert.equal(await frozenResult.locator("dd").last().innerText(), combined.latestReceipt.gapCount);
  assert.notEqual(combined.latestReceipt.gapCount, "0");
  assert.equal(await page.locator(".st-heading .st-badge").innerText(), "包已冻结 · 当前准入另行核验");
  await page.screenshot({ path: path.join(evidenceDirectory, "combined-frozen-gaps.png"), fullPage: true });
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").first().click();
  await page.getByRole("button", { name: "完整材料清单", exact: true }).click();
  await inventoryView.getByLabel("路径搜索", { exact: true }).fill("README.md");
  await inventoryView.getByRole("button", { name: "搜索清单", exact: true }).click();
  await inventoryView.getByText("当前筛选匹配 2 项 · 本页 2 项", { exact: true }).waitFor();
  for (const component of combined.components) {
    await inventoryView.getByRole("combobox", { name: "组件筛选", exact: true }).selectOption(component.id);
    await inventoryView.getByRole("button", { name: "搜索清单", exact: true }).click();
    await inventoryView.getByText("当前筛选匹配 1 项 · 本页 1 项", { exact: true }).waitFor();
    assert.ok((await inventoryView.locator("tbody").innerText()).includes(component.kind));
  }
  await page.screenshot({ path: path.join(evidenceDirectory, "combined-inventory-components.png"), fullPage: true });
  results.push({ case: "combined", bundle: combined.id, status: combined.latestReceipt.status, gapCount: combined.latestReceipt.gapCount, independentComponents: 2 });
  await save();

  await page.getByRole("button", { name: "凭据与准入", exact: true }).click();
  const oldReceiptHistory = await f.read("combined", `/bundles/${combined.id}/receipts?limit=20`);
  assert.equal(oldReceiptHistory.items.length, 1);
  await page.locator(".st-renewal summary").click();
  const renewalButton = page.getByRole("button", { name: "确认并签发新 Receipt", exact: true });
  assert.equal(await renewalButton.isDisabled(), true);
  await page.getByLabel("重新接受的理由", { exact: true }).fill("同包保留全部缺口，浏览器显式重新接受");
  const expiry = new Date(Date.now() + 7200000);
  await page.getByLabel("新的绝对失效时间（浏览器本地时间）", { exact: true }).fill(new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await page.getByRole("checkbox", { name: /^我重新接受该包完整的/ }).check();
  const issued = page.waitForResponse((response) => response.url().endsWith("/renewals") && response.request().method() === "POST");
  await renewalButton.click(); const renewalResponse = await issued; assert.equal(renewalResponse.status(), 200);
  const newReceipt = (await renewalResponse.json()).receipt;
  assert.notEqual(newReceipt.id, combined.latestReceipt.id); assert.equal(newReceipt.bundleId, combined.id);
  assert.equal(newReceipt.gapSetId, combined.latestReceipt.gapSetId);
  assert.equal(newReceipt.gapCount, combined.latestReceipt.gapCount);
  assert.equal(newReceipt.status, "READY_WITH_ACCEPTED_GAPS");
  const receiptHistory = await f.read("combined", `/bundles/${combined.id}/receipts?limit=20`);
  assert.equal(receiptHistory.items.length, 2);
  assert.deepEqual(receiptHistory.items.find((receipt) => receipt.id === combined.latestReceipt.id), oldReceiptHistory.items[0]);
  assert.equal((await f.read("combined", "/history/bundles?limit=50")).items.length, 1);
  results.push({ case: "same-bundle-renewal", bundle: combined.id, oldReceipt: combined.latestReceipt.id, newReceipt: newReceipt.id, oldReceiptUnchanged: true }); await save();

  await page.locator(".st-auth summary").click();
  await page.getByLabel("成员访问令牌（仅本页内存）", { exact: true }).fill(f.readerToken);
  const beforeReader = mutations.length;
  await page.getByRole("button", { name: "验证并连接", exact: true }).click();
  await page.getByText("当前成员为只读权限，可查看历史与证据，不能创建任务、上传、确认或冻结。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "创建新版本", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "从选中的冻结包创建新版本", exact: true }).count(), 0);
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").first().click();
  assert.equal(await page.locator(".st-renewal").count(), 0);
  await page.getByRole("button", { name: "完整材料清单", exact: true }).click();
  await inventoryView.getByLabel("路径搜索", { exact: true }).fill("README.md");
  await inventoryView.getByRole("button", { name: "搜索清单", exact: true }).click();
  await inventoryView.getByText("当前筛选匹配 2 项 · 本页 2 项", { exact: true }).waitFor();
  assert.equal(mutations.length, beforeReader);
  results.push({ case: "read-only", canSearchHistory: true, noMutation: true, cannotRenewOrCreate: true }); await save();

  await connect("combined");
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").first().click();
  await page.getByRole("button", { name: "从选中的冻结包创建新版本", exact: true }).click(); await station(1);
  await page.getByRole("checkbox", { name: "上传目录", exact: true }).uncheck();
  await start(); await review(true); const gitOnly = await seal("combined");
  assert.equal(gitOnly.components.length, 1); assert.equal(gitOnly.components[0].kind, "GIT");
  const removedDirectory = combined.components.find((component) => component.kind === "DIRECTORY_UPLOAD");
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").first().click();
  await page.getByRole("button", { name: "文件级版本差异", exact: true }).click();
  const baselineSelect = inventoryView.getByRole("combobox", { name: "从哪个冻结包比较", exact: true });
  const sourceSelect = inventoryView.getByRole("combobox", { name: "来源", exact: true });
  const compareButton = inventoryView.getByRole("button", { name: "比较文件级变化", exact: true });
  const beforeComparison = mutations.length;
  await baselineSelect.selectOption(combined.id);
  assert.equal(await sourceSelect.locator("option").count(), 2);
  await sourceSelect.selectOption(removedDirectory.sourceId);
  assert.match(await sourceSelect.locator("option:checked").innerText(), /来源已移除（仅基线）/);
  await compareButton.click();
  await inventoryView.getByText(/无法逐项对比：SOURCE_REMOVED/).waitFor();
  assert.equal(await inventoryView.locator("tbody tr").count(), 0);
  await page.screenshot({ path: path.join(evidenceDirectory, "delta-removed-source.png"), fullPage: true });
  await baselineSelect.selectOption("");
  assert.equal(await sourceSelect.inputValue(), gitOnly.components[0].sourceId);
  assert.equal(await sourceSelect.locator("option").count(), 1);
  assert.equal(await compareButton.isDisabled(), true);
  assert.equal(await inventoryView.getByText(/无法逐项对比：SOURCE_REMOVED/).count(), 0);
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").filter({ hasText: combined.id.slice(0, 12) }).click();
  await page.getByRole("button", { name: "文件级版本差异", exact: true }).click();
  await baselineSelect.selectOption(gitOnly.id);
  await sourceSelect.selectOption(removedDirectory.sourceId);
  assert.match(await sourceSelect.locator("option:checked").innerText(), /来源新增（仅目标）/);
  await compareButton.click();
  await inventoryView.getByText(/无法逐项对比：SOURCE_ADDED/).waitFor();
  assert.equal(await inventoryView.locator("tbody tr").count(), 0);
  assert.equal(mutations.length, beforeComparison, "version comparison and selection changes are GET-only");
  const finalHistory = await f.read("combined", "/history/bundles?limit=50");
  assert.deepEqual(finalHistory.items.find((item) => item.id === gitOnly.id), gitOnly);
  const previousCombined = finalHistory.items.find((item) => item.id === combined.id);
  assert.deepEqual(previousCombined.components, combined.components);
  assert.equal(previousCombined.latestReceipt.id, newReceipt.id);
  results.push({ case: "source-component-delta", from: combined.id, to: gitOnly.id, removedSource: removedDirectory.sourceId,
    removalAndReverseAdditionVisible: true, noFileDeletionClaim: true, invalidBaselineSelectionCleared: true, noMutation: true }); await save();

  await connect("blocked"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
  await page.getByLabel("版本或分支", { exact: true }).fill(f.source.commitA);
  await page.getByLabel("目录根（留空代表全仓库）", { exact: true }).fill("missing-root");
  await start();
  await page.waitForFunction(() => document.querySelector(".st-heading .st-badge")?.textContent?.includes("阻断"), null, { timeout: 30000 });
  assert.equal((await f.read("blocked", "/history/bundles?limit=50")).items.length, 0);
  assert.equal((await f.read("blocked", "/history/receipts?limit=50")).items.length, 0);
  assert.equal(await page.getByRole("button", { name: "冻结包", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "确认清单与缺口", exact: true }).count(), 0);
  results.push({ case: "blocked-root", bundles: 0, receipts: 0, noAcceptBypass: true });
  await recoveryJourneys({ f, page, station, connect, picker, start, review, seal, mutations, evidenceDirectory,
    directoryBaseline: d2, gitBaseline: g1, record: async (result) => { results.push(result); await save(); } });
  assert.equal(mutations.some(({ url }) => /analysis-jobs|understanding-runs/.test(url)), false);
  assert.deepEqual(pageErrors, []);
  report.status = issues.length ? "GAPS_FOUND" : "PASSED"; report.noAutomaticAnalysis = true;
  await save(); console.log(JSON.stringify(report));
  if (issues.length) process.exitCode = 1;
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack };
  if (diagnosticPage && !diagnosticPage.isClosed()) {
    try {
      report.page = { url: diagnosticPage.url(), accessibility: await diagnosticPage.locator("body").ariaSnapshot() };
      await diagnosticPage.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true });
    } catch (diagnosticError) { report.diagnosticError = diagnosticError.message; }
  }
  await save(); console.error(JSON.stringify(report)); process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) await cleanup();
}

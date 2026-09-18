// B-13 small-fixture UI boundaries. Native OPFS handles, not an OS picker test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserFixture } from "./source-truth-browser-fixture.js";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && path.isAbsolute(evidenceDirectory));
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const cleanups = [], results = [], mutations = [], pageErrors = [];
const report = { status: "RUNNING", scope: "B13_SMALL_FIXTURES_NOT_SCALE_ACCEPTANCE", platform: platform(), release: release(),
  nativePickerVerified: false, scale100kBrowserVerified: false, results };
const save = () => writeFile(path.join(evidenceDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
let page;
try {
  const f = await browserFixture({ after: (fn) => cleanups.push(fn) });
  report.fixtureRoot = f.root;
  report.sources = await Promise.all(["test/support/source-truth-browser-empty.mjs", "test/support/source-truth-browser-fixture.js",
    "web/app/source-truth/empty-git.ts", "web/app/source-truth/types.ts", "web/app/source-truth/workbench.tsx", "web/app/source-truth/version-view.tsx"].map(async (name) => ({
    path: name, sha256: createHash("sha256").update(await readFile(new URL(`../../${name}`, import.meta.url))).digest("hex"),
  })));
  // Replace only this newly owned fixture's Git INDEX with an empty tree.
  // No user files are removed; source commits remain addressable via HTTPS.
  await f.source.git("read-tree", "--empty");
  await f.source.git("commit", "-m", "B13 empty tree");
  await f.source.git("push", path.join(f.source.root, "repo.git"), "main");
  const emptyCommit = await f.source.git("rev-parse", "HEAD");
  assert.equal(await f.source.git("ls-tree", "-r", emptyCommit), "");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("http://127.0.0.1:3100/**", (route) => route.abort());
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (request.url().startsWith(f.apiBase) && !["GET", "OPTIONS"].includes(request.method())) mutations.push({ method: request.method(), url: request.url() });
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  const station = (n) => page.waitForFunction((value) => document.querySelector('.st-rail [aria-current="step"]')?.getAttribute("data-station") === String(value), n, { timeout: 45000 });
  const screenshot = (name) => page.screenshot({ path: path.join(evidenceDirectory, `${name}.png`), fullPage: true });
  const record = async (value) => { results.push(value); await save(); };
  const connect = async (workspace) => {
    await page.goto(f.webOrigin);
    await page.waitForSelector(".connection-button.unavailable");
    await page.getByTitle("部署诊断", { exact: true }).click();
    await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
    await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill(f.token);
    await button("重新连接并刷新").click(); await page.waitForSelector(".connection-button.healthy");
    await page.locator(".diagnostic-drawer header button").click();
    await page.getByLabel("切换工作区", { exact: true }).selectOption(workspace);
    await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
    await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  };
  const start = async () => { await button("保存来源，确认范围").click(); await station(2); await button("确认范围并开始").click(); };
  const seal = async (workspace, emptyGit = false) => {
    await station(7);
    if (emptyGit) {
      await page.locator('.st-source-line').getByText('已确认空 Git 版本，0 个文件', { exact: true }).waitFor({ timeout: 1500 });
      await screenshot(`${workspace}-empty-review`);
    } else assert.equal(await page.getByText('已确认空 Git 版本，0 个文件', { exact: true }).count(), 0);
    assert.equal(await button("确认清单与缺口").isDisabled(), true);
    await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).check();
    await button("确认清单与缺口").click(); await station(8);
    if (emptyGit) await page.locator('.st-source-line').getByText('已确认空 Git 版本，0 个文件', { exact: true }).waitFor({ timeout: 1500 });
    await button("冻结包").click();
    await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor({ timeout: 45000 });
    return (await f.read(workspace, "/history/bundles?limit=50")).items[0];
  };
  const gitInput = async (commit) => {
    await page.getByLabel("仓库 HTTPS 地址", { exact: true }).fill(f.source.url);
    await page.getByLabel("版本或分支", { exact: true }).fill(commit);
  };
  const selectVersion = async (version) => {
    await page.locator(".st-history-columns > div").first().locator(".st-history-row").filter({ hasText: version.id.slice(0, 12) }).click();
    await page.locator(".st-version-view").getByRole("heading", { name: `冻结包 ${version.id.slice(0, 12)}…`, exact: true }).waitFor();
  };
  const assertEmptyGit = async (workspace, version) => {
    assert.equal(version.counts.fileCount, "0"); assert.equal(version.counts.directoryCount, "0");
    assert.equal(version.components[0].nativeIdentity.commit, emptyCommit);
    assert.equal(version.latestReceipt.status, "READY");
    await selectVersion(version); await button("核验当前准入").click();
    await page.locator('.st-version-view').getByText('已确认空 Git 版本，0 个文件', { exact: true }).waitFor({ timeout: 1500 });
    const identities = page.locator('.st-version-view .st-source-line');
    await identities.getByText(emptyCommit, { exact: true }).waitFor();
    await identities.getByText(version.components[0].manifestId, { exact: true }).waitFor();
    await identities.getByText('全仓库', { exact: true }).waitFor();
    await page.getByText(/本次核验通过；凭据/).waitFor();
    await button("完整材料清单").click();
    await page.locator(".st-version-view").getByText("当前筛选匹配 0 项 · 本页 0 项", { exact: true }).waitFor();
    const inventory = await f.read(workspace, `/bundles/${version.id}/inventory-history?receiptId=${version.latestReceipt.id}&limit=100`);
    assert.equal(inventory.matchedCount, "0"); assert.deepEqual(inventory.items, []); assert.equal(inventory.nextCursor, null);
  };

  await connect("git"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await gitInput(f.source.commitA); await start(); const original = await seal("git");
  assert.equal(original.counts.fileCount, "2"); assert.equal(original.counts.directoryCount, "1");
  await button("创建新版本").click(); await station(1);
  await page.getByRole("combobox", { name: "本版处理", exact: true }).selectOption("UPDATE");
  await gitInput(emptyCommit); await start(); const empty = await seal("git", true);
  await assertEmptyGit("git", empty);
  const deltaQuery = new URLSearchParams({ fromBundleId: original.id, toBundleId: empty.id, sourceId: original.components[0].sourceId, limit: "1" });
  const deleted = []; let cursor = null;
  do {
    const value = await f.read("git", `/delta?${deltaQuery}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    assert.equal(value.comparable, true);
    assert.deepEqual(value.counts, { added: "0", modified: "0", deleted: "3", unchanged: "0" });
    deleted.push(...value.items); cursor = value.nextCursor;
    assert.ok(deleted.length <= 3, "bounded empty-tree delta must make progress");
  } while (cursor);
  assert.equal(deleted.length, 3);
  assert.ok(deleted.every((row) => row.change === "DELETED" && row.before.bundleId === original.id && row.after === null));
  assert.deepEqual(deleted.map((row) => Buffer.from(row.pathBytes, "base64url").toString()), ["README.md", "src", "src/orders.js"]);
  await button("文件级版本差异").click();
  await page.getByRole("combobox", { name: "从哪个冻结包比较", exact: true }).selectOption(original.id);
  await button("比较文件级变化").click();
  await page.getByText("added 0 · modified 0 · deleted 3 · unchanged 0（文件与目录条目）", { exact: true }).waitFor();
  assert.equal(await page.locator(".st-version-view tbody tr").count(), 3);
  assert.deepEqual(await f.read("git", `/bundles/${original.id}`), original);
  await screenshot("git-full-deletion");
  await record({ case: "git-full-deletion", from: original.id, to: empty.id, commit: emptyCommit, fileCount: "0", directoryCount: "0", deletedEntries: 3, deltaPages: 3, originalUnchanged: true, explicitEmptyNoticeAtReviewSealAndHistory: true });

  await connect("blocked"); await station(1);
  await page.getByRole("checkbox", { name: "Git 仓库", exact: true }).check();
  await gitInput(emptyCommit); await start(); const firstEmpty = await seal("blocked", true);
  await assertEmptyGit("blocked", firstEmpty); await screenshot("empty-git-first-version");
  await record({ case: "empty-git-first-version", bundle: firstEmpty.id, commit: emptyCommit, emptyInventory: true, admissionVerified: true, explicitEmptyNoticeAtReviewSealAndHistory: true });

  const picker = (name, withZeroByteFile) => page.evaluate(async ({ name, withZeroByteFile }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
    await root.getDirectoryHandle("empty-child", { create: true });
    if (withZeroByteFile) { const writer = await (await root.getFileHandle("zero.txt", { create: true })).createWritable(); await writer.close(); }
    window.showDirectoryPicker = async () => root;
  }, { name, withZeroByteFile });
  const assertNoEmptyDirectoryPublication = async (expectedBundles) => {
    await page.getByText("所选目录必须含至少一个文件；全部删除不能发布为空目录版本", { exact: true }).waitFor();
    assert.equal(await page.getByText('已确认空 Git 版本，0 个文件', { exact: true }).count(), 0);
    assert.equal(await button("确认清单与缺口").count(), 0); assert.equal(await button("冻结包").count(), 0);
    assert.equal((await f.read("directory", "/history/bundles?limit=50")).items.length, expectedBundles);
    assert.equal((await f.read("directory", "/history/receipts?limit=50")).items.length, expectedBundles);
    const run = (await f.read("directory")).activeRun;
    assert.equal(run.status, "WAITING_FOR_CLIENT");
    const detail = await f.read("directory", `/runs/${run.id}/view`);
    assert.equal(detail.sources[0].manifestId, null); assert.equal(detail.candidate, null);
    assert.equal((await f.read("directory", `/runs/${run.id}/sources/${run.input.sources[0].sourceId}/entries?limit=100`)).items.length, 0);
    return run;
  };
  await connect("directory"); await station(1);
  await page.getByRole("checkbox", { name: "上传目录", exact: true }).check();
  await picker("first-empty", false); await button("选择本机目录").click(); await start();
  const rejectedFirst = await assertNoEmptyDirectoryPublication(0); await screenshot("empty-directory-first-rejected");
  await record({ case: "empty-directory-first-rejected", run: rejectedFirst.id, bundles: 0, receipts: 0, manifestClosed: false });
  await picker("one-zero-byte-file", true); await button("重新选择目录并继续").click();
  const directory = await seal("directory"); assert.equal(directory.counts.fileCount, "1");
  assert.equal((await f.read("directory", `/runs/${rejectedFirst.id}/view`)).run.status, "SUCCEEDED");
  await button("创建新版本").click(); await station(1);
  await page.getByRole("combobox", { name: "本版处理", exact: true }).selectOption("UPDATE");
  await picker("replacement-empty", false);
  await button("重新选择目录").click(); await start();
  const rejectedReplacement = await assertNoEmptyDirectoryPublication(1);
  assert.deepEqual(await f.read("directory", `/bundles/${directory.id}`), directory);
  await screenshot("empty-directory-replacement-rejected");
  await record({ case: "empty-directory-replacement-rejected", run: rejectedReplacement.id, baseline: directory.id, baselineUnchanged: true, zeroByteFilePreviouslyAccepted: true, noEmptyVersion: true });
  assert.deepEqual(pageErrors, []);
  assert.equal(mutations.some(({ url }) => /analysis-jobs|understanding-runs/.test(url)), false);
  assert.equal(results.length, 4);
  report.status = "PASSED"; report.noAutomaticAnalysis = true;
} catch (error) {
  report.status = "FAILED"; report.failure = { message: error.message, stack: error.stack };
  if (page) { report.page = await page.locator("body").ariaSnapshot().catch(() => "unavailable"); await page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true }).catch(() => {}); }
  process.exitCode = 1;
} finally {
  await save(); for (const cleanup of cleanups.reverse()) await cleanup();
  console.log(JSON.stringify(report));
}

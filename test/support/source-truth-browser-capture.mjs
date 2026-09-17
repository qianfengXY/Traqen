// Full browser enumeration of 50k directory files beside an exact reused 50k Git
// component. OPFS is real browser storage, NOT the OS directory picker. Only a
// fresh copy of a cold, identified test database and blob store receives writes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { browserHistoryFixture } from "./source-truth-browser-history-fixture.js";
import { measurements } from "./source-truth-pilot.js";
import { observeBrowserMemory } from "./source-truth-browser-memory-observer.js";

const [modulePath, executablePath, evidenceDirectory, pilotRoot, clusterRoot, binaries, diagnosticArgument] = process.argv.slice(2);
assert.ok([modulePath, executablePath, evidenceDirectory, pilotRoot, clusterRoot, binaries].every((v) => v && path.isAbsolute(v)));
assert.ok(diagnosticArgument === undefined || diagnosticArgument === "--heap-diagnostic");
const heapDiagnostic = diagnosticArgument === "--heap-diagnostic";
const bundleIds = ["be15695e00830de24ec09f4dbde7daee6306a9fd4e3fc5a3f43cf72faba61026", "b31723f1d01529355f7444fa111b80c4472bff7ab8cfc9b93aaefbadf1294add", "37d1734b353bbdbc1f58b1b40d9433424bb696e044fddb5ddf3e67f48cedf664"];
const changedText = "browser changed document v3\n", expectedSent = Buffer.byteLength(changedText);
const changedPath = Buffer.from("materials/g0000/f000003.txt").toString("base64url");
const cleanups = [], phases = [], pageErrors = [], issues = [], measured = measurements();
const network = { manifestBatches: 0, maxBatchEntries: 0, enumeratedFiles: 0, enumeratedDirectories: 0, completeFileRequests: 0,
  chunkRequests: 0, sentBytes: 0, runCreates: 0, confirmations: 0, seals: 0, otherWrites: [] };
const report = { status: "RUNNING", scope: "BROWSER_OPFS_50K_FULL_ENUMERATION_INCREMENTAL_CAPTURE_WITH_REUSED_50K_GIT", platform: platform(), release: release(),
  acceptanceGate: !heapDiagnostic, allocationSamplingDiagnostic: heapDiagnostic, explicitGcDiagnostic: false,
  nativePickerVerified: false, initialFullUploadVerified: false, disasterDeploymentVerified: false, priorBundleIds: bundleIds,
  totalFiles: 100000, phases, network, budgets: { maxTreeRssBytes: 1073741824, maxTreeFileDescriptors: 1024 } };
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const save = () => writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
let page, memoryObserver, activePhase = "initialization";
const recordMemory = async (name) => {
  if (!memoryObserver) return;
  const { allocationProfile, ...memory } = await memoryObserver.snapshot();
  const allocationProfileFile = `heap-${name}.json`;
  await writeFile(path.join(evidenceDirectory, allocationProfileFile), `${JSON.stringify(allocationProfile)}\n`, { mode: 0o600 });
  await measured.sample();
  report.memoryObservations ??= [];
  report.memoryObservations.push({ name, at: new Date().toISOString(), ...memory, allocationProfileFile,
    treeRssBytes: measured.result.latestProcessTreeRssBytes, processes: measured.result.latestRssProcesses });
  await save();
};
const pulse = setInterval(() => console.log(JSON.stringify({ phase: activePhase, state: "RUNNING", network, resources: measured.result })), 10000);
pulse.unref();
const stage = async (name, work) => {
  activePhase = name; console.log(JSON.stringify({ phase: name, state: "STARTED" })); const start = performance.now();
  const value = await work();
  await measured.sample();
  const browserState = page && !page.isClosed() ? await page.evaluate(() => ({
    domNodes: document.querySelectorAll("*").length,
    // Chromium's exposed heap figure may be coarsened; this is attribution,
    // not an exact peak or an alternative to the unchanged process-tree budget.
    coarseJsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
  })) : null;
  phases.push({ name, milliseconds: Math.round(performance.now() - start),
    resourcesAtEnd: { treeRssBytes: measured.result.latestProcessTreeRssBytes,
      processes: measured.result.latestRssProcesses, browserState } });
  await recordMemory(name);
  await save(); console.log(JSON.stringify({ phase: name, state: "FINISHED", ...phases.at(-1) })); return value;
};
try {
  const f = await stage("clone-owned-cold-fixture", () => browserHistoryFixture({ after: (fn) => cleanups.push(fn) },
    { pilotRoot, clusterRoot, binaries, expectedBundleIds: bundleIds, expectedFiles: 100000, access: "MAINTAIN" }));
  report.fixtureRoot = f.root; report.sourceReportHash = f.sourceReportHash;
  assert.equal((await f.read("")).role, "MAINTAIN");
  const prior = await f.read("/history/bundles?limit=50");
  const base = prior.items.find((item) => item.id === bundleIds[2]);
  assert.ok(base); assert.equal(base.counts.fileCount, "100000");
  const previousGit = base.components.find((component) => component.kind === "GIT");
  const previousDirectory = base.components.find((component) => component.kind === "DIRECTORY_UPLOAD");
  assert.equal(previousGit.fileCount, "50000"); assert.equal(previousDirectory.fileCount, "50000");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  const browser = await chromium.launch({ executablePath, headless: true });
  cleanups.push(() => browser.close()); report.browser = browser.version();
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  if (heapDiagnostic) {
    memoryObserver = await observeBrowserMemory(await page.context().newCDPSession(page), await browser.newBrowserCDPSession());
    cleanups.push(async () => {
      // Diagnostic failure must not prevent closing our browser and copied PG.
      try { await memoryObserver.stop(); }
      catch (error) {
        report.memoryDiagnosticError = error.message;
        if (report.status !== "FAILED") report.status = "ERROR";
        process.exitCode = 1; await save();
      }
    });
    await recordMemory("browser-start");
  }
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("http://127.0.0.1:3100/**", (route) => route.abort());
  await page.route(`${f.apiBase}/**`, (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (["GET", "OPTIONS"].includes(method)) return route.continue();
    // Refuse accidental F002 work or any write outside the one copied Workspace.
    if (!url.pathname.startsWith("/v1/workspaces/workspace/source-truth/")) {
      network.otherWrites.push({ method, path: url.pathname }); return route.abort();
    }
    return route.continue();
  });
  page.on("request", (request) => {
    if (!request.url().startsWith(`${f.apiBase}/v1/workspaces/workspace/source-truth/`) || ["GET", "OPTIONS"].includes(request.method())) return;
    try {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/entries")) {
        const body = request.postDataJSON(); network.manifestBatches++;
        network.maxBatchEntries = Math.max(network.maxBatchEntries, body.entries.length);
        for (const entry of body.entries) {
          if (entry.kind === "FILE") network.enumeratedFiles++; else if (entry.kind === "DIRECTORY") network.enumeratedDirectories++;
        }
      } else if (url.pathname.endsWith("/close")) report.closedManifest = request.postDataJSON();
      else if (url.pathname.endsWith("/complete-file") || url.pathname.endsWith("/chunks")) {
        if (url.pathname.endsWith("/complete-file")) network.completeFileRequests++; else network.chunkRequests++;
        const body = request.postDataBuffer(); network.sentBytes += body.length;
        assert.equal(url.searchParams.get("pathBytes"), changedPath); assert.equal(body.toString(), changedText);
      } else if (url.pathname.endsWith("/runs")) network.runCreates++;
      else if (url.pathname.endsWith("/confirm")) network.confirmations++;
      else if (url.pathname.endsWith("/seal")) network.seals++;
    } catch (error) { issues.push(error.message); }
  });
  page.on("response", (response) => { if (response.url().startsWith(`${f.apiBase}/v1/workspaces/workspace/source-truth`) && response.status() >= 400) issues.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  const station = (n, timeout = 45000) => page.waitForFunction((value) => document.querySelector('.st-rail [aria-current="step"]')?.getAttribute("data-station") === String(value), n, { timeout });
    await page.goto(f.webOrigin);
  await page.waitForSelector(".connection-button.unavailable");
  await page.getByTitle("部署诊断", { exact: true }).click();
  await page.getByLabel("API 地址", { exact: true }).fill(f.apiBase);
  await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill(f.token);
  await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
  await page.waitForSelector(".connection-button.healthy"); await page.locator(".diagnostic-drawer header button").click();
  await page.locator(".workspace-project-open").filter({ has: page.locator("strong", { hasText: /^Workspace$/ }) }).click();
    await page.locator(".nav-button").filter({ hasText: "来源快照" }).click();
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").filter({ hasText: base.id.slice(0, 12) }).click();
  await page.getByRole("button", { name: "从选中的冻结包创建新版本", exact: true }).click(); await station(1);
  assert.equal(await page.getByRole("combobox", { name: "版本基线", exact: true }).inputValue(), base.id);
  const gitCard = page.locator(".st-source-card").filter({ has: page.getByRole("checkbox", { name: "Git 仓库", exact: true }) });
  const directoryCard = page.locator(".st-source-card").filter({ has: page.getByRole("checkbox", { name: "上传目录", exact: true }) });
  assert.equal(await gitCard.getByRole("combobox", { name: "本版处理", exact: true }).inputValue(), "REUSE");
  await directoryCard.getByRole("combobox", { name: "本版处理", exact: true }).selectOption("UPDATE");
  await recordMemory("workbench-ready");
  await page.exposeFunction("f001FixtureProgress", (value) => console.log(JSON.stringify({ phase: "generate-opfs-directory", ...value })));
  report.localFixture = await stage("generate-opfs-directory", () => page.evaluate(async ({ changedText }) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("f001-scale-directory-v3", { create: true });
    await root.getDirectoryHandle("empty-child", { create: true });
    const materials = await root.getDirectoryHandle("materials", { create: true });
    const encoder = new TextEncoder(); let group, knownBytes = 0, files = 0;
    for (let i = 0; i < 50000; i++) {
      if (i % 500 === 0) group = await materials.getDirectoryHandle(`g${String(Math.floor(i / 500)).padStart(4, "0")}`, { create: true });
      if (i === 2) continue; // Same complete D2 baseline: one retained deletion.
      const body = i === 0 ? new Uint8Array(1024 * 1024).fill(68) : encoder.encode(i === 1 ? "" : i === 3 ? changedText
        : i % 10 === 0 ? "shared duplicate material\n" : `directory immutable pilot material ${i}\n`);
      const writer = await (await group.getFileHandle(`f${String(i).padStart(6, "0")}.txt`, { create: true })).createWritable();
      await writer.write(body); await writer.close(); knownBytes += body.byteLength; files++;
      if (i % 5000 === 4999) await window.f001FixtureProgress({ files, knownBytes });
    }
    const text = "new document v2\n", writer = await (await root.getFileHandle("new-document.txt", { create: true })).createWritable();
    await writer.write(text); await writer.close(); knownBytes += encoder.encode(text).byteLength; files++;
    window.showDirectoryPicker = async () => root;
    return { fileCount: files, directoryCount: 102, knownBytes, picker: "OPFS_TEST_HANDLE_NOT_NATIVE_PICKER" };
  }, { changedText }));
  assert.equal(report.localFixture.fileCount, 50000);
  await directoryCard.getByRole("button", { name: "选择本机目录", exact: true }).click();
  await stage("browser-full-enumeration-and-incremental-capture", async () => {
    await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).click(); await station(2);
    await page.getByRole("button", { name: "确认范围并开始", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.st-rail [aria-current="step"]')?.getAttribute("data-station") === "7"
      || Boolean(document.querySelector('.st-workbench .st-callout.danger[role="alert"], .st-heading .st-badge.danger')), null, { timeout: 900000 });
    assert.equal(await page.locator('.st-workbench .st-callout.danger[role="alert"], .st-heading .st-badge.danger').count(), 0, "capture failed; inspect retained page diagnostics");
    await station(7);
    await page.getByText(new RegExp(`^本机完整核对完成；本次传输 ${expectedSent} 字节`)).waitFor();
  });
  assert.equal(network.enumeratedFiles, 50000); assert.equal(network.enumeratedDirectories, 102);
  assert.equal(network.manifestBatches, 101); assert.equal(network.maxBatchEntries, 500);
  assert.equal(report.closedManifest.fileCount, "50000"); assert.equal(report.closedManifest.directoryCount, "102");
  assert.equal(report.closedManifest.knownBytes, String(report.localFixture.knownBytes));
  assert.equal(network.sentBytes, expectedSent); assert.equal(network.completeFileRequests, 1); assert.equal(network.chunkRequests, 0);
  const beforeSeal = await f.read("/history/bundles?limit=50"); assert.deepEqual(beforeSeal, prior);
  const run = (await f.read("")).activeRun; assert.ok(run); report.runId = run.id;
  const detail = await f.read(`/runs/${run.id}/view`);
  assert.equal(detail.candidate.fileCount, "100000"); assert.equal(detail.candidate.gapCount, "0"); assert.equal(detail.result, null);
  assert.equal(detail.sources.find((source) => source.kind === "GIT").mode, "REUSE");
  assert.equal(detail.sources.find((source) => source.kind === "DIRECTORY_UPLOAD").manifestId, report.closedManifest.manifestId);
  assert.equal(await page.getByRole("button", { name: "确认清单与缺口", exact: true }).isDisabled(), true);
  await page.screenshot({ path: path.join(evidenceDirectory, "100k-browser-review.png"), fullPage: true });
  await stage("explicit-confirm-and-freeze", async () => {
    await page.getByRole("checkbox", { name: /^我已核对完整清单/ }).check();
    await page.getByRole("button", { name: "确认清单与缺口", exact: true }).click(); await station(8);
    await page.getByRole("button", { name: "冻结包", exact: true }).click();
    await page.getByRole("heading", { name: "冻结包已建立", exact: true }).waitFor({ timeout: 300000 });
  });
  const history = await f.read("/history/bundles?limit=50"); assert.equal(history.items.length, 4);
  const next = history.items.find((item) => !bundleIds.includes(item.id)); assert.ok(next);
  report.bundleId = next.id; assert.equal(next.counts.fileCount, "100000"); assert.equal(next.latestReceipt.status, "READY");
  assert.deepEqual(next.components.find((component) => component.kind === "GIT"), previousGit);
  const directory = next.components.find((component) => component.kind === "DIRECTORY_UPLOAD");
  assert.notEqual(directory.id, previousDirectory.id); assert.equal(directory.fileCount, "50000"); assert.equal(directory.manifestId, report.closedManifest.manifestId);
  for (const item of prior.items) assert.deepEqual(await f.read(`/bundles/${item.id}`), item);
  await f.assertPriorHistoryUnchanged();
  await page.locator(".st-history-columns > div").first().locator(".st-history-row").filter({ hasText: next.id.slice(0, 12) }).click();
  const view = page.locator(".st-version-view");
  await view.getByRole("button", { name: "文件级版本差异", exact: true }).click();
  await view.getByRole("combobox", { name: "从哪个冻结包比较", exact: true }).selectOption(base.id);
  await view.getByRole("combobox", { name: "来源", exact: true }).selectOption(previousDirectory.sourceId);
  await view.getByRole("button", { name: "比较文件级变化", exact: true }).click();
  await view.getByText(/added 0 · modified 1 · deleted 0/).waitFor();
  assert.equal(await view.locator("tbody tr").count(), 1); assert.match(await view.locator("tbody").innerText(), /f000003\.txt/);
  await view.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(evidenceDirectory, "100k-browser-delta.png") });
  assert.equal(network.runCreates, 1); assert.equal(network.confirmations, 1); assert.equal(network.seals, 1);
  assert.deepEqual(network.otherWrites, []); assert.deepEqual(issues, []); assert.deepEqual(pageErrors, []);
  await measured.stop(); report.resources = measured.result;
  assert.equal(measured.result.samplingErrors, 0); assert.ok(measured.result.sampleCount > 0);
  assert.ok(measured.result.peakObservedProcessTreeRssBytes <= report.budgets.maxTreeRssBytes, "sampled process tree RSS exceeds the unchanged 1GiB budget");
  assert.ok(measured.result.peakObservedProcessTreeFileDescriptors <= report.budgets.maxTreeFileDescriptors, "sampled descriptors exceed the unchanged 1024 budget");
  report.status = heapDiagnostic ? "OBSERVED_NOT_ACCEPTANCE" : "PASSED";
  report.fullBrowserEnumerationVerified = true; report.incrementalBrowserCaptureVerified = true;
  report.priorHistoryUnchanged = true; report.noAutomaticAnalysis = true; report.isolatedCopyUsed = true; report.sourceFixturesReopenedInPlace = false;
  report.changedContentSha256 = createHash("sha256").update(changedText).digest("hex");
  await save(); console.log(JSON.stringify(report));
} catch (error) {
  report.status = "FAILED"; report.failure = { phase: activePhase, message: error.message, stack: error.stack }; report.issues = issues; report.pageErrors = pageErrors;
  report.resources = measured.result;
  try { await recordMemory("failure"); } catch (diagnostic) { report.memoryDiagnosticError = diagnostic.message; }
  if (page && !page.isClosed()) try { report.page = await page.locator("body").ariaSnapshot(); await page.screenshot({ path: path.join(evidenceDirectory, "failure.png"), fullPage: true }); }
  catch (diagnostic) { report.diagnosticError = diagnostic.message; }
  await save(); console.error(JSON.stringify(report)); process.exitCode = 1;
} finally { clearInterval(pulse); await measured.stop(); for (const cleanup of cleanups.reverse()) await cleanup(); }

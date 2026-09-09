// Diagnostic, never an acceptance gate. Uses an ephemeral browser/profile and
// loopback-only module server, no API/database/user directory. Default mode uses
// labeled diagnostic GC; --native-diagnostic uses allocator dumps and teardown,
// without forced GC. Neither mode can pass or replace the unchanged RSS gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "../../web/node_modules/typescript/lib/typescript.js";
import { measurements } from "./source-truth-pilot.js";
import { captureNativeMemory } from "./source-truth-browser-memory-observer.js";

const [modulePath, executablePath, evidenceDirectory, countArgument, mode] = process.argv.slice(2);
assert.ok(mode === undefined || mode === "--native-diagnostic");
const nativeDiagnostic = mode === "--native-diagnostic";
assert.ok([modulePath, executablePath, evidenceDirectory].every((value) => value && path.isAbsolute(value)));
const count = Number(countArgument);
assert.ok(Number.isSafeInteger(count) && count >= 10 && count <= 50000);
const root = fileURLToPath(new URL("../../", import.meta.url));
const modules = new Map([["/", "<!doctype html><title>F001 isolated memory diagnosis</title>"]]);
const report = { status: "RUNNING", acceptanceGate: false, explicitGcDiagnostic: !nativeDiagnostic,
  nativeAllocatorDiagnostic: nativeDiagnostic,
  platform: platform(), release: release(), files: count, sources: {}, diagnosticSources: {}, stages: [] };
for (const name of ["source-truth-browser-memory.mjs", "source-truth-browser-memory-observer.js", "source-truth-pilot.js"]) {
  report.diagnosticSources[name] = createHash("sha256").update(await readFile(new URL(name, import.meta.url))).digest("hex");
}
for (const name of ["directory", "stream-hash", "local-entry-store"]) {
  const source = await readFile(path.join(root, "web/app/source-truth", `${name}.ts`), "utf8");
  report.sources[name] = createHash("sha256").update(source).digest("hex");
  modules.set(`/${name}.js`, ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022,
  } }).outputText.replaceAll('"./stream-hash.ts"', '"./stream-hash.js"'));
}
modules.set("/diagnostic.js", `import {scanDirectory, directoryManifest} from './directory.js';
import {LocalEntryStore} from './local-entry-store.js';
window.f001Memory = {scanDirectory, directoryManifest, LocalEntryStore};`);
const server = createServer((request, response) => {
  const body = modules.get(request.url);
  response.writeHead(body ? 200 : 404, { "Content-Type": request.url === "/" ? "text/html" : "text/javascript", "Cache-Control": "no-store" });
  response.end(body ?? "");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
report.origin = origin;
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
const save = () => writeFile(path.join(evidenceDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
const measured = measurements();
let browser, page, cdp, browserCdp;
let phase = "initialization";
const pulse = setInterval(() => console.log(JSON.stringify({ phase, state: "RUNNING", sampleCount: measured.result.sampleCount,
  treeRssBytes: measured.result.latestProcessTreeRssBytes })), 10000); pulse.unref();
const record = async (name) => {
  await measured.sample();
  const stage = { name, at: new Date().toISOString(), treeRssBytes: measured.result.latestProcessTreeRssBytes,
    processes: measured.result.latestRssProcesses, heap: page ? await cdp.send("Runtime.getHeapUsage") : null,
    dom: page ? await cdp.send("Memory.getDOMCounters") : null, browserProcesses: (await browserCdp.send("SystemInfo.getProcessInfo")).processInfo };
  if (nativeDiagnostic) {
    const { traceEvents, ...allocation } = await captureNativeMemory(browserCdp, { requireRenderer: Boolean(page) });
    const serialized = `${JSON.stringify({ traceEvents })}\n`;
    const traceFile = `native-${name}.json`;
    await writeFile(path.join(evidenceDirectory, traceFile), serialized, { mode: 0o600 });
    stage.nativeAllocation = { ...allocation, observedAt: new Date().toISOString(), traceFile,
      traceSha256: createHash("sha256").update(serialized).digest("hex") };
  }
  report.stages.push(stage); await save(); console.log(JSON.stringify(stage));
};
const scan = async () => {
  const summary = await page.evaluate(async (files) => {
    const d = window.f001Memory;
    const store = await d.LocalEntryStore.open();
    try {
      const summary = await d.scanDirectory(d.root, store, { maxEntries: files + 1000,
        maxFileBytes: "1073741824", maxTotalBytes: "536870912", maxBatchEntries: 500 });
      let rows = 0; for await (const row of store.ordered()) { if (!row.entry) throw Error("missing entry"); rows++; }
      return { ...summary, manifestId: await d.directoryManifest(store.ordered()), rows };
    } finally { await store.discard(); }
  }, count);
  assert.equal(summary.fileCount, String(count));
  assert.equal(summary.directoryCount, String(Math.ceil(count / 500) + 2));
  assert.equal(summary.knownBytes, String(report.fixture.knownBytes));
  assert.equal(summary.rows, count + Math.ceil(count / 500) + 2);
  return summary;
};
try {
  const { chromium } = await import(pathToFileURL(modulePath).href);
  browser = await chromium.launch({ executablePath, headless: true });
  report.browser = browser.version();
  page = await browser.newPage();
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin);
  await page.addScriptTag({ type: "module", url: `${origin}/diagnostic.js` });
  await page.waitForFunction(() => Boolean(window.f001Memory));
  cdp = await page.context().newCDPSession(page);
  browserCdp = await browser.newBrowserCDPSession();
  await record("before-fixture");
  phase = "generate-opfs";
  report.fixture = await page.evaluate(async (files) => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("f001-memory", { create: true });
    await root.getDirectoryHandle("empty-child", { create: true });
    const materials = await root.getDirectoryHandle("materials", { create: true });
    let group, knownBytes = 0;
    for (let i = 0; i < files; i++) {
      if (i % 500 === 0) group = await materials.getDirectoryHandle(`g${String(Math.floor(i / 500)).padStart(4, "0")}`, { create: true });
      const body = i === 0 ? new Uint8Array(1024 * 1024).fill(68) : new TextEncoder().encode(i === 1 ? "" : `directory immutable pilot material ${i}\n`);
      const writer = await (await group.getFileHandle(`f${String(i).padStart(6, "0")}.txt`, { create: true })).createWritable();
      await writer.write(body); await writer.close(); knownBytes += body.byteLength;
    }
    window.f001Memory.root = root;
    return { knownBytes, picker: "OPFS_TEST_HANDLE_NOT_NATIVE_PICKER" };
  }, count);
  await record("after-fixture-natural");
  phase = "scan-natural"; report.first = await scan(); await record("after-scan-natural");
  if (nativeDiagnostic) {
    phase = "page-teardown";
    await page.close(); page = null;
    await new Promise(resolve => setTimeout(resolve, 5000));
    await record("after-page-teardown-5s");
    // Per-role baseline and residual counters are evidence, not an automatic
    // total-reclamation verdict: closing a renderer also removes its baseline.
  } else {
    phase = "diagnostic-gc";
    await cdp.send("HeapProfiler.collectGarbage");
    await record("after-explicit-gc-diagnostic-only");
    phase = "rescan"; report.second = await scan(); await record("after-rescan-natural");
    assert.deepEqual(report.second, report.first);
    await cdp.send("HeapProfiler.collectGarbage");
    await record("after-second-explicit-gc-diagnostic-only");
  }
  await measured.stop(); report.resources = measured.result;
  assert.equal(report.resources.samplingErrors, 0);
  report.status = "OBSERVED_NOT_ACCEPTANCE"; await save();
} catch (error) {
  report.status = "ERROR"; report.failure = { phase, message: error.message, stack: error.stack };
  await save(); process.exitCode = 1; console.error(JSON.stringify(report.failure));
} finally {
  clearInterval(pulse); await measured.stop();
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

// Bounded real F001 -> F002 -> product image reading, NOT a Hub preview.
// Every pixel is synthetic. Encoder support is checked, never inferred from a
// filename or a successful header test. No product dependencies are installed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { f002BrowserFixture, fixtureToken, fixtureReaderToken } from "./f002-browser-fixture.js";

const [modulePath, executablePath] = process.argv.slice(2);
assert.ok(path.isAbsolute(modulePath ?? "") && path.isAbsolute(executablePath ?? ""));
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), "traqen-f002-raster-browser-"));
const api = "http://127.0.0.1:6225", web = "http://127.0.0.1:6226";
const environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "SHELL"]
  .flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const results = [], errors = [], log = [];
const report = { scope: "OWNED_SYNTHETIC_F001_F002_RASTER_BROWSER", status: "RUNNING", results, errors,
  hubPreview: "NOT_OPENED", yamlSecurity: "NOT_RUN", f003Runtime: "NOT_CONFIGURED" };
let fixture, child, browser, page;
const deadline = setTimeout(() => { errors.push("bounded raster browser timed out"); child?.kill("SIGTERM"); void browser?.close(); }, 240_000);
async function metadata(action = "metadata", method = "GET") {
  const response = await fetch(`${api}/__f002_fixture/${action}`, { method, headers: { Authorization: `Bearer ${fixtureToken}` }, signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200); return response.json();
}
async function authenticate() {
  await page.locator(".workspace-connection").getByText("需要访问令牌", { exact: true }).waitFor();
  await page.getByLabel("访问令牌（仅当前页面内存）", { exact: true }).fill(fixtureToken);
  const response = page.waitForResponse(value => new URL(value.url()).pathname === "/v1/workspaces"
    && value.request().headers()["x-traqen-api-token"] === fixtureToken);
  await page.locator(".workspace-connection").getByRole("button", { name: "验证并连接", exact: true }).click();
  assert.equal((await response).status(), 200);
}
try {
  const { chromium } = await import(pathToFileURL(modulePath).href);
  assert.equal(typeof chromium?.launch, "function");
  browser = await chromium.launch({ executablePath, headless: true, env: environment });
  const encoder = await browser.newPage();
  const encoded = await encoder.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 3; canvas.height = 2;
    const context = canvas.getContext("2d"); context.fillStyle = "#345678"; context.fillRect(0, 0, 3, 2);
    return ["image/png", "image/jpeg", "image/webp"].map(type => ({ type, data: canvas.toDataURL(type) }));
  });
  await encoder.close();
  const cases = encoded.map(({ type, data }) => {
    assert.ok(data.startsWith(`data:${type};base64,`), "the installed browser must actually support this fixture encoder");
    return { name: type.split("/")[1], type, bytes: Buffer.from(data.split(",")[1], "base64"), width: 3, height: 2 };
  });
  // Complete 1x1 GIF89a: two-color table and LZW clear/pixel/end codes.
  cases.push({ name: "gif", type: "image/gif", bytes: Buffer.from("47494638396101000100800000000000ffffff2c00000000010001000002024401003b", "hex"), width: 1, height: 1 });
  cases.push({ name: "malformed-png", type: "image/png", bytes: cases[0].bytes.subarray(0, 33), rejected: "decode" });
  const oversized = Buffer.from(cases[0].bytes); oversized.writeUInt32BE(100_000, 16);
  cases.push({ name: "oversized-png", type: "application/octet-stream", bytes: oversized, rejected: "header" });
  child = spawn(process.execPath, [path.join(root, "web/node_modules/vinext/dist/cli.js"), "dev", "--hostname", "127.0.0.1", "--port", "6226"], {
    cwd: path.join(root, "web"), env: { ...environment, NEXT_PUBLIC_TRAQEN_API_BASE: api, WRANGLER_LOG_PATH: path.join(directory, "wrangler.log") }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", data => log.push(data.toString())); child.stderr.on("data", data => log.push(data.toString()));
  child.on("error", error => errors.push(error.message));
  report.startup = { pid: child.pid, port: 6226, startedAt: new Date().toISOString(), lastProbe: null };
  let ready = false;
  const until = Date.now() + 30_000;
  while (!ready && Date.now() < until && child.exitCode === null) {
    try { const response = await fetch(web, { signal: AbortSignal.timeout(1000) }); ready = response.ok; report.startup.lastProbe = response.status; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, "owned frontend readiness must precede product assertions");
  for (const image of cases) {
    fixture = await f002BrowserFixture({ content: image.bytes, entryPath: `synthetic-${image.name}.bin` });
    const meta = await metadata(); assert.equal(meta.noFact.factCount, 0);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["127.0.0.1", "localhost"].includes(url.hostname) || (url.protocol === "blob:" && url.pathname.startsWith(`${web}/`)) ? route.continue() : route.abort();
    });
    await context.addInitScript(() => {
      const events = window.__f002RasterBlobEvents = { created: [], retired: [] };
      const create = URL.createObjectURL.bind(URL), retire = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); events.created.push(url); return url; };
      URL.revokeObjectURL = url => { events.retired.push(url); retire(url); };
    });
    page = await context.newPage(); page.setDefaultTimeout(20_000);
    page.on("pageerror", error => errors.push(error.message));
    const contentResponse = page.waitForResponse(value => new URL(value.url()).pathname.endsWith(`/materials/${meta.noFact.materialId}/content`));
    await page.goto(`${web}/?${new URLSearchParams({ page: "evidence", workspace: "workspace", tab: "objects", factset: meta.noFact.graphVersionId,
      source: meta.sourceVersionId, kind: "MATERIAL", record: meta.noFact.materialId })}`);
    await authenticate();
    const response = await contentResponse;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["content-type"].split(";")[0], image.type);
    if (image.rejected === "decode") {
      await page.locator(".f002-raster").getByRole("alert").waitFor();
      assert.equal(await page.locator(".f002-raster img").count(), 0);
      assert.equal(await page.evaluate(() => window.__f002RasterBlobEvents.created.every(url => window.__f002RasterBlobEvents.retired.includes(url))), true);
    } else if (image.rejected === "header") {
      await page.getByText("已校验受控字节。此二进制格式不能作为可执行文档展示；请查看元数据及明确限制。", { exact: true }).waitFor();
      assert.equal(await page.locator(".f002-raster img").count(), 0);
      assert.equal(await page.evaluate(() => window.__f002RasterBlobEvents.created.length), 0);
    } else {
      const img = page.locator(".f002-raster img"); await img.waitFor();
      assert.deepEqual(await img.evaluate(node => [node.naturalWidth, node.naturalHeight]), [image.width, image.height]);
      await page.getByRole("button", { name: "放大原图", exact: true }).click();
      assert.equal(await img.evaluate(node => parseFloat(getComputedStyle(node).width)), image.width * 1.25);
      await page.getByRole("button", { name: "原图 100%", exact: true }).click();
      assert.equal(await img.evaluate(node => parseFloat(getComputedStyle(node).width)), image.width);
      await page.screenshot({ path: path.join(directory, `${image.name}.png`), fullPage: true });
      if (image.name === "png") {
        const ownerUrl = await img.getAttribute("src");
        // The member switch is an intentionally collapsed native details
        // control. Exercise the visible user path rather than filling a hidden
        // input or changing the product's authentication presentation.
        await page.locator(".f002-auth summary").click();
        const memberInput = page.getByLabel("成员访问令牌（仅本页内存）", { exact: true });
        await memberInput.waitFor({ state: "visible" });
        await memberInput.fill(fixtureReaderToken);
        await page.locator(".f002-auth").getByRole("button", { name: "验证并连接", exact: true }).click();
        await page.waitForFunction(previous => {
          const img = document.querySelector(".f002-raster img");
          return img && img.src !== previous && img.naturalWidth > 0;
        }, ownerUrl);
        const readerUrl = await img.getAttribute("src");
        await metadata("revoke-reader", "POST");
        await page.getByRole("heading", { name: "访问已停止", exact: true }).waitFor();
        assert.equal(await img.count(), 0);
        assert.equal(await page.evaluate(url => window.__f002RasterBlobEvents.retired.includes(url), readerUrl), true);
        await page.screenshot({ path: path.join(directory, "png-revoked.png"), fullPage: true });
      }
    }
    assert.equal((await metadata()).sourceStable, true);
    results.push({ case: image.name, passed: true, decoded: !image.rejected, sourceStable: true });
    await context.close(); page = null;
    await fixture.close(); fixture = null;
  }
  assert.deepEqual(errors, []);
  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED"; errors.push(error.stack ?? error.message);
  if (page) await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  clearTimeout(deadline);
  if (browser) await browser.close();
  if (child && child.exitCode === null) {
    const closed = new Promise(resolve => child.once("close", resolve)); child.kill("SIGTERM");
    const kill = setTimeout(() => child.kill("SIGKILL"), 3000); await closed; clearTimeout(kill);
  }
  if (fixture) await fixture.close();
  await writeFile(path.join(directory, "frontend.log"), log.join(""));
  await writeFile(path.join(directory, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, parentPath: `${directory}/`, childPath: "summary.json" }));
  process.exitCode = report.status === "PASSED" && errors.length === 0 ? 0 : 1;
}

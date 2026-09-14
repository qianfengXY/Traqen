// Run only against source-truth-preview-server.js (isolated test stores).
// Supply an installed Playwright module, headless Chromium and evidence directory.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, executablePath, evidenceDirectory] = process.argv.slice(2);
assert.ok(modulePath && executablePath && evidenceDirectory, "expected Playwright module, Chromium executable and evidence directory");
const { chromium } = await import(pathToFileURL(path.resolve(modulePath)).href);
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const mutations = [];
page.on("request", (request) => {
  if (request.url().startsWith("http://127.0.0.1:3187/") && !["GET", "OPTIONS"].includes(request.method())) mutations.push(request.url());
});
try {
  await page.goto("http://127.0.0.1:3188/");
  await page.waitForFunction(() => document.querySelector(".connection-button.unavailable"));
  await page.getByTitle("部署诊断", { exact: true }).click();
  await page.getByLabel("API 地址", { exact: true }).fill("http://127.0.0.1:3187");
  await page.getByLabel("API token（仅当前页面内存）", { exact: true }).fill("f001-browser-isolated-fixture-token");
  await page.getByRole("button", { name: "重新连接并刷新", exact: true }).click();
  await page.waitForSelector(".connection-button.healthy");
  await page.locator(".diagnostic-drawer header button").click();
  await page.locator(".workspace-project-open").filter({ has: page.locator("strong", { hasText: /^Workspace$/ }) }).click();
  await page.locator(".nav-button").filter({ hasText: "Workspace 分析" }).click();
  await page.getByRole("heading", { name: "快照旅程", exact: true }).waitFor();
  const current = page.locator('.st-rail button[aria-current="step"]');
  if (!(await current.getAttribute("aria-label")).startsWith("第 7 站")) {
    await page.evaluate(async () => {
      // Real browser directory/file handles; this does not prove native OS picker UX.
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("f001-rail", { create: true });
      await root.getDirectoryHandle("empty", { create: true });
      const writer = await (await root.getFileHandle("readme.txt", { create: true })).createWritable();
      await writer.write("source evidence only\n"); await writer.close();
      window.showDirectoryPicker = async () => root;
    });
    await page.getByRole("checkbox", { name: "上传目录", exact: true }).check();
    await page.getByRole("button", { name: "选择本机目录", exact: true }).click();
    await page.getByRole("button", { name: "保存来源，确认范围", exact: true }).click();
    await page.getByRole("button", { name: "确认范围并开始", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.st-rail button[aria-current="step"]')?.getAttribute("aria-label")?.startsWith("第 7 站"), null, { timeout: 30000 });
  }
  const visible = () => page.evaluate(() => {
    const rail = document.querySelector(".st-rail"), target = rail.querySelector('[aria-current="step"]');
    const viewport = rail.getBoundingClientRect(), station = target.getBoundingClientRect();
    return { visible: station.left >= viewport.left - 1 && station.right <= viewport.right + 1,
      scrollLeft: rail.scrollLeft, railLeft: viewport.left, railRight: viewport.right,
      stationLeft: station.left, stationRight: station.right, documentWidth: document.documentElement.scrollWidth };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  // Move the rail away deliberately: the explicit return action must work even
  // when the selected station already equals the current station (no state change).
  await page.locator(".st-rail").evaluate((rail) => { rail.scrollLeft = 0; });
  await page.getByRole("button", { name: "回到当前 · 第 7 站", exact: true }).click();
  await page.waitForFunction(() => {
    const rail = document.querySelector(".st-rail"), target = rail.querySelector('[aria-current="step"]');
    const r = rail.getBoundingClientRect(), t = target.getBoundingClientRect();
    return t.left >= r.left - 1 && t.right <= r.right + 1;
  }, null, { timeout: 4000 }).catch(() => {});
  const returned = await visible();
  console.log(JSON.stringify({ check: "return-to-current", ...returned }));
  await page.screenshot({ path: path.join(evidenceDirectory, "rail-return-current.png"), fullPage: true });
  assert.equal(returned.visible, true, "return-to-current must reveal the actual station in the horizontal rail");
  assert.equal(returned.documentWidth, 390, "journey must not overflow the page");

  const priorMutations = mutations.length;
  await page.getByRole("button", { name: /^第 8 站/ }).click();
  assert.equal(await page.getByRole("button", { name: "冻结包", exact: true }).count(), 0, "future preview cannot seal");
  await page.getByRole("button", { name: "回到当前节点", exact: true }).click();
  assert.equal((await visible()).visible, true, "footer return must also reveal the current station");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const rail = document.querySelector(".st-rail"), target = rail.querySelector('[aria-current="step"]');
    const r = rail.getBoundingClientRect(), t = target.getBoundingClientRect();
    return t.left >= r.left - 1 && t.right <= r.right + 1;
  });
  assert.equal(mutations.length, priorMutations, "station navigation/resize must remain read-only");
  console.log(JSON.stringify({ status: "PASSED", checks: ["header return", "footer return", "future remains read-only", "resize", "no page overflow", "no mutation"], nativePickerVerified: false }));
} finally { await browser.close(); }

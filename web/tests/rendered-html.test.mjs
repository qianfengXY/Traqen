import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Traqen proof-chain product surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Traqen · 可追溯质量工作台<\/title>/i);
  assert.match(html, /功能追溯/);
  assert.match(html, /追溯图谱/);
  assert.match(html, /端到端证据追踪链/);
  assert.match(html, /为什么相信/);
  assert.match(html, /TraceGap/);
  assert.match(html, /DEMO SNAPSHOT/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps real API loading explicit and ships no disposable preview surface", async () => {
  const [page, product, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/traqen-product.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<TraqenProduct \/>/);
  assert.match(product, /\/traceability\?snapshotManifestId=/);
  assert.match(product, /\/graph\?\$\{parameters\}/);
  assert.match(product, /\/graph\/paths\/query/);
  assert.match(product, /默认最多 30 个节点/);
  assert.match(product, /cytoscape/);
  assert.match(product, /\/reverse-runs\/\$\{encodeURIComponent\(runId\)\}\/candidates/);
  assert.match(product, /\/change-sets/);
  assert.match(product, /implementation-reanalyses/);
  assert.match(product, /服务端派生/);
  assert.match(product, /演示模式不会写入业务基线/);
  assert.match(product, /成功后清空/);
  assert.match(product, /历史版本比较/);
  assert.match(product, /重建当前实现映射/);
  assert.match(product, /x-traqen-api-token/);
  assert.match(product, /API token（仅保存在当前页面内存）/);
  assert.match(layout, /Traqen · 可追溯质量工作台/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, null);
  assert.equal(hostingConfig.r2, null);
  assert.ok(hostingConfig.project_id === undefined || typeof hostingConfig.project_id === "string");
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../public/favicon.svg", import.meta.url)));
  await access(root);
});

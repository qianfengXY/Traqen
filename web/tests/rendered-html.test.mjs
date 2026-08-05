import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  for (const text of [
    "工作台概览",
    "Workspace 分析",
    "功能 / API",
    "理解图谱",
    "声明审核",
    "变更影响",
    "能力设置",
    "创建第一个 Workspace",
    "新建 Workspace",
    "中文",
    "English",
  ]) {
    assert.match(html, new RegExp(text));
  }
  for (const text of ["Published Head", "Review Queue", "Impact Actions", "Connection Health", "部署诊断"]) {
    assert.match(html, new RegExp(text));
  }
  assert.doesNotMatch(html, /API 地址.*API token/s);
  assert.doesNotMatch(html, /webkitdirectory|兼容导入|浏览器扫描|SELF WORKSPACE|codex-preview/i);
});

test("ships only the server-owned understanding path after Web cutover", async () => {
  const [page, product, surfaces, serverClient, graphClient] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/traqen-product.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/product-surfaces.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/server-understanding-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/understanding-graph-client.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<TraqenProduct \/>/);
  assert.match(product, /registerServerWorkspaceSource/);
  assert.match(product, /resolveServerWorkspaceExecutionProfile/);
  assert.match(product, /startServerWorkspaceUnderstanding/);
  assert.match(product, /getServerWorkspaceUnderstanding/);
  assert.match(product, /listServerWorkspaceUnderstandingJobs/);
  assert.match(product, /controlServerWorkspaceUnderstanding/);
  assert.match(product, /traqen\.activeWorkspaceId/);
  assert.match(product, /availableJobs\.find\(\(\{ status \}\) => status === "RUNNING"\)/);
  assert.match(product, /availableJobs\.find\(\(\{ status \}\) => status === "PAUSED"\)/);
  assert.match(surfaces, /jobs\.map\(\(item\)/);
  assert.match(product, /getCurrentUnderstandingGraph/);
  assert.match(product, /staleWorkspaceResponse/);
  assert.match(product, /revisionRequestRef/);
  assert.match(product, /staleWorkspaceRequestResponse\(requestContext, contextRef\.current, requestVersion, revisionRequestRef\.current\)/);
  assert.match(product, /REFERENCE ONLY/);
  assert.match(product, /window\.setInterval/);
  for (const stage of ["SOURCE_SCAN", "FACT_COMMIT", "ANALYSIS", "RECONCILIATION", "EVALUATION", "PROJECTION", "PUBLISHING"]) {
    assert.match(surfaces, new RegExp(stage));
  }
  for (const moduleName of ["FeatureExplorer", "GraphExplorer", "ReviewWorkspace", "ImpactWorkspace", "CapabilitySettings"]) {
    assert.match(`${product}\n${surfaces}`, new RegExp(moduleName));
  }
  assert.match(surfaces, /PUBLISHED/);
  assert.match(surfaces, /CANDIDATE/);
  assert.match(surfaces, /Static lane/);
  assert.match(surfaces, /Agent lane/);
  assert.match(serverClient, /source-registrations/);
  assert.match(serverClient, /workspace-analysis-jobs/);
  assert.match(serverClient, /"pause" \| "resume" \| "cancel"/);
  assert.match(serverClient, /execution-profile-revisions/);
  assert.doesNotMatch(serverClient, /workspaceExecutionProfileRevisionId\?:/);
  assert.match(graphClient, /graph\/current/);
  assert.match(graphClient, /features\/\$\{encodeURIComponent\(featureId\)\}\/traceability/);
  assert.match(graphClient, /features\/\$\{encodeURIComponent\(featureId\)\}\/graph/);
  assert.match(product, /getFeatureTraceability/);
  assert.match(product, /getFeatureGraph/);
  assert.match(product, /queryFeatureGraphPath/);
  assert.match(surfaces, /featureDetailTabs\.map/);
  assert.match(surfaces, /VERIFIED NO PATH/);
  assert.doesNotMatch(surfaces, /for \(let pass = 0; pass < depth/);
  assert.doesNotMatch(surfaces, /slice\(0, 36\)/);
  assert.doesNotMatch(product, /local-workspace-analysis|local-workspace-store|analysis-model-client|workspace-analysis-run-client/);
  assert.doesNotMatch(product, /scanLocalWorkspaceFile|analyzeLocalWorkspaceRecords|ingestWorkspaceObservations|startWorkspaceAnalysisRun|webkitdirectory|showDirectoryPicker/);
});

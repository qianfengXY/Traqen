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
  assert.doesNotMatch(product, /resolveServerWorkspaceExecutionProfile/);
  assert.match(product, /startServerWorkspaceUnderstanding/);
  assert.match(product, /ServerUnderstandingApiError/);
  assert.match(product, /startHistoricalRevisionReanalysis/);
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
  assert.match(product, /staleWorkspaceRequestResponse\(requestContext, contextRef\.current, revisionRequestVersion, revisionRequestRef\.current\)/);
  assert.match(product, /capabilitySettingsResult\.status === "fulfilled"[\s\S]*if \(draft\)[\s\S]*else \{[\s\S]*setMainModel\(""\)/,
    "Workspace capability state must be committed only after draft, catalog, and profile recovery all succeed");
  assert.match(product, /setCapabilitySettingsReady\(false\)[\s\S]*capabilitySettingsResult\.status === "fulfilled"[\s\S]*setCapabilitySettingsReady\(true\)/,
    "a failed Workspace capability recovery must keep every mutation path unavailable instead of exposing stale state");
  assert.match(surfaces, /recoveryReady: boolean[\s\S]*const editingDisabled = working \|\| !recoveryReady[\s\S]*disabled=\{editingDisabled\}/,
    "the capability surface must disable edits and saves while recovery is incomplete");
  assert.match(product, /const workspace = activeWorkspace;[\s\S]*const requestContext = \{ \.\.\.contextRef\.current \};[\s\S]*staleWorkspaceResponse\(requestContext, contextRef\.current\)/);
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
  const startClient = serverClient.slice(
    serverClient.indexOf("export async function startServerWorkspaceUnderstanding"),
    serverClient.indexOf("export async function startHistoricalRevisionReanalysis"),
  );
  assert.doesNotMatch(startClient, /workspaceExecutionProfileRevisionId/,
    "the Web client must not select an immutable Profile revision for a new Run");
  assert.match(serverClient, /graph\/revisions\/\$\{encodeURIComponent\(graphRevisionId\)\}\/reanalysis-jobs/);
  assert.match(serverClient, /"pause" \| "resume" \| "cancel"/);
  assert.doesNotMatch(serverClient, /workspaceExecutionProfileRevisionId\?:/);
  assert.match(graphClient, /graph\/current/);
  assert.match(graphClient, /features\/\$\{encodeURIComponent\(featureId\)\}\/traceability/);
  assert.match(graphClient, /features\/\$\{encodeURIComponent\(featureId\)\}\/graph/);
  assert.match(product, /getFeatureTraceability/);
  assert.match(product, /getFeatureGraph/);
  assert.match(product, /queryFeatureGraphPath/);
  assert.match(surfaces, /featureDetailTabs\.map/);
  assert.match(surfaces, /Reanalyze immutable Snapshot/);
  assert.match(surfaces, /VERIFIED NO PATH/);
  assert.doesNotMatch(surfaces, /for \(let pass = 0; pass < depth/);
  assert.doesNotMatch(surfaces, /slice\(0, 36\)/);
  assert.doesNotMatch(product, /local-workspace-analysis|local-workspace-store|analysis-model-client|workspace-analysis-run-client/);
  assert.doesNotMatch(product, /listWorkspaceCapabilityConfigs|capabilityConfig/,
    "the F006 surface must not restore or render the superseded capability-config authority");
  assert.doesNotMatch(product, /secrets:\s*"HANDLE_ONLY"/);
  const selectWorkspaceSource = product.slice(product.indexOf("const selectWorkspace"), product.indexOf("const reconnect"));
  assert.match(selectWorkspaceSource, /setMainModel\(""\)/);
  assert.match(selectWorkspaceSource, /setChildSlots\(createDefaultChildSlots\(\)\)/);
  assert.doesNotMatch(selectWorkspaceSource, /globalModels|effectiveCatalog|roster/);
  const refreshSource = product.slice(product.indexOf("const refreshWorkspaceReads"), product.indexOf("const selectWorkspace"));
  const legacyConfigSource = refreshSource.slice(refreshSource.indexOf('if (configResult.status'), refreshSource.indexOf('if (profileResult.status'));
  assert.doesNotMatch(legacyConfigSource, /setMainModel|setMainSkillNames|setMainMcpNames|setChildSlots/);
  assert.doesNotMatch(product, /window\.confirm/);
  assert.match(surfaces, /reference\.source/);
  assert.match(surfaces, /ACTIVE_RUN/);
  assert.match(surfaces, /atomic transaction|原子事务/);
  assert.match(surfaces, /item\.readiness\} · \{item\.lifecycle/);
  assert.doesNotMatch(surfaces, /setReplacementBySource\(\(current\)[^\n]*event\.currentTarget/);
  assert.doesNotMatch(product, /scanLocalWorkspaceFile|analyzeLocalWorkspaceRecords|ingestWorkspaceObservations|startWorkspaceAnalysisRun|webkitdirectory|showDirectoryPicker/);
  const startConfirmationSource = product.slice(product.indexOf("{startConfirmationOpen"), product.indexOf("</main>"));
  assert.match(startConfirmationSource, /Agent roster<\/dt><dd>Main \+ \{executionProfile\?\.childSlots\.length \?\? 0\} Child slots<\/dd>/,
    "start confirmation must display the immutable Active Profile roster that the server will pin");
  assert.doesNotMatch(startConfirmationSource, /Agent roster<\/dt><dd>Main \+ \{childSlots\.length\} Child slots<\/dd>/,
    "start confirmation must not display a mutable Draft roster beside an Active Profile revision");
  const startUnderstandingSource = product.slice(product.indexOf("async function startUnderstanding"), product.indexOf("async function controlUnderstanding"));
  assert.match(startUnderstandingSource, /error instanceof ServerUnderstandingApiError[\s\S]*error\.status === 409[\s\S]*error\.code === "PERSISTENCE_CONFLICT"/,
    "a stale start confirmation must identify the structured conflict rather than treating it as a generic error");
  assert.match(startUnderstandingSource, /await refreshWorkspaceReads\(activeWorkspace, requestContext\)/,
    "a stale start confirmation must refresh the Active Profile before allowing a retry");
  assert.match(startUnderstandingSource, /The Active Profile changed\. The confirmation was refreshed; review it and try again\./);
  assert.match(product, /capabilityDraftConflict/,
    "a stale Workspace Draft save must retain a dedicated conflict state rather than discard the editor");
  assert.match(product, /getWorkspaceCapabilityDraft/,
    "a stale Workspace Draft save must fetch the newer server head for comparison");
  assert.match(surfaces, /Local expected revision/);
  assert.match(surfaces, /Current revision/);
  assert.match(surfaces, /Local project capability revisions/);
  assert.match(surfaces, /Current project capability revisions/);
  assert.match(surfaces, /Local policy content/);
  assert.match(surfaces, /Current policy content/);
  assert.match(surfaces, /Retry my retained Draft/);
  assert.match(surfaces, /Use newer server Draft/);
});

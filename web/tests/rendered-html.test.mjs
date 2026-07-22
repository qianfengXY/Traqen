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
  assert.match(html, /效果指标/);
  assert.match(html, /Workspace 分析/);
  assert.match(html, /创建第一个 Workspace/);
  assert.match(html, /创建项目后，才会加载工程选择、分析 Agent、功能树与追溯统计/);
  assert.doesNotMatch(html, /选择工程，由分析 Agent 建立功能追溯 Workspace/);
  assert.doesNotMatch(html, /等待创建主任务/);
  assert.match(html, /配置分析模型/);
  assert.match(html, /新建 Workspace/);
  assert.match(html, /尚未创建项目/);
  assert.match(html, /待创建/);
  assert.doesNotMatch(html, /SELF WORKSPACE/);
  assert.doesNotMatch(html, /Traqen Platform/);
  assert.match(html, /中文/);
  assert.match(html, /English/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps real API loading explicit and ships no disposable preview surface", async () => {
  const [page, product, modelClient, analyzer, workspaceStatistics, workspaceStore, detailModel, layout, viteConfig, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/traqen-product.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/analysis-model-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/local-workspace-analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/local-workspace-statistics.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/local-workspace-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/trace-detail-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<TraqenProduct \/>/);
  assert.match(product, /\/traceability\?snapshotManifestId=/);
  assert.match(product, /\/features`/);
  assert.match(product, /\/snapshots`/);
  assert.match(product, /自动发现并加载/);
  assert.match(product, /\/graph\?\$\{parameters\}/);
  assert.match(product, /\/graph\/paths\/query/);
  assert.match(product, /默认最多 30 个节点/);
  assert.match(product, /cytoscape/);
  assert.match(product, /"description" \| "design" \| "configuration" \| "test-case" \| "test-result"/);
  assert.match(product, /设计流程/);
  assert.match(product, /代码定位/);
  assert.match(product, /配置项/);
  assert.match(product, /测试步骤/);
  assert.match(product, /结果数据/);
  assert.match(product, /完整功能说明/);
  assert.match(product, /业务人工确认/);
  assert.match(product, /设计文档/);
  assert.match(product, /原始 Markdown/);
  assert.match(product, /业务逻辑代码块/);
  assert.match(product, /完整源文件/);
  assert.match(product, /跨环境配置矩阵/);
  assert.match(product, /测试设计策略/);
  assert.match(product, /具体测试用例/);
  assert.match(product, /测试逻辑与步骤/);
  assert.match(product, /Agent 执行与回传预留/);
  assert.match(product, /按场景执行结果/);
  assert.match(product, /失败详情/);
  assert.match(product, /正式确认必须由有权限的负责人提交/);
  assert.match(detailModel, /traqen\.testspec\.agent\/v1/);
  assert.match(detailModel, /runnerIdentity/);
  assert.match(detailModel, /failedStepId/);
  assert.match(detailModel, /"DEV" \| "SIT" \| "UAT" \| "PROD"/);
  assert.match(detailModel, /applicability: "CURRENT" \| "HISTORICAL"/);
  assert.match(detailModel, /feature-traceability-design\.zh-CN\.md\?raw/);
  assert.match(detailModel, /feature-traceability-design\.md\?raw/);
  assert.match(product, /LanguageContext/);
  assert.match(product, /ThemeProvider/);
  assert.match(product, /ThemeSwitcher/);
  assert.match(layout, /"enterprise","apple","warm","fresh","minimal"/);
  assert.match(product, /全局主题配色/);
  assert.match(product, /localizedTerms/);
  assert.match(product, /aria-label=\{t\("全局语言", "Global language"\)\}/);
  assert.match(product, /term\(gap\.severity\)/);
  assert.match(product, /role\(gap\.ownerRole\)/);
  assert.match(product, /term\(selectedResult\.status\)/);
  assert.match(detailModel, /trace-chain\.js\?raw/);
  assert.match(detailModel, /feature-graph\.js\?raw/);
  assert.match(product, /PROJECT-TRAQEN/);
  assert.match(product, /FEATURE-TRACEABILITY-001/);
  assert.doesNotMatch(`${product}\n${detailModel}`, /Order Platform|FEATURE-ORDER|ORDER-SUBMIT|order-service\.js\?raw|order-submit-design/);
  assert.match(product, /\/reverse-runs\/\$\{encodeURIComponent\(runId\)\}\/candidates/);
  assert.match(product, /\/change-sets/);
  assert.match(product, /implementation-reanalyses/);
  assert.match(product, /continuous-protection/);
  assert.match(product, /增量回归与质量门禁/);
  assert.match(product, /不把未知显示为通过/);
  assert.match(product, /metrics\/product-effectiveness/);
  assert.match(product, /metrics\/platform-operations/);
  assert.match(product, /平台运营可观测性/);
  assert.match(product, /没有综合绿色分数/);
  assert.match(product, /服务端派生/);
  assert.match(product, /自 Workspace 候选的选择不会写入/);
  assert.match(product, /成功后清空/);
  assert.match(product, /历史版本比较/);
  assert.match(product, /重建当前实现映射/);
  assert.match(product, /x-traqen-api-token/);
  assert.match(product, /API token（仅保存在当前页面内存）/);
  assert.match(product, /webkitdirectory/);
  assert.match(product, /WorkspaceAnalysisView/);
  assert.match(product, /view === "workspace" && !workspaceProjectCreated/);
  assert.match(product, /hidden=\{view !== "workspace" \|\| !workspaceProjectCreated\}/);
  assert.match(product, /workspaceProjectCreated && <WorkspaceAnalysisView/);
  assert.match(product, /view === "workspace" && workspaceCreationOpen/);
  assert.match(product, /navigateToView/);
  assert.match(product, /已恢复持久化检查点/);
  assert.match(product, /current\?\.projectId === projectId/);
  assert.match(product, /先建立项目身份，随后选择代码工程并启动首次全量分析/);
  assert.match(product, /saveLocalWorkspaceProjectSummary/);
  assert.match(product, /workspaceAnalysisRunning && workspaceProjectId !== project\.id/);
  assert.match(product, /新项目会加入列表，当前分析不会被中断/);
  assert.match(product, /启动首次全量分析/);
  assert.match(workspaceStore, /export async function saveLocalWorkspaceProjectSummary/);
  assert.match(product, /REQUEST_PREPARED/);
  assert.match(product, /分析 Agent 会话/);
  assert.match(product, /建立源码清单/);
  assert.match(product, /提取可定位证据/);
  assert.match(product, /理解业务与 API 语义/);
  assert.match(product, /当前子任务/);
  assert.match(product, /主 Agent 对话/);
  assert.match(product, /三个子 Agent 对话/);
  assert.match(product, /sub-agent-deck/);
  assert.match(product, /公开执行过程，不展示隐藏思维链/);
  assert.match(product, /planWorkspaceAnalysis/);
  assert.match(product, /Promise\.allSettled/);
  assert.match(product, /上下文达到安全阈值/);
  assert.match(product, /模型网关已响应/);
  assert.match(product, /证据置信度上限/);
  assert.match(modelClient, /application\/x-ndjson/);
  assert.match(modelClient, /JAVA_DECLARATION_PATTERN/);
  assert.match(product, /WorkspaceAnalysisDashboard/);
  assert.match(product, /分层统计/);
  assert.match(product, /待人工确认/);
  assert.match(product, /证据链与不符合/);
  assert.match(product, /下一层统计/);
  assert.match(product, /WorkspaceTraceabilityView/);
  assert.match(product, /WorkspaceGraphSurface/);
  assert.match(product, /workspaceGraphForAnalysis/);
  assert.match(product, /WorkspaceFeatureExplorer/);
  assert.match(product, /FeatureTreeBranch/);
  assert.match(product, /WorkspaceTreeModeSwitch/);
  assert.match(product, /纯业务功能/);
  assert.match(product, /API 接口/);
  assert.match(product, /不含接口与工程命令/);
  assert.match(product, /const \[workspaceAnalysis, setWorkspaceAnalysis\]/);
  assert.match(product, /const \[workspaceProjectId, setWorkspaceProjectId\]/);
  assert.match(product, /const \[workspaceFeatureId, setWorkspaceFeatureId\]/);
  assert.match(product, /const \[workspaceExpandedNodeIds, setWorkspaceExpandedNodeIds\]/);
  assert.match(product, /visibleWorkspaceAnalysis && !liveScenario/);
  assert.match(product, /初始化完成：Workspace 已成为全局导航上下文/);
  assert.match(product, /从功能树逐项查看端到端追溯链/);
  assert.match(product, /十万级工程做有界确定性提取/);
  assert.match(product, /执行增量分析/);
  assert.match(product, /configureAndVerifyAnalysisModel/);
  assert.match(product, /API Base URL \/ Chat Completions URL/);
  assert.match(product, /Stream \/ SSE/);
  assert.match(product, /selectAnalysisModelProfile/);
  assert.match(product, /管理模型并选择当前分析模型/);
  assert.match(product, /removeAnalysisModelProfile/);
  assert.match(product, /analysis-task-console/);
  assert.match(product, /总执行进度/);
  assert.match(product, /累计耗时/);
  assert.match(product, /技术诊断/);
  assert.match(product, /workspaceModelCandidateBatches/);
  assert.match(product, /applyLocalModelEnrichment/);
  assert.match(product, /先配置模型/);
  assert.match(product, /从展示中移出/);
  assert.match(product, /setLocalWorkspaceProjectVisibility/);
  assert.match(product, /visibleWorkspaceProjects/);
  assert.match(modelClient, /Web 与 API 使用同一代码版本/);
  assert.match(modelClient, /normalizeChatCompletionsEndpoint/);
  assert.match(modelClient, /配置已保存，但模型连接验证失败/);
  assert.match(product, /previous\.size === file\.size && previous\.lastModified === file\.lastModified/);
  assert.match(product, /workspaceProjects\.map/);
  assert.match(workspaceStore, /indexedDB\.open/);
  assert.match(workspaceStore, /projects.*snapshots/s);
  assert.match(workspaceStore, /analysisRuns/);
  assert.match(workspaceStore, /analysisResults/);
  assert.match(workspaceStore, /includeHidden/);
  assert.match(workspaceStore, /setLocalWorkspaceProjectVisibility/);
  assert.doesNotMatch(workspaceStore, /content:/);
  assert.match(workspaceStatistics, /calculateLocalWorkspaceStatistics/);
  assert.match(workspaceStatistics, /localWorkspaceStatisticsForNode/);
  assert.match(workspaceStatistics, /nonconformingFeatureCount/);
  assert.match(workspaceStatistics, /completeEvidenceChainCount/);
  assert.match(analyzer, /export function analyzeLocalWorkspace/);
  assert.match(analyzer, /export function createLocalWorkspaceAnalysisAccumulator/);
  assert.match(analyzer, /export function scanLocalWorkspaceFile/);
  assert.match(analyzer, /export function analyzeLocalWorkspaceRecords/);
  assert.match(analyzer, /export function localWorkspaceAnalysisForTreeMode/);
  assert.match(analyzer, /localWorkspaceScannerVersion = 4/);
  assert.match(analyzer, /ENDPOINT.*CODE_SYMBOL.*COMMAND/s);
  assert.match(analyzer, /API_SERVICE.*BUSINESS_CAPABILITY.*DATA_INTEGRATION.*BACKGROUND_INTEGRATION.*PROJECT_OPERATION/s);
  assert.match(analyzer, /featureCount: features\.length/);
  assert.match(product, /对外接口服务/);
  assert.match(product, /业务处理能力/);
  assert.match(analyzer, /discoverJavaCandidates/);
  assert.match(analyzer, /GetMapping.*PostMapping.*RequestMapping/s);
  assert.match(analyzer, /JAX-RS/);
  assert.match(analyzer, /KafkaListener.*RabbitListener.*EventListener/);
  assert.match(analyzer, /target.*out.*\.gradle/);
  assert.match(analyzer, /MISSING_AUTHORITY/);
  assert.match(analyzer, /NOT_EXECUTED_ON_CURRENT_DEPLOYMENT/);
  assert.match(analyzer, /maxFileBytes = 768 \* 1024/);
  assert.doesNotMatch(analyzer, /maxFiles|maxTotalBytes/);
  assert.match(product, /const batchSize = 120/);
  assert.match(product, /expandedNodeIds\.has\(node\.id\)/);
  assert.match(layout, /Traqen · 可追溯质量工作台/);
  assert.match(viteConfig, /fileURLToPath\(new URL\("\.\."/);
  assert.match(viteConfig, /fs: \{ allow: \[repositoryRoot\] \}/);
  assert.match(viteConfig, /CLOUDFLARE_CF_FETCH_ENABLED \?\?= "false"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, null);
  assert.equal(hostingConfig.r2, null);
  assert.ok(hostingConfig.project_id === undefined || typeof hostingConfig.project_id === "string");
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("../public/favicon.svg", import.meta.url)));
  await access(root);
});

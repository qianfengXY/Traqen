"use client";

import { useMemo, useState } from "react";

type View = "trace" | "review" | "impact";
type NodeStatus = "ACTIVE" | "STALE" | "PENDING";

type ChainNode = {
  id: string;
  kind: string;
  title: string;
  meta: string;
  status: NodeStatus;
  relation?: string;
  provenance: string;
};

type Gap = { type: string; severity: string; ownerRole: string; message: string };
type Dimension = { label: string; value: string };
type Evidence = { type: string; id: string; detail: string; state: string };

type ReviewCandidate = {
  id: string;
  featureCandidateId: string;
  statement: string;
  subjectKey: string;
  constraint: { dimension: string; operator: string; value: unknown };
  scope: Record<string, unknown>;
  evidence: Array<{ factId: string; relation: string }>;
  sources: Array<{ candidateId?: string; producer?: { skillId?: string; skillVersion?: string } }>;
};

type ImpactResult = {
  changeSet: {
    id: string;
    fromSnapshotManifestId: string;
    toSnapshotManifestId: string;
    complete: boolean;
    warnings: string[];
    changes: Array<{ id: string; kind: string; changeType: string; artifact: string | null }>;
  };
  impact: {
    affectedFeatureIds: string[];
    affectedClaimRefs: Array<{ id: string; version: number }>;
    affectedTestSpecIds: string[];
    continuedFeatureIds: string[];
    invalidations: Array<{
      id: string;
      featureId: string;
      layers: string[];
      preserves: string[];
      reason: string;
      recommendedActions: string[];
    }>;
  };
};

type Scenario = {
  feature: { id: string; name: string; version: number };
  snapshotId: string;
  deploymentId: string;
  computedAt: string;
  complete: boolean;
  dimensions: Dimension[];
  nodes: ChainNode[];
  gaps: Gap[];
  evidence: Evidence[];
  reasons: string[];
};

const completeScenario: Scenario = {
  feature: { id: "FEATURE-ORDER-SUBMIT-001", name: "订单提交 / Submit order", version: 3 },
  snapshotId: "SNAPSHOT-7D31E8",
  deploymentId: "DEPLOY-SIT-20260714.4",
  computedAt: "2026-07-14 16:42:08 CST",
  complete: true,
  dimensions: [
    { label: "业务权威", value: "CONFIRMED" },
    { label: "实现符合性", value: "CONFORMS" },
    { label: "验证结果", value: "PASS" },
    { label: "证据新鲜度", value: "FRESH" },
    { label: "冲突", value: "NONE" },
  ],
  nodes: [
    { id: "CLAIM-ORDER-STATUS-001@1", kind: "Claim", title: "仅草稿订单可提交", meta: "NORMATIVE_REQUIREMENT", status: "ACTIVE", relation: "APPLIES_IN", provenance: "业务负责人确认" },
    { id: "SCOPE-NORMAL-DRAFT@1", kind: "Scope", title: "普通用户 · 标准订单", meta: "actor=normal-user", status: "ACTIVE", relation: "CONFIRMED_BY", provenance: "生效范围 v1" },
    { id: "DECISION-ORDER-001", kind: "Decision", title: "已确认", meta: "business-owner · 14 Jul", status: "ACTIVE", relation: "CONFORMS_TO", provenance: "不可变人工决策" },
    { id: "ENDPOINT-POST-ORDER-SUBMIT", kind: "Implementation", title: "POST /orders/{id}/submit", meta: "src/orders.js:84", status: "ACTIVE", relation: "CONTROLLED_BY", provenance: "Scanner + exact Fact mapping" },
    { id: "TABLE-ORDERS + FLAG-SUBMIT", kind: "Data / Config", title: "orders.status · submit.enabled", meta: "PostgreSQL + config", status: "ACTIVE", relation: "VERIFIED_BY", provenance: "Snapshot-bound Facts" },
    { id: "TEST-ORDER-SUBMIT-001@2", kind: "TestSpec", title: "提交已 Seed 的草稿订单", meta: "CONTROLLED_WRITE", status: "ACTIVE", relation: "ASSERTED_BY", provenance: "独立批准的 TestSpec" },
    { id: "ASSERT-HTTP-DB", kind: "Assertions", title: "HTTP 200 · DB=SUBMITTED", meta: "2 deterministic checks", status: "ACTIVE", relation: "EXECUTED_AS", provenance: "Runner deterministic assertions" },
    { id: "EXEC-WRITE-001", kind: "Execution", title: "PASS · cleanup PASS", meta: "runner 1.1.0", status: "ACTIVE", relation: "PROVEN_BY", provenance: "Signed Runner task" },
    { id: "EVIDENCE-BUNDLE-001", kind: "Evidence", title: "请求 · 响应 · SQL · 生命周期", meta: "HMAC verified", status: "ACTIVE", provenance: "Current deployment evidence" },
  ],
  gaps: [],
  evidence: [
    { type: "HTTP", id: "EVIDENCE-EXEC-WRITE-001-invoke-endpoint", detail: "POST /orders/ORDER-001/submit → 200", state: "VERIFIED" },
    { type: "DATABASE", id: "EVIDENCE-EXEC-WRITE-001-verify-database", detail: "order_by_id → status=SUBMITTED", state: "VERIFIED" },
    { type: "ASSERTION", id: "EVIDENCE-EXEC-WRITE-001-ASSERTIONS", detail: "2 / 2 deterministic assertions", state: "VERIFIED" },
    { type: "LIFECYCLE", id: "EVIDENCE-EXEC-WRITE-001-LIFECYCLE", detail: "Seed PASS · cleanup PASS", state: "VERIFIED" },
  ],
  reasons: [
    "业务声明由有权限的业务负责人确认，并绑定明确 Scope。",
    "实现 Fact 与当前 Snapshot Manifest 精确映射，符合性为 CONFORMS。",
    "批准的 TestSpec 在当前部署执行，API 与数据库断言全部通过。",
    "Evidence 绑定 Runner、TestSpec 版本、部署制品并通过完整性校验。",
  ],
};

const staleScenario: Scenario = {
  ...completeScenario,
  snapshotId: "SNAPSHOT-92A44C",
  deploymentId: "DEPLOY-SIT-20260714.5",
  computedAt: "2026-07-14 17:18:31 CST",
  complete: false,
  dimensions: [
    { label: "业务权威", value: "CONFIRMED" },
    { label: "实现符合性", value: "STALE" },
    { label: "验证结果", value: "NOT_RUN" },
    { label: "证据新鲜度", value: "STALE" },
    { label: "冲突", value: "NONE" },
  ],
  nodes: completeScenario.nodes.map((node, index) => ({
    ...node,
    status: index <= 2 ? "ACTIVE" : "STALE",
  })),
  gaps: [
    { type: "CONFORMANCE_STALE", severity: "BLOCKING", ownerRole: "DEVELOPER", message: "订单提交处理器发生语义变化，需要重新分析当前实现是否仍符合已确认规则。" },
    { type: "NOT_EXECUTED_ON_CURRENT_DEPLOYMENT", severity: "BLOCKING", ownerRole: "QUALITY_OWNER", message: "已批准 TestSpec 尚未在 DEPLOY-SIT-20260714.5 上重新执行。" },
    { type: "EVIDENCE_STALE", severity: "WARNING", ownerRole: "QUALITY_OWNER", message: "历史 Evidence 保留，但不能证明新部署当前正常。" },
  ],
  reasons: [
    "规范性 Claim 与业务 Decision 仍然有效，没有被代码变化自动废弃。",
    "处理器 Fact 已变化，因此实现符合性和后续验证链路被标记为 STALE。",
    "必须重新分析映射并在当前部署重跑 TestSpec，才能恢复完整可信链。",
  ],
};

function tone(value: string) {
  if (["CONFIRMED", "CONFORMS", "PASS", "FRESH", "NONE", "VERIFIED", "ACTIVE"].includes(value)) return "good";
  if (["STALE", "NOT_RUN", "EXPIRING", "PENDING", "INCOMPLETE"].includes(value)) return "warn";
  return "bad";
}

function nodeLabel(type: string) {
  return ({
    FEATURE: "Feature",
    CLAIM: "Claim",
    CLAIM_SCOPE: "Scope",
    DECISION: "Decision",
    IMPLEMENTATION_CONFORMANCE: "Conformance",
    IMPLEMENTATION_FACT: "Implementation",
    TEST_SPEC: "TestSpec",
    TEST_ASSERTION: "Assertions",
    TEST_EXECUTION: "Execution",
    EVIDENCE: "Evidence",
  } as Record<string, string>)[type] ?? type.replaceAll("_", " ");
}

function fromApi(input: Record<string, unknown>): Scenario {
  const feature = input.feature as { id?: string; name?: string; version?: number } | undefined;
  const snapshot = input.snapshotManifest as { id?: string; components?: { deployment?: { id?: string } } } | undefined;
  const chains = Array.isArray(input.traceChains) ? input.traceChains as Array<Record<string, unknown>> : [];
  const chain = chains[0] ?? {};
  const segments = Array.isArray(chain.segments) ? chain.segments as Array<Record<string, unknown>> : [];
  const nodeMap = new Map<string, ChainNode>();
  for (const segment of segments) {
    for (const endpoint of [segment.from, segment.to]) {
      const ref = endpoint as { id?: string; type?: string; version?: string | number | null } | undefined;
      if (!ref?.id || nodeMap.has(`${ref.type}:${ref.id}`)) continue;
      nodeMap.set(`${ref.type}:${ref.id}`, {
        id: ref.id,
        kind: nodeLabel(ref.type ?? "UNKNOWN"),
        title: ref.id,
        meta: ref.version == null ? "immutable" : `version ${ref.version}`,
        status: (segment.status as NodeStatus) ?? "PENDING",
        relation: segment.relation as string | undefined,
        provenance: String(segment.provenance ?? "server-derived"),
      });
    }
  }
  const dimensions = input.dimensions as Record<string, Array<{ status?: string }>> | undefined;
  const dimensionLabels: Record<string, string> = {
    authority: "业务权威", conformance: "实现符合性", verification: "验证结果", freshness: "证据新鲜度", conflict: "冲突",
  };
  const dimensionList = Object.entries(dimensionLabels).map(([key, label]) => ({
    label,
    value: dimensions?.[key]?.[0]?.status ?? "UNKNOWN",
  }));
  const claims = Array.isArray(input.claims) ? input.claims as Array<Record<string, unknown>> : [];
  const evidence = claims.flatMap((claim) => Array.isArray(claim.evidence) ? claim.evidence as Array<Record<string, unknown>> : [])
    .slice(0, 8)
    .map((item) => ({
      type: String(item.type ?? "EVIDENCE"),
      id: String(item.id ?? "unknown"),
      detail: String(item.contentHash ?? item.storageUri ?? "snapshot-bound manifest"),
      state: String(item.integrity ?? "VERIFIED"),
    }));
  const gaps = Array.isArray(input.gaps) ? input.gaps as Gap[] : [];
  const complete = chains.length > 0 && chains.every((item) => item.complete === true) && gaps.length === 0;
  return {
    feature: { id: feature?.id ?? "UNKNOWN-FEATURE", name: feature?.name ?? feature?.id ?? "Unknown feature", version: feature?.version ?? 1 },
    snapshotId: snapshot?.id ?? "UNKNOWN-SNAPSHOT",
    deploymentId: snapshot?.components?.deployment?.id ?? String(chain.deploymentId ?? "UNKNOWN-DEPLOYMENT"),
    computedAt: String(input.computedAt ?? new Date().toISOString()),
    complete,
    dimensions: dimensionList,
    nodes: [...nodeMap.values()],
    gaps,
    evidence,
    reasons: complete
      ? ["服务端派生的全部追踪链均完整。", "所有独立维度满足当前 Snapshot 与部署的可信要求。", "没有未解决的 TraceGap。"]
      : ["服务端返回了未闭合的 TraceGap。", "只有完成缺口修复与重新计算后，平台才会恢复可信状态。"],
  };
}

export function TraqenProduct() {
  const [view, setView] = useState<View>("trace");
  const [scenarioKey, setScenarioKey] = useState<"current" | "changed">("current");
  const [liveScenario, setLiveScenario] = useState<Scenario | null>(null);
  const [selectedId, setSelectedId] = useState(completeScenario.nodes[0].id);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [apiBase, setApiBase] = useState("http://127.0.0.1:3100");
  const [projectId, setProjectId] = useState("PROJECT-001");
  const [featureId, setFeatureId] = useState("FEATURE-ORDER-SUBMIT-001");
  const [snapshotId, setSnapshotId] = useState("SNAPSHOT-MANIFEST-001");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const scenario = liveScenario ?? (scenarioKey === "current" ? completeScenario : staleScenario);
  const selected = useMemo(
    () => scenario.nodes.find((node) => node.id === selectedId) ?? scenario.nodes[0],
    [scenario, selectedId],
  );

  async function loadTraceability() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const url = `${base}/v1/projects/${encodeURIComponent(projectId)}/features/${encodeURIComponent(featureId)}/traceability?snapshotManifestId=${encodeURIComponent(snapshotId)}`;
      const response = await fetch(url, { headers: { accept: "application/json" } });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        const error = body.error as { message?: string } | undefined;
        throw new Error(error?.message ?? `API returned ${response.status}`);
      }
      const normalized = fromApi(body);
      setLiveScenario(normalized);
      setSelectedId(normalized.nodes[0]?.id ?? "");
      setConnectionOpen(false);
      setMessage("已加载服务端派生的 Feature 追溯视图。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载追溯视图");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">TQ</span>Traqen</div>
        <div>
          <p className="workspace-label">Workspace</p>
          <div className="workspace"><strong>Order Platform</strong><small>PROJECT-001 · SIT</small></div>
        </div>
        <nav className="nav" aria-label="产品导航">
          <button className={`nav-button ${view === "trace" ? "active" : ""}`} onClick={() => setView("trace")}><span className="nav-icon">→</span>功能追溯</button>
          <button className={`nav-button ${view === "review" ? "active" : ""}`} onClick={() => setView("review")}><span className="nav-icon">✓</span>声明审核</button>
          <button className={`nav-button ${view === "impact" ? "active" : ""}`} onClick={() => setView("impact")}><span className="nav-icon">△</span>变更影响</button>
        </nav>
        <div className="sidebar-note"><b>北极星</b><br />从当前部署证据反向证明业务规则，而不是统计生成了多少文档或测试。</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">Order Platform&nbsp; / &nbsp;<b>{view === "trace" ? "功能追溯" : view === "review" ? "声明审核" : "变更影响"}</b></div>
          <div className="top-actions">
            <span className={`mode-badge ${liveScenario ? "live" : ""}`}>{liveScenario ? "LIVE API" : "DEMO SNAPSHOT"}</span>
            {liveScenario && <button className="button ghost" onClick={() => setLiveScenario(null)}>返回演示</button>}
            <button className="button" onClick={() => setConnectionOpen((value) => !value)}>连接 Traqen API</button>
          </div>
        </header>

        {connectionOpen && (
          <section className="panel connection-panel" aria-label="API 连接">
            <div className="connection-grid">
              <div className="field full"><label htmlFor="api-base">API Base URL</label><input id="api-base" value={apiBase} onChange={(event) => setApiBase(event.target.value)} /></div>
              <div className="field"><label htmlFor="project-id">Project ID</label><input id="project-id" value={projectId} onChange={(event) => setProjectId(event.target.value)} /></div>
              <div className="field"><label htmlFor="feature-id">Feature ID</label><input id="feature-id" value={featureId} onChange={(event) => setFeatureId(event.target.value)} /></div>
              <div className="field full"><label htmlFor="snapshot-id">Snapshot Manifest ID</label><input id="snapshot-id" value={snapshotId} onChange={(event) => setSnapshotId(event.target.value)} /></div>
            </div>
            <div className="connection-actions"><button className="button primary" disabled={loading} onClick={loadTraceability}>{loading ? "加载中…" : "加载服务端追溯视图"}</button>{message && <span className={`form-message ${message.startsWith("已加载") ? "" : "error"}`}>{message}</span>}</div>
          </section>
        )}

        {view === "trace" && <TraceView scenario={scenario} demo={!liveScenario} scenarioKey={scenarioKey} setScenarioKey={setScenarioKey} selected={selected} setSelectedId={setSelectedId} />}
        {view === "review" && <ReviewView apiBase={apiBase} projectId={projectId} />}
        {view === "impact" && <ImpactView apiBase={apiBase} projectId={projectId} />}
      </main>
    </div>
  );
}

function TraceView({ scenario, demo, scenarioKey, setScenarioKey, selected, setSelectedId }: {
  scenario: Scenario;
  demo: boolean;
  scenarioKey: "current" | "changed";
  setScenarioKey: (value: "current" | "changed") => void;
  selected?: ChainNode;
  setSelectedId: (value: string) => void;
}) {
  return <>
    <section className="hero">
      <div className="hero-card"><p className="eyebrow">Feature · {scenario.feature.id} · v{scenario.feature.version}</p><h1>{scenario.feature.name}</h1><p className="hero-sub">从已确认业务声明出发，沿实现、测试与执行证据回答：为什么相信这个功能在当前部署正常？每个状态维度独立展示，任何断链都会阻止“完整可信”。</p></div>
      <div className="hero-card trust-card"><div className="trust-status"><span className={`status-light ${scenario.complete ? "" : "warn"}`} />{scenario.complete ? "追踪链完整" : "存在阻断缺口"}</div><div><strong>{scenario.complete ? "当前可被证据支持" : "当前不能证明正常"}</strong><p>{scenario.deploymentId}<br />{scenario.computedAt}</p></div></div>
    </section>

    <section className="dimension-grid" aria-label="独立可信维度">
      {scenario.dimensions.map((dimension) => <div className="dimension-card" key={dimension.label}><span>{dimension.label}</span><div className="dimension-value"><i className={`dot ${tone(dimension.value) === "warn" ? "warn" : tone(dimension.value) === "bad" ? "bad" : ""}`} />{dimension.value}</div></div>)}
    </section>

    <section className="panel">
      <div className="panel-head"><div><h2>端到端证据追踪链</h2><p>Snapshot {scenario.snapshotId} · 点击节点查看来源与绑定</p></div>{demo && <div className="scenario-switch"><button className={scenarioKey === "current" ? "active" : ""} onClick={() => setScenarioKey("current")}>当前部署</button><button className={scenarioKey === "changed" ? "active" : ""} onClick={() => setScenarioKey("changed")}>代码变更后</button></div>}</div>
      <div className="chain-wrap"><div className="chain">{scenario.nodes.map((node, index) => <div className="chain-item" key={node.id}><button className={`chain-node ${node.status.toLowerCase()} ${selected?.id === node.id ? "selected" : ""}`} onClick={() => setSelectedId(node.id)}><span className="node-kind">{node.kind}</span><strong className="node-title">{node.title}</strong><span className="node-meta">{node.meta}<br />{node.status}</span></button>{index < scenario.nodes.length - 1 && <div className="chain-link" aria-hidden="true"><span /></div>}</div>)}</div><div className="relation-row" aria-hidden="true">{scenario.nodes.slice(0, -1).map((node) => <span key={node.id}>{node.relation ?? "LINKED_TO"}</span>)}</div></div>
      <div className="chain-foot"><div className="detail-pane"><h3>Selected node</h3>{selected && <div className="detail-kv"><span>类型</span><span>{selected.kind}</span><span>ID</span><span>{selected.id}</span><span>来源</span><span>{selected.provenance}</span><span>状态</span><span>{selected.status}</span></div>}</div><div className="why-pane"><h3>{scenario.complete ? "为什么相信" : "为什么不能相信"}</h3><ul>{scenario.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div></div>
    </section>

    <div className="two-column">
      <section className="panel"><div className="panel-head"><div><h2>TraceGap</h2><p>缺口、责任角色与下一步动作</p></div><span className="mode-badge">{scenario.gaps.length} OPEN</span></div><div className="gap-list">{scenario.gaps.length === 0 ? <div className="gap-empty">没有缺失环节。该状态仅对所选 Snapshot 与部署成立。</div> : scenario.gaps.map((gap) => <div className="gap" key={gap.type}><div className="gap-top"><span>{gap.severity} · {gap.type}</span><span className="owner">{gap.ownerRole}</span></div><p>{gap.message}</p></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><h2>Evidence</h2><p>当前执行产生的已验证证据</p></div></div><div className="evidence-list">{scenario.evidence.map((item) => <div className="evidence-item" key={item.id}><div><strong>{item.type} · {item.detail}</strong><small>{item.id}</small></div><span className="evidence-state">{item.state}</span></div>)}</div></section>
    </div>
  </>;
}

const demoCandidate: ReviewCandidate = {
  id: "CANDIDATE-ORDER-ENDPOINT-001",
  featureCandidateId: "CANDIDATE-FEATURE-ORDER-001",
  statement: "订单提交能力必须暴露标准订单的提交端点。",
  subjectKey: "endpoint:POST /orders/{id}/submit",
  constraint: { dimension: "endpointExposed", operator: "EQUALS", value: true },
  scope: { actor: "normal-user", orderType: "standard" },
  evidence: [
    { factId: "FACT-ENDPOINT-ORDER-SUBMIT", relation: "SUPPORTS" },
    { factId: "FACT-TABLE-ORDERS", relation: "SUPPORTS" },
    { factId: "FACT-CONFIG-SUBMIT-ENABLED", relation: "CONTEXT" },
  ],
  sources: [
    { candidateId: "RAW-SPECONE-001", producer: { skillId: "specone-reference", skillVersion: "1.0.0" } },
    { candidateId: "RAW-GSD-001", producer: { skillId: "gsd-reference", skillVersion: "1.0.0" } },
  ],
};

function parseObject(value: string, field: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${field} 必须是 JSON object`);
  return parsed as Record<string, unknown>;
}

function ReviewView({ apiBase, projectId }: { apiBase: string; projectId: string }) {
  const [candidate, setCandidate] = useState<ReviewCandidate>(demoCandidate);
  const [liveCandidate, setLiveCandidate] = useState(false);
  const [runId, setRunId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [reviewId, setReviewId] = useState("REVIEW-UI-001");
  const [token, setToken] = useState("");
  const [outcome, setOutcome] = useState("");
  const [rationale, setRationale] = useState("业务负责人确认该声明适用于所选范围。");
  const [featureMode, setFeatureMode] = useState<"CREATE" | "EXISTING">("CREATE");
  const [featureId, setFeatureId] = useState("FEATURE-ORDER-SUBMIT-001");
  const [claimId, setClaimId] = useState("CLAIM-ORDER-ENDPOINT-001");
  const [scopeId, setScopeId] = useState("SCOPE-ORDER-ENDPOINT-001");
  const [decisionId, setDecisionId] = useState("DECISION-ORDER-ENDPOINT-001");
  const [statement, setStatement] = useState(demoCandidate.statement);
  const [scopeJson, setScopeJson] = useState(JSON.stringify(demoCandidate.scope, null, 2));
  const [conflictIds, setConflictIds] = useState("");
  const [associationRationale, setAssociationRationale] = useState("该候选描述既有 Feature 的当前实现。");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadCandidate() {
    if (!runId.trim() || !candidateId.trim()) {
      setMessage("请先填写 Reverse Run ID 与 Candidate ID。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/reverse-runs/${encodeURIComponent(runId)}`);
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const merged = body.mergedOutput as Record<string, unknown> | undefined;
      const claims = Array.isArray(merged?.candidateClaims) ? merged.candidateClaims as Array<Record<string, unknown>> : [];
      const raw = claims.find((item) => item.id === candidateId);
      if (!raw) throw new Error("该 Reverse Run 中未找到 Candidate ID。");
      const features = Array.isArray(merged?.candidateFeatures) ? merged.candidateFeatures as Array<Record<string, unknown>> : [];
      const feature = features.find((item) => item.externalKey === raw.subjectKey);
      const loaded: ReviewCandidate = {
        id: String(raw.id),
        featureCandidateId: String(feature?.id ?? ""),
        statement: String((Array.isArray(raw.statements) ? raw.statements[0] : raw.statement) ?? raw.subjectKey ?? raw.id),
        subjectKey: String(raw.subjectKey ?? raw.id),
        constraint: (raw.constraint as ReviewCandidate["constraint"] | undefined) ?? { dimension: "candidateAccepted", operator: "EQUALS", value: true },
        scope: (raw.scope as Record<string, unknown> | undefined) ?? {},
        evidence: (Array.isArray(raw.evidence) ? raw.evidence : []) as ReviewCandidate["evidence"],
        sources: (Array.isArray(raw.sources) ? raw.sources : []) as ReviewCandidate["sources"],
      };
      setCandidate(loaded);
      setStatement(loaded.statement);
      setScopeJson(JSON.stringify(loaded.scope, null, 2));
      setLiveCandidate(true);
      setMessage("已加载候选；正式提交仍需核对规范性表述、Scope 与目标 ID。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法加载候选");
    } finally {
      setLoading(false);
    }
  }

  async function submitReview(selectedOutcome: "CONFIRMED" | "EXCEPTION_RECORDED" | "REJECTED") {
    if (!liveCandidate) {
      setOutcome(selectedOutcome);
      setMessage(`演示选择：${selectedOutcome}。演示模式不会写入业务基线。`);
      return;
    }
    if (!token.trim()) {
      setMessage("正式提交需要 Reviewer bearer token；身份与角色由服务端解析。");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const request: Record<string, unknown> = {
        id: reviewId,
        outcome: selectedOutcome,
        rationale,
        acknowledgedConflictIds: conflictIds.split(",").map((item) => item.trim()).filter(Boolean),
      };
      if (selectedOutcome !== "REJECTED") {
        request.candidateFeatureId = candidate.featureCandidateId;
        request.target = {
          featureMode,
          featureId,
          claimId,
          scopeId,
          decisionId,
          ...(featureMode === "CREATE"
            ? { featureName: candidate.subjectKey, businessDomain: "reviewed-candidate" }
            : { associationRationale }),
        };
        request.normative = {
          statement,
          constraint: candidate.constraint,
          scope: parseObject(scopeJson, "Scope"),
          decisionContent: rationale,
        };
      }
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/reverse-runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidate.id)}/reviews`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      const review = body.review as { outcome?: string; actorId?: string; actorRole?: string } | undefined;
      setOutcome(review?.outcome ?? selectedOutcome);
      setMessage(`已由服务端记录 ${review?.outcome ?? selectedOutcome}；审核人 ${review?.actorId ?? "server-resolved"} / ${review?.actorRole ?? "authorized-role"}。`);
      setToken("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "审核提交失败");
    } finally {
      setLoading(false);
    }
  }

  return <>
    <section className="panel review-loader"><div className="panel-head"><div><h2>加载待审核候选</h2><p>从 Reverse Run 读取原始候选与 Fact 来源；浏览器不生成业务真相。</p></div><span className={`mode-badge ${liveCandidate ? "live" : ""}`}>{liveCandidate ? "LIVE CANDIDATE" : "DEMO CANDIDATE"}</span></div><div className="inline-form"><div className="field"><label htmlFor="review-run">Reverse Run ID</label><input id="review-run" value={runId} onChange={(event) => setRunId(event.target.value)} /></div><div className="field"><label htmlFor="review-candidate">Candidate ID</label><input id="review-candidate" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} /></div><button className="button primary" disabled={loading} onClick={loadCandidate}>{loading ? "处理中…" : "加载候选"}</button></div></section>
    <div className="review-grid">
      <section className="panel candidate"><p className="eyebrow">Reverse candidate · WAITING_REVIEW</p><h1>{candidate.subjectKey}</h1><div className="candidate-statement">“{candidate.statement}”</div><p className="hero-sub">这是 Skill 生成的候选陈述，不是业务事实。确认时平台会新建独立的规范性 Claim 与 Decision，并保留候选原文和 Fact 证据。</p><h2>原始证据</h2><div className="candidate-evidence">{candidate.evidence.map((item) => <div className="evidence-snippet" key={`${item.factId}:${item.relation}`}>{item.relation} · {item.factId}</div>)}{candidate.sources.map((item, index) => <div className="evidence-snippet" key={`${item.candidateId ?? index}:source`}>SOURCE · {item.producer?.skillId ?? "unknown-skill"}@{item.producer?.skillVersion ?? "unknown"}<br />{item.candidateId ?? "raw candidate"}</div>)}</div></section>
      <section className="panel decision-box"><p className="eyebrow">Human authority boundary</p><h2>最小声明审核</h2><p>候选不能自行晋升为业务真相。正式提交由服务端鉴权、校验冲突并记录不可变 Decision。</p><div className="review-fields"><div className="field full"><label htmlFor="normative-statement">规范性表述</label><textarea id="normative-statement" value={statement} onChange={(event) => setStatement(event.target.value)} /></div><div className="field full"><label htmlFor="scope-json">Scope JSON</label><textarea id="scope-json" value={scopeJson} onChange={(event) => setScopeJson(event.target.value)} /></div><div className="field"><label htmlFor="feature-mode">Feature 模式</label><select id="feature-mode" value={featureMode} onChange={(event) => setFeatureMode(event.target.value as "CREATE" | "EXISTING")}><option value="CREATE">CREATE</option><option value="EXISTING">EXISTING</option></select></div><div className="field"><label htmlFor="target-feature">Feature ID</label><input id="target-feature" value={featureId} onChange={(event) => setFeatureId(event.target.value)} /></div><div className="field"><label htmlFor="target-claim">Claim ID</label><input id="target-claim" value={claimId} onChange={(event) => setClaimId(event.target.value)} /></div><div className="field"><label htmlFor="target-scope">Scope ID</label><input id="target-scope" value={scopeId} onChange={(event) => setScopeId(event.target.value)} /></div><div className="field"><label htmlFor="target-decision">Decision ID</label><input id="target-decision" value={decisionId} onChange={(event) => setDecisionId(event.target.value)} /></div><div className="field"><label htmlFor="review-id">Review ID</label><input id="review-id" value={reviewId} onChange={(event) => setReviewId(event.target.value)} /></div>{featureMode === "EXISTING" && <div className="field full"><label htmlFor="association-rationale">关联既有 Feature 的理由</label><textarea id="association-rationale" value={associationRationale} onChange={(event) => setAssociationRationale(event.target.value)} /></div>}<div className="field full"><label htmlFor="review-rationale">审核理由</label><textarea id="review-rationale" value={rationale} onChange={(event) => setRationale(event.target.value)} /></div><div className="field full"><label htmlFor="conflict-ids">已确认 Conflict IDs（逗号分隔）</label><input id="conflict-ids" value={conflictIds} onChange={(event) => setConflictIds(event.target.value)} /></div><div className="field full"><label htmlFor="review-token">Reviewer bearer token（仅保存在当前页面内存，成功后清空）</label><input id="review-token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></div></div><div className="decision-actions"><button disabled={loading} className="decision-action confirm" onClick={() => void submitReview("CONFIRMED")}><b>确认最小声明</b><span>创建独立 Claim、Scope 与 CONFIRMED Decision</span></button><button disabled={loading} className="decision-action" onClick={() => void submitReview("EXCEPTION_RECORDED")}><b>确认并记录例外</b><span>保留冲突并明确适用边界</span></button><button disabled={loading} className="decision-action" onClick={() => void submitReview("REJECTED")}><b>驳回候选</b><span>不创建规范性业务基线</span></button></div><div className={`review-notice ${message && !message.startsWith("已") && !message.startsWith("演示") ? "error" : ""}`}>{message || (outcome ? `审核结果：${outcome}` : "演示候选的选择不会写入；只有加载真实候选并提供凭据后才会调用正式审核 API。")}</div></section>
    </div>
  </>;
}

function ImpactView({ apiBase, projectId }: { apiBase: string; projectId: string }) {
  const [changeSetId, setChangeSetId] = useState("CHANGESET-UI-001");
  const [fromSnapshot, setFromSnapshot] = useState("SNAPSHOT-7D31E8");
  const [toSnapshot, setToSnapshot] = useState("SNAPSHOT-92A44C");
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function compareSnapshots() {
    setLoading(true);
    setMessage("");
    try {
      const base = apiBase.replace(/\/$/, "");
      const response = await fetch(`${base}/v1/projects/${encodeURIComponent(projectId)}/change-sets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: changeSetId, fromSnapshotManifestId: fromSnapshot, toSnapshotManifestId: toSnapshot }),
      });
      const body = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String((body.error as { message?: string } | undefined)?.message ?? `API returned ${response.status}`));
      setResult(body as unknown as ImpactResult);
      setMessage("已加载服务端持久化的 Snapshot 历史比较与分层失效结果。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Snapshot 比较失败");
    } finally {
      setLoading(false);
    }
  }

  const changes = result?.changeSet.changes ?? [{ id: "CHANGE-DEMO-001", kind: "MODIFIED", changeType: "SOURCE_CODE", artifact: "src/orders.js" }];
  const invalidations = result?.impact.invalidations ?? [{ id: "INVALIDATION-DEMO-001", featureId: "FEATURE-ORDER-SUBMIT-001", layers: ["CONFORMANCE", "VERIFICATION", "TRACE_SEGMENTS"], preserves: ["NORMATIVE_CLAIM", "BUSINESS_DECISION", "HISTORICAL_FACTS", "HISTORICAL_EVIDENCE"], reason: "Endpoint Fact 的 handlerVersion 与内容 Hash 发生变化，旧实现映射不能证明新 Snapshot。", recommendedActions: ["REMAP_IMPLEMENTATION_FACTS", "RECOMPUTE_IMPLEMENTATION_CONFORMANCE", "RERUN_AFFECTED_TESTS", "RECOMPUTE_TRACE_CHAIN"] }];
  const affectedFeatures = result?.impact.affectedFeatureIds ?? ["FEATURE-ORDER-SUBMIT-001"];
  const affectedClaims = result?.impact.affectedClaimRefs ?? [{ id: "CLAIM-ORDER-STATUS-001", version: 1 }];
  const affectedTests = result?.impact.affectedTestSpecIds ?? ["TEST-ORDER-SUBMIT-001"];

  return <>
    <section className="panel review-loader"><div className="panel-head"><div><h2>历史版本比较</h2><p>由服务端比较两个不可变 Snapshot Manifest，并持久化可审计 ChangeSet。</p></div><span className={`mode-badge ${result ? "live" : ""}`}>{result ? "LIVE IMPACT" : "DEMO IMPACT"}</span></div><div className="inline-form impact-form"><div className="field"><label htmlFor="change-set">ChangeSet ID</label><input id="change-set" value={changeSetId} onChange={(event) => setChangeSetId(event.target.value)} /></div><div className="field"><label htmlFor="from-snapshot">From Snapshot</label><input id="from-snapshot" value={fromSnapshot} onChange={(event) => setFromSnapshot(event.target.value)} /></div><div className="field"><label htmlFor="to-snapshot">To Snapshot</label><input id="to-snapshot" value={toSnapshot} onChange={(event) => setToSnapshot(event.target.value)} /></div><button className="button primary" disabled={loading} onClick={compareSnapshots}>{loading ? "比较中…" : "比较并记录影响"}</button></div>{message && <div className="inline-message">{message}</div>}</section>
    <div className="impact-grid">
      <section className="panel"><div className="panel-head"><div><h2>Snapshot 变更影响</h2><p>{result?.changeSet.fromSnapshotManifestId ?? fromSnapshot} → {result?.changeSet.toSnapshotManifestId ?? toSnapshot}</p></div><span className="mode-badge">{changes.length} FACT CHANGES</span></div><div className="impact-summary"><div className="metric"><strong>{affectedFeatures.length}</strong><span>受影响 Feature</span></div><div className="metric"><strong>{affectedClaims.length}</strong><span>受影响 Claim</span></div><div className="metric"><strong>{affectedTests.length}</strong><span>需重跑 TestSpec</span></div></div><div className="candidate">{changes.slice(0, 8).map((change) => <div className="impact-row" key={change.id}><b>{change.kind} · {change.changeType} · {change.artifact ?? change.id}</b><p>该差异来自服务端 Fact Graph 比较；缺失或不完整扫描会保留 warning，不能伪装成完整影响结论。</p></div>)}{invalidations.map((item) => <div className="impact-row" key={item.id}><b>{item.featureId} · 分层失效</b><p>{item.reason}</p><p>{item.layers.map((layer) => <span className="preserved invalidated" key={layer}>{layer} → STALE</span>)}</p><p>{item.preserves.map((layer) => <span className="preserved" key={layer}>{layer}</span>)}</p></div>)}{result && result.changeSet.warnings.length > 0 && <div className="impact-row"><b>比较警告</b><p>{result.changeSet.warnings.join(" · ")}</p></div>}</div></section>
      <section className="panel impact-card"><p className="eyebrow">Repair queue</p><h2>断链修复顺序</h2>{[...new Set(invalidations.flatMap((item) => item.recommendedActions))].map((action, index) => <div className="impact-row" key={action}><b>{index + 1} · {action}</b><p>按服务端给出的推荐动作修复受影响 segment；Claim、Decision 与历史 Evidence 不因代码变化自动删除。</p></div>)}{result && result.impact.continuedFeatureIds.length > 0 && <div className="impact-row"><b>无需失效的连续 Feature</b><p>{result.impact.continuedFeatureIds.join(" · ")}</p></div>}</section>
    </div>
  </>;
}

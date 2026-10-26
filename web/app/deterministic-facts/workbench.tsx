"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeProductRoute } from "../product-navigation.ts";
import { SourceClientError } from "../source-truth/client.ts";
import type { SourceOverview } from "../source-truth/types.ts";
import { FactsClientError, type DeterministicFactsClient } from "./client.ts";
import { evidenceHref, evidenceReturnHref, evidenceTabs, readEvidenceLocation, type EvidenceLocation } from "./model.ts";
import { RecordBrowser, CoverageView } from "./record-browser.tsx";
import { DeliveryPanel } from "./delivery-panel.tsx";
import { RequestPanel } from "./request-panel.tsx";
import type { FactsOverview } from "./types.ts";
import { EvidenceTransport } from "./transport.ts";
import "./workbench.css";

const short = (id?: string | null) => id ? `${id.slice(0, 12)}…` : "未绑定";
const tabLabels = { objects: "对象与事实", relations: "关系", coverage: "覆盖与缺口", delivery: "分析任务" };

export function DeterministicFactsWorkbench({ apiBase, apiToken, workspaceId, workspaceName }: {
  apiBase: string; apiToken: string; workspaceId: string; workspaceName: string;
}) {
  return <section className="f002-workbench" aria-label="技术证据工作台"><EvidenceSession key={workspaceId} apiBase={apiBase} token={apiToken} workspaceId={workspaceId} workspaceName={workspaceName} /></section>;
}

function EvidenceSession({ apiBase, token, workspaceId, workspaceName }: { apiBase: string; token: string; workspaceId: string; workspaceName: string }) {
  const search = useSyncExternalStore(subscribeProductRoute, () => window.location.search, () => "");
  const parsed = useMemo(() => {
    try {
      const context = search ? readEvidenceLocation(search) : { workspaceId, tab: "objects" as const };
      if (context.workspaceId !== workspaceId) throw new Error("引用属于另一工作区，不能在当前身份上下文读取。");
      return { context, error: null };
    } catch (error) { return { context: null, error: error as Error }; }
  }, [search, workspaceId]);
  const context = parsed.context;
  const transport = useMemo(() => new EvidenceTransport(apiBase, token, workspaceId), [apiBase, token, workspaceId]);
  const clients = useSyncExternalStore(transport.subscribe, transport.getSnapshot, transport.getServerSnapshot);
  const [overview, setOverview] = useState<FactsOverview | null>(null), [access, setAccess] = useState<SourceOverview | null>(null);
  const [error, setError] = useState<Error | null>(null), [lost, setLost] = useState(false), [refreshKey, setRefreshKey] = useState(0);
  const sequence = useRef(0);
  const initialOverview = useRef<DeterministicFactsClient | null>(null);
  const navigate = useCallback((next: EvidenceLocation, replace = false) => {
    const href = evidenceHref(next);
    if (`${location.pathname}${location.search}` === href) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", href);
    window.dispatchEvent(new Event("traqen:navigate"));
  }, []);
  const accessLost = useCallback((error: Error) => {
    sequence.current += 1; transport.close();
    setOverview(null); setAccess(null); setError(error); setLost(true);
  }, [transport]);
  const refresh = useCallback(async () => {
    if (!clients || clients.facts.signal?.aborted || lost) return;
    const read = ++sequence.current;
    try {
      const result = await clients.facts.request<FactsOverview>();
      if (clients.facts.signal?.aborted || read !== sequence.current) return;
      setOverview(result); setError(null);
      const firstRead = initialOverview.current !== clients.facts;
      initialOverview.current = clients.facts;
      // A direct visit may choose a first version once. A fixed link must
      // never be replaced by the latest version, even if it is unavailable.
      const candidates = context?.sourceVersionId ? result.versions.filter(version => version.bundleId === context.sourceVersionId) : result.versions;
      if (firstRead && context && !context.graphVersionId && candidates.length) navigate({ ...context, graphVersionId: candidates.at(-1)!.graphVersionId }, true);
      const currentAccess = await clients.sources.request<SourceOverview>();
      if (!clients.facts.signal?.aborted && read === sequence.current) setAccess(currentAccess);
    } catch (error) {
      if (clients.facts.signal?.aborted || read !== sequence.current) return;
      if ((error instanceof FactsClientError || error instanceof SourceClientError) && [401, 403].includes(error.status)) accessLost(error);
      else setError(error as Error);
    }
  }, [clients, lost, context, navigate, accessLost]);
  useEffect(() => {
    let reading = false, active = true;
    const observe = async () => { if (!active || reading) return; reading = true; try { await refresh(); } finally { reading = false; } };
    void observe();
    const timer = window.setInterval(() => void observe(), 5000);
    const focus = () => void observe();
    window.addEventListener("focus", focus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh, refreshKey]);
  if (parsed.error || !context) return <section className="f002-panel"><h1>技术证据</h1><p role="alert">固定引用无效：{parsed.error?.message}。没有替换为其他材料或版本。</p></section>;
  const current = overview?.versions.find(version => version.graphVersionId === context.graphVersionId);
  const latest = overview?.versions.at(-1);
  const chooseVersion = (graphVersionId: string) => navigate({ ...context, graphVersionId,
    sourceVersionId: overview?.versions.find(version => version.graphVersionId === graphVersionId)?.bundleId,
    kind: undefined, recordId: undefined, line: undefined, lineEnd: undefined, windowLine: undefined, graphRootId: undefined, relationReturn: undefined });
  const sourceMismatch = Boolean(current && context.sourceVersionId && context.sourceVersionId !== current.bundleId);
  const returnHref = evidenceReturnHref(context);
  return <>
    <header className="f002-heading"><div><p className="eyebrow">TECHNICAL EVIDENCE · {workspaceName}</p><h1>技术证据</h1><p>固定来源上的确定性事实、受控材料与明确限制；不代替业务调查或人工决定。</p></div><div className="f002-actions">{returnHref && <a className="button" href={returnHref}>返回原回答／会话入口</a>}<button className="button" disabled={lost} onClick={() => setRefreshKey(value => value + 1)}>复验权限并刷新</button></div></header>
    <section className="f002-context" aria-label="固定版本上下文"><div><b>来源版本 F001</b><code title={context.sourceVersionId ?? current?.bundleId}>{short(context.sourceVersionId ?? current?.bundleId)}</code></div><div><b>正在浏览的事实集 F002</b><select aria-label="选择固定事实集" value={context.graphVersionId ?? ""} disabled={!overview || lost} onChange={event => chooseVersion(event.target.value)}><option value="">尚无可读事实集</option>{context.graphVersionId && !current && <option value={context.graphVersionId}>{short(context.graphVersionId)} · 原固定引用</option>}{overview?.versions.map(version => <option key={version.graphVersionId} value={version.graphVersionId}>{short(version.graphVersionId)} · {version.publishedAt}</option>)}</select></div><div><b>上游业务图版本 F003</b><code>{short(context.businessGraphRevisionId)}</code><small>只保留上游引用，不推断已采用。</small></div></section>
    {latest && current && latest.graphVersionId !== current.graphVersionId && <p className="f002-notice">⚠ 存在较新的独立事实集，当前引用仍固定。<button className="button" onClick={() => chooseVersion(latest.graphVersionId)}>明确查看新版本</button></p>}
    {lost ? <section className="f002-panel" role="alert"><h2>访问已停止</h2><p>账号权限变化或登录失效，已停止读取、清除原展示和图像句柄；不复用旧缓存。请重新登录，或确认当前工作区授权后刷新页面。</p><p>{error?.message}</p></section>
      : !overview || !clients ? <section className="f002-panel"><h2>技术证据访问尚未就绪</h2>{error ? <p role="alert">{error.message}。不可用不是空结果；未创建任何任务。</p> : <p role="status">正在验证成员、Workspace 和持久化服务…</p>}</section>
      : <><nav className="f002-tabs" aria-label="技术证据页签">{evidenceTabs.map(tab => <a key={tab} href={evidenceHref({ ...context, tab })} aria-current={context.tab === tab ? "page" : undefined} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate({ ...context, tab }); } }}>{tabLabels[tab]}</a>)}</nav>
        {error && <p className="f002-notice" role="alert">⚠ 最新状态读取未完成：{error.message}。保留上次可信阅读定位，不允许据此取得新写权限。</p>}
        {context.tab === "delivery" ? access ? <DeliveryPanel key={`${workspaceId}:${access.actor.actorId}:${context.graphVersionId ?? "none"}`} client={clients.facts} sourceClient={clients.sources} actorId={access.actor.actorId} workspaceId={workspaceId} writable={access.role === "MAINTAIN" && !error} profiles={overview.profiles} versions={overview.versions} runs={overview.activeRuns} versionId={context.graphVersionId} onVersion={chooseVersion} refresh={refresh} onAccessLost={accessLost} /> : <section className="f002-panel" role="status">正在复验操作成员身份；未发送写操作。</section>
          : sourceMismatch ? <section className="f002-panel" role="alert"><h2>固定来源与事实集不匹配</h2><p>保留原引用，不用另一来源的材料补齐。请回原工作核对，或明确选择需要浏览的事实集。</p></section>
          : !context.graphVersionId ? <section className="f002-panel"><h2>尚无分析结果</h2><p>选择来源快照即可开始技术分析，完成后直接查看对象、关联及原文依据，无需手动封存。</p><button className="button primary" onClick={() => navigate({ ...context, tab: "delivery" })}>新建分析</button></section>
          : !access ? <section className="f002-panel" role="status">正在复验当前成员；尚未恢复本地阅读偏好。</section>
          : context.tab === "coverage" ? <CoverageView key={`${access.actor.actorId}:${context.graphVersionId}`} actorId={access.actor.actorId} client={clients.facts} context={context} navigate={navigate} accessLost={accessLost} />
          : <RecordBrowser key={`${access.actor.actorId}:${context.graphVersionId}`} actorId={access.actor.actorId} client={clients.facts} context={context} navigate={navigate} accessLost={accessLost} />}
        {context.graphVersionId && access && !sourceMismatch && <RequestPanel key={JSON.stringify([workspaceId, access.actor.actorId, context.graphVersionId, context.kind, context.recordId,
          context.returnTo?.page, context.returnTo?.objectId, context.returnTo?.graphRevisionId])} client={clients.facts} context={context} actorId={access.actor.actorId} configured={overview.consumer.configured} writable={access.role === "MAINTAIN" && !error} profiles={overview.profiles} navigate={navigate} onAccessLost={accessLost} />}
        <section className="f002-panel"><h2>核查后继续工作</h2><p>复制完整引用后可返回原回答／会话。调查发现、正式决定、新材料和执行结果分别由所属流程处理；F002 不就地修改封存事实。</p><p>会话贡献及回答回写尚未接通，此处不会模拟保存或生效。新增来源请回「来源快照」。</p></section>
      </>}
  </>;
}

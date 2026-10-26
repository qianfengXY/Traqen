"use client";
import { useCallback, useState } from "react";
import { DeterministicFactsClient } from "../deterministic-facts/client.ts";
import type { EvidenceRequest, RequestPage } from "../deterministic-facts/types.ts";
import { BusinessKnowledgeClient } from "./client.ts";
import { useKnowledgeRead } from "./use-read.ts";
import { useCommandContext } from "./use-command.ts";
import { ReadIssue } from "./trace-panel.tsx";
import { shortId } from "./model.ts";
import type { Investigation } from "./types.ts";

export function TechnicalAdoption(props: { client: BusinessKnowledgeClient; apiBase: string; run: Investigation; canControl: boolean;
  onAccessLost: (error: Error) => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="bk-panel" onToggle={event => setOpen(event.currentTarget.open)}><summary>技术补证与明确采用</summary>
    <p>补证返回新版本不会自动采用。采用会保留原基准与已用预算，并重新排队调查；旧图谱仍按原依据可查。</p>
    {!props.run.technicalVersionId ? <p>本调查未绑定技术基准，直接读取原材料；没有可冒充本调查补证收据的版本。</p> : open && <RequestList {...props} />}
  </details>;
}

function RequestList({ client, apiBase, run, canControl, onAccessLost, onChanged }: {
  client: BusinessKnowledgeClient; apiBase: string; run: Investigation; canControl: boolean; onAccessLost: (error: Error) => void; onChanged: () => void;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]), [requestId, setRequestId] = useState("");
  const cursor = cursors[cursors.length - 1];
  const load = useCallback((bound: BusinessKnowledgeClient) => {
    const facts = new DeterministicFactsClient(apiBase, "", client.workspaceId, bound.signal);
    const query = new URLSearchParams({ investigationId: run.id, baseVersionId: run.technicalVersionId!, limit: "20" });
    if (cursor) query.set("cursor", cursor);
    return facts.request<RequestPage>(`/requests?${query}`);
  }, [apiBase, client.workspaceId, run.id, run.technicalVersionId, cursor]);
  const page = useKnowledgeRead(client, `requests:${run.id}:${cursor}`, load, onAccessLost);
  return <>{page.loading && <p role="status">正在查询本调查的当前授权补证记录…</p>}{page.error && <ReadIssue error={page.error} retry={page.retry} />}
    {page.data && <>{!page.data.items.length && <p>当前授权页没有补证记录；未从全局版本清单推断可采用结果。</p>}<ul className="bk-request-list">{page.data.items.map(request => <li key={request.id}><button className="bk-text-button" onClick={() => setRequestId(request.id)}>{request.questionSummary || shortId(request.id)}</button><span> · {request.status} / {request.outcome ?? "尚无结果"}</span></li>)}</ul>
      <div className="bk-actions"><button className="button" disabled={cursors.length === 1} onClick={() => { setCursors(values => values.slice(0, -1)); setRequestId(""); }}>上一页</button><button className="button" disabled={!page.data.nextCursor} onClick={() => { setCursors(values => [...values, page.data!.nextCursor]); setRequestId(""); }}>下一页</button></div></>}
    {requestId && <RequestAdoption key={requestId} client={client} apiBase={apiBase} run={run} requestId={requestId} canControl={canControl} onAccessLost={onAccessLost} onChanged={onChanged} />}
  </>;
}

function RequestAdoption({ client, apiBase, run, requestId, canControl, onAccessLost, onChanged }: {
  client: BusinessKnowledgeClient; apiBase: string; run: Investigation; requestId: string; canControl: boolean; onAccessLost: (error: Error) => void; onChanged: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const beginCommand = useCommandContext(client, `${run.id}:${run.revision}:${requestId}`);
  const load = useCallback(async (bound: BusinessKnowledgeClient) => {
    const result = await new DeterministicFactsClient(apiBase, "", client.workspaceId, bound.signal).request<{ request: EvidenceRequest }>(`/requests/${encodeURIComponent(requestId)}`);
    if (result.request.id !== requestId || result.request.investigationId !== run.id || result.request.baseVersionId !== run.technicalVersionId) throw Error("补证记录不属于本调查固定基准，未展示可采用操作。");
    return result.request;
  }, [apiBase, client.workspaceId, requestId, run.id, run.technicalVersionId]);
  const receipt = useKnowledgeRead(client, `receipt:${run.id}:${requestId}`, load, onAccessLost);
  const version = receipt.data?.result?.graphVersionId;
  const eligible = receipt.data?.status === "COMPLETED" && receipt.data.outcome === "NEW_VERSION" && typeof version === "string"
    && /^[a-f0-9]{64}$/.test(version) && !run.adoptedVersionIds.includes(version) && ["QUEUED", "RUNNING", "PAUSED"].includes(run.state);
  const adopt = async () => {
    if (!canControl || !eligible || !confirmed || !version || busy || error) return;
    const current = beginCommand();
    setBusy(true);
    try { await client.adopt(run.id, { requestId, versionId: version, expectedRevision: run.revision }); if (current()) onChanged(); }
    catch (cause) { if (current()) { const issue = cause instanceof Error ? cause : new Error("采用结果未确认"); setError(issue.message); onAccessLost(issue); } }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  return <section className="bk-adoption"><h3>固定补证收据</h3>{receipt.loading && <p role="status">复验单项收据与当前授权…</p>}{receipt.error && <ReadIssue error={receipt.error} retry={receipt.retry} />}
    {receipt.data && <><p>请求：<code>{requestId}</code></p><p>状态：{receipt.data.status}；结果：{receipt.data.outcome ?? "未返回"}</p>{version && <p>新技术版本：<code>{version}</code></p>}
      {eligible ? <><label><input type="checkbox" checked={confirmed} disabled={!canControl || busy || !!error} onChange={event => setConfirmed(event.target.checked)} />明确采用此收据的新版本，并将调查重新排队；不删除原依据</label><button className="button" disabled={!canControl || !confirmed || busy || !!error} onClick={() => void adopt()}>采用技术依据并继续调查</button></>
        : <p>此收据或调查状态不满足采用条件；未提供绕过操作。</p>}</>}
    {error && <p role="alert">{error}。未自动重试采用；请刷新调查并核对原收据及已采用版本。</p>}
  </section>;
}

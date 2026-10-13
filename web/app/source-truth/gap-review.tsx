"use client";
import { useEffect, useRef, useState } from "react";
import type { Candidate, Gap, GapAcceptance, GapPage } from "./types.ts";
import { SourceTruthClient } from "./client.ts";
import { sourcePath } from "./evidence-view.tsx";
import { observeSourceReads } from "./observe.ts";

export function GapDecision({ client, runId, candidate, gap, actorId, disabled, onAccepted }: { client: SourceTruthClient; runId: string; candidate: Candidate; gap: Gap; actorId: string; disabled: boolean; onAccepted: () => Promise<void> }) {
  const [reason, setReason] = useState(""), [expires, setExpires] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), pending = useRef(false), alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const acceptance = gap.acceptance;
  const submit = async () => {
    if (pending.current || disabled || gap.severity !== "NON_BLOCKING") return;
    pending.current = true; setBusy(true); setError("");
    try {
      await client.request<GapAcceptance>(`/runs/${runId}/gap-acceptances`, "POST", { candidateId: candidate.id, gapSetId: candidate.gapSetId,
        componentId: gap.componentId, gapKey: gap.gapKey, reason, expiresAt: new Date(expires).toISOString() });
      if (alive.current && !client.signal?.aborted) await onAccepted();
    } catch (error) { if (alive.current && !client.signal?.aborted) setError((error as Error).message); }
    finally { pending.current = false; if (alive.current && !client.signal?.aborted) setBusy(false); }
  };
  return <article className="st-callout warning"><h4>{sourcePath(gap.pathBytes)} · {gap.ruleCode}</h4><p>来源 {gap.sourceId} · 影响范围 {gap.affectedScope}</p>
    <p>{gap.severity !== "NON_BLOCKING" ? "阻断，不可接受" : acceptance ? acceptance.currentlyValid ? "已接受 · 缺失事实保留" : "接受已过期 · 须明确重新接受" : "待接受 · 不可冻结"}</p>
    {acceptance && <dl><dt>责任人</dt><dd>{acceptance.actorId}</dd><dt>理由</dt><dd>{acceptance.reason}</dd><dt>绝对期限</dt><dd>{acceptance.expiresAt}</dd><dt>接受记录</dt><dd>{acceptance.id}</dd></dl>}
    {gap.severity === "NON_BLOCKING" && (!acceptance || !acceptance.currentlyValid) && <details open={!acceptance}><summary>接受此限制</summary><form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label>接受理由<textarea maxLength={2000} value={reason} disabled={busy || disabled} onChange={event => setReason(event.target.value)} /></label>
      <p>责任人（当前用户）：{actorId}；不允许代替他人接受。</p>
      <label>有效期至（浏览器本地时间）<input type="datetime-local" step="1" value={expires} disabled={busy || disabled} onChange={event => setExpires(event.target.value)} /></label>
      {expires && Number.isFinite(Date.parse(expires)) && <small>绝对 UTC 时间：{new Date(expires).toISOString()}；服务端复验，冻结不会延长。</small>}
      {error && <p role="alert">{error}；输入保留，尚未声称保存成功。</p>}
      <button className="button" disabled={busy || disabled || !reason.trim() || !expires || !Number.isFinite(Date.parse(expires))}>{busy ? "正在保存…" : "接受此限制"}</button>
    </form></details>}
  </article>;
}

export function GapReview({ client, runId, candidate, actorId, disabled, onStatus }: { client: SourceTruthClient; runId: string; candidate: Candidate; actorId: string; disabled: boolean; onStatus: (complete: boolean, acceptedCount: string) => void }) {
  const [page, setPage] = useState<GapPage | null>(null), [cursor, setCursor] = useState<string | null>(null), [revision, setRevision] = useState(0), [error, setError] = useState("");
  const notify = useRef(onStatus);
  useEffect(() => { notify.current = onStatus; }, [onStatus]);
  useEffect(() => {
    let active = true;
    const read = async () => {
      const value = await client.request<GapPage>(`/runs/${runId}/gaps?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (active && !client.signal?.aborted) { setPage(value); setError(""); notify.current(value.gapSetId === candidate.gapSetId && value.acceptedCount === value.total, value.acceptedCount); }
    };
    const stop = observeSourceReads(read, { signal: client.signal, intervalMs: 2500, onError: error => {
      if (active && !client.signal?.aborted) { setPage(null); setError(error.message); notify.current(false, "0"); }
    } });
    return () => { active = false; stop(); };
  }, [client, runId, candidate.gapSetId, cursor, revision]);
  return <section aria-label="逐项核对与接受限制"><h3>缺口与限制 · {candidate.gapCount} 项</h3><p>接受进度：{page?.acceptedCount ?? "尚未核验"} / {candidate.gapCount}；不加入内容已验证计数。</p>
    {error && <p role="alert">{error}</p>}{page?.items.map(gap => <GapDecision key={`${candidate.id}:${gap.componentId}:${gap.gapKey}`} client={client} runId={runId} candidate={candidate} gap={gap} actorId={actorId} disabled={disabled} onAccepted={async () => { notify.current(false, page.acceptedCount); setRevision(value => value + 1); }} />)}
    {page?.nextCursor && <button className="button" onClick={() => setCursor(page.nextCursor)}>下一页限制</button>}{cursor && <button className="button" onClick={() => setCursor(null)}>限制首页</button>}
  </section>;
}

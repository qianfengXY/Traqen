"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceTruthClient } from "./client.ts";
import { continueStagingRelease, type StagingDisposition } from "./staging.ts";

export function SourceStagingView({ client, runId, writable, onChanged }: { client: SourceTruthClient; runId: string; writable: boolean; onChanged: () => Promise<void> }) {
  const [state, setState] = useState<StagingDisposition | null>(null), [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false);
  const lifecycle = useRef(0), writing = useRef(false);
  const route = `/runs/${encodeURIComponent(runId)}/staging-release`;
  useEffect(() => {
    const generation = ++lifecycle.current;
    void client.request<StagingDisposition>(route).then((value) => { if (generation === lifecycle.current && !client.signal?.aborted) setState(value); })
      .catch((error: Error) => { if (generation === lifecycle.current && !client.signal?.aborted) setError(error.message); });
    return () => { lifecycle.current = generation + 1; };
  }, [client, route]);
  const inspect = async () => {
    const generation = lifecycle.current;
    try {
      const value = await client.request<StagingDisposition>(route);
      if (generation === lifecycle.current && !client.signal?.aborted) { setState(value); setError(""); }
    } catch (error) {
      if (generation === lifecycle.current && !client.signal?.aborted) setError(error instanceof Error ? error.message : "查询未确认");
    }
  };
  const release = async () => {
    if (writing.current || (!confirmed && !state?.abandoned) || !writable) return;
    const generation = lifecycle.current, signal = client.signal;
    const active = () => generation === lifecycle.current && !signal?.aborted;
    writing.current = true;
    setBusy(true); setError("");
    try {
      await continueStagingRelease(client, runId, active, setState);
      if (active()) { setConfirmed(false); await onChanged(); }
    } catch (error) {
      if (active()) {
        setError(error instanceof Error ? error.message : "释放结果未确认，请查询原处置");
        const value = await client.request<StagingDisposition>(route).catch(() => null);
        if (active()) { if (value) setState(value); await onChanged().catch(() => {}); }
      }
    } finally { writing.current = false; if (active()) setBusy(false); }
  };
  return <section className="st-callout warning" aria-label="暂存处置">
    <h3>暂存与续传材料</h3>
    {error && <><p role="alert">{error}</p><button className="st-link" disabled={busy} onClick={() => void inspect()}>查询原处置记录</button></>}
    {!state ? <p>正在查询原任务的保留与处置记录…</p> : <>
      <p>{state.boundary}</p>
      <p>{state.abandoned ? `已由 ${state.requestedBy} 确认放弃续传` : "任务结束或取消并不会自动删除材料"}。已处置 {state.releasedBytes} 字节；受引用保护而保留 {state.retainedBytes} 字节；尚待处理 {state.remainingChunks} 个分片。</p>
      {state.unverifiedBackupChunks !== "0" && <p>存在尚未完成核验的备份引用；请由部署维护者核验或导入其目标完成记录。无法证明无引用时不会删除。</p>}
      {writable && state.canAbandon && (!state.abandoned || state.remainingChunks !== "0") && <>
        {!state.abandoned && <label className="st-check"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />我确认放弃此任务的续传资格，仅释放没有保护引用的私有上传分片；原始本机目录和 Git 仓库不受影响。</label>}
        <button className="button" disabled={busy || (!confirmed && !state.abandoned)} onClick={() => void release()}>{busy ? "正在分批核对引用并处置…" : state.abandoned ? "继续原暂存处置" : "明确放弃并释放无引用暂存"}</button>
        <p>离开页面将停止发起后续批次，正在处理的批次仍可能完成。处置记录持久保留，可返回查询并继续。</p>
      </>}
    </>}
  </section>;
}

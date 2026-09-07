"use client";

import { useState } from "react";
import { SourceTruthClient } from "./client.ts";
import { ArtifactTable, GapBrowser, sourcePath } from "./evidence-view.tsx";
import type { Confirmation, FrozenVersion, Page, Receipt } from "./types.ts";

type Difference = { pathBytes: string; change: string; before: unknown; after: unknown };
type Delta = Page<Difference> & { comparable: boolean; reason?: string; counts: Record<string, string> | null; countUnit: string };
type RenewalState = { confirmation: Confirmation; operation: { id: string; status: string } | null; result: { receipt: Receipt } | null };

export function SourceVersionView({ client, version, versions, writable, onChanged }: { client: SourceTruthClient; version: FrozenVersion; versions: FrozenVersion[]; writable: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [admission, setAdmission] = useState<{ receiptId: string; gapCount: string; inheritedGapSet: { count: string } } | null>(null);
  const [reason, setReason] = useState(""), [expires, setExpires] = useState(""), [accepted, setAccepted] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(version.latestReceipt);
  const [tab, setTab] = useState("receipt"), [from, setFrom] = useState(""), [sourceId, setSourceId] = useState(version.components[0]?.sourceId ?? "");
  const [delta, setDelta] = useState<Delta | null>(null);
  const [renewal, setRenewal] = useState<RenewalState | null>(null), [renewalChecked, setRenewalChecked] = useState(false);
  const request = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (error) { if (!client.signal?.aborted) { setError((error as Error).message); setAdmission(null); } }
    finally { if (!client.signal?.aborted) setBusy(false); }
  };
  const compare = (cursor?: string | null) => request(async () => {
    const params = new URLSearchParams({ fromBundleId: from, toBundleId: version.id, sourceId, limit: "100", ...(cursor ? { cursor } : {}) });
    setDelta(await client.request(`/delta?${params}`));
  });
  const issued = async (value: Receipt) => { setReceipt(value); setRenewal(null); setRenewalChecked(false); setAccepted(false); setAdmission(null); await onChanged(); };
  const recover = () => request(async () => {
    const value = await client.request<RenewalState | null>(`/renewal-status?bundleId=${version.id}&receiptId=${encodeURIComponent(receipt!.id)}`);
    setRenewalChecked(true); setRenewal(value);
    if (value?.result) await issued(value.result.receipt);
  });
  const finishRenewal = async (confirmation: Confirmation) => {
    const result = await client.request<{ receipt: Receipt }>("/renewals", "POST", { bundleId: version.id, receiptId: receipt!.id, confirmationId: confirmation.id, clientToken: crypto.randomUUID() });
    await issued(result.receipt);
  };
  return <section className="st-version-view"><h3>冻结包 {version.id.slice(0, 12)}…</h3>
    <div className="st-tabs" role="group" aria-label="冻结包证据视图">{[["receipt", "凭据与准入"], ["inventory", "完整材料清单"], ["gaps", "缺口记录"], ["delta", "文件级版本差异"]].map(([id, label]) => <button className={tab === id ? "selected" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <p className="st-callout danger" role="alert">{error}</p>}
    {tab === "receipt" && <>
      <dl><dt>Bundle</dt><dd>{version.id}</dd><dt>Receipt</dt><dd>{receipt?.id ?? "缺失：不能准入"}</dd><dt>冻结/签发时状态</dt><dd><span className={`st-badge ${receipt?.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : "muted"}`}>{receipt?.status}</span></dd><dt>Gap 数量</dt><dd>{receipt?.gapCount}</dd><dt>接受失效时间</dt><dd>{receipt?.expiresAt ?? "无接受期限（无 Gap）"}</dd><dt>备份覆盖</dt><dd>须核对这一对 Bundle + Receipt 的完整备份证明，不由冻结状态推定</dd></dl>
      <p className="st-callout">历史凭据不可改写。下面只核验当前访问权限、接受期限和材料完整性，不会启动 F002。</p>
      <button className="button" disabled={busy || !receipt} onClick={() => void request(async () => setAdmission(await client.request("/admission", "POST", { bundleId: version.id, receiptId: receipt!.id })))}>核验当前准入</button>
      {admission && <p className={`st-callout ${admission.gapCount === "0" ? "" : "warning"}`}>本次核验通过；凭据 {admission.receiptId}。后续必须继承完整 Gap 集（{admission.inheritedGapSet.count} 项）。这是本次核验结果，不是永久准入许可。</p>}
      {receipt && receipt.gapCount !== "0" && writable && <details className="st-renewal"><summary>同包重新接受缺口并签发新凭据</summary><p>不重新采集、不改 Bundle，不覆盖旧 Receipt，也不会让旧分析自动改用新凭据。</p><GapBrowser client={client} route={`/bundles/${version.id}/gap-history`} />
        <button className="button" disabled={busy} onClick={() => void recover()}>查询本成员上次续签</button>
        {renewalChecked && !renewal && <p>没有未确认的续签结果。可明确填写新的理由与期限。</p>}
        {renewal && <div className="st-callout warning"><p>服务端已保存确认 {renewal.confirmation.id}；签发结果尚未确认。理由：{renewal.confirmation.reason}；绝对期限：{renewal.confirmation.expiresAt}。</p><button className="button" disabled={busy || renewal.confirmation.currentlyValid === false} onClick={() => void request(() => finishRenewal(renewal.confirmation))}>继续原续签，查询同一结果</button>{renewal.confirmation.currentlyValid === false && <p>该接受已过期，必须重新明确理由与期限；不能自动延长。</p>}</div>}
        <label>重新接受的理由<textarea value={reason} maxLength={2000} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
        <label>新的绝对失效时间（浏览器本地时间）<input type="datetime-local" value={expires} onChange={(event) => setExpires(event.target.value)} disabled={busy} /></label>
        <label className="st-check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} />我重新接受该包完整的 {receipt.gapCount} 项非阻断缺口。</label>
        <button className="button primary" disabled={busy || !accepted || !reason.trim() || !expires || !Number.isFinite(Date.parse(expires))} onClick={() => void request(async () => {
          const confirmation = await client.request<Confirmation>("/renewal-confirmations", "POST", { bundleId: version.id, receiptId: receipt.id, gapSetId: receipt.gapSetId, reason, expiresAt: new Date(expires).toISOString() });
          setRenewal({ confirmation, operation: null, result: null });
          await finishRenewal(confirmation);
        })}>确认并签发新 Receipt</button>
      </details>}
    </>}
    {tab === "inventory" && (receipt ? <ArtifactTable key={receipt.id} client={client} route={`/bundles/${version.id}/inventory?receiptId=${encodeURIComponent(receipt.id)}`} /> : <p>没有可核对的 Receipt。</p>)}
    {tab === "gaps" && <GapBrowser client={client} route={`/bundles/${version.id}/gap-history`} />}
    {tab === "delta" && <><p>只比较两个完整版本的文件/目录新增、修改与删除，不进行变更影响推理。来源或范围不一致时不会将整个范围误标为删除。</p>
      <div className="st-actions"><label>从哪个冻结包比较<select disabled={busy} value={from} onChange={(event) => { setFrom(event.target.value); setDelta(null); }}><option value="">选择精确基线</option>{versions.filter((other) => other.id !== version.id).map((other) => <option key={other.id} value={other.id}>{other.id.slice(0, 12)} · {new Date(other.publishedAt).toLocaleString("zh-CN")}</option>)}</select></label><label>来源<select disabled={busy} value={sourceId} onChange={(event) => { setSourceId(event.target.value); setDelta(null); }}>{version.components.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.kind} · {source.sourceId}</option>)}</select></label><button className="button" disabled={busy || !from || !sourceId} onClick={() => void compare()}>比较文件级变化</button></div>
      {delta && (!delta.comparable ? <p className="st-callout warning">无法逐项对比：{delta.reason}。请确认两个版本的来源登记及范围；这里不声明文件删除。</p> : <><p>{Object.entries(delta.counts ?? {}).map(([key, count]) => `${key} ${count}`).join(" · ")}（文件与目录条目）</p><div className="st-table-scroll"><table><thead><tr><th>路径</th><th>变化</th></tr></thead><tbody>{delta.items.map((item) => <tr key={item.pathBytes}><td>{sourcePath(item.pathBytes)}</td><td>{item.change}</td></tr>)}</tbody></table></div>{delta.nextCursor && <button className="button" disabled={busy} onClick={() => void compare(delta.nextCursor)}>下一页差异</button>}</>)}
    </>}
  </section>;
}

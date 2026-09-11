"use client";

import { useEffect, useRef, useState } from "react";
import { SourceTruthClient } from "./client.ts";
import { ArtifactTable, GapBrowser, sourcePath } from "./evidence-view.tsx";
import type { Confirmation, FrozenVersion, Page, Receipt } from "./types.ts";
import { BackupCoverage, ReceiptHistory } from "./receipt-history.tsx";
import { deltaSources, selectedDeltaSource } from "./delta.ts";
import { isEmptyGitComponent } from "./empty-git.ts";

type Difference = { pathBytes: string; change: string; before: unknown; after: unknown };
type Delta = Page<Difference> & { comparable: boolean; reason?: string; counts: Record<string, string> | null; countUnit: string };
type RenewalState = { confirmation: Confirmation; operation: { id: string; status: string; requiresAction?: boolean; retryAfter?: string | null;
  diagnostic?: { code: string; message: string; recovery: string } | null } | null; result: { receipt: Receipt } | null };

export function SourceVersionView({ client, version, versions, writable, onChanged }: { client: SourceTruthClient; version: FrozenVersion; versions: FrozenVersion[]; writable: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [admission, setAdmission] = useState<{ receiptId: string; gapCount: string; inheritedGapSet: { count: string } } | null>(null);
  const [reason, setReason] = useState(""), [expires, setExpires] = useState(""), [accepted, setAccepted] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(version.latestReceipt);
  const [tab, setTab] = useState("receipt"), [from, setFrom] = useState(""), [sourceId, setSourceId] = useState(version.components[0]?.sourceId ?? "");
  const [delta, setDelta] = useState<Delta | null>(null);
  const baseline = versions.find((other) => other.id === from);
  const comparisonSources = deltaSources(version, baseline);
  const selectedSourceId = selectedDeltaSource(comparisonSources, sourceId);
  const [renewal, setRenewal] = useState<RenewalState | null>(null), [renewalChecked, setRenewalChecked] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const request = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); } catch (error) { if (alive.current && !client.signal?.aborted) { setError((error as Error).message); setAdmission(null); } }
    finally { if (alive.current && !client.signal?.aborted) setBusy(false); }
  };
  const compare = (cursor?: string | null) => request(async () => {
    if (!baseline || !selectedSourceId) return;
    const params = new URLSearchParams({ fromBundleId: from, toBundleId: version.id, sourceId: selectedSourceId, limit: "100", ...(cursor ? { cursor } : {}) });
    const value = await client.request<Delta>(`/delta?${params}`);
    if (alive.current && !client.signal?.aborted) setDelta(value);
  });
  const selectReceipt = (value: Receipt) => { setReceipt(value); setRenewal(null); setRenewalChecked(false); setAccepted(false); setAdmission(null); setError(""); };
  const issued = async (value: Receipt) => { if (!alive.current || client.signal?.aborted) return; selectReceipt(value); await onChanged(); };
  const recover = () => request(async () => {
    const value = await client.request<RenewalState | null>(`/renewal-status?bundleId=${version.id}&receiptId=${encodeURIComponent(receipt!.id)}`);
    if (!alive.current || client.signal?.aborted) return;
    setRenewalChecked(true); setRenewal(value);
    if (value?.result) await issued(value.result.receipt);
  });
  const finishRenewal = async (confirmation: Confirmation) => {
    const result = await client.request<{ receipt: Receipt }>("/renewals", "POST", { bundleId: version.id, receiptId: receipt!.id, confirmationId: confirmation.id, clientToken: crypto.randomUUID() });
    await issued(result.receipt);
  };
  return <section className="st-version-view"><h3>冻结包 {version.id.slice(0, 12)}…</h3>
    {version.components.filter(isEmptyGitComponent).map((component) => <article className="st-source-line" key={component.id}>
      <strong>已确认空 Git 版本，0 个文件</strong>
      <dl><dt>来源</dt><dd>{component.sourceId}</dd><dt>精确 commit</dt><dd>{component.nativeIdentity?.commit}</dd>
        <dt>采集范围</dt><dd>{component.scope?.root ? `${component.scope.root}（不是全仓库）` : "全仓库"}</dd>
        <dt>空 manifest 摘要</dt><dd>{component.manifestId}</dd></dl>
      <p className="st-muted">此组件的完整清单已确认为空；历史冻结不代表当前可以准入。</p>
    </article>)}
    <div className="st-tabs" role="group" aria-label="冻结包证据视图">{[["receipt", "凭据与准入"], ["inventory", "完整材料清单"], ["gaps", "缺口记录"], ["delta", "文件级版本差异"]].map(([id, label]) => <button className={tab === id ? "selected" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <p className="st-callout danger" role="alert">{error}</p>}
    {tab === "receipt" && <>
      <ReceiptHistory client={client} bundleId={version.id} selected={receipt} onSelect={(value) => { if (!busy) selectReceipt(value); }} />
      <dl><dt>Bundle</dt><dd>{version.id}</dd><dt>Receipt</dt><dd>{receipt?.id ?? "缺失：不能准入"}</dd><dt>冻结/签发时状态</dt><dd><span className={`st-badge ${receipt?.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : "muted"}`}>{receipt?.status}</span></dd><dt>Gap 数量</dt><dd>{receipt?.gapCount}</dd><dt>接受失效时间</dt><dd>{receipt?.expiresAt ?? "无接受期限（无 Gap）"}</dd><dt>备份覆盖</dt><dd>须核对这一对 Bundle + Receipt 的完整备份证明，不由冻结状态推定</dd></dl>
      <p className="st-callout">历史凭据不可改写。下面只核验当前访问权限、接受期限和材料完整性，不会启动 F002。</p>
      <button className="button" disabled={busy || !receipt} onClick={() => void request(async () => setAdmission(await client.request("/admission", "POST", { bundleId: version.id, receiptId: receipt!.id })))}>核验当前准入</button>
      {admission && <p className={`st-callout ${admission.gapCount === "0" ? "" : "warning"}`}>本次核验通过；凭据 {admission.receiptId}。后续必须继承完整 Gap 集（{admission.inheritedGapSet.count} 项）。这是本次核验结果，不是永久准入许可。</p>}
      {receipt && <BackupCoverage key={receipt.id} client={client} bundleId={version.id} receiptId={receipt.id} />}
      {receipt && receipt.gapCount !== "0" && writable && <details className="st-renewal"><summary>同包重新接受缺口并签发新凭据</summary><p>不重新采集、不改 Bundle，不覆盖旧 Receipt，也不会让旧分析自动改用新凭据。</p><GapBrowser client={client} route={`/bundles/${version.id}/gap-history`} />
        <button className="button" disabled={busy} onClick={() => void recover()}>查询本成员上次续签</button>
        {renewalChecked && !renewal && <p>没有未确认的续签结果。可明确填写新的理由与期限。</p>}
        {renewal && <div className="st-callout warning"><p>服务端已保存确认 {renewal.confirmation.id}；签发结果尚未确认。理由：{renewal.confirmation.reason}；绝对期限：{renewal.confirmation.expiresAt}。</p>
          {renewal.operation?.diagnostic && <p role="status">{renewal.operation.diagnostic.code}：{renewal.operation.diagnostic.message}。{renewal.operation.diagnostic.recovery}。原包与原凭据不变。</p>}
          {renewal.operation?.retryAfter && !renewal.operation.requiresAction && <p>系统最早恢复尝试时间：{new Date(renewal.operation.retryAfter).toLocaleString("zh-CN")}；这不是签发成功时间。</p>}
          <button className="button" disabled={busy || renewal.confirmation.currentlyValid === false} onClick={() => void request(() => finishRenewal(renewal.confirmation))}>{renewal.operation?.diagnostic?.code === "SOURCE_RESTORE_RECONCILIATION_REQUIRED" ? "已核对恢复点，继续原续签" : "继续原续签，查询同一结果"}</button>{renewal.confirmation.currentlyValid === false && <p>该接受已过期，必须重新明确理由与期限；不能自动延长。</p>}</div>}
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
    {tab === "inventory" && (receipt ? <><p className="st-callout">历史材料查看不会获得新的分析准入；接受已过期时仍可在当前读取权限内查看。</p><ArtifactTable key={receipt.id} client={client} route={`/bundles/${version.id}/inventory-history?receiptId=${encodeURIComponent(receipt.id)}`} reference={{ bundleId: version.id, receiptId: receipt.id }} components={version.components} /></> : <p>没有可核对的 Receipt。</p>)}
    {tab === "gaps" && <GapBrowser client={client} route={`/bundles/${version.id}/gap-history`} />}
    {tab === "delta" && <><p>只比较两个完整版本的文件/目录新增、修改与删除，不进行变更影响推理。来源或范围不一致时不会将整个范围误标为删除。</p>
      <div className="st-actions"><label>从哪个冻结包比较<select disabled={busy} value={from} onChange={(event) => {
        const nextFrom = event.target.value;
        setFrom(nextFrom);
        setSourceId(selectedDeltaSource(deltaSources(version, versions.find((other) => other.id === nextFrom)), selectedSourceId));
        setDelta(null);
      }}><option value="">选择精确基线</option>{versions.filter((other) => other.id !== version.id).map((other) => <option key={other.id} value={other.id}>{other.id.slice(0, 12)} · {new Date(other.publishedAt).toLocaleString("zh-CN")}</option>)}</select></label>
        <label>来源<select disabled={busy} value={selectedSourceId} onChange={(event) => { setSourceId(event.target.value); setDelta(null); }}>{comparisonSources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.kind} · {source.sourceId}{baseline && (!version.components.some((item) => item.sourceId === source.sourceId) ? " · 来源已移除（仅基线）" : !baseline.components.some((item) => item.sourceId === source.sourceId) ? " · 来源新增（仅目标）" : "")}</option>)}</select></label>
        <button className="button" disabled={busy || !baseline || !selectedSourceId} onClick={() => void compare()}>比较文件级变化</button></div>
      {delta && (!delta.comparable ? <p className="st-callout warning">无法逐项对比：{delta.reason}。请确认两个版本的来源登记及范围；这里不声明文件删除。</p> : <><p>{Object.entries(delta.counts ?? {}).map(([key, count]) => `${key} ${count}`).join(" · ")}（文件与目录条目）</p><div className="st-table-scroll"><table><thead><tr><th>路径</th><th>变化</th></tr></thead><tbody>{delta.items.map((item) => <tr key={item.pathBytes}><td>{sourcePath(item.pathBytes)}</td><td>{item.change}</td></tr>)}</tbody></table></div>{delta.nextCursor && <button className="button" disabled={busy} onClick={() => void compare(delta.nextCursor)}>下一页差异</button>}</>)}
    </>}
  </section>;
}

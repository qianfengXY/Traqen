"use client";

import { useEffect, useId, useRef, useState } from "react";
import { SourceTruthClient } from "./client.ts";
import { ArtifactTable, GapBrowser, sourcePath } from "./evidence-view.tsx";
import type { Confirmation, FrozenVersion, Page, Receipt } from "./types.ts";
import { BackupCoverage, ReceiptHistory } from "./receipt-history.tsx";
import { deltaSources, selectedDeltaSource } from "./delta.ts";
import { isEmptyGitComponent } from "./empty-git.ts";
import type { SourceEntryContext, SourceAssociationService } from "./context.ts";
import { SourceContinuation } from "./continuation.tsx";
import { combinedFileCoverage, CoverageMetrics } from "./coverage.tsx";

type Difference = { pathBytes: string; change: string; before: unknown; after: unknown };
type Delta = Page<Difference> & { comparable: boolean; reason?: string; counts: Record<string, string> | null; countUnit: string };
type RenewalState = { confirmation: Confirmation; operation: { id: string; status: string; requiresAction?: boolean; retryAfter?: string | null;
  diagnostic?: { code: string; message: string; recovery: string } | null } | null; result: { receipt: Receipt } | null };

export function SourceVersionView({ client, version, versions, writable, onChanged, fixedReceiptId, fixedComponentId, entryContext, associationService }: { client: SourceTruthClient; version: FrozenVersion; versions: FrozenVersion[]; writable: boolean; onChanged: () => Promise<void>; fixedReceiptId?: string; fixedComponentId?: string; entryContext?: SourceEntryContext; associationService?: SourceAssociationService }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [admission, setAdmission] = useState<{ receiptId: string; gapCount: string; inheritedGapSet: { count: string } } | null>(null);
  const [reason, setReason] = useState(""), [expires, setExpires] = useState(""), [accepted, setAccepted] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(fixedReceiptId ? null : version.latestReceipt);
  const tabsId = useId();
  const canRenew = writable && !fixedReceiptId;
  const [tab, setTab] = useState<string>(entryContext?.tab ?? "inventory"), [from, setFrom] = useState(""), [sourceId, setSourceId] = useState(version.components[0]?.sourceId ?? "");
  const [inspecting, setInspecting] = useState(false), [inspectorTarget, setInspectorTarget] = useState<HTMLElement | null>(null);
  const [delta, setDelta] = useState<Delta | null>(null);
  const baseline = versions.find((other) => other.id === from);
  const comparisonSources = deltaSources(version, baseline);
  const selectedSourceId = selectedDeltaSource(comparisonSources, sourceId);
  const [renewal, setRenewal] = useState<RenewalState | null>(null), [renewalChecked, setRenewalChecked] = useState(false);
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!fixedReceiptId) return;
    let active = true;
    client.request<Receipt>(`/bundles/${version.id}/receipt?receiptId=${encodeURIComponent(fixedReceiptId)}`)
      .then(value => { if (active && !client.signal?.aborted) setReceipt(value); })
      .catch(error => { if (active && !client.signal?.aborted) { setReceipt(null); setError(error.message); } });
    return () => { active = false; };
  }, [client, version.id, fixedReceiptId]);
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
  const selectReceipt = (value: Receipt) => { setInspecting(false); setReceipt(value); setRenewal(null); setRenewalChecked(false); setAccepted(false); setAdmission(null); setError(""); };
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
  return <section className="st-version-view"><h3>来源包已冻结 · {version.id.slice(0, 12)}…</h3>
    <CoverageMetrics coverage={combinedFileCoverage(version.components)} />
    <p className={`st-callout${receipt?.status === "READY_WITH_ACCEPTED_GAPS" ? " warning" : ""}`}>{receipt?.status === "READY_WITH_ACCEPTED_GAPS" ? `有限制可用 · ${receipt.gapCount} 项限制已接受；缺失仍是缺失。` : "冻结记录不代表当前可用。"} 当前准入、备份覆盖与下游调查状态各自核验。</p>
    {receipt && entryContext?.mode === "ADD_MATERIAL" && <SourceContinuation client={client} context={entryContext} reference={{ workspaceId: entryContext.workspaceId, bundleId: version.id, receiptId: receipt.id }} service={associationService} />}
    {version.components.filter(isEmptyGitComponent).map((component) => <article className="st-source-line" key={component.id}>
      <strong>已确认空 Git 版本，0 个文件</strong>
      <dl><dt>来源</dt><dd>{component.sourceId}</dd><dt>精确 commit</dt><dd>{component.nativeIdentity?.commit}</dd>
        <dt>采集范围</dt><dd>{component.scope?.root ? `${component.scope.root}（不是全仓库）` : "全仓库"}</dd>
        <dt>空 manifest 摘要</dt><dd>{component.manifestId}</dd></dl>
      <p className="st-muted">此组件的完整清单已确认为空；历史冻结不代表当前可以准入。</p>
    </article>)}
    {fixedReceiptId && <p className="st-callout">固定 Receipt：{fixedReceiptId}。{receipt ? "已读取精确绑定；当前准入另行核验。" : "尚未确认；不会替换为最新凭据。"}</p>}
    <dl className="st-identity-card"><dt>Bundle</dt><dd>{version.id}</dd><dt>Receipt</dt><dd>{receipt?.id ?? "尚未核验"}</dd><dt>Inventory</dt><dd>{version.identity.inventoryId}</dd><dt>GapSet</dt><dd>{version.identity.gapSetId}</dd>
      {version.components.map(component => <div className="st-identity-component" key={component.id}><dt>{component.kind === "GIT" ? "Git commit" : "目录 manifest"}</dt><dd>{component.kind === "GIT" ? component.nativeIdentity?.commit ?? "未返回精确 commit" : component.manifestId} · 组件 {component.id}</dd></div>)}</dl>
    <div className="st-actions"><button className="button" onClick={() => setTab("inventory")}>浏览材料</button><button className="button" onClick={() => setTab("receipt")}>查看 Receipt</button></div>
    <div className="st-grid"><div>
    <div className="st-tabs" role="tablist" aria-label="冻结包证据视图">{[["inventory", "材料清单"], ["gaps", "限制与接受"], ["receipt", "Receipt"], ["history", "版本历史"]].map(([id, label]) => <button id={`${tabsId}-${id}`} aria-controls={`${tabsId}-${id}-panel`} role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className={tab === id ? "selected" : ""} key={id} onClick={() => setTab(id)} onKeyDown={event => {
      const buttons = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("[role=tab]"));
      const index = buttons.indexOf(event.currentTarget);
      const target = event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index + buttons.length - 1) % buttons.length : event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : -1;
      if (target >= 0) { event.preventDefault(); buttons[target].focus(); }
    }}>{label}</button>)}</div>
    {error && <p className="st-callout danger" role="alert">{error}</p>}
    <div id={`${tabsId}-receipt-panel`} role="tabpanel" aria-labelledby={`${tabsId}-receipt`} hidden={tab !== "receipt"}>
      {!fixedReceiptId && <ReceiptHistory client={client} bundleId={version.id} selected={receipt} onSelect={(value) => { if (!busy) selectReceipt(value); }} />}
      <dl><dt>Bundle</dt><dd>{version.id}</dd><dt>Receipt</dt><dd>{receipt?.id ?? "缺失：不能准入"}</dd><dt>冻结/签发时状态</dt><dd><span className={`st-badge ${receipt?.status === "READY_WITH_ACCEPTED_GAPS" ? "warning" : "muted"}`}>{receipt?.status}</span></dd><dt>Gap 数量</dt><dd>{receipt?.gapCount}</dd><dt>接受失效时间</dt><dd>{receipt?.expiresAt ?? "无接受期限（无 Gap）"}</dd><dt>备份覆盖</dt><dd>须核对这一对 Bundle + Receipt 的完整备份证明，不由冻结状态推定</dd></dl>
      <p className="st-callout">历史凭据不可改写。下面只核验当前访问权限、接受期限和材料完整性，不会启动 F002。</p>
      {receipt && receipt.gapCount !== "0" && canRenew && <details className="st-renewal"><summary>同包重新接受缺口并签发新凭据</summary><p>不重新采集、不改 Bundle，不覆盖旧 Receipt，也不会让旧分析自动改用新凭据。</p><GapBrowser key={receipt.id} client={client} route={`/bundles/${version.id}/gap-history?receiptId=${encodeURIComponent(receipt.id)}`} />
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
    </div>
    <div id={`${tabsId}-inventory-panel`} role="tabpanel" aria-labelledby={`${tabsId}-inventory`} hidden={tab !== "inventory"}>{receipt ? <><p className="st-callout">历史材料查看不会获得新的分析准入；接受已过期时仍可在当前读取权限内查看。</p><ArtifactTable key={receipt.id} client={client} route={`/bundles/${version.id}/inventory-history?receiptId=${encodeURIComponent(receipt.id)}`} reference={{ bundleId: version.id, receiptId: receipt.id }} components={version.components} initialComponentId={fixedComponentId ?? (entryContext?.bundleId === version.id ? entryContext.componentId : undefined)} initialPathBytes={entryContext?.bundleId === version.id && entryContext?.receiptId === receipt.id ? entryContext.pathBytes : undefined} inspectorTarget={inspectorTarget} onSelectionChange={setInspecting} /></> : <p>没有可核对的 Receipt。</p>}</div>
    <div id={`${tabsId}-gaps-panel`} role="tabpanel" aria-labelledby={`${tabsId}-gaps`} hidden={tab !== "gaps"}>{receipt && <GapBrowser key={receipt.id} client={client} route={`/bundles/${version.id}/gap-history?receiptId=${encodeURIComponent(receipt.id)}`} />}</div>
    <div id={`${tabsId}-history-panel`} role="tabpanel" aria-labelledby={`${tabsId}-history`} hidden={tab !== "history"}><h4>冻结版本历史</h4><p>当前选择 {version.id}；旧版本仍保留，失败采集不进入此列表。</p>{versions.map(item => <p key={item.id}>{item.id} · {item.publishedAt} · {item.latestReceipt?.status ?? "凭据未核验"}</p>)}
      <h4>文件级版本差异</h4><p>只比较两个完整版本的文件/目录新增、修改与删除，不进行变更影响推理。来源或范围不一致时不会将整个范围误标为删除。</p>
      <div className="st-actions"><label>从哪个冻结包比较<select disabled={busy} value={from} onChange={(event) => {
        const nextFrom = event.target.value;
        setFrom(nextFrom);
        setSourceId(selectedDeltaSource(deltaSources(version, versions.find((other) => other.id === nextFrom)), selectedSourceId));
        setDelta(null);
      }}><option value="">选择精确基线</option>{versions.filter((other) => other.id !== version.id).map((other) => <option key={other.id} value={other.id}>{other.id.slice(0, 12)} · {new Date(other.publishedAt).toLocaleString("zh-CN")}</option>)}</select></label>
        <label>来源<select disabled={busy} value={selectedSourceId} onChange={(event) => { setSourceId(event.target.value); setDelta(null); }}>{comparisonSources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.kind} · {source.sourceId}{baseline && (!version.components.some((item) => item.sourceId === source.sourceId) ? " · 来源已移除（仅基线）" : !baseline.components.some((item) => item.sourceId === source.sourceId) ? " · 来源新增（仅目标）" : "")}</option>)}</select></label>
        <button className="button" disabled={busy || !baseline || !selectedSourceId} onClick={() => void compare()}>比较文件级变化</button></div>
      {delta && (!delta.comparable ? <p className="st-callout warning">无法逐项对比：{delta.reason}。请确认两个版本的来源登记及范围；这里不声明文件删除。</p> : <><p>{Object.entries(delta.counts ?? {}).map(([key, count]) => `${key} ${count}`).join(" · ")}（文件与目录条目）</p><div className="st-table-scroll"><table><thead><tr><th>路径</th><th>变化</th></tr></thead><tbody>{delta.items.map((item) => <tr key={item.pathBytes}><td>{sourcePath(item.pathBytes)}</td><td>{item.change}</td></tr>)}</tbody></table></div>{delta.nextCursor && <button className="button" disabled={busy} onClick={() => void compare(delta.nextCursor)}>下一页差异</button>}</>)}
    </div></div><aside className="st-side" aria-label="所选冻结版本的使用条件"><section data-material-details-host="" ref={setInspectorTarget} hidden={tab !== "inventory" || !inspecting} /><div className="st-usage-context" hidden={tab === "inventory" && inspecting}><section className="st-panel"><h2>当前使用条件</h2>
      <p className={`st-callout ${receipt?.gapCount !== "0" ? "warning" : ""}`}>{receipt ? `${receipt.gapCount} 项已接受限制；后续使用重验权限、内容与有效期。` : "确切 Receipt 尚未核验，不允许准入。"}</p>
      <p>最早接受期限：{receipt?.expiresAt ?? (receipt?.gapCount === "0" ? "无 Gap 接受期限" : "尚未核验")}</p>
      <button className="button" disabled={busy || !receipt} onClick={() => void request(async () => setAdmission(await client.request("/admission", "POST", { bundleId: version.id, receiptId: receipt!.id })))}>核验当前准入</button>
      {admission ? <p className={`st-callout ${admission.gapCount === "0" ? "" : "warning"}`}>本次核验通过；凭据 {admission.receiptId}。继承完整 Gap 集（{admission.inheritedGapSet.count} 项），不是永久许可。</p> : <p>当前准入尚未核实；历史冻结或关联成功不等于当前可用。{error && `本次操作未确认：${error}`}</p>}
    </section><section className="st-panel"><h2>备份覆盖</h2>{receipt ? <BackupCoverage key={receipt.id} client={client} bundleId={version.id} receiptId={receipt.id} /> : <p>备份覆盖：尚未核验；需要精确 Receipt。</p>}</section>
      <section className="st-panel"><h2>其他信息</h2><dl><dt>冻结时间</dt><dd>{version.publishedAt}</dd><dt>冻结人</dt><dd>{version.publishedBy ?? "原发布身份尚未返回；不以当前访问者替代"}</dd>
        <dt>适用范围</dt><dd>{version.components.map(component => `${component.kind} · ${component.scope?.root ?? "完整选择范围"}`).join("；")}</dd><dt>备注</dt><dd>历史内容不可变；没有发布备注时不编造说明。</dd></dl><button className="st-link" onClick={() => setTab("history")}>查看版本历史与明确文件比较</button></section>
    </div></aside></div>
  </section>;
}

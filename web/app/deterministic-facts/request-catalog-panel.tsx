"use client";

import { useEffect, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import { requestPresentation } from "./model.ts";
import { observeRequestCatalog, type CatalogSnapshot } from "./request-catalog.ts";

export function RequestCatalogPanel({ client, workspaceId, investigationId, baseVersionId, configured, disabled, onSelect, onAccessLost }: {
  client: DeterministicFactsClient; workspaceId: string; investigationId: string; baseVersionId: string;
  configured: boolean; disabled: boolean; onSelect: (id: string) => void; onAccessLost: (error: Error) => void;
}) {
  const reference = JSON.stringify([workspaceId, investigationId, baseVersionId]);
  const [active, setActive] = useState<{ reference: string; cursor: string | null } | null>(null), [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([reference, active?.cursor ?? null]);
  const [snapshot, setSnapshot] = useState<{ client: DeterministicFactsClient; key: string; data: CatalogSnapshot | null; error: Error | null } | null>(null);
  useEffect(() => {
    if (!configured || active?.reference !== reference) return;
    const observation = observeRequestCatalog(client, { workspaceId, investigationId, baseVersionId, cursor: active.cursor }, data => {
      setSnapshot({ client, key, data, error: null });
    }, error => {
      setSnapshot({ client, key, data: null, error });
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
    });
    return () => observation.close();
  }, [client, workspaceId, investigationId, baseVersionId, configured, active, reference, key, refresh, onAccessLost]);
  const current = configured && active?.reference === reference && snapshot?.client === client && snapshot.key === key ? snapshot : null;
  const data = current?.data, investigation = data?.investigation, page = data?.page;
  const valid = /^[A-Za-z0-9_-]{1,128}$/.test(investigationId) && /^[a-f0-9]{64}$/.test(baseVersionId);
  return <section aria-label="调查预算与请求清单">
    <h3>调查允许的预算与停止条件</h3>
    <button className="button" disabled={!configured || disabled || !valid} onClick={() => {
      setSnapshot(null); setActive({ reference, cursor: null }); setRefresh(value => value + 1);
    }}>复验调查边界与请求清单</button>
    <p className="f002-caption">只读复验当前填写的调查与固定基准；不会提交、补提或自动采用新版本。边界与请求清单不作为本地授权缓存。</p>
    {!active || active.reference !== reference ? <p>尚未读取此调查的可信边界或请求清单。</p> : !current && <p role="status">正在复验原调查与基准，未使用旧清单。</p>}
    {current?.error && <p role="alert">请求清单未确认：{current.error.message}。没有展示旧的获准清单。</p>}
    {data?.investigationError && <p role="alert">新取证预算未获确认：{data.investigationError.message}。不推断仍可继续取证；历史回执仍须逐项 READ 授权。</p>}
    {investigation && <div aria-label="服务端调查边界">
      <p>调查 {investigation.investigationId} · {investigation.state} · 固定基准 {investigation.baseVersionId}</p>
      <ul>
        <li>累计材料：已预留与已结算 {investigation.usage.materials} / 上限 {investigation.budget.maxMaterials}</li>
        <li>累计字节：已预留与已结算 {investigation.usage.bytes} / 上限 {investigation.budget.maxBytes}</li>
        <li>规则应用：已预留与已结算 {investigation.usage.ruleApplications} / 上限 {investigation.budget.maxRuleApplications}</li>
        <li>取证尝试：已预留与已结算 {investigation.usage.attempts} / 上限 {investigation.budget.maximumAttempts}</li>
        <li>服务端截止时间：<time dateTime={investigation.budget.deadline}>{investigation.budget.deadline}</time></li>
      </ul>
      <p>调查允许能力：{investigation.allowedCapabilities.join("、") || "未允许新增能力"}</p>
      <p>停止边界：到达截止时间或本次执行将超过任一累计上限。此处是当前只读核对，不预留剩余额度；提交与执行仍由服务端复验。</p>
    </div>}
    <h3>当前授权请求</h3>
    {page && <>
      <p>只显示本调查、固定基准下当前逐项获准的请求；不报告未获准请求的数量或编号。按稳定编号分页，刷新从首页重新发现新增项。</p>
      {!page.items.length && <p role="status">当前授权范围内暂无可读取请求。</p>}
      <ol>{page.items.map(item => { const status = requestPresentation(item); return <li key={item.id}>
        <button className="button" disabled={disabled} onClick={() => onSelect(item.id)}>读取请求 {item.id}</button>
        <p>问题摘要：{item.questionSummary ?? "旧回执未记录问题摘要"}</p>
        <p>范围：{item.scope ? `材料 ${item.scope.materialRefs.join("、") || "无"}；事实 ${item.scope.factRefs.join("、") || "无"}` : "旧回执未记录范围"}</p>
        <p>状态：{status.statusLabel} · 返回：{status.outcomeLabel} · 最后更新：<time dateTime={item.updatedAt}>{item.updatedAt}</time></p>
      </li>; })}</ol>
      {page.nextCursor && <button className="button" disabled={disabled} onClick={() => setActive({ reference, cursor: page.nextCursor })}>下一页获准请求</button>}
    </>}
  </section>;
}

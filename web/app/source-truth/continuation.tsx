"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmedSourceAssociation, performSourceAssociation, safeSourceReturn, sourceContextError, type SourceAssociationOutcome, type SourceAssociationService, type SourceEntryContext, type SourceReference } from "./context.ts";
import { SourceTruthClient } from "./client.ts";

export function SourceContinuation({ client, context, reference, service }: { client: SourceTruthClient; context: SourceEntryContext; reference: SourceReference; service?: SourceAssociationService }) {
  const { workspaceId, bundleId, receiptId, componentId } = reference;
  const boundReference = useMemo(() => ({ workspaceId, bundleId, receiptId, componentId }), [workspaceId, bundleId, receiptId, componentId]);
  return <SourceAssociationSession key={JSON.stringify([context, boundReference])} client={client} context={context} reference={boundReference} service={service} />;
}

function SourceAssociationSession({ client, context, reference, service }: { client: SourceTruthClient; context: SourceEntryContext; reference: SourceReference; service?: SourceAssociationService }) {
  const [resultState, setResultState] = useState({ client, service, state: "CHECKING", reason: "" });
  const state = resultState.client === client && resultState.service === service ? resultState.state : "CHECKING";
  const reason = resultState.client === client && resultState.service === service ? resultState.reason : "";
  const update = useCallback((state: string, reason = "") => setResultState({ client, service, state, reason }), [client, service]);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const back = safeSourceReturn(context), invalid = sourceContextError(context, reference.workspaceId);
  const usable = Boolean(service && context.workSessionId && back && !invalid);
  const acceptResult = useCallback((result: SourceAssociationOutcome) => {
    if (result.status === "INVALID") { update("INVALID", result.reason); return; }
    if (confirmedSourceAssociation(result, reference)) update("CONFIRMED");
    else update(result.status === "NOT_SAVED" ? "NOT_SAVED" : "UNKNOWN", result.reason ?? "关联结果尚未核实；冻结包与原工作保持不变。");
  }, [reference, update]);
  useEffect(() => {
    const current = ++generation.current;
    controller.current?.abort(); pending.current = false;
    if (!usable || !service) return;
    const action = new AbortController(); controller.current = action;
    const signal = AbortSignal.any([action.signal, AbortSignal.timeout(15000), ...(client.signal ? [client.signal] : [])]);
    void performSourceAssociation(service, client, context, reference, true, signal).then(result => {
      if (!signal.aborted && current === generation.current) acceptResult(result);
    }).catch(() => { if (!action.signal.aborted && current === generation.current) update("UNKNOWN", "原工作或此前关联结果未核实；先查询，不重复提交。"); });
    return () => { action.abort(); controller.current?.abort(); pending.current = false; };
  }, [client, context, reference, service, usable, acceptResult, update]);
  const submit = async (query: boolean) => {
    if (pending.current || !service || !usable) return;
    pending.current = true;
    const current = generation.current;
    const action = new AbortController(); controller.current = action;
    const signal = AbortSignal.any([action.signal, AbortSignal.timeout(15000), ...(client.signal ? [client.signal] : [])]);
    update(query ? "QUERYING" : "SUBMITTING");
    try {
      const result = await performSourceAssociation(service, client, context, reference, query, signal);
      if (!signal.aborted && current === generation.current) acceptResult(result);
    } catch (error) { if (!action.signal.aborted && current === generation.current) update("UNKNOWN", (error as Error).message); }
    finally { if (current === generation.current) pending.current = false; }
  };
  useEffect(() => () => controller.current?.abort(), []);
  return <section className="st-callout" aria-label="冻结后的工作接续"><h3>冻结成功与工作关联分别核验</h3>
    <p>固定 Bundle {reference.bundleId} · Receipt {reference.receiptId}。复用此版本只关联引用，不创建采集任务或重复上传。</p>
    {!usable ? <p role="status">{invalid ?? "工作会话关联服务尚未接入或来路无法核验。没有假成功按钮；可以继续浏览冻结版本或返回合法来路，不重新冻结。"}</p>
      : <><p role="status">{state === "CONFIRMED" ? "相应服务已确认保存这对材料引用；尚未启动分析或改变答卷。" : state === "NOT_SAVED" ? "尚未关联；确认后将固定这对引用到原工作。" : state === "SUBMITTING" ? "正在请求关联，请勿重复提交…" : state === "INVALID" ? "原工作不可用，未创建替代会话。" : "正在核对原工作与关联结果；未知不等于失败。"}</p>
        {reason && <p>{reason}</p>}
        {state === "NOT_SAVED" && <button className="button primary" onClick={() => void submit(false)}>确认关联此版本</button>}
        {state === "UNKNOWN" && <button className="button" onClick={() => void submit(true)}>查询原关联结果</button>}
        {state === "CONFIRMED" && back && <a className="button primary" href={back}>关联已确认，返回原工作</a>}
      </>}
    {state !== "CONFIRMED" && back && <a className="st-link" href={back}>不改变原工作，返回</a>}
  </section>;
}

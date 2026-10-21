"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DeterministicFactsClient, FactsClientError, isDefiniteWriteRejection } from "./client.ts";
import { ReadFence, readEvidenceLocation, requestPresentation, requestResultNavigation, type EvidenceLocation, type ReadTicket } from "./model.ts";
import { observeRequestAccess } from "./request-access.ts";
import { buildEvidenceRequestInput, RequestInputError, requestKinds, requestRejectionField, type RequestInputField } from "./request-input.ts";
import { RequestCatalogPanel } from "./request-catalog-panel.tsx";
import { RequestMaterialPicker } from "./request-material-picker.tsx";
import type { VerifiedMaterialSelection } from "./request-material.ts";
import type { EvidenceRequest, Profile } from "./types.ts";
import type { OperationEnvelope, PendingOperation } from "./operations.ts";
import { useOperationJournal } from "./use-operation-journal.ts";

export function RequestPanel({ client, context, actorId, configured, writable, profiles, navigate, onAccessLost }: {
  client: DeterministicFactsClient; context: EvidenceLocation; actorId: string; configured: boolean; writable: boolean;
  profiles: Profile[];
  navigate: (next: EvidenceLocation) => void; onAccessLost: (error: Error) => void;
}) {
  const journal = useOperationJournal({ workspaceId: context.workspaceId, actorId, baseVersionId: context.graphVersionId, namespace: "request",
    targetRef: context.recordId ? `${context.kind}:${context.recordId}` : undefined,
    workRef: context.returnTo ? JSON.stringify([context.returnTo.page, context.returnTo.objectId, context.returnTo.graphRevisionId]) : undefined });
  const investigation = journal.draft.investigationId ?? "", question = journal.draft.question ?? "", lookup = journal.draft.lookup ?? "", operation = journal.pending;
  const capabilities = [...new Set(profiles.filter(profile => profile.startable).flatMap(profile => profile.capabilityIds))].sort();
  const requestedCapabilities = journal.draft.requestedCapabilities ?? [];
  const [material, setMaterial] = useState<VerifiedMaterialSelection | null>(null);
  const requestInput = (() => {
    try { return { value: buildEvidenceRequestInput(context, journal.draft, capabilities, material?.client === client && !client.signal?.aborted ? material : null), error: null }; }
    catch (error) { return { value: null, error: error instanceof Error ? error : new Error("请求输入未确认") }; }
  })();
  const [request, setRequest] = useState<EvidenceRequest | null>(null);
  const selected = useRef<EvidenceRequest | null>(null), reads = useRef(new ReadFence());
  const requestId = request?.id, requestBase = request?.baseVersionId, requestInvestigation = request?.investigationId;
  const [busy, setBusy] = useState(false), [error, setError] = useState<Error | null>(null);
  const feedbackId = useId();
  const rejectedField = error instanceof FactsClientError ? requestRejectionField(error.code, error.status) : null;
  const inputError = requestInput.error instanceof RequestInputError ? requestInput.error
    : rejectedField && error ? new RequestInputError(rejectedField, error.message) : null;
  const fieldError = (field: RequestInputField) => inputError?.field === field ? inputError.message : undefined;
  const fieldProps = (field: RequestInputField, hint?: string) => ({
    "aria-invalid": fieldError(field) ? true as const : undefined,
    "aria-describedby": [hint, fieldError(field) ? `${feedbackId}-${field}` : null].filter(Boolean).join(" ") || undefined,
  });
  const feedback = (field: RequestInputField) => fieldError(field)
    ? <small id={`${feedbackId}-${field}`} className="f002-field-error">⚠ {fieldError(field)}</small> : null;
  useEffect(() => {
    const fence = reads.current;
    return () => fence.clear();
  }, [client]);
  useEffect(() => {
    const binding = selected.current;
    if (!binding || binding.id !== requestId || client.signal?.aborted) return;
    const current = () => selected.current?.id === binding.id && selected.current?.baseVersionId === binding.baseVersionId
      && selected.current?.investigationId === binding.investigationId && !client.signal?.aborted;
    const observation = observeRequestAccess(client, binding, value => {
      if (!current() || value.revision < selected.current!.revision) return;
      selected.current = value; setRequest(value); setError(null);
    }, error => {
      if (!current()) return;
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
      else setError(error);
    });
    return () => observation.close();
  }, [client, requestId, requestBase, requestInvestigation, onAccessLost]);
  const report = (error: unknown, ticket?: ReadTicket) => {
    if (client.signal?.aborted || (ticket && !reads.current.accepts(ticket))) return;
    if (error instanceof FactsClientError && [401, 403].includes(error.status)) onAccessLost(error);
    else setError(error instanceof Error ? error : new Error("请求未确认"));
  };
  const readClient = (ticket: ReadTicket) => client.withSignal(client.signal ? AbortSignal.any([client.signal, ticket.signal]) : ticket.signal);
  const acceptRequest = (value: EvidenceRequest, ticket: ReadTicket) => {
    if (client.signal?.aborted || !reads.current.accepts(ticket)) return;
    if (selected.current?.id === value.id && value.revision < selected.current.revision) return;
    selected.current = value; setRequest(value);
  };
  const saveDraft = (patch: Partial<typeof journal.draft>) => {
    try { journal.saveDraft({ ...journal.draft, ...patch }); if (rejectedField) setError(null); } catch (error) { report(error); }
  };
  const read = async (id = lookup) => {
    if (busy || !/^[A-Za-z0-9-]{1,128}$/.test(id)) return;
    const ticket = reads.current.begin(id);
    setBusy(true); setError(null);
    try {
      const value = await readClient(ticket).request<{ request: EvidenceRequest }>(`/requests/${id}`);
      if (value.request?.id !== id) throw new FactsClientError("回执与原请求不匹配", "F002_REQUEST_REFERENCE_MISMATCH");
      acceptRequest(value.request, ticket);
    } catch (error) { report(error, ticket); }
    finally { if (!client.signal?.aborted && reads.current.accepts(ticket)) setBusy(false); }
  };
  const recover = async (pending: PendingOperation, ticket: ReadTicket) => {
    const result = await readClient(ticket).request<OperationEnvelope>(`/operations/${pending.operationId}`);
    if (client.signal?.aborted || !reads.current.accepts(ticket)) return;
    if (!journal.resolve(result)) throw new Error("未找到匹配原输入的取证回执；保留原操作键，不创建重复请求。");
    const found = result.results[0].value as unknown as EvidenceRequest;
    acceptRequest(found, ticket); saveDraft({ lookup: found.id });
  };
  const reconcile = async () => {
    if (!operation || busy) return;
    const ticket = reads.current.begin(operation.operationId);
    setBusy(true); setError(null);
    try { await recover(operation, ticket); } catch (error) { report(error, ticket); }
    finally { if (!client.signal?.aborted && reads.current.accepts(ticket)) setBusy(false); }
  };
  const send = async (cancel = false) => {
    if (busy || operation || !journal.available || !writable || !configured || !context.graphVersionId) return;
    if (!cancel && !requestInput.value) return;
    if (cancel && (!request || request.baseVersionId !== context.graphVersionId)) return;
    const operationId = crypto.randomUUID();
    const ticket = reads.current.begin(operationId);
    const pending = cancel && request ? { operationId, path: `/requests/${request.id}/cancel`, purpose: "取消取证", body: { operationId, revision: request.revision } }
      : { operationId, path: "/requests", purpose: requestKinds.find(kind => kind.value === requestInput.value!.requestKind)!.label,
        body: { operationId, ...requestInput.value! } };
    let dispatching = true;
    setBusy(true); setError(null);
    try {
      journal.begin(pending);
      await readClient(ticket).request(pending.path, "POST", pending.body); dispatching = false;
      if (!client.signal?.aborted && reads.current.accepts(ticket)) await recover(pending, ticket);
    } catch (error) {
      if (client.signal?.aborted || !reads.current.accepts(ticket)) return;
      if (dispatching && isDefiniteWriteRejection(error)) { try { journal.reject(operationId); } catch (storageError) { report(storageError); } }
      report(error, ticket);
    }
    finally { if (!client.signal?.aborted && reads.current.accepts(ticket)) setBusy(false); }
  };
  const status = request ? requestPresentation(request) : null;
  const resultNavigation = request ? requestResultNavigation(request, context) : null;
  return <details className="f002-panel"><summary>受授权的定向取证与持久回执</summary><p>调查授权、固定基准、范围和预算由 F003 可信 resolver 验证；输入调查 ID 不等于取得权限。新事实集不会自动替换原调查基准。</p>
    {!configured && <p className="f002-notice">⚠ F002_CONSUMER_UNAVAILABLE：调查消费方未配置，不能发起无主请求；这不是成功空结果。</p>}
    {((error && !rejectedField) || journal.error) && <p role="alert">{(!rejectedField && error ? error : journal.error)?.message}</p>}{operation && <p className="f002-notice">本次操作 {operation.operationId} 尚未确认。<button className="button" disabled={busy} onClick={() => void reconcile()}>对账原操作</button></p>}
    <div className="f002-form-grid"><label>可信调查 ID<input aria-label="可信调查 ID" {...fieldProps("investigationId")} disabled={!configured || busy || Boolean(operation)} value={investigation} onChange={event => saveDraft({ investigationId: event.target.value })} />{feedback("investigationId")}</label><label>问题（不粘贴敏感原文）<textarea aria-label="问题（不粘贴敏感原文）" {...fieldProps("question")} disabled={!configured || busy || Boolean(operation)} value={question} onChange={event => saveDraft({ question: event.target.value })} maxLength={16384} />{feedback("question")}</label></div>
    <p aria-label="固定取证基准">固定来源：{context.sourceVersionId ?? "由基准事实集绑定"} · 基准事实集：{context.graphVersionId ?? "尚未选择"}{feedback("baseVersionId")}</p>
    <p aria-label="当前固定取证目标">本次目标：{journal.draft.materialTargetId ? "MATERIAL" : context.kind ?? "尚未选择材料／事实"} · {journal.draft.materialTargetId ?? context.recordId ?? "—"}{feedback("target")}</p>
    <RequestMaterialPicker client={client} workspaceId={context.workspaceId} graphVersionId={context.graphVersionId} materialId={journal.draft.materialTargetId}
      disabled={busy || Boolean(operation) || !journal.available} onChoose={id => saveDraft({ materialTargetId: id })} onVerified={setMaterial} onAccessLost={onAccessLost} />
    <div className="f002-form-grid"><label>请求类型<select aria-label="取证请求类型" {...fieldProps("requestKind", `${feedbackId}-kind-hint`)} disabled={!configured || busy || Boolean(operation)} value={journal.draft.requestKind ?? "TARGETED_EVIDENCE"} onChange={event => saveDraft({ requestKind: event.target.value })}>{requestKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select><small id={`${feedbackId}-kind-hint`}>疑似漏提／错误只是待核查输入，不是改写事实的指令。</small>{feedback("requestKind")}</label>
      <label>请求的已安装能力<select aria-label="请求的已安装能力" {...fieldProps("requestedCapabilities", `${feedbackId}-capability-hint`)} multiple size={5} disabled={!configured || busy || Boolean(operation)} value={requestedCapabilities} onChange={event => saveDraft({ requestedCapabilities: Array.from(event.target.selectedOptions, option => option.value) })}>{[...new Set([...capabilities, ...requestedCapabilities])].map(capability => <option key={capability} value={capability} disabled={!capabilities.includes(capability)}>{capability}{!capabilities.includes(capability) ? " · 已不可启动，保留原选择" : ""}</option>)}</select><small id={`${feedbackId}-capability-hint`}>可启动不等于调查获准。留空仅按既有能力核查；范围与预算仍由服务端复验。</small>{feedback("requestedCapabilities")}</label></div>
    <button className="button" disabled={!configured || busy || Boolean(operation) || !requestedCapabilities.length} onClick={() => saveDraft({ requestedCapabilities: [] })}>清除能力选择</button>
    {requestInput.error && !inputError && <p className="f002-caption">⚠ {requestInput.error.message}</p>}
    <button className="button" disabled={!configured || !journal.available || !writable || busy || Boolean(operation) || !requestInput.value} onClick={() => void send()}>按当前固定引用请求取证</button>
    <h3>已知请求回查</h3><label>持久请求 ID<input value={lookup} onChange={event => saveDraft({ lookup: event.target.value })} /></label><button className="button" disabled={busy || !lookup} onClick={() => void read()}>复验原绑定并读取</button>
    {request && resultNavigation && <article aria-label="取证返回依据"><h3>{request.id}</h3><p>任务：{status?.statusLabel} · 返回：{status?.outcomeLabel}</p><p>调查 {request.investigationId} · 固定基准 {request.baseVersionId}</p>
      <p>{resultNavigation.explanation}</p>{resultNavigation.error && <p role="alert">{resultNavigation.error}</p>}
      <div className="f002-actions">{resultNavigation.links.map(link => <a className="button" key={link.href} href={link.href} onClick={event => {
        if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.button === 0) { event.preventDefault(); navigate(readEvidenceLocation(new URL(link.href, location.origin).search)); }
      }}>{link.label}</a>)}</div>
      <details><summary>核对完整结果与诊断回执</summary><pre>{JSON.stringify({ result: request.result, diagnostic: request.diagnostic }, null, 2)}</pre></details>
      <button className="button" disabled={busy} onClick={() => void read(request.id)}>刷新原请求状态</button>{["RUNNING", "QUEUED"].includes(request.status) && <button className="button" disabled={!writable || !journal.available || busy || Boolean(operation) || !configured || request.baseVersionId !== context.graphVersionId} onClick={() => void send(true)}>按当前调查授权取消</button>}</article>}
    <RequestCatalogPanel key={JSON.stringify([context.workspaceId, investigation, context.graphVersionId])} client={client} workspaceId={context.workspaceId}
      investigationId={investigation} baseVersionId={context.graphVersionId!} configured={configured} disabled={busy || Boolean(operation)}
      onSelect={id => { saveDraft({ lookup: id }); void read(id); }} onAccessLost={onAccessLost} />
  </details>;
}

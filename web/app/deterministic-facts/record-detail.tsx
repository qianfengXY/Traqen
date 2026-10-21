"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DeterministicFactsClient, FactsClientError } from "./client.ts";
import { evidenceReference, type EvidenceLocation } from "./model.ts";
import { evidenceRecordTitle as title } from "./search.ts";
import { useEvidenceResource } from "./use-resource.ts";
import { EvidenceExplanation } from "./evidence-explanation.tsx";
import type { Coverage, FactRecord, Manifest, RecordDetail, RecordPage } from "./types.ts";
import { isEvidenceShortcut } from "./keyboard.ts";

export function RecordDetailPanel({ client, context, select, accessLost, scrollTop, onScroll, onClose, autoFocus, onEndpoint }: {
  client: DeterministicFactsClient; context: EvidenceLocation; select: (record: FactRecord, line?: number) => void;
  accessLost: (error: Error) => void; scrollTop: number; onScroll: (top: number) => void;
  onClose: (top: number) => void; autoFocus: boolean;
  onEndpoint?: (fact: FactRecord, object: FactRecord) => void;
}) {
  const route = context.recordId && context.kind ? `/versions/${context.graphVersionId}/records/${context.kind}/${context.recordId}` : "";
  const load = useCallback((bound: DeterministicFactsClient) => route ? bound.request<RecordDetail>(route) : Promise.resolve(null), [route]);
  const resource = useEvidenceResource(client, route, load, accessLost);
  const versionRoute = context.recordId && context.graphVersionId ? `/versions/${context.graphVersionId}` : "";
  const loadManifest = useCallback(async (bound: DeterministicFactsClient) => versionRoute ? (await bound.request<{ manifest: Manifest }>(`${versionRoute}/manifest`)).manifest : null, [versionRoute]);
  const loadGaps = useCallback((bound: DeterministicFactsClient) => versionRoute ? bound.request<RecordPage>(`${versionRoute}/gaps?limit=100`) : Promise.resolve(null), [versionRoute]);
  const loadCoverage = useCallback(async (bound: DeterministicFactsClient) => versionRoute ? (await bound.request<{ coverage: Coverage }>(`${versionRoute}/coverage`)).coverage : null, [versionRoute]);
  const manifest = useEvidenceResource(client, `${versionRoute}/manifest`, loadManifest, accessLost);
  const gaps = useEvidenceResource(client, `${versionRoute}/gaps?limit=100`, loadGaps, accessLost);
  const coverage = useEvidenceResource(client, `${versionRoute}/coverage`, loadCoverage, accessLost);
  const detail = resource.data, error = resource.error;
  const panel = useRef<HTMLElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState<{ id: string; message: string } | null>(null);
  useEffect(() => { if (autoFocus) heading.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    const element = panel.current;
    // A position that cannot yet be restored is not clamped onto another
    // record. The parent binds the coordinate to kind + record ID.
    if (detail && element && scrollTop <= element.scrollHeight - element.clientHeight) element.scrollTop = scrollTop;
  }, [detail, manifest.data, gaps.data, coverage.data, scrollTop]);
  const close = () => onClose(panel.current?.scrollTop ?? scrollTop);
  const copy = async () => {
    if (!detail || client.signal?.aborted || !context.graphVersionId) return;
    try {
      await client.request(`/versions/${context.graphVersionId}/records/${detail.record.kind}/${detail.record.id}`);
      client.signal?.throwIfAborted();
      await navigator.clipboard.writeText(evidenceReference(context.workspaceId, context.graphVersionId, detail.record.kind, detail.record.id));
      if (!client.signal?.aborted) setNotice({ id: detail.record.id, message: "已复制完整版本引用，不是原文内容。" });
    } catch (error) {
      if (error instanceof FactsClientError && [401, 403].includes(error.status)) accessLost(error);
      else if (!client.signal?.aborted) setNotice({ id: detail.record.id, message: "引用或剪贴板权限未确认，复制未完成。" });
    }
  };
  return <aside className="f002-detail" ref={panel} aria-label="所选记录的依据与限制" onScroll={event => onScroll(event.currentTarget.scrollTop)}
    onKeyDown={event => { if (isEvidenceShortcut(event.nativeEvent, ["Escape"])) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <header><h2 ref={heading} tabIndex={-1} data-inspector-heading="true">依据与限制</h2><button className="button" aria-label="关闭依据面板" onClick={close}>关闭</button></header>
    {error ? <p role="alert">固定引用暂不可用：{error.message}。不会替换为最新版。</p> : !context.recordId ? <p>选择材料、对象或事实，查看原文位置、规则与前提。</p> : !detail ? <p role="status">正在读取固定记录…</p> : <>
      <h3>{title(detail.record)}</h3><code className="f002-id">{detail.record.id}</code><p>{detail.record.payload.basis === "DERIVED" ? "推导事实：须连同规则、前提与证据阅读。" : "技术记录或直接依据，不表示人工业务确认。"}</p>
      <dl><dt>固定事实集版本</dt><dd className="f002-id">{context.graphVersionId}</dd><dt>来源与范围</dt><dd>工作区 {context.workspaceId} · 来源 {context.sourceVersionId ?? "由事实集清单绑定"}</dd>
        {detail.record.payload.kind === "RELATION" && <><dt>关系方向</dt><dd className="f002-id">{detail.record.payload.subjectId} → {detail.record.payload.targetId}</dd><dt>关系谓词</dt><dd>{detail.record.payload.predicate}</dd></>}
      </dl>
      <button className="button" onClick={() => void copy()}>复制完整引用</button><p role="status">{notice?.id === context.recordId ? notice.message : ""}</p>
      {[{ label: "版本说明", resource: manifest }, { label: "限制清单", resource: gaps }, { label: "能力处置", resource: coverage }].map(({ label, resource }) => resource.error && <p role="alert" key={label}>{label}读取未完成：{resource.error.message}。不能按空结果解释。<button className="button" onClick={resource.retry}>重读{label}</button></p>)}
      <EvidenceExplanation context={context} detail={detail} manifest={manifest.data} gapPage={gaps.data} coverage={coverage.data} select={select} />
      <details><summary>核查固定记录原始字段</summary><pre>{JSON.stringify(detail.record.payload, null, 2)}</pre></details>
      <h3>原文与引用闭包</h3>{detail.references.map(reference => <button className="f002-ref" key={`${reference.role}:${reference.kind}:${reference.id}`} onClick={() => onEndpoint && detail.record.payload.kind === "RELATION" && ["subject", "target"].includes(reference.role)
        ? onEndpoint(detail.record, reference) : select(reference, reference.payload.anchor?.lineStart)}>{reference.role} · {title(reference)}<small>{reference.kind} · {reference.id.slice(0, 12)}…</small></button>)}
      {!detail.references.length && <p>此记录没有附加引用；材料读取不要求先有 Fact。</p>}
      <h3>关联的回答</h3><p>{context.returnTo ? "保留了来源工作定位，但上游回答状态未接入；不推断已确认、已采用或已调查。" : "本次为独立技术阅读，未绑定业务回答或会话。"}</p>
    </>}
  </aside>;
}

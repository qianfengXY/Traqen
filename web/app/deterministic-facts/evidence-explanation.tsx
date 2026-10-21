"use client";

import { explainEvidenceRecord, type EvidenceLocation } from "./model.ts";
import type { Coverage, FactRecord, Manifest, RecordDetail, RecordPage } from "./types.ts";

export function EvidenceExplanation({ context, detail, manifest, gapPage, coverage, select }: {
  context: EvidenceLocation; detail: RecordDetail; manifest: Manifest | null; gapPage: RecordPage | null; coverage: Coverage | null;
  select: (record: FactRecord, line?: number) => void;
}) {
  const explanation = explainEvidenceRecord({ context, detail, manifest, gapPage, coverage });
  const open = (kind: string, id: string) => {
    const record = detail.record.kind === kind && detail.record.id === id ? detail.record
      : detail.references.find(item => item.kind === kind && item.id === id) ?? gapPage?.items.find(item => item.kind === kind && item.id === id);
    if (record) select(record, record.payload.anchor?.lineStart);
  };
  return <section className="f002-explanation" aria-label="所选记录的可读技术说明">
    <p>{explanation.formLabel} · {explanation.basisLabel}</p><p data-evidence-statement>{explanation.statement}</p>
    {detail.record.kind === "FACT" && <p data-predicate-meaning>{explanation.meaning ?? "本版本的谓词词义尚未载入或未确认；不套用其他版本解释。"}</p>}
    <dl className="f002-digests"><dt>来源快照</dt><dd>{explanation.sourceVersionId ?? "未确认"}</dd><dt>分析范围</dt><dd>{explanation.scopeId ?? "未确认"}</dd>
      {explanation.scopeStatus && <><dt>范围状态</dt><dd>{explanation.scopeStatus}（不表示业务确认）</dd></>}
      {explanation.scopeSelections.map((selection, index) => <div key={index}><dt>范围选取 {index + 1}</dt><dd>{selection.kind ?? "类型未确认"} · {selection.componentId ?? selection.materialId ?? selection.objectId ?? "身份未确认"}</dd></div>)}
      <dt>能力配置</dt><dd>{explanation.profileId ?? "未确认"}</dd></dl><p>{explanation.contextNotice}</p>
    <h3>原文定位</h3>
    {explanation.locations.map(location => <div key={`${location.kind}:${location.id}`} data-source-location>
      <button className="f002-record-link" onClick={() => open(location.kind, location.id)}>{location.description}</button>
      <small className="f002-id">材料 {location.materialId ?? "未确认"} · 内容摘要 {location.contentDigest ?? "未确认"}</small>
    </div>)}
    {!explanation.locations.length && <p>此记录没有可用原文锚点；不会补造行号或图像区域。材料仍可独立受控读取。</p>}
    {!!explanation.missingEvidenceIds.length && <p className="f002-id">未载入证据：{explanation.missingEvidenceIds.join(" · ")}</p>}
    <h3>提取规则与前提</h3>
    <p data-extraction-rule>{explanation.rule ? `${explanation.rule.id}@${explanation.rule.version} · ${explanation.rule.declared ? "列入本版本配置（非执行验证）" : "规则配置尚未确认"}` : detail.record.kind === "FACT" ? "规则身份未确认。" : "非 Fact 记录，无 Fact 提取规则。"}</p>
    <p data-premise-notice>{explanation.premiseNotice}</p>
    {explanation.premiseIds.map(id => <div key={id} className="f002-id">{explanation.loadedPremiseIds.includes(id)
      ? <button className="f002-record-link" onClick={() => open("FACT", id)}>查看前提 {id}</button> : <span>前提未载入：{id}</span>}</div>)}
    <h3>材料能力处置</h3><p>{explanation.processingNotice}</p>
    {explanation.processing.map(item => <p key={`${item.materialId}:${item.capabilityId}`} className="f002-id">{item.materialId} · {item.capabilityId} · {item.status}</p>)}
    <h3>已知限制与禁止外推</h3>
    {explanation.gap && <div data-gap-explanation><dl className="f002-digests"><dt>限制来源</dt><dd>{explanation.gap.originLabel}</dd>
      <dt>实际原因代码</dt><dd>{explanation.gap.code}</dd><dt>原因类别／能力</dt><dd>{explanation.gap.category ?? "未确认"} · {explanation.gap.capability ?? "未确认"}</dd>
      {explanation.gap.sourceGapId && <><dt>原来源 Gap</dt><dd>{explanation.gap.sourceGapId}</dd></>}
      {explanation.gap.affectedScope && <><dt>受影响范围</dt><dd>{explanation.gap.affectedScope}</dd></>}</dl>
      <p>{explanation.gap.notice}</p><h3>可用的下一步</h3><p>{explanation.gap.nextStep}</p></div>}
    <p data-gap-notice>{explanation.gapNotice}</p>
    {explanation.relatedGaps.map(gap => <div key={gap.id}><button className="f002-ref" onClick={() => open("GAP", gap.id)}>{gap.relation} · {gap.originLabel} · {gap.code}<small>{gap.id}</small></button><p>{gap.notice}</p></div>)}
    <ul>{explanation.limits.map((limit, index) => <li key={index}>{limit}</li>)}</ul>
  </section>;
}

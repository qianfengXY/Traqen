import type { EvidenceLocation } from "./model.ts";
import type { Coverage, Manifest, RecordDetail, RecordPage } from "./types.ts";
import { evidenceRecordTitle } from "./search.ts";
import { explainGap, explainSourceLocation, metadataIds, metadataObject, metadataText } from "./explanation-locations.ts";

const commonLimits = ["技术事实及处理状态不等于人工业务确认、已实现或实际执行通过。", "没有 Fact 或 Gap 不等于完备；同材料 Gap 不自动否定所选事实。"];
function typedValue(value: unknown) {
  const scalar = metadataObject(value);
  const datatype = metadataText(scalar.datatype);
  if (!datatype || !["string", "number", "integer", "boolean", "null"].includes(datatype)) return "值的标量类型未确认";
  const raw = scalar.value;
  if ((datatype === "integer" && typeof raw === "number" && Number.isInteger(raw)) || (datatype === "number" && typeof raw === "number" && Number.isFinite(raw))
    || (datatype === "string" && typeof raw === "string") || (datatype === "boolean" && typeof raw === "boolean") || (datatype === "null" && raw === null)) return `${JSON.stringify(raw)}（${datatype}）`;
  return `值与声明类型 ${datatype} 不一致，未确认`;
}

export function explainEvidenceRecord({ context, detail, manifest, gapPage, coverage }: {
  context: EvidenceLocation; detail: RecordDetail; manifest: Manifest | null; gapPage: RecordPage | null; coverage: Coverage | null;
}) {
  const { record, references } = detail, payload = record.payload;
  const bound = !!manifest && manifest.graphVersionId === context.graphVersionId && (!context.sourceVersionId || manifest.bundleId === context.sourceVersionId);
  const rules = metadataObject(bound ? manifest.rules : null), vocabulary = metadataObject(bound ? manifest.vocabulary : null);
  const scope = metadataObject(bound ? manifest.scope : null);
  const predicate = metadataText(payload.predicate);
  const definitions = Array.isArray(vocabulary.predicates) ? vocabulary.predicates.map(metadataObject) : [];
  const meaning = metadataText(definitions.find(item => item.predicate === predicate)?.meaning);
  const subject = references.find(ref => ref.role === "subject" && ref.kind === "OBJECT" && ref.id === payload.subjectId);
  const target = references.find(ref => ref.role === "target" && ref.kind === "OBJECT" && ref.id === payload.targetId);
  const subjectLabel = subject ? evidenceRecordTitle(subject) : payload.subjectId ?? "主体未载入";
  const targetLabel = target ? evidenceRecordTitle(target) : payload.targetId ?? "目标未载入";
  const formLabel = record.kind === "FACT" ? payload.kind === "RELATION" ? "关系事实" : payload.kind === "PROPERTY" ? "属性事实" : "事实形式未确认"
    : ({ MATERIAL: "材料记录", OBJECT: "结构对象", EVIDENCE: "原文证据", GAP: "限制记录" }[record.kind] ?? "记录类型未确认");
  const basisLabel = record.kind !== "FACT" ? "非 Fact 记录" : payload.basis === "DERIVED" ? "规则派生 · DERIVED"
    : payload.basis === "DECLARED" ? "原文声明 · DECLARED" : "依据类别未确认";
  const gap = record.kind === "GAP" ? explainGap(record) : null;
  const statement = record.kind === "FACT" ? payload.kind === "RELATION" ? `${subjectLabel} — ${predicate ?? "谓词未确认"} → ${targetLabel}`
    : payload.kind === "PROPERTY" ? `${subjectLabel} · ${predicate ?? "谓词未确认"} = ${typedValue(payload.value)}` : "事实形式未确认；保留固定记录供核查。"
    : record.kind === "MATERIAL" ? `材料 ${evidenceRecordTitle(record)}；独立阅读不要求先有 Fact，材料记录本身不证明已提取事实。`
    : record.kind === "OBJECT" ? `${payload.kind ?? "对象类型未确认"} · ${evidenceRecordTitle(record)}；仅表示已登记结构对象。`
    : gap ? `${gap.originLabel} · ${gap.code}` : "精确原文锚点；不表示人工业务确认。";
  const rawRule = metadataObject(record.kind === "FACT" ? payload.ruleRef : null);
  const ruleId = metadataText(rawRule.id), version = metadataText(rawRule.version);
  const rule = ruleId && version ? { id: ruleId, version, declared: bound && rules.profileId === manifest.profileId
    && Array.isArray(rules.ruleVersions) && ruleId.startsWith("f002-") && rules.ruleVersions.includes(`${ruleId.slice(5)}@${version}`) } : null;
  const premiseIds = record.kind === "FACT" ? metadataIds(payload.premiseFactIds) : [];
  const loadedPremiseIds = premiseIds.filter(id => references.some(ref => ref.role === "premise" && ref.kind === "FACT" && ref.id === id));
  const missingPremiseIds = premiseIds.filter(id => !loadedPremiseIds.includes(id));
  const evidenceIds = record.kind === "FACT" ? metadataIds(payload.evidenceIds) : [];
  const missingEvidenceIds = evidenceIds.filter(id => !references.some(ref => ref.kind === "EVIDENCE" && ref.role === "evidence" && ref.id === id));
  const located = record.kind === "FACT" ? references.filter(ref => ref.kind === "EVIDENCE" && ref.role === "evidence" && evidenceIds.includes(ref.id)) : [record];
  const locations = located.flatMap(item => {
    const location = explainSourceLocation(item);
    if (!location) return [];
    const material = references.find(ref => ref.kind === "MATERIAL" && ref.role === "material" && ref.id === location.materialId);
    return [{ ...location, contentDigest: location.contentDigest ?? metadataText(material?.payload.contentDigest) }];
  });
  // Only exact authorized references establish association, never a shared
  // name, inferred path hierarchy or arbitrary recursive payload traversal.
  const objectIds = new Set([...(record.kind === "OBJECT" ? [record.id] : []), ...references.filter(ref => ref.kind === "OBJECT").map(ref => ref.id)]);
  const materialIds = new Set([...(record.kind === "MATERIAL" ? [record.id] : []), ...[record, ...references].flatMap(ref => typeof ref.payload.materialId === "string" ? [ref.payload.materialId] : []),
    ...references.filter(ref => ref.kind === "MATERIAL").map(ref => ref.id)]);
  const relatedGaps = (gapPage?.items ?? []).flatMap(item => {
    if (item.kind !== "GAP" || (record.kind === "GAP" && item.id === record.id)) return [];
    const relation = item.payload.objectId && objectIds.has(item.payload.objectId) ? "对象关联" : item.payload.materialId && materialIds.has(item.payload.materialId) ? "同材料限制" : null;
    return relation ? [{ ...explainGap(item), relation }] : [];
  });
  const processing = coverage && (!manifest || (bound && coverage.scopeId === manifest.scopeId)) ? coverage.items.filter(item => materialIds.has(item.materialId))
    .map(item => ({ materialId: item.materialId, capabilityId: item.capabilityId, status: item.status })) : [];
  const scopeSelections = Array.isArray(scope.selections) ? scope.selections.map(item => {
    const selection = metadataObject(item);
    return { kind: metadataText(selection.kind), componentId: metadataText(selection.componentId), materialId: metadataText(selection.materialId), objectId: metadataText(selection.objectId) };
  }) : [];
  return { formLabel, basisLabel, statement, predicate, meaning, rule, premiseIds, loadedPremiseIds, missingPremiseIds, missingEvidenceIds,
    premiseNotice: record.kind !== "FACT" ? "此记录不是 Fact，不补造提取规则或推导前提。" : premiseIds.length ? missingPremiseIds.length ? "所列前提部分未载入；不能把闭包展示当作证明完整。" : "所列前提已载入；不代表业务确认或实际执行。"
      : payload.basis === "DERIVED" ? "派生记录未列出前提；不能将其当作完整推导证明。" : "记录未列出前提；不表示业务语义或实现已验证。",
    sourceVersionId: context.sourceVersionId ?? (bound ? manifest.bundleId : null), scopeId: bound ? manifest.scopeId : null,
    profileId: bound ? manifest.profileId : null, scopeStatus: metadataText(scope.status), scopeSelections,
    contextNotice: !manifest ? "版本清单尚未载入；规则配置、词义和范围未确认。" : !bound ? "清单与固定版本或来源不一致；不使用其他版本的词义、规则或范围。" : "来源、规则配置和范围由此固定版本清单绑定；登记不等于执行验证。",
    locations, gap, relatedGaps,
    gapNotice: !gapPage ? "Gap 清单尚未载入或未确认；不能声称没有限制。" : gapPage.nextCursor ? "仅关联当前加载页的 Gap；仍有后续页，未展示不等于不存在。" : "已核对当前版本的 Gap 页；没有关联项不等于完备。",
    processing, processingNotice: !coverage ? "材料能力处置尚未确认或未载入；不推断 DONE 或零事实。" : processing.length ? "仅显示实际材料 × 能力的处置，不汇总成业务成功。" : "未找到可确认的关联材料能力处置；不推断已完成。",
    limits: [...commonLimits, ...(Array.isArray(vocabulary.prohibitions) ? vocabulary.prohibitions.filter((item): item is string => typeof item === "string") : [])] };
}

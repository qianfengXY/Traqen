import { createHash } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";

const kinds = new Set(["FUNCTION", "RULE", "ROLE", "STATE", "PROCESS", "EXCEPTION", "BUSINESS_OBJECT"]);
const text = (value, max = 16384) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const strings = value => Array.isArray(value) && value.length <= 200 && value.every(s => text(s));
const hash = value => createHash("sha256").update(canonicalEncode(value)).digest("hex");

export function intactBusinessGraph(graph) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return false;
  try {
    const {id,digest:claimed,...body}=graph;
    return /^[a-f0-9]{64}$/.test(claimed??'')&&hash(body)===claimed&&id===`F003-GRAPH-${claimed}`;
  } catch {return false;}
}

function validCitation(citation, materials, bundleId, workspaceId) {
  const material = materials.get(citation?.materialId);
  if (!material || material.sourceMaterial.bundleId !== bundleId || material.sourceMaterial.workspaceId !== workspaceId
    || !Number.isSafeInteger(citation.startLine) || citation.startLine < 1 || !Number.isSafeInteger(citation.endLine)
    || citation.endLine < citation.startLine || !text(citation.quote)) return false;
  const lines = material.text.split(/\r?\n/);
  if (citation.endLine > lines.length) return false;
  return lines.slice(citation.startLine - 1, citation.endLine).join("\n").includes(citation.quote);
}

// These are structural and provenance guards, not an automatic semantic judge.
// Main's evidence-bounded verification is retained verbatim; independent
// run-bound quality evidence is still required before publishing a current head.
export function buildBusinessGraph(input) {
  requireF003(input && text(input.workspaceId, 128) && text(input.investigationId, 128) && text(input.sourceBundleId, 256)
    && text(input.profileId, 256), "F003_GRAPH_INPUT_INVALID", "图谱必须绑定调查、Workspace、原材料及配置");
  for (const field of ["materials", "inventory", "candidates", "relations", "reviews", "allowedFactIds", "adoptedVersionIds"]) {
    requireF003(Array.isArray(input[field]) && input[field].length <= 10000, "F003_GRAPH_INPUT_INVALID", `${field}必须是有界清单`);
  }
  const materials = new Map(input.materials.map(m => [m.id, m]));
  requireF003(materials.size === input.materials.length && input.materials.every(m => text(m.id, 256) && m.sourceMaterial?.id === m.id && typeof m.text === "string"),
    "F003_GRAPH_INPUT_INVALID", "已读材料引用重复或不完整");
  const knownFacts = new Set(input.allowedFactIds), reviews = new Map(), duplicates = new Set();
  for (const review of input.reviews) {
    if (reviews.has(review?.key)) duplicates.add(review.key);
    reviews.set(review?.key, review);
  }
  const candidateKeys = new Set(input.candidates.map(c => c?.key));
  const endpointKeys = new Set([...candidateKeys, ...materials.keys()]);
  const allKeys = [...input.candidates, ...input.relations].map(c => c?.key);
  const repeatedKeys = new Set(allKeys.filter((value, index) => allKeys.indexOf(value) !== index));
  const quarantine = [];
  function assess(item, relation) {
    const review = reviews.get(item?.key);
    let reason = null;
    const evidence = Array.isArray(item?.evidence) ? item.evidence : [];
    const technicalRefs = item?.technicalRefs ?? [];
    if (!text(item?.key, 128) || repeatedKeys.has(item.key) || !text(item.scope) || !strings(item.uncertainties ?? [])
      || (item.identityIssues ?? []).length > 0
      || (!relation && (!kinds.has(item.kind) || !text(item.name, 256) || !text(item.statement)))) reason = "INVALID_STRUCTURE";
    else if (relation && (!endpointKeys.has(item.sourceKey) || !endpointKeys.has(item.targetKey)
      || !/^[A-Z][A-Z0-9_]{0,63}$/.test(item.predicate ?? ""))) reason = "INVALID_ENDPOINT";
    else if (evidence.length > 200 || evidence.some(c => !validCitation(c, materials, input.sourceBundleId, input.workspaceId))
      || !Array.isArray(technicalRefs) || technicalRefs.length > 200 || technicalRefs.some(id => !knownFacts.has(id))) reason = "INVALID_EVIDENCE";
    let state = "RETAINED_UNKNOWN";
    if (reason) state = "QUARANTINED";
    else if ((item.consolidationIssues ?? []).length > 0 || duplicates.has(item.key) || (Array.isArray(review?.unresolvedConflicts) && review.unresolvedConflicts.length > 0)
      || review?.support === "AMBIGUOUS") state = "HUMAN_REVIEW";
    else if (evidence.length === 0 || review?.support === "INSUFFICIENT") state = "NEEDS_EVIDENCE";
    else if (review?.support === "SUPPORTED" && text(review.rationale) && strings(review.premises) && review.premises.length > 0
      && Array.isArray(review.unresolvedConflicts) && review.unresolvedConflicts.length === 0) state = "ANALYSIS_ACCEPTED";
    const record = { key: text(item?.key, 128) ? item.key : `invalid-${quarantine.length}`,
      ...(relation ? { sourceKey: item.sourceKey ?? null, predicate: item.predicate ?? null, targetKey: item.targetKey ?? null }
        : { kind: item.kind ?? null, name: item.name ?? null, statement: item.statement ?? null }),
      scope: item.scope ?? null, evidence: structuredClone(evidence), technicalRefs: structuredClone(technicalRefs),
      originRefs: structuredClone(item.originRefs ?? []), provenance: structuredClone(item.provenance ?? null),
      dependencyScope:structuredClone(item.dependencyScope??null),reuse:structuredClone(item.reuse??null),
      identityIssues: structuredClone(item.identityIssues ?? []), consolidationIssues: structuredClone(item.consolidationIssues ?? []),
      uncertainties: strings(item.uncertainties ?? []) ? structuredClone(item.uncertainties ?? []) : ["不确定性字段无效"],
      state, authority: "AGENT_ANALYSIS", verification: review ? structuredClone(review) : null };
    record.id = hash({ workspaceId: input.workspaceId, investigationId: input.investigationId, record });
    if (reason) quarantine.push({ id: record.id, key: record.key, reason });
    return record;
  }
  const candidates = input.candidates.map(c => assess(c, false));
  const relations = input.relations.map(r => assess(r, true));
  const byKey = new Map(candidates.map(c => [c.key, c]));
  for (const relation of relations) {
    if (relation.state === "ANALYSIS_ACCEPTED" && [relation.sourceKey, relation.targetKey].some(k => byKey.has(k) && byKey.get(k).state !== "ANALYSIS_ACCEPTED")) {
      relation.state = "HUMAN_REVIEW";
      relation.uncertainties.push("关系端点仍有未决解释，不能作为已成立分支");
      relation.id = hash({ ...relation, id: null });
    }
  }
  const associated = new Set(candidates.filter(c => c.state === "ANALYSIS_ACCEPTED").flatMap(c => c.evidence.map(e => e.materialId)));
  for (const relation of relations.filter(r => r.state === "ANALYSIS_ACCEPTED")) {
    for (const citation of relation.evidence) associated.add(citation.materialId);
    for (const endpoint of [relation.sourceKey, relation.targetKey]) if (materials.has(endpoint)) associated.add(endpoint);
  }
  const childInputs = (input.process ?? []).filter(p => /^(child-|supplement)/.test(p.taskKey ?? "") && Array.isArray(p.sourceRanges));
  const pending = (input.process ?? []).flatMap(p => (p.pendingTasks ?? []).flatMap(task => task.sourceRanges ?? []));
  const modelInput = id => {
    const material = materials.get(id), length = material ? Buffer.byteLength(material.text) : 0, ranges = [];
    const actual = childInputs.flatMap(p => p.sourceRanges).filter(r => r.materialId === id && Number.isSafeInteger(r.byteStart)
      && Number.isSafeInteger(r.byteEnd) && r.byteStart >= 0 && r.byteEnd >= r.byteStart && r.byteEnd <= length).sort((a, b) => a.byteStart - b.byteStart);
    for (const r of actual) {
      const last = ranges.at(-1);
      if (last && r.byteStart <= last[1]) last[1] = Math.max(last[1], r.byteEnd);
      else ranges.push([r.byteStart, r.byteEnd]);
    }
    const supplied = ranges.reduce((n, [start, end]) => n + end - start, 0);
    return { status: !material ? "NOT_SUPPLIED" : !childInputs.length ? "UNKNOWN" : !ranges.length ? "NOT_SUPPLIED"
      : supplied === length ? "FULLY_SUPPLIED" : "PARTIALLY_SUPPLIED", suppliedByteRanges: ranges,
    pendingByteRanges: pending.filter(r => r.materialId === id).map(r => [r.byteStart, r.byteEnd]),
    meaning: "TRANSPORT_COVERAGE_NOT_SEMANTIC_COMPLETENESS" };
  };
  const coverage = input.inventory.map(entry => ({ ...structuredClone(entry),
    sourceReadStatus: materials.has(entry.materialId) ? "READ" : "UNREAD", modelInput: modelInput(entry.materialId),
    businessStatus: associated.has(entry.materialId) ? "ASSOCIATED" : "UNASSOCIATED" }));
  const graph = { schemaVersion: 1, workspaceId: input.workspaceId, investigationId: input.investigationId,
    sourceBundleId: input.sourceBundleId, profileId: input.profileId, adoptedVersionIds: [...input.adoptedVersionIds],
    materials: input.materials.map(({ id, sourceMaterial, receiptId, kind, assetType }) => ({ id, sourceMaterial, receiptId: receiptId ?? null, kind: kind ?? "UNKNOWN", assetType: assetType ?? "OTHER" })),
    consolidation: structuredClone(input.consolidation ?? null),
    candidates, relations, coverage, quarantine, process: structuredClone(input.process ?? []), published: false,
    ...(input.dependencyReview?{dependencyReview:structuredClone(input.dependencyReview)}:{}),
    ...(input.continuation?{continuation:structuredClone(input.continuation)}:{}) };
  const digest = hash(graph);
  return { ...graph, id: `F003-GRAPH-${digest}`, digest };
}

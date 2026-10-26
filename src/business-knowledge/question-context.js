import { originalEvidenceContext, originalContextBytes } from './model-context.js';
import { publicationDigest as digest } from './publication-authority.js';

export const questionInputBytes = 1024 * 1024;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const unique = values => [...new Set(values)];
const citations = values => [...new Map(values.map(value => [digest(value), value])).values()];

// The dependency set comes from the immutable graph and explicitly adopted
// version-local F002 packet, never from the Child's choice of citations.
export function questionPremiseResolver(objects, endpoints, technical, {requireAccepted=true}={}) {
  const byKey = new Map([...endpoints, ...objects].map(o => [o.key, o])), cache = new Map();
  const versionKey = (version, id) => `${version}\0${id}`;
  const facts = new Map((technical.records ?? []).map(r => [versionKey(r.versionId, r.id), r.record]));
  const factsById = new Map();
  for (const r of technical.records ?? []) factsById.set(r.id, [...(factsById.get(r.id) ?? []), r]);
  const technicalObjects = new Map((technical.objects ?? []).map(r => [versionKey(r.versionId, r.objectId), r]));
  const evidence = new Map((technical.evidence ?? []).map(r => [versionKey(r.versionId, r.evidenceId), r]));
  const materials = new Map((technical.materials ?? []).map(r => [versionKey(r.versionId, r.materialId), r]));
  function resolve(keys) {
    const result = { graphKeys: [], endpointKeys: [], evidence: [], wholeMaterialIds: [], technicalDependencies: [], gaps: [] };
    const visited = new Set(), visitedTechnical = new Set();
    const gap = reason => { if (!result.gaps.includes(reason)) result.gaps.push(reason); };
    function raw(version, row) {
      const material = materials.get(versionKey(version, row.materialId));
      if (!material?.sourceMaterial?.id || material.sourceMaterial.bundleId !== technical.sourceBundleId) { gap('TECHNICAL_CONTEXT_INCOMPLETE'); return; }
      const materialId = material.sourceMaterial.id, anchor = row.anchor;
      if (anchor?.kind === 'TEXT') {
        if (!Number.isSafeInteger(anchor.lineStart) || !Number.isSafeInteger(anchor.lineEnd) || anchor.lineStart < 1 || anchor.lineEnd < anchor.lineStart)
          gap('TECHNICAL_CONTEXT_INCOMPLETE');
        else result.evidence.push({ materialId, startLine: anchor.lineStart, endLine: anchor.lineEnd });
      } else {
        // Non-line anchors are not guessed. A complete bounded raw material is
        // an equivalent readable projection; if it cannot fit it stays unknown.
        result.wholeMaterialIds.push(materialId);
      }
    }
    function dependency(version, kind, id, depth = 0, stack = new Set()) {
      const key = `${version}\0${kind}\0${id}`;
      if (stack.has(key) || depth > 32) { gap('TECHNICAL_CONTEXT_INCOMPLETE'); return; }
      if (visitedTechnical.has(key)) return;
      visitedTechnical.add(key);
      const next = new Set(stack); next.add(key);
      if (kind === 'FACT') {
        const fact = facts.get(versionKey(version, id));
        if (!fact || !(technical.versionIds ?? []).includes(version) || !(technical.allowedFactIds ?? []).includes(id)) { gap('TECHNICAL_CONTEXT_INCOMPLETE'); return; }
        result.technicalDependencies.push({ versionId: version, factId: id });
        dependency(version, 'OBJECT', fact.subjectId, depth + 1, next);
        if (fact.targetId) dependency(version, 'OBJECT', fact.targetId, depth + 1, next);
        for (const e of fact.evidenceIds ?? []) dependency(version, 'EVIDENCE', e, depth + 1, next);
        for (const premise of fact.premiseFactIds ?? []) dependency(version, 'FACT', premise, depth + 1, next);
      } else {
        const row = (kind === 'OBJECT' ? technicalObjects : evidence).get(versionKey(version, id));
        if (!row) { gap('TECHNICAL_CONTEXT_INCOMPLETE'); return; }
        raw(version, row);
        if (kind === 'OBJECT' && row.parentId) dependency(version, 'OBJECT', row.parentId, depth + 1, next);
      }
    }
    function visit(key, endpoint = false) {
      if (visited.has(key)) return;
      visited.add(key);
      const object = byKey.get(key);
      if (!object) { gap('GRAPH_REFERENCE_NOT_SUPPORTED'); return; }
      result.graphKeys.push(key); if (endpoint) result.endpointKeys.push(key);
      if (object.sourceMaterial?.id === key && object.id === key) {
        result.wholeMaterialIds.push(object.id); return;
      }
      if (requireAccepted && object.state !== 'ANALYSIS_ACCEPTED') gap('GRAPH_REFERENCE_NOT_SUPPORTED');
      if ((object.consolidationIssues ?? []).length || (object.verification?.unresolvedConflicts ?? []).length) gap('UNRESOLVED_GRAPH_CONFLICT');
      if (!Array.isArray(object.evidence) || !object.evidence.length) gap('ORIGINAL_CONTEXT_INCOMPLETE');
      else result.evidence.push(...object.evidence);
      for (const id of object.technicalRefs ?? []) {
        const matches = factsById.get(id) ?? [];
        if (!matches.length) gap('TECHNICAL_CONTEXT_INCOMPLETE');
        // Identical ids in multiple adopted versions retain both provenance
        // chains; do not silently pick a version by array order.
        for (const fact of matches) dependency(fact.versionId, 'FACT', id);
      }
      if (object.sourceKey || object.targetKey) {
        if (!object.sourceKey || !object.targetKey) gap('GRAPH_REFERENCE_NOT_SUPPORTED');
        else { visit(object.sourceKey, true); visit(object.targetKey, true); }
      }
    }
    for (const key of keys) visit(key);
    result.evidence = citations(result.evidence); result.wholeMaterialIds = unique(result.wholeMaterialIds);
    return result;
  }
  const forKeys = keys => {
    const key = JSON.stringify(keys);
    if (!cache.has(key)) cache.set(key, resolve(keys));
    return cache.get(key);
  };
  return { forKeys, materialIds: unique(objects.flatMap(o => {
    const p = forKeys([o.key]); return [...p.evidence.map(e => e.materialId), ...p.wholeMaterialIds];
  })) };
}

// Each item's graph/technical/original closure is atomic under the shared raw
// byte bound. An unavailable premise cannot be hidden by a small quoted subset.
export function questionOriginalContext(items, materials, resolver, limit = originalContextBytes) {
  const prepared = [], missingEvidence = [], premises = [];
  for (const item of items) {
    const p = resolver.forKeys(item.graphRefs), gaps = [...p.gaps], evidence = [...p.evidence];
    for (const id of p.wholeMaterialIds) {
      const m = materials.find(m => m.id === id);
      if (!m) gaps.push('ORIGINAL_CONTEXT_INCOMPLETE');
      else evidence.push({ materialId: id, startLine: 1, endLine: m.text.split('\n').length });
    }
    premises.push({ key: item.key, graphKeys: p.graphKeys, endpointKeys: p.endpointKeys, technicalDependencies: p.technicalDependencies });
    if (gaps.length) missingEvidence.push({ key: item.key, reason: gaps[0], reasons: unique(gaps) });
    else prepared.push({ key: item.key, evidence: citations(evidence) });
  }
  const original = originalEvidenceContext(prepared, materials, limit);
  original.evidenceContext.missingEvidence.push(...missingEvidence);
  original.evidenceContext.premises = premises;
  original.evidenceContext.rules.push('Every retained item includes ALL referenced graph evidence, directed endpoints and recursively adopted technical raw premises. Child citation subsets do not reduce this set.');
  return original;
}

// Model output and JSON metadata are bounded independently of raw text. Keep
// whole per-segment closures; omitted segments remain persisted UNKNOWN. A bad
// or giant draft cannot consume another valid segment's original-context budget.
export function boundedQuestionVerification(base, drafts, materials, resolver, eligible, maxBytes = questionInputBytes) {
  const all = drafts.flatMap(d => d.segments), retained = [], omitted = [], provenance = new Map(drafts.flatMap(d => d.segments.map(s => [s.key, d])));
  const project = segments => {
    const original = questionOriginalContext(segments.filter(s => eligible(s)), materials, resolver);
    const grouped = [];
    for (const segment of segments) {
      const draft = provenance.get(segment.key), taskKey = draft.taskKey; let group = grouped.find(d => d.taskKey === taskKey);
      if (!group) { group = { taskKey, segments: [], unknowns: draft.unknowns ?? [] }; grouped.push(group); }
      group.segments.push(segment);
    }
    return { ...base, drafts: grouped, ...original };
  };
  // Validate useful drafts first, so invalid model references cannot evict them.
  for (const segment of [...all.filter(eligible), ...all.filter(s => !eligible(s))]) {
    if (bytes(segment) + bytes(base) > maxBytes) { omitted.push({key:segment.key,reason:'MODEL_INPUT_BYTE_BUDGET'}); continue; }
    const input = project([...retained, segment]);
    if (bytes(input) <= maxBytes) retained.push(segment);
    else omitted.push({ key: segment.key, reason: 'MODEL_INPUT_BYTE_BUDGET' });
  }
  const input = project(retained);
  // A base envelope which itself cannot fit is not sent to the model. The
  // caller can still save the bounded UNKNOWN answer without inventing a vote.
  return { input: bytes(input) <= maxBytes ? input : null, omitted: bytes(input) <= maxBytes ? omitted
    : all.map(s => ({ key: s.key, reason: 'MODEL_INPUT_BYTE_BUDGET' })) };
}

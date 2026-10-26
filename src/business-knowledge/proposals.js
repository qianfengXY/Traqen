import { createHash } from "node:crypto";
import { canonicalEncode } from "../source-truth/identity.js";
import { requireF003 } from "./errors.js";

const hash = value => createHash("sha256").update(canonicalEncode(value)).digest("hex");
const text = (v, max = 16384) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const unique = values => [...new Map(values.map(v => [canonicalEncode(v), v])).values()];
const issue = (record, code) => { record.consolidationIssues = [...new Set([...(record.consolidationIssues ?? []), code])]; };
const candidateSemantics = p => ({ kind: p.kind, name: p.name, statement: p.statement, scope: p.scope,
  dependencyScope: p.dependencyScope ?? null });

// Local names only bind within the emitting task. IDs include typed collection,
// task, ordinal and original content, and are stable across checkpoint reuse.
export function qualifyTaskProposals({ investigationId, sourceBundleId, taskKey, slotId, modelRevisionId, reservationId,
  materialIds, sourceRanges, existingCandidateKeys = [], output }) {
  const originalProposals = [], local = new Map(), candidateCounts = new Map(), relationCounts = new Map();
  for (const [items, counts] of [[output.candidates, candidateCounts], [output.relations, relationCounts]]) {
    requireF003(Array.isArray(items) && items.length <= 2000, "F003_MODEL_OUTPUT_INVALID", "任务候选必须是有界清单");
    for (const p of items) if (text(p?.key, 128)) counts.set(p.key, (counts.get(p.key) ?? 0) + 1);
  }
  const qualify = (p, ordinal, collection, counts) => {
    const raw = p && typeof p === "object" && !Array.isArray(p) ? p : {};
    const origin = { investigationId, sourceBundleId, taskKey, slotId, modelRevisionId, reservationId,
      collection, ordinal, localKey: typeof raw.key === "string" ? raw.key : null, materialIds: [...materialIds],
      ...(sourceRanges ? { sourceRanges: structuredClone(sourceRanges) } : {}), proposalDigest: hash(raw) };
    const key = `${collection.toLowerCase()}-${hash(origin)}`;
    originalProposals.push({ id: key, origin, proposal: structuredClone(p ?? null) });
    const identityIssues = [];
    if (!text(raw.key, 128)) identityIssues.push("INVALID_TASK_LOCAL_KEY");
    if (counts.get(raw.key) > 1) identityIssues.push("DUPLICATE_TASK_LOCAL_KEY");
    return { ...structuredClone(raw), key, proposalCollection: collection, originRefs: [key], provenance: origin, identityIssues, consolidationIssues: [],
      reuse:null };
  };
  const candidates = output.candidates.map((p, i) => qualify(p, i, "CANDIDATE", candidateCounts));
  for (const c of candidates) if (text(c.provenance.localKey, 128) && candidateCounts.get(c.provenance.localKey) === 1) local.set(c.provenance.localKey, c.key);
  const materials = new Set(materialIds), existing = new Set(existingCandidateKeys);
  const endpoint = (value, record) => {
    if (candidateCounts.get(value) > 1 || (local.has(value) && materials.has(value))) {
      record.identityIssues.push("AMBIGUOUS_TASK_ENDPOINT"); return value;
    }
    if (local.has(value)) return local.get(value);
    if (materials.has(value) || existing.has(value)) return value;
    record.identityIssues.push("UNRESOLVED_TASK_ENDPOINT"); return value;
  };
  const relations = output.relations.map((p, i) => {
    const relation = qualify(p, i, "RELATION", relationCounts);
    relation.sourceKey = endpoint(relation.sourceKey, relation); relation.targetKey = endpoint(relation.targetKey, relation);
    return relation;
  });
  return { candidates, relations, originalProposals };
}

// Main proposes semantic equivalence/conflict; this layer applies only valid,
// disjoint proposals and preserves every original and mapping. The resulting
// canonical propositions still need a separate evidence-verification pass.
export function consolidateProposals({ candidates, relations, originalProposals, invalidKeys = [], mergeSuggestions = [], conflictGroups = [] }) {
  requireF003(Array.isArray(mergeSuggestions) && mergeSuggestions.length <= 2000 && Array.isArray(conflictGroups)
    && conflictGroups.length <= 2000, "F003_MODEL_OUTPUT_INVALID", "Main归并与冲突编组必须有界");
  const originals = [...structuredClone(candidates), ...structuredClone(relations)], byKey = new Map(originals.map(p => [p.key, p]));
  const candidateKeys = new Set(candidates.map(c => c.key)), invalid = new Set(invalidKeys), aliases = new Map(originals.map(p => [p.key, p.key]));
  const canonicalEndpoint = key => aliases.get(key) ?? key;
  const issues = [], groups = [], removed = new Set(), added = [], counts = new Map();
  const proposals = mergeSuggestions.map(g => ({ ...g, disposition: "EQUIVALENT" }));
  for (const g of proposals) for (const k of new Set(Array.isArray(g.keys) ? g.keys : [])) counts.set(k, (counts.get(k) ?? 0) + 1);
  const reject = (g, code, affectedKeys = null) => {
    const keys = Array.isArray(g.keys) ? g.keys.filter(k => byKey.has(k)) : [];
    issues.push({ code, keys, rationale: typeof g.rationale === "string" ? g.rationale : null });
    for (const k of affectedKeys ?? keys) issue(byKey.get(k), code);
  };
  // An unresolved conflict is not an equivalence operation. It does not need
  // disjoint groups or complete Main context to remain an explicit constraint.
  // Quarantined sources cannot create a conflict for an otherwise valid branch.
  for (const g of conflictGroups) {
    const declared = Array.isArray(g?.keys) ? [...new Set(g.keys)] : [];
    const keys = declared.filter(k => byKey.has(k) && !invalid.has(k) && byKey.get(k).identityIssues.length === 0);
    if (declared.length < 2 || declared.length > 200 || keys.length < 2 || !text(g?.rationale)
      || !(keys.every(k => candidateKeys.has(k)) || keys.every(k => !candidateKeys.has(k)))) {
      issues.push({ code: "INVALID_CONFLICT_SOURCE", keys: declared, rationale: typeof g?.rationale === "string" ? g.rationale : null }); continue;
    }
    const id = `group-${hash({ disposition: "CONFLICT", keys: [...keys].sort(), rationale: g.rationale })}`;
    groups.push({ id, disposition: "CONFLICT", keys, reportedKeys: declared, rationale: g.rationale });
    for (const k of keys) issue(byKey.get(k), "BUSINESS_CONFLICT");
  }
  // Candidate aliases are established before remapping and consolidating edges.
  for (const collection of ["CANDIDATE", "RELATION"]) {
    if (collection === "RELATION") {
      const finalCandidates = new Map([...originals.filter(p => candidateKeys.has(p.key)), ...added].map(p => [p.key, p]));
      for (const r of originals.filter(p => !candidateKeys.has(p.key))) {
        // Compare each trusted original endpoint with its final proposition
        // before aliases erase that distinction. A null node reuse marker
        // says nothing about semantic equality (new Child nodes also have it).
        // Unchanged keys (including quarantined malformed neighbors) have no
        // replacement semantics to serialize. Only admitted aliases can change
        // the endpoint; their members passed the existing invalid-source guard.
        const changed = [r.sourceKey, r.targetKey].some(key => candidateKeys.has(key) && canonicalEndpoint(key) !== key
          && canonicalEncode(candidateSemantics(byKey.get(key))) !== canonicalEncode(candidateSemantics(finalCandidates.get(canonicalEndpoint(key)))));
        if (changed) {
          r.reuse = null;
          r.provenance = { kind: "MAIN_ENDPOINT_REBINDING", sourceKeys: [r.key] };
        }
        r.sourceKey = canonicalEndpoint(r.sourceKey); r.targetKey = canonicalEndpoint(r.targetKey);
      }
    }
    for (const g of proposals) {
      if (!Array.isArray(g.keys) || g.keys.length < 2 || g.keys.length > 200 || new Set(g.keys).size !== g.keys.length
        || !g.keys.every(k => byKey.has(k)) || !text(g.rationale)) {
        if (collection === "CANDIDATE") reject(g, "INVALID_CONSOLIDATION_GROUP"); continue;
      }
      const candidateGroup = g.keys.every(k => candidateKeys.has(k)), relationGroup = g.keys.every(k => !candidateKeys.has(k));
      if (!candidateGroup && !relationGroup) { if (collection === "CANDIDATE") reject(g, "MIXED_PROPOSAL_KINDS"); continue; }
      if ((collection === "CANDIDATE") !== candidateGroup) continue;
      if (g.keys.some(k => counts.get(k) > 1)) { reject(g, "OVERLAPPING_CONSOLIDATION_GROUPS"); continue; }
      const members = g.keys.map(k => byKey.get(k));
      if (g.keys.some(k => invalid.has(k)) || members.some(m => m.identityIssues.length > 0)) {
        reject(g, "INVALID_SOURCE_PROPOSAL", members.filter(m => invalid.has(m.key) || m.identityIssues.length).map(m => m.key)); continue;
      }
      const conflicted = members.filter(m => m.consolidationIssues.includes("BUSINESS_CONFLICT")).map(m => m.key);
      if (conflicted.length) { reject(g, "CONFLICT_REQUIRES_DECISION", conflicted); continue; }
      const id = `group-${hash({ disposition: g.disposition, keys: [...g.keys].sort(), rationale: g.rationale })}`;
      const ordered = [...members].sort((a, b) => a.key.localeCompare(b.key)), first = ordered[0];
      if (candidateGroup && members.some(m => m.kind !== first.kind)) { reject(g, "INCOMPATIBLE_BUSINESS_KINDS"); continue; }
      if (relationGroup && members.some(m => m.sourceKey !== first.sourceKey || m.targetKey !== first.targetKey)) { reject(g, "DIRECTION_OR_ENDPOINT_CONFLICT"); continue; }
      const content = m => candidateGroup ? { kind: m.kind, statement: m.statement, scope: m.scope }
        : { predicate: m.predicate, sourceKey: m.sourceKey, targetKey: m.targetKey, scope: m.scope };
      const exact = members.every(m => canonicalEncode(content(m)) === canonicalEncode(content(first)));
      // Main only sees the supplied task-qualified keys, not canonical IDs
      // computed by this pass. Normalize both sides of endpoint comparisons
      // through the same trusted map, without changing Main's original output.
      const rawProposed = g.mergedProposal;
      const proposed = relationGroup && rawProposed && typeof rawProposed === "object" && !Array.isArray(rawProposed)
        ? { ...rawProposed, sourceKey: canonicalEndpoint(rawProposed.sourceKey), targetKey: canonicalEndpoint(rawProposed.targetKey) }
        : rawProposed;
      const validProposal = proposed && typeof proposed === "object" && !Array.isArray(proposed) && text(proposed.scope)
        && ["evidence", "technicalRefs", "uncertainties"].every(f => proposed[f] === undefined || (Array.isArray(proposed[f]) && proposed[f].length <= 200))
        && (candidateGroup ? proposed.kind === first.kind && text(proposed.name, 256) && text(proposed.statement)
          : text(proposed.predicate, 64) && proposed.sourceKey === first.sourceKey && proposed.targetKey === first.targetKey);
      if ((!exact && !validProposal) || (proposed !== undefined && !validProposal)) { reject(g, "MERGED_PROPOSAL_REQUIRED"); continue; }
      const fields = candidateGroup ? ["kind", "name", "statement", "scope"] : ["predicate", "sourceKey", "targetKey", "scope"];
      const canonical = { ...first };
      if (validProposal) for (const field of fields) canonical[field] = proposed[field];
      canonical.evidence = unique([...members.flatMap(m => m.evidence ?? []), ...(proposed?.evidence ?? [])]);
      canonical.technicalRefs = [...new Set([...members.flatMap(m => m.technicalRefs ?? []), ...(proposed?.technicalRefs ?? [])])];
      canonical.uncertainties = [...new Set([...members.flatMap(m => m.uncertainties ?? []), ...(proposed?.uncertainties ?? [])])];
      if ([canonical.evidence, canonical.technicalRefs, canonical.uncertainties].some(a => a.length > 200)) { reject(g, "CONSOLIDATION_EVIDENCE_LIMIT"); continue; }
      canonical.originRefs = [...new Set(members.flatMap(m => m.originRefs))].sort();
      canonical.provenance = { consolidationGroupId: id, rationale: g.rationale, sourceKeys: [...g.keys] };
      // A changed canonical proposition is new Main semantics, not a reused A
      // result. Preserve original source mappings, without laundering its
      // historical reuse proof onto different conditions or a new statement.
      const reusedMember=members.find(m=>m.reuse);
      const reuseContent=m=>candidateGroup?candidateSemantics(m):content(m);
      canonical.reuse=reusedMember&&canonicalEncode(reuseContent(canonical))===canonicalEncode(reuseContent(reusedMember))
        ?reusedMember.reuse:null;
      canonical.key = `merged-${hash({ id, content: content(canonical), originRefs: canonical.originRefs })}`;
      for (const m of members) { removed.add(m.key); aliases.set(m.key, canonical.key); }
      added.push(canonical); groups.push({ id, disposition: "EQUIVALENT", keys: [...g.keys], canonicalKey: canonical.key, rationale: g.rationale });
    }
  }
  const result = [...originals.filter(p => !removed.has(p.key)), ...added];
  const sourceToCanonical = originals.map(p => ({ sourceKey: p.key, canonicalKey: aliases.get(p.key), originRefs: p.originRefs,
    status: invalid.has(p.key) || p.identityIssues.length ? "INVALID" : p.consolidationIssues.includes("BUSINESS_CONFLICT") ? "CONFLICT"
      : removed.has(p.key) ? "MERGED" : p.consolidationIssues.length ? "UNRESOLVED" : "KEPT" }));
  return { candidates: result.filter(p => p.proposalCollection === "CANDIDATE"),
    relations: result.filter(p => p.proposalCollection === "RELATION"),
    consolidation: { schemaVersion: 1, originalProposals: structuredClone(originalProposals), sourceToCanonical, groups, issues } };
}

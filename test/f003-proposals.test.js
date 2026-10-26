import assert from "node:assert/strict";
import test from "node:test";
import { qualifyTaskProposals, consolidateProposals } from "../src/business-knowledge/proposals.js";
import { buildBusinessGraph } from "../src/business-knowledge/semantic-graph.js";

const material = { id: "material", sourceMaterial: { id: "material", workspaceId: "w", bundleId: "b" }, text: "未支付订单允许取消。" };
const evidence = [{ materialId: "material", startLine: 1, endLine: 1, quote: material.text }];
const proposal = extra => ({ key: "cancel", kind: "RULE", name: "取消订单", statement: "未支付订单允许取消", scope: "冻结说明", uncertainties: [], evidence, ...extra });
function task(taskKey, output = { candidates: [proposal()], relations: [] }) {
  return qualifyTaskProposals({ investigationId: "i", sourceBundleId: "b", taskKey, slotId: "child", modelRevisionId: "model-v1", reservationId: `${taskKey}-call`, materialIds: ["material"], output });
}
function combine(...tasks) { return { candidates: tasks.flatMap(t => t.candidates), relations: tasks.flatMap(t => t.relations), originalProposals: tasks.flatMap(t => t.originalProposals), invalidKeys: [] }; }
function graph(merged) {
  const reviews = [...merged.candidates, ...merged.relations].map(c => ({ key: c.key, support: "SUPPORTED", rationale: "已核对原文和前提", premises: ["未支付订单"], unresolvedConflicts: [] }));
  return buildBusinessGraph({ workspaceId: "w", investigationId: "i", sourceBundleId: "b", profileId: "p", adoptedVersionIds: [], materials: [material], inventory: [],
    candidates: merged.candidates, relations: merged.relations, reviews, allowedFactIds: [], consolidation: merged.consolidation });
}

test("F003 proposals have stable task-qualified identities and retain original local keys and process/source origins", () => {
  const a = task("child-0"), b = task("child-1");
  assert.notEqual(a.candidates[0].key, b.candidates[0].key);
  assert.deepEqual(a, task("child-0"));
  assert.equal(a.originalProposals[0].origin.localKey, "cancel");
  assert.equal(a.originalProposals[0].origin.taskKey, "child-0");
  assert.equal(a.originalProposals[0].origin.sourceBundleId, "b");
  assert.equal(a.originalProposals[0].proposal.key, "cancel");
});

test("F003 applies Main equivalence proposals before verification and retains the complete source-to-canonical map", () => {
  const input = combine(task("child-0"), task("child-1")), keys = input.candidates.map(c => c.key);
  const merged = consolidateProposals({ ...input, mergeSuggestions: [{ keys, rationale: "同一原文、命题与适用范围" }], conflictGroups: [] });
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.consolidation.originalProposals.length, 2);
  assert.equal(merged.candidates[0].originRefs.length, 2);
  assert.ok(merged.consolidation.sourceToCanonical.every(m => m.canonicalKey === merged.candidates[0].key && m.status === "MERGED"));
  const built = graph(merged);
  assert.equal(built.candidates[0].state, "ANALYSIS_ACCEPTED");
  assert.equal(built.consolidation.sourceToCanonical.length, 2);
  assert.equal(built.candidates[0].originRefs.length, 2);
});

test("F003 cannot silently select one of differently scoped propositions when Main omitted its merged proposition", () => {
  const input = combine(task("a"), task("b", { candidates: [proposal({ scope: "已支付订单" })], relations: [] }));
  const merged = consolidateProposals({ ...input, mergeSuggestions: [{ keys: input.candidates.map(c => c.key), rationale: "可能同义但未给出新命题" }], conflictGroups: [] });
  assert.equal(merged.candidates.length, 2);
  assert.ok(graph(merged).candidates.every(c => c.state === "HUMAN_REVIEW"));
  assert.ok(merged.consolidation.issues.some(i => i.code === "MERGED_PROPOSAL_REQUIRED"));
});

test("F003 distinguishes business conflict from malformed task-local duplication", () => {
  const input = combine(task("a"), task("b", { candidates: [proposal({ statement: "未支付订单不允许取消" })], relations: [] }));
  const merged = consolidateProposals({ ...input, mergeSuggestions: [], conflictGroups: [{ keys: input.candidates.map(c => c.key), rationale: "解释冲突待业务决定" }] });
  assert.equal(merged.candidates.length, 2);
  assert.ok(graph(merged).candidates.every(c => c.state === "HUMAN_REVIEW"));
  const invalid = combine(task("bad", { candidates: [proposal(), proposal()], relations: [] }));
  assert.ok(graph(consolidateProposals({ ...invalid, mergeSuggestions: [], conflictGroups: [] })).candidates.every(c => c.state === "QUARANTINED"));
});

test("F003 task-local relation endpoints are qualified and remapped after Main merges their candidate endpoints", () => {
  const output = { candidates: [proposal()], relations: [{ key: "description", sourceKey: "cancel", predicate: "DESCRIBED_BY", targetKey: "material", scope: "冻结说明", evidence }] };
  const a = task("a", output), b = task("b", output), input = combine(a, b);
  assert.equal(a.relations[0].sourceKey, a.candidates[0].key);
  const merged = consolidateProposals({ ...input, mergeSuggestions: [
    { keys: input.candidates.map(c => c.key), rationale: "同一命题" }, { keys: input.relations.map(r => r.key), rationale: "同向同义关系" }], conflictGroups: [] });
  assert.equal(merged.relations.length, 1);
  assert.equal(merged.relations[0].sourceKey, merged.candidates[0].key);
  assert.equal(merged.relations[0].targetKey, "material");
  assert.equal(merged.relations[0].originRefs.length, 2);
  assert.equal(graph(merged).relations[0].state, "ANALYSIS_ACCEPTED");
});

test("F003 Main cannot launder invalid originals or resolve overlapping consolidation groups by array order", () => {
  const input = combine(task("a"), task("b"), task("c")), keys = input.candidates.map(c => c.key);
  const overlap = consolidateProposals({ ...input, mergeSuggestions: [{ keys: keys.slice(0, 2), rationale: "first" }, { keys: keys.slice(1), rationale: "second" }], conflictGroups: [] });
  assert.equal(overlap.candidates.length, 3);
  assert.ok(graph(overlap).candidates.every(c => c.state === "HUMAN_REVIEW"));
  const invalid = consolidateProposals({ ...input, invalidKeys: [keys[0]], mergeSuggestions: [{ keys: keys.slice(0, 2), rationale: "invalid member cannot disappear" }], conflictGroups: [] });
  assert.equal(invalid.candidates.length, 3);
  assert.equal(invalid.consolidation.originalProposals.length, 3);
  assert.ok(invalid.consolidation.issues.some(i => i.code === "INVALID_SOURCE_PROPOSAL"));
});

test("F003 can merge an explicit evidence-bounded paraphrase without discarding original wording or uncertainties", () => {
  const input = combine(task("a"), task("b", { candidates: [proposal({ statement: "取消仅适用于未支付订单", uncertainties: ["已支付范围未知"] })], relations: [] }));
  const merged = consolidateProposals({ ...input, mergeSuggestions: [{ keys: input.candidates.map(c => c.key), rationale: "同一原文的等价表达，不扩展适用条件",
    mergedProposal: proposal({ statement: "未支付订单可取消", uncertainties: ["超时处理未知"] }) }] });
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.candidates[0].statement, "未支付订单可取消");
  assert.deepEqual(new Set(merged.candidates[0].uncertainties), new Set(["已支付范围未知", "超时处理未知"]));
  assert.deepEqual(merged.consolidation.originalProposals.map(p => p.proposal.statement), ["未支付订单允许取消", "取消仅适用于未支付订单"]);
  assert.equal(graph(merged).candidates[0].state, "ANALYSIS_ACCEPTED");
});

test("F003 retains direction and trusted collection even when a relation carries a misleading model kind", () => {
  const output = reverse => ({ candidates: [proposal()], relations: [{ key: "edge", kind: "RULE", proposalCollection: "CANDIDATE",
    sourceKey: reverse ? "material" : "cancel", targetKey: reverse ? "cancel" : "material", predicate: "DESCRIBED_BY", scope: "冻结说明", evidence }] });
  const input = combine(task("a", output(false)), task("b", output(true)));
  const merged = consolidateProposals({ ...input, mergeSuggestions: [
    { keys: input.candidates.map(c => c.key), rationale: "同一命题" }, { keys: input.relations.map(r => r.key), rationale: "错误地声称反向相同" }] });
  assert.equal(merged.candidates.length, 1);
  assert.equal(merged.relations.length, 2);
  assert.ok(merged.consolidation.issues.some(i => i.code === "DIRECTION_OR_ENDPOINT_CONFLICT"));
  assert.ok(graph(merged).relations.every(r => r.state === "HUMAN_REVIEW"));
  const ambiguous = task("bad", { candidates: [proposal(), proposal()], relations: output(false).relations });
  assert.ok(ambiguous.relations[0].identityIssues.includes("AMBIGUOUS_TASK_ENDPOINT"));
  assert.equal(graph(consolidateProposals(combine(ambiguous))).relations[0].state, "QUARANTINED");
});

test("F003 canonicalizes explicit Main relation endpoints in the same namespace as its member edges", () => {
  for (const targetIsCandidate of [false, true]) for (const scope of ["冻结说明", "同一冻结业务说明"]) {
    const output = { candidates: [proposal(), ...(targetIsCandidate ? [proposal({ key: "order", kind: "BUSINESS_OBJECT", name: "订单", statement: "订单具有支付状态" })] : [])],
      relations: [{ key: "edge", sourceKey: "cancel", targetKey: targetIsCandidate ? "order" : "material", predicate: "DESCRIBED_BY", scope: "冻结说明", evidence }] };
    const input = combine(task("a", output), task("b", { ...output, relations: [{ ...output.relations[0], scope }] }));
    const merges = [0, ...(targetIsCandidate ? [1] : [])].map(i => ({ keys: [input.candidates[i].key, input.candidates[i + output.candidates.length].key], rationale: "同一原文与范围" }));
    const originalEndpoint = input.relations[0].sourceKey;
    const explicit = { ...input.relations[0], scope: "冻结说明" };
    const run = changed => consolidateProposals({ ...input, mergeSuggestions: [...merges, { keys: input.relations.map(r => r.key), rationale: "同向同义条件", mergedProposal: changed }] });
    const merged = run(explicit);
    assert.equal(merged.relations.length, 1);
    assert.equal(merged.relations[0].sourceKey, merged.candidates.find(c => c.kind === "RULE").key);
    assert.equal(merged.relations[0].targetKey, targetIsCandidate ? merged.candidates.find(c => c.kind === "BUSINESS_OBJECT").key : "material");
    assert.equal(merged.relations[0].originRefs.length, 2);
    assert.equal(explicit.sourceKey, originalEndpoint, "Main's original proposal must not be mutated");
    assert.equal(graph(merged).relations[0].state, "ANALYSIS_ACCEPTED");
    for (const bad of [{ ...explicit, sourceKey: explicit.targetKey, targetKey: explicit.sourceKey }, { ...explicit, targetKey: "invented" }]) {
      const rejected = run(bad);
      assert.equal(rejected.relations.length, 2);
      assert.ok(graph(rejected).relations.every(r => r.state === "HUMAN_REVIEW"));
    }
  }
});

test("F003 explicit valid conflicts survive overlap while isolated conflict sources cannot contaminate valid originals", () => {
  const a = task("good"), bad = task("invalid", { candidates: [proposal({ evidence: [{ ...evidence[0], quote: "invented" }] })], relations: [] });
  const invalid = combine(a, bad), invalidKey = bad.candidates[0].key;
  const merged = consolidateProposals({ ...invalid, invalidKeys: [invalidKey], conflictGroups: [{ keys: invalid.candidates.map(p => p.key), rationale: "invalid source cannot create business conflict" }] });
  assert.equal(graph(merged).candidates.find(p => p.key === a.candidates[0].key).state, "ANALYSIS_ACCEPTED");
  const valid = combine(task("one"), task("two"), task("three")), keys = valid.candidates.map(p => p.key);
  const conflict = consolidateProposals({ ...valid, conflictGroups: [{ keys: keys.slice(0, 2), rationale: "first valid conflict" }, { keys: keys.slice(1), rationale: "second valid conflict" }] });
  assert.ok(conflict.consolidation.sourceToCanonical.every(m => m.status === "CONFLICT"));
  assert.equal(conflict.consolidation.groups.filter(g => g.disposition === "CONFLICT").length, 2);
  assert.ok(graph(conflict).candidates.every(p => p.state === "HUMAN_REVIEW"));
});

function incidentProposals({ endpoint = "sourceKey", change = {}, mergeEdge = false, endpointReuse = true } = {}) {
  const proof = key => ({ reuseProofDigest: key, sourceGraphDigest: "A" });
  const candidate = key => ({ ...proposal({ key, name: key }), proposalCollection: "CANDIDATE", originRefs: [key],
    identityIssues: [], consolidationIssues: [], reuse: endpointReuse ? proof(key) : null, provenance: { reservationId: key } });
  const old = candidate("z-old"), fresh = { ...candidate("a-fresh"), name: old.name, reuse: null,
    ...(change.dependencyScope ? { dependencyScope: change.dependencyScope } : {}) };
  const other = candidate("other"), untouched = candidate("untouched");
  const edge = { ...candidate("edge"), proposalCollection: "RELATION", sourceKey: endpoint === "sourceKey" ? old.key : other.key,
    targetKey: endpoint === "targetKey" ? old.key : other.key, predicate: "REQUIRES", reuse: proof("edge"),
    provenance: { kind: "REVALIDATED_REUSE", producer: { investigationId: "A", reservationId: "A-edge" } } };
  const unrelated = { ...edge, key: "unrelated-edge", sourceKey: other.key, targetKey: untouched.key, originRefs: ["unrelated-edge"], reuse: proof("unrelated-edge") };
  const candidates = [old, fresh, other, untouched], relations = [edge, unrelated,
    ...(mergeEdge ? [{ ...edge, key: "new-edge", reuse: null, originRefs: ["new-edge"], provenance: { reservationId: "B-child" } }] : [])];
  const input = { candidates, relations, originalProposals: [...candidates, ...relations].map(p => ({ id: p.key, origin: p.provenance, proposal: structuredClone(p) })),
    mergeSuggestions: [{ keys: [old.key, fresh.key], rationale: "Main chooses the final current proposition",
      mergedProposal: { kind: old.kind, name: old.name, statement: old.statement, scope: old.scope, ...change } },
      ...(mergeEdge ? [{ keys: [edge.key, "new-edge"], rationale: "Same directed relation after final endpoint resolution" }] : [])] };
  return { input, old, edge, unrelated };
}

test("F003 revokes incident A proofs and producer ownership for either changed endpoint before any relation merge", () => {
  let cases = 0;
  for (const endpoint of ["sourceKey", "targetKey"]) for (const mergeEdge of [false, true]) {
    for (const change of [{ statement: "A different condition" }, { name: "A different business name" },
      { scope: "A different scope" }, { dependencyScope: { kind: "LOCAL_RETURN_LITERAL", functionName: "changed", value: false } }]) {
      const { input, old, edge, unrelated } = incidentProposals({ endpoint, change, mergeEdge }), before = structuredClone(input);
      const merged = consolidateProposals(input), canonical = merged.candidates.find(p => p.key.startsWith("merged-"));
      const relation = merged.relations.find(p => p.key !== unrelated.key);
      assert.equal(relation[endpoint], canonical.key);
      assert.equal(relation.reuse, null, JSON.stringify({ endpoint, mergeEdge, change }));
      assert.notEqual(relation.provenance.kind, "REVALIDATED_REUSE");
      assert.ok(relation.provenance.sourceKeys.includes(edge.key), "current Main producer resolves the unchanged original A coordinate");
      assert.deepEqual(relation.originRefs, mergeEdge ? ["edge", "new-edge"] : ["edge"]);
      assert.deepEqual(merged.relations.find(p => p.key === unrelated.key).reuse, unrelated.reuse);
      assert.deepEqual(merged.consolidation.originalProposals, before.originalProposals);
      assert.deepEqual(input, before, "consolidation never rewrites historical input");
      assert.equal(graph(merged).relations.find(p => p.key === relation.key).state, "ANALYSIS_ACCEPTED");
      assert.equal(merged.consolidation.sourceToCanonical.find(m => m.sourceKey === old.key).canonicalKey, canonical.key);
      cases++;
    }
  }
  assert.equal(cases, 16);
});

test("F003 semantic aliases preserve directed relation reuse even when the endpoint itself has no reuse", () => {
  for (const endpoint of ["sourceKey", "targetKey"]) for (const mergeEdge of [false, true]) for (const endpointReuse of [false, true]) {
    const { input, edge, unrelated } = incidentProposals({ endpoint, mergeEdge, endpointReuse });
    const merged = consolidateProposals(input), canonical = merged.candidates.find(p => p.key.startsWith("merged-"));
    const relation = merged.relations.find(p => p.key !== unrelated.key);
    assert.equal(relation[endpoint], canonical.key);
    assert.equal(relation[endpoint === "sourceKey" ? "targetKey" : "sourceKey"], "other");
    assert.deepEqual(relation.reuse, edge.reuse);
    assert.deepEqual(merged.relations.find(p => p.key === unrelated.key), unrelated);
  }
});

test("F003 a later canonicalization checks final semantics without resurrecting a revoked incident proof", () => {
  const { input, unrelated } = incidentProposals();
  const first = consolidateProposals(input), old = first.candidates.find(p => p.key.startsWith("merged-"));
  const fresh = { ...old, key: "later-alias", reuse: null, originRefs: ["later-alias"] };
  const secondInput = { ...first, candidates: [...first.candidates, fresh], originalProposals: input.originalProposals,
    mergeSuggestions: [{ keys: [old.key, fresh.key], rationale: "Later final meaning", mergedProposal: { ...old, statement: "Changed after a prior alias" } }] };
  const changed = consolidateProposals(secondInput), edge = changed.relations.find(p => p.key !== unrelated.key);
  assert.equal(edge.reuse, null);
  const final = changed.candidates.find(p => p.statement === "Changed after a prior alias");
  assert.equal(edge.sourceKey, final.key);
  const again = { ...final, key: "final-alias", originRefs: ["final-alias"], reuse: null };
  const last = consolidateProposals({ ...changed, candidates: [...changed.candidates, again], originalProposals: input.originalProposals,
    mergeSuggestions: [{ keys: [final.key, again.key], rationale: "Same final meaning" }] });
  assert.equal(last.relations.find(p => p.key !== unrelated.key).reuse, null);
  assert.deepEqual(last.relations.find(p => p.key === unrelated.key).reuse, unrelated.reuse);
});

test("F003 incident propagation preserves relation-own predicate/scope and incompatible-direction guards", () => {
  for (const change of [{ predicate: "EXPLAINS" }, { scope: "New relationship condition" }]) {
    const { input, edge, unrelated } = incidentProposals({ mergeEdge: true });
    input.mergeSuggestions[1].mergedProposal = { ...edge, ...change };
    const merged = consolidateProposals(input);
    assert.equal(merged.relations.find(p => p.key !== unrelated.key).reuse, null);
  }
  for (const change of [{ sourceKey: "other", targetKey: "z-old" }, { targetKey: "untouched" }]) {
    const { input, edge } = incidentProposals({ mergeEdge: true });
    input.mergeSuggestions[1].mergedProposal = { ...edge, ...change };
    const merged = consolidateProposals(input);
    assert.ok(merged.consolidation.issues.some(i => i.code === "MERGED_PROPOSAL_REQUIRED"));
    assert.equal(graph(merged).relations.find(p => p.key === edge.key).state, "HUMAN_REVIEW");
  }
  const { input, old } = incidentProposals();
  input.candidates[1].kind = "BUSINESS_OBJECT";
  const rejected = consolidateProposals(input);
  assert.ok(rejected.consolidation.issues.some(i => i.code === "INCOMPATIBLE_BUSINESS_KINDS"));
  assert.equal(rejected.relations[0].sourceKey, old.key, "a rejected kind change never replaces the endpoint");
});

test("F003 invalid qualified endpoint neighbors remain isolated through quarantine, consolidation and the final graph", () => {
  for (const missing of [["name", "statement"], ["name"], ["statement"], ["kind"], ["scope"]]) for (const mergeValid of [false, true]) {
    const bad = proposal({ key: "bad" });
    for (const field of missing) delete bad[field];
    const input = combine(task("invalid-neighbor", { candidates: [proposal(), bad], relations: [
      { key: "incident", sourceKey: "bad", targetKey: "cancel", predicate: "REQUIRES", scope: "local", evidence, uncertainties: [] }
    ] }), ...(mergeValid ? [task("valid-alias")] : []));
    const goodKey = input.candidates[0].key, badKey = input.candidates[1].key;
    const before = structuredClone(input), preflight = graph(input), invalidKeys = preflight.quarantine.map(p => p.key);
    assert.deepEqual(invalidKeys, [badKey]);
    assert.equal(preflight.quarantine[0].reason, "INVALID_STRUCTURE");
    const merged = consolidateProposals({ ...input, invalidKeys, mergeSuggestions: mergeValid ? [
      { keys: [goodKey, input.candidates[2].key], rationale: "The valid branch remains independently mergeable" }
    ] : [] });
    const built = graph(merged), canonicalGood = merged.consolidation.sourceToCanonical.find(m => m.sourceKey === goodKey).canonicalKey;
    assert.equal(built.candidates.find(p => p.key === canonicalGood).state, "ANALYSIS_ACCEPTED");
    assert.equal(built.candidates.find(p => p.key === badKey).state, "QUARANTINED");
    assert.equal(built.relations[0].state, "HUMAN_REVIEW");
    assert.equal(built.relations[0].reuse, null, "unknown endpoint structure never gains a semantic reuse proof");
    assert.equal(built.relations[0].sourceKey, badKey);
    assert.equal(built.relations[0].targetKey, canonicalGood);
    assert.deepEqual(input, before);
    assert.deepEqual(merged.consolidation.originalProposals, before.originalProposals);
  }
});

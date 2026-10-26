import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessGraph } from "../src/business-knowledge/semantic-graph.js";

const material = { id: "material-1", sourceMaterial: { id: "material-1", workspaceId: "workspace", bundleId: "bundle-1" },
  text: "用户可以取消未支付订单。\n已支付订单不可取消。", kind: "DOCUMENT" };
const evidence = [{ materialId: material.id, startLine: 1, endLine: 1, quote: "用户可以取消未支付订单。" }];
const proposal = key => ({ key, kind: "RULE", name: "取消订单", statement: "未支付订单允许取消", scope: "用户自己的订单", evidence, uncertainties: [] });
const review = (key, support = "SUPPORTED", extra = {}) => ({ key, support, rationale: "已对照原文，适用条件明确", premises: ["未支付"], unresolvedConflicts: [], ...extra });
const input = overrides => ({ workspaceId: "workspace", investigationId: "run-1", sourceBundleId: "bundle-1", profileId: "profile-1",
  adoptedVersionIds: [], materials: [material], inventory: [{ materialId: material.id, disposition: "READ" }],
  candidates: [proposal("cancel")], relations: [], reviews: [review("cancel")], allowedFactIds: [], ...overrides });

test("F003 semantic graph accepts supported original-material conclusions without requiring a Fact", () => {
  const graph = buildBusinessGraph(input());
  assert.equal(graph.candidates[0].state, "ANALYSIS_ACCEPTED");
  assert.equal(graph.candidates[0].authority, "AGENT_ANALYSIS");
  assert.equal(graph.candidates[0].evidence[0].materialId, material.id);
  assert.equal(graph.candidates[0].verification.rationale, review("cancel").rationale);
  assert.equal(graph.sourceBundleId, "bundle-1");
  assert.equal(graph.published, false);
});

test("F003 five-way triage keeps uncertainty, missing support and invalid citations separate", () => {
  const candidates = [proposal("ok"), proposal("missing"), proposal("ambiguous"), proposal("unknown"), { ...proposal("invalid"), evidence: [{ ...evidence[0], quote: "invented" }] }];
  const graph = buildBusinessGraph(input({ candidates, reviews: [review("ok"), review("missing", "INSUFFICIENT"),
    review("ambiguous", "AMBIGUOUS", { unresolvedConflicts: ["文档和实现冲突"] }), review("unknown", "UNKNOWN"), review("invalid")] }));
  assert.deepEqual(graph.candidates.map(c => c.state), ["ANALYSIS_ACCEPTED", "NEEDS_EVIDENCE", "HUMAN_REVIEW", "RETAINED_UNKNOWN", "QUARANTINED"]);
  assert.equal(graph.quarantine.length, 1);
  assert.equal(graph.quarantine[0].reason, "INVALID_EVIDENCE");
});

test("F003 graph preserves directional relations and independently checks each relation's evidence", () => {
  const candidates = [proposal("cancel"), { ...proposal("order"), kind: "BUSINESS_OBJECT", name: "订单", statement: "可取消的业务对象" }];
  const relations = [{ key: "rel-1", sourceKey: "cancel", predicate: "APPLIES_TO", targetKey: "order", scope: "未支付", evidence },
    { key: "bad-rel", sourceKey: "cancel", predicate: "IMPLEMENTED_BY", targetKey: "missing", scope: "unknown", evidence }];
  const graph = buildBusinessGraph(input({ candidates, relations, reviews: [review("cancel"), review("order"), review("rel-1"), review("bad-rel")] }));
  assert.equal(graph.relations[0].state, "ANALYSIS_ACCEPTED");
  assert.equal(graph.relations[0].sourceKey, "cancel");
  assert.equal(graph.relations[0].targetKey, "order");
  assert.equal(graph.relations[1].state, "QUARANTINED");
});

test("F003 cannot use unsupported technical refs, mixed materials or a model vote to establish a conclusion", () => {
  const graph = buildBusinessGraph(input({ candidates: [proposal("vote"), { ...proposal("bad-fact"), technicalRefs: ["invented-fact"] },
    { ...proposal("mixed"), evidence: [{ ...evidence[0], materialId: "other-source" }] }], reviews: [review("vote", "VOTE_UNANIMOUS"), review("bad-fact"), review("mixed")] }));
  assert.deepEqual(graph.candidates.map(c => c.state), ["RETAINED_UNKNOWN", "QUARANTINED", "QUARANTINED"]);
});

test("F003 material coverage retains uninvestigated, restricted and unassociated material", () => {
  const graph = buildBusinessGraph(input({ candidates: [], reviews: [], inventory: [{ materialId: material.id, disposition: "READ" },
    { materialId: "unread", disposition: "NOT_INVESTIGATED" }, { materialId: "restricted", disposition: "RESTRICTED", reason: "无当前权限" }] }));
  assert.equal(graph.coverage.length, 3);
  assert.equal(graph.coverage[0].businessStatus, "UNASSOCIATED");
  assert.equal(graph.coverage[1].disposition, "NOT_INVESTIGATED");
  assert.equal(graph.coverage[2].reason, "无当前权限");
  assert.equal("understandingPercent" in graph, false);
});

test("F003 directed engineering relations can connect business propositions to actual frozen assets, never invented assets", () => {
  const relations = [{ key: "implements", sourceKey: "cancel", predicate: "DESCRIBED_BY", targetKey: material.id, scope: "该冻结说明", evidence },
    { key: "reverse", sourceKey: material.id, predicate: "DESCRIBES", targetKey: "cancel", scope: "该冻结说明", evidence },
    { key: "fake-asset", sourceKey: "cancel", predicate: "TESTED_BY", targetKey: "invented-file", scope: "unknown", evidence }];
  const graph = buildBusinessGraph(input({ relations, reviews: [review("cancel"), ...relations.map(r => review(r.key))] }));
  assert.deepEqual(graph.relations.map(r => r.state), ["ANALYSIS_ACCEPTED", "ANALYSIS_ACCEPTED", "QUARANTINED"]);
  assert.equal(graph.materials[0].sourceMaterial.id, material.id);
});

test("F003 business coverage includes accepted relations' independent evidence and direct material endpoints, never mere reads or invalid relations", () => {
  const code = { ...material, id: "code", sourceMaterial: { ...material.sourceMaterial, id: "code" } };
  const asset = { ...material, id: "asset", sourceMaterial: { ...material.sourceMaterial, id: "asset" } };
  const unused = { ...material, id: "unused", sourceMaterial: { ...material.sourceMaterial, id: "unused" } };
  const cite = [{ ...evidence[0], materialId: code.id }], candidates = [proposal("cancel"), proposal("release")];
  const relations = [{ key: "calls", sourceKey: "cancel", targetKey: "release", predicate: "INVOKES", scope: "same frozen rule", evidence: cite },
    { key: "asset-link", sourceKey: "cancel", targetKey: asset.id, predicate: "IMPLEMENTED_BY", scope: "same frozen asset", evidence: cite }];
  const materials = [material, code, asset, unused], base = input({ materials, candidates, relations,
    inventory: materials.map(m => ({ materialId: m.id })), reviews: [...candidates, ...relations].map(p => review(p.key)) });
  const accepted = buildBusinessGraph(base);
  assert.deepEqual(accepted.coverage.map(m => m.businessStatus), ["ASSOCIATED", "ASSOCIATED", "ASSOCIATED", "UNASSOCIATED"]);
  for (const support of ["UNKNOWN", "AMBIGUOUS", "INSUFFICIENT"]) {
    const graph = buildBusinessGraph({ ...base, reviews: [...candidates.map(p => review(p.key)), ...relations.map(p => review(p.key, support))] });
    assert.deepEqual(graph.coverage.slice(1).map(m => m.businessStatus), ["UNASSOCIATED", "UNASSOCIATED", "UNASSOCIATED"]);
  }
  const invalid = buildBusinessGraph({ ...base, relations: relations.map(r => ({ ...r, evidence: [{ ...cite[0], quote: "not present" }] })) });
  assert.ok(invalid.relations.every(r => r.state === "QUARANTINED"));
  assert.deepEqual(invalid.coverage.slice(1).map(m => m.businessStatus), ["UNASSOCIATED", "UNASSOCIATED", "UNASSOCIATED"]);
});

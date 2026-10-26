import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessGraph } from "../src/business-knowledge/semantic-graph.js";
import { queryBusinessGraph, traceBusinessGraph, businessSevenQuestions } from "../src/business-knowledge/queries.js";

function fixture() {
  const materials = ["DOCUMENT", "API_CODE", "TEST_ASSET", "CONFIG_DATA"].map((assetType, i) => ({ id: `material-${i}`,
    sourceMaterial: { id: `material-${i}`, workspaceId: "w", bundleId: "b" }, text: "取消未支付订单", kind: "RAW_MATERIAL", assetType }));
  const evidence = [{ materialId: materials[0].id, startLine: 1, endLine: 1, quote: "取消未支付订单" }];
  const candidates = ["FUNCTION", "RULE", "BUSINESS_OBJECT", "EXCEPTION"].map((kind, i) => ({ key: `c-${i}`, kind, name: kind,
    statement: "取消未支付订单", scope: "冻结示例", uncertainties: i === 3 ? ["超时未知"] : [], evidence }));
  const relations = [{ key: "business", sourceKey: "c-0", predicate: "HAS_RULE", targetKey: "c-1", scope: "未支付", evidence },
    { key: "object", sourceKey: "c-0", predicate: "USES", targetKey: "c-2", scope: "未支付", evidence },
    ...materials.map((m, i) => ({ key: `asset-${i}`, sourceKey: "c-0", predicate: ["DESCRIBED_BY", "IMPLEMENTED_BY", "HAS_TEST_ASSET", "CONFIGURED_BY"][i], targetKey: m.id, scope: "仅冻结材料", evidence }))];
  const reviews = [...candidates, ...relations].map(c => ({ key: c.key, support: c.key === "c-3" ? "UNKNOWN" : "SUPPORTED", rationale: "核对原文", premises: ["冻结示例"], unresolvedConflicts: [] }));
  return buildBusinessGraph({ workspaceId: "w", investigationId: "i", sourceBundleId: "b", profileId: "p", materials,
    inventory: materials.map(m => ({ materialId: m.id, disposition: "VERIFIED" })), candidates, relations, reviews, allowedFactIds: [], adoptedVersionIds: [] });
}

test("F003 queries the same offline graph by business, implementation and coverage without changing semantic direction", () => {
  const graph = fixture(), before = structuredClone(graph);
  const business = queryBusinessGraph(graph);
  assert.equal(business.nodes.length, 3);
  assert.equal(business.edges.find(e => e.key === "business").sourceKey, "c-0");
  assert.equal(queryBusinessGraph(graph, { includeUncertain: true }).nodes.length, 4);
  assert.equal(queryBusinessGraph(graph, { onlyHumanConfirmed: true }).nodes.length, 0);
  const implementation = queryBusinessGraph(graph, { view: "IMPLEMENTATION", key: "c-0" });
  assert.equal(implementation.materials.length, 4);
  assert.equal(queryBusinessGraph(graph, { view: "COVERAGE" }).coverage.length, 4);
  assert.deepEqual(graph, before);
});

test("F003 traces business to materials and materials back to business, retaining independent edge evidence", () => {
  const graph = fixture(), forward = traceBusinessGraph(graph, { key: "c-0" }), reverse = traceBusinessGraph(graph, { materialId: "material-2" });
  assert.equal(forward.materials.length, 4);
  assert.ok(reverse.nodes.some(n => n.key === "c-0"));
  assert.equal(reverse.edges[0].targetKey, "material-2");
  assert.ok(reverse.edges[0].evidence.length > 0);
  assert.throws(() => traceBusinessGraph(graph, { key: "missing" }), { code: "F003_OBJECT_NOT_FOUND" });
});

test("F003 seven questions are derived references and distinguish test assets from real execution", () => {
  const graph = fixture(), answer = businessSevenQuestions(graph, "c-0");
  assert.equal(answer.sections.length, 7);
  assert.equal(answer.graphDigest, graph.digest);
  assert.equal(answer.sections[1].nodes[0].kind, "RULE");
  assert.equal(answer.sections[4].testAssets[0].assetType, "TEST_ASSET");
  assert.equal(answer.sections[4].executionStatus, "NO_LINKED_EXECUTION_RECORD");
  assert.equal(answer.sections[5].sourceBundleId, "b");
  assert.equal(answer.authority, "DERIVED_VIEW");
  assert.equal("passed" in answer.sections[4], false);
});

test("F003 forward trace, implementation and seven questions close over relationship citations without unrelated materials", () => {
  const materials = ["business-doc", "implementation-code", "unrelated-test"].map((id, i) => ({ id,
    sourceMaterial: { id, workspaceId: "w", bundleId: "b" }, text: "cancel invokes releaseStock", assetType: ["DOCUMENT", "API_CODE", "TEST_ASSET"][i] }));
  const cite = materialId => [{ materialId, startLine: 1, endLine: 1, quote: "cancel invokes releaseStock" }];
  const candidates = ["cancel", "releaseStock", "unrelated"].map(key => ({ key, kind: "FUNCTION", name: key, statement: key,
    scope: "fixed source", uncertainties: [], evidence: cite(key === "unrelated" ? "unrelated-test" : "business-doc") }));
  const relations = [{ key: "call", sourceKey: "cancel", targetKey: "releaseStock", predicate: "INVOKES", scope: "unpaid orders only",
    uncertainties: [], evidence: cite("implementation-code") }];
  const reviews = [...candidates, ...relations].map(({ key }) => ({ key, support: "SUPPORTED", rationale: "separate source evidence",
    premises: [key === "call" ? "stock was reserved" : "fixed source"], unresolvedConflicts: [] }));
  const graph = buildBusinessGraph({ workspaceId: "w", investigationId: "i", sourceBundleId: "b", profileId: "p", materials,
    inventory: materials.map(m => ({ materialId: m.id, disposition: "VERIFIED" })), candidates, relations, reviews, allowedFactIds: [], adoptedVersionIds: [] });
  const before = structuredClone(graph), expectedMaterials = ["business-doc", "implementation-code"];
  const forward = traceBusinessGraph(graph, { key: "cancel" }), implementation = queryBusinessGraph(graph, { view: "IMPLEMENTATION", key: "cancel" });
  for (const projection of [forward, implementation]) {
    assert.deepEqual(projection.materials.map(m => m.id), expectedMaterials);
    assert.equal(projection.edges[0].sourceKey, "cancel"); assert.equal(projection.edges[0].targetKey, "releaseStock");
    assert.equal(projection.edges[0].scope, "unpaid orders only");
    assert.equal(projection.graphDigest, graph.digest); assert.equal(projection.sourceBundleId, "b");
  }
  const reverse = traceBusinessGraph(graph, { materialId: "implementation-code" });
  assert.deepEqual(reverse.nodes.map(n => n.key), ["cancel", "releaseStock"]);
  assert.equal(reverse.edges[0].key, "call");
  const seven = businessSevenQuestions(graph, "cancel");
  assert.deepEqual(seven.sections[2].materials.map(m => m.id), expectedMaterials);
  assert.ok(seven.sections[6].evidence.some(e => e.materialId === "implementation-code"));
  assert.ok(seven.sections[6].uncertainties.some(e => e.key === "call" && e.premises.includes("stock was reserved")));
  forward.materials[0].assetType = "mutated caller result";
  assert.deepEqual(graph, before);
});

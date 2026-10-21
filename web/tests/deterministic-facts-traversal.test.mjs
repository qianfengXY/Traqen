import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/deterministic-facts/model.ts";

const id = char => char.repeat(64), version = id("a");
const material = { kind: "MATERIAL", id: id("b"), payload: { kind: "JAVASCRIPT", displayPath: "src/orders.js" } };
const source = { kind: "OBJECT", id: id("c"), payload: { name: "sameName", materialId: material.id, kind: "FUNCTION" } };
const target = { kind: "OBJECT", id: id("d"), payload: { name: "sameName", materialId: material.id, kind: "FUNCTION" } };
const relation = { kind: "FACT", id: id("e"), payload: { kind: "RELATION", predicate: "calls", subjectId: source.id,
  targetId: target.id, evidenceIds: [id("f")], basis: "DERIVED", value: "NEVER_SEARCH_OR_PERSIST", ruleRef: { id: "javascript@1" } } };
const property = { kind: "FACT", id: id("1"), payload: { kind: "PROPERTY", subjectId: source.id, predicate: "name", value: "calls" } };
const filters = { query: "", predicate: "", source: "", target: "", path: "" };
const graph = { root: { kind: "FACT", id: relation.id }, depth: 2, limit: 40, truncated: false,
  nodes: [source, target, relation], edges: [{ factId: relation.id, subjectId: source.id, targetId: target.id, predicate: "calls", evidenceIds: [id("f")] }] };

test("F002 relations filter type direction and admitted endpoint paths without merging same-name objects", () => {
  assert.equal(typeof model.filterRelationFacts, "function", "relations need their own direction-aware filter, not the generic record table");
  const reverse = { ...relation, id: id("2"), payload: { ...relation.payload, subjectId: target.id, targetId: source.id } };
  const all = [relation, reverse, property], records = [source, target, material];
  assert.deepEqual(model.filterRelationFacts(all, { ...filters, predicate: "calls", source: source.id, target: target.id, path: "src/orders" }, records), [relation]);
  assert.deepEqual(model.filterRelationFacts(all, { ...filters, source: "sameName" }, records), [relation, reverse], "same name remains two independently identified candidates");
  assert.deepEqual(model.filterRelationFacts(all, { ...filters, source: source.id, target: source.id }, records), []);
  assert.deepEqual(model.filterRelationFacts(all, { ...filters, query: "NEVER_SEARCH_OR_PERSIST" }, records), [], "a sealed value or secret is not searchable metadata");
  assert.deepEqual(model.filterRelationFacts(all, { ...filters, path: "src/orders" }, []), [], "missing authorized endpoint/material context must not invent a path match");
  assert.equal(relation.payload.targetId, target.id);
});

test("F002 graph projection consumes the real flat edge contract and selects the same immutable relation Fact", () => {
  assert.equal(typeof model.projectEvidenceGraph, "function", "the API edge is {factId,subjectId,targetId}, not a fabricated FactRecord payload");
  const projected = model.projectEvidenceGraph(graph);
  assert.deepEqual(projected.nodes.map(node => node.id), [source.id, target.id]);
  assert.equal(projected.edges.length, 1);
  assert.equal(projected.edges[0].fact, relation, "graph and table must retain the exact same Fact identity and premises");
  assert.equal(projected.edges[0].subject, source); assert.equal(projected.edges[0].target, target);
  assert.deepEqual(projected.unavailableFactIds, []);
});

test("F002 truncated or mismatched graph evidence cannot draw a certain relation or substitute a same-name endpoint", () => {
  assert.equal(typeof model.projectEvidenceGraph, "function");
  const missing = model.projectEvidenceGraph({ ...graph, truncated: true, nodes: [source, relation] });
  assert.equal(missing.edges.length, 0); assert.deepEqual(missing.unavailableFactIds, [relation.id]);
  const corrupt = model.projectEvidenceGraph({ ...graph, edges: [{ ...graph.edges[0], targetId: source.id }] });
  assert.equal(corrupt.edges.length, 0, "a graph edge disagreeing with its Fact is not a proven relation");
  assert.deepEqual(corrupt.unavailableFactIds, [relation.id]);
  const absentFact = model.projectEvidenceGraph({ ...graph, nodes: [source, target] });
  assert.equal(absentFact.edges.length, 0, "a bare edge ID is not permission to invent a Fact or its premises");
});

test("F002 endpoint navigation retains the exact relation return row and graph root without replacing versions", () => {
  assert.equal(typeof model.relationEndpointLocation, "function");
  assert.equal(typeof model.evidenceRelationReturn, "function");
  const context = { workspaceId: "workspace", graphVersionId: version, sourceVersionId: id("3"), tab: "relations", kind: "FACT",
    recordId: relation.id, graphRootId: source.id, returnTo: { page: "graph", workspaceId: "workspace", objectId: "original-answer" } };
  const opened = model.relationEndpointLocation(context, relation, target.id, 123);
  assert.equal(opened.tab, "objects"); assert.equal(opened.recordId, target.id); assert.equal(opened.kind, "OBJECT");
  assert.equal(opened.graphVersionId, version); assert.equal(opened.sourceVersionId, context.sourceVersionId);
  assert.deepEqual(opened.relationReturn, { factId: relation.id, rootId: source.id, scrollTop: 123 });
  const encoded = model.evidenceHref({ ...opened, relationReturn: { ...opened.relationReturn, apiToken: "NEVER_SEARCH_OR_PERSIST" } });
  assert.equal(encoded.includes("NEVER_SEARCH_OR_PERSIST"), false);
  const restored = model.readEvidenceLocation(encoded.split("?")[1]);
  assert.deepEqual(restored.relationReturn, opened.relationReturn);
  const back = model.evidenceRelationReturn(restored);
  assert.equal(back.tab, "relations"); assert.equal(back.kind, "FACT"); assert.equal(back.recordId, relation.id);
  assert.equal(back.graphRootId, source.id); assert.equal(back.graphVersionId, version); assert.deepEqual(back.returnTo, context.returnTo);
  assert.throws(() => model.relationEndpointLocation(context, relation, id("4"), 123), /关系|端点|定位/);
  assert.throws(() => model.evidenceHref({ ...opened, relationReturn: { factId: "https://attacker.test", rootId: source.id, scrollTop: 1 } }), /关系|定位|返回/);
});

function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const metadata = { query: "orders", readingLine: 12, directoryScrollTop: 40, inspectorOpen: false, inspectorScrollTop: 10,
  relationFilters: { ...filters, predicate: "calls", source: source.id, path: "orders" }, relationScrollTop: 120,
  graphRootId: source.id, graphViewport: { zoom: 1.25, x: 20, y: -30 },
  gapFilters: { query: "", code: "UNSUPPORTED", origin: "F002", materialType: "JAVASCRIPT", status: "UNSUPPORTED" }, gapScrollTop: 80 };
const identity = { workspaceId: "workspace", actorId: "member", graphVersionId: version, recordId: relation.id, recordKind: "FACT", graphRootId: source.id, authorized: true };

test("F002 relation and Gap filters list positions and graph viewport survive only current member/version authorization", () => {
  const saved = storage(); model.rememberEvidenceView(saved, identity, { ...metadata, response: "NEVER_SEARCH_OR_PERSIST", apiToken: "NEVER_SEARCH_OR_PERSIST" });
  const restored = model.restoreEvidenceView(saved, identity);
  assert.deepEqual(restored.relationFilters, metadata.relationFilters, "relation filters must not be dropped by navigation metadata");
  assert.equal(restored.relationScrollTop, 120); assert.deepEqual(restored.graphViewport, metadata.graphViewport);
  assert.deepEqual(restored.gapFilters, metadata.gapFilters); assert.equal(restored.gapScrollTop, 80);
  assert.equal([...saved.values.values()].some(value => value.includes("NEVER_SEARCH_OR_PERSIST")), false);
  const otherRoot = model.restoreEvidenceView(saved, { ...identity, graphRootId: target.id });
  assert.deepEqual(otherRoot.graphViewport, { zoom: 1, x: 0, y: 0 }, "another root cannot inherit this root's exploration coordinates");
  assert.deepEqual(model.restoreEvidenceView(saved, { ...identity, actorId: "other-member" }).relationFilters, filters);
  const unavailable = { getItem: () => { throw new Error("forbidden storage read"); } };
  assert.deepEqual(model.restoreEvidenceView(unavailable, { ...identity, authorized: false }).graphViewport, { zoom: 1, x: 0, y: 0 });
});

test("F002 traversal metadata rejects corrupt filters or unbounded viewport instead of discarding them silently", () => {
  const saved = storage();
  assert.throws(() => model.rememberEvidenceView(saved, identity, { ...metadata, graphViewport: { zoom: Infinity, x: 0, y: 0 } }), /图|元数据|边界/);
  assert.throws(() => model.rememberEvidenceView(saved, identity, { ...metadata, graphViewport: { zoom: 1, x: 100001, y: 0 } }), /图|元数据|边界/);
  assert.throws(() => model.rememberEvidenceView(saved, identity, { ...metadata, relationFilters: { ...filters, predicate: "x".repeat(513) } }), /筛选|元数据|边界/);
  assert.throws(() => model.rememberEvidenceView(saved, identity, { ...metadata, gapFilters: { ...metadata.gapFilters, origin: "GUESSED" } }), /来源|筛选|元数据/);
});

test("F002 Gap filters separate F001 inheritance and F002 findings using actual material capability dispositions", () => {
  assert.equal(typeof model.filterEvidenceGaps, "function", "Gap filters must preserve cause, origin, material and actual status independently");
  const inherited = { kind: "GAP", id: id("4"), payload: { code: "UNSUPPORTED", origin: "F001", materialId: material.id } };
  const own = { kind: "GAP", id: id("5"), payload: { code: "UNSUPPORTED", origin: "F002", materialId: material.id, capability: "javascript" } };
  const coverage = { items: [{ materialId: material.id, capabilityId: "inventory", status: "DONE" }, { materialId: material.id, capabilityId: "javascript", status: "UNSUPPORTED" }] };
  const input = { query: "", code: "UNSUPPORTED", origin: "F002", materialType: "JAVASCRIPT", status: "UNSUPPORTED" };
  assert.deepEqual(model.filterEvidenceGaps([inherited, own], input, [material], coverage), [own]);
  assert.deepEqual(model.filterEvidenceGaps([own], { ...input, status: "DONE" }, [material], coverage), [], "another capability's DONE cannot relabel this Gap");
  assert.deepEqual(model.filterEvidenceGaps([own], input, [material], null), [], "missing coverage is unknown, not an inferred status");
  assert.deepEqual(model.filterEvidenceGaps([inherited, own], { ...input, origin: "F001", status: "" }, [material], null), [inherited]);
});

test("F002 subcapability Gap status uses its durable work-item association, never the gap-index DONE counter", () => {
  assert.equal(typeof model.filterEvidenceGaps, "function");
  const gap = { kind: "GAP", id: id("6"), payload: { code: "EXPRESS_ROUTE_DYNAMIC", origin: "F002", materialId: material.id, capability: "express" } };
  const coverage = { items: [{ materialId: material.id, capabilityId: "gaps", status: "DONE", gapIds: [gap.id] },
    { materialId: material.id, capabilityId: "javascript", status: "DONE", gapIds: [gap.id] }] };
  const input = { query: "", code: "", origin: "F002", materialType: "JAVASCRIPT", status: "DONE" };
  assert.deepEqual(model.filterEvidenceGaps([gap], input, [material], coverage), [gap], "the actual JavaScript work item carries the Express Gap even though express is not its capabilityId");
  assert.deepEqual(model.filterEvidenceGaps([gap], input, [material], { items: [coverage.items[0]] }), [], "the gap indexing task finishing cannot invent a source extraction status");
});

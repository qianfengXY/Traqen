import assert from "node:assert/strict";
import test from "node:test";
import { loadTechnicalContext } from "../src/business-knowledge/technical-context.js";

const records = [
  { kind: "MATERIAL", id: "m", payload: { materialId: "m", componentId: "component", pathBytes: "b3JkZXJzLnRz", contentDigest: "a".repeat(64), displayPath: "orders.ts" } },
  { kind: "OBJECT", id: "call", payload: { objectId: "call", kind: "CALL", name: "validateOrder(id)", materialId: "m", anchor: { kind: "TEXT", lineStart: 2, lineEnd: 2 } } },
  { kind: "OBJECT", id: "target", payload: { objectId: "target", kind: "FUNCTION", name: "validateOrder", materialId: "m", anchor: { kind: "TEXT", lineStart: 1, lineEnd: 1 } } },
  { kind: "EVIDENCE", id: "e", payload: { evidenceId: "e", materialId: "m", contentDigest: "a".repeat(64), anchor: { kind: "TEXT", lineStart: 2, lineEnd: 2 } } },
  { kind: "FACT", id: "premise", payload: { factId: "premise", predicate: "declaration", subjectId: "target", evidenceIds: ["e"], premiseFactIds: [], ruleRef: { id: "rule-v1" }, basis: "DECLARED" } },
  { kind: "FACT", id: "root", payload: { factId: "root", predicate: "callsDeclaration", subjectId: "call", targetId: "target", evidenceIds: ["e"], premiseFactIds: ["premise"], ruleRef: { id: "rule-v1" }, basis: "DERIVED" } },
];
function tx(rows, calls = []) {
  return { async query(_sql, parameters) {
    calls.push(parameters);
    const [w, v, ...selections] = parameters;
    assert.equal(w, "w"); assert.equal(v, "v");
    const ids = new Set(selections.filter(Array.isArray).flat());
    return { rows: rows.filter(r => ids.has(r.id)).map(r => structuredClone(r)) };
  } };
}
const input = extra => ({ workspaceId: "w", bundleId: "b", snapshots: [{ versionId: "v", allowedFactIds: ["root", "premise"], allowedMaterialIds: ["m"] }],
  limit: 10, maxBytes: 32768, ...extra });

test("F003 technical input retains names, source anchors, original Fact payloads and recursive premises in the adopted version", async () => {
  const result = await loadTechnicalContext(tx(records), input());
  assert.equal(result.objects.find(o => o.objectId === "target").name, "validateOrder");
  assert.deepEqual(result.records.find(r => r.id === "root").record, records.find(r => r.id === "root").payload);
  assert.ok(result.records.some(r => r.id === "premise"));
  assert.equal(result.evidence[0].evidenceId, "e");
  assert.equal(result.evidence[0].anchor.lineStart, 2);
  assert.equal(result.materials[0].sourceMaterial.bundleId, "b");
  assert.equal(result.materials[0].sourceMaterial.componentId, "component");
  assert.equal(result.truncated, false);
  assert.ok(result.allowedFactIds.includes("root"));
});

test("F003 missing and out-of-scope technical context stays unknown rather than exposing or authorizing an orphan relation", async () => {
  const result = await loadTechnicalContext(tx(records.filter(r => r.id !== "target")), input());
  assert.equal(result.allowedFactIds.includes("root"), false);
  assert.equal(result.records.some(r => r.id === "root"), false);
  assert.ok(result.unresolved.some(r => r.factId === "root" && r.status === "UNKNOWN"));
  const scoped = await loadTechnicalContext(tx(records.map(r => r.id === "target" ? { ...r, payload: { ...r.payload, materialId: "foreign" } } : r)), input());
  assert.equal(scoped.objects.some(o => o.objectId === "target"), false);
  assert.equal(scoped.allowedFactIds.includes("root"), false);
});

test("F003 technical context is byte bounded and never silently truncates the dependencies of a retained relation", async () => {
  const result = await loadTechnicalContext(tx(records), input({ maxBytes: 1024 }));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  assert.equal(result.truncated, true);
  assert.equal(result.allowedFactIds.includes("root"), false);
  assert.ok(result.limitations.some(l => l.code === "CONTEXT_BYTE_LIMIT"));
});

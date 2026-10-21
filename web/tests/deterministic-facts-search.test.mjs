import assert from "node:assert/strict";
import test from "node:test";
import * as model from "../app/deterministic-facts/model.ts";
import * as search from "../app/deterministic-facts/search.ts";

const version = "a".repeat(64);
const material = (id, kind, displayPath) => ({ kind: "MATERIAL", id, payload: { kind, displayPath, contentAvailable: true } });
const first = material("b".repeat(64), "JAVASCRIPT", "services/orders/routes.js");
const second = material("b".repeat(12) + "c".repeat(52), "MARKDOWN", "docs/orders.md");
const coverage = { scopeId: "s", declaredCapabilities: ["inventory", "javascript"], counts: {}, items: [
  { materialId: first.id, capabilityId: "inventory", status: "DONE", recordIds: [], gapIds: [] },
  { materialId: first.id, capabilityId: "javascript", status: "PARSE_FAILED", recordIds: [], gapIds: ["gap"] },
  { materialId: second.id, capabilityId: "inventory", status: "DONE", recordIds: [], gapIds: [] },
] };
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
};

test("F002 match descriptions translate every metadata field without leaking internal keys", () => {
  assert.equal(typeof search.evidenceMatchDescription, "function", "directory and record tables need the same readable presentation contract");
  assert.equal(search.evidenceMatchDescription([]), "");
  assert.equal(search.evidenceMatchDescription(["name", "id", "predicate", "type", "basis", "code"]),
    "命中：名称／符号、完整编号、谓词、登记类型、依据类别、限制原因");
});

test("F002 record search explains path symbol and ID hits without choosing an ambiguous short ID", () => {
  assert.equal(typeof model.matchEvidenceRecords, "function", "visible search needs a shared, metadata-only match result");
  const symbol = { kind: "OBJECT", id: "d".repeat(64), payload: { name: "CancelOrder", materialId: first.id, value: "HIDDEN_SOURCE_BYTES" } };
  const records = [first, second, symbol];
  assert.deepEqual(model.matchEvidenceRecords(records, "services/orders").map(hit => [hit.record.id, hit.fields]), [[first.id, ["path"]]]);
  assert.deepEqual(model.matchEvidenceRecords(records, "cancelorder").map(hit => [hit.record.id, hit.fields]), [[symbol.id, ["name"]]]);
  assert.deepEqual(model.matchEvidenceRecords(records, "b".repeat(12)).map(hit => hit.record.id), [first.id, second.id], "short-ID ambiguity must remain a choice, not an automatic merge");
  assert.deepEqual(model.matchEvidenceRecords(records, "HIDDEN_SOURCE_BYTES"), [], "search must not serialize or inspect arbitrary source/value payloads");
  assert.equal(model.matchEvidenceRecords(records, "")[0].record, first, "matching does not rewrite sealed record identities");
});

test("F002 material filters use declared type and actual per-capability dispositions, not Fact counts", () => {
  assert.equal(typeof model.filterEvidenceMaterials, "function", "directory type/status filters must be executable, not labels only");
  const records = [first, second];
  assert.deepEqual(model.filterEvidenceMaterials(records, { query: "orders", materialType: "JAVASCRIPT", processingStatus: "PARSE_FAILED" }, coverage).map(hit => hit.record.id), [first.id]);
  assert.deepEqual(model.filterEvidenceMaterials(records, { query: "", materialType: "", processingStatus: "DONE" }, coverage).map(hit => hit.record.id), [first.id, second.id], "mixed-capability material remains visible for each actual disposition; DONE is not a whole-material completeness claim");
  assert.deepEqual(model.filterEvidenceMaterials(records, { query: "", materialType: "MARKDOWN", processingStatus: "PARSE_FAILED" }, coverage), []);
  assert.equal(second.payload.contentAvailable, true);
  assert.equal(coverage.items[2].recordIds.length, 0, "no extracted Fact must not become UNPROCESSED or hide an approved material");
});

test("F002 missing coverage cannot invent a processing status or silently clear a selected filter", () => {
  assert.equal(typeof model.filterEvidenceMaterials, "function");
  const records = [first, second];
  const filters = { query: "orders", materialType: "", processingStatus: "DONE" };
  assert.deepEqual(model.filterEvidenceMaterials(records, filters, null), []);
  assert.deepEqual(model.filterEvidenceMaterials(records, filters, { ...coverage, items: [] }), []);
  assert.deepEqual(model.filterEvidenceMaterials(records, { ...filters, processingStatus: "" }, null).map(hit => hit.record.id), [first.id, second.id]);
  assert.equal(filters.processingStatus, "DONE", "unknown data is not authority to replace user input");
});

test("F002 directory filters survive refresh only after exact member version authorization", () => {
  const saved = storage(), context = { workspaceId: "w", actorId: "member-1", graphVersionId: version, authorized: true };
  const metadata = { query: "orders", materialType: "JAVASCRIPT", processingStatus: "PARSE_FAILED", directoryScrollTop: 50, readingLine: 12 };
  model.rememberEvidenceView(saved, context, { ...metadata, apiToken: "NEVER_STORE", coverage, displayBytes: "NEVER_STORE" });
  const restored = model.restoreEvidenceView(saved, context);
  assert.equal(restored.materialType, metadata.materialType, "type selection must be retained independently of the text query");
  assert.equal(restored.processingStatus, metadata.processingStatus);
  assert.equal([...saved.values.values()].some(value => value.includes("NEVER_STORE") || value.includes("gapIds")), false);
  assert.equal(model.restoreEvidenceView(saved, { ...context, actorId: "member-2" }).materialType, "");
  assert.equal(model.restoreEvidenceView(saved, { ...context, graphVersionId: "c".repeat(64) }).processingStatus, "");
  assert.equal(model.restoreEvidenceView({ getItem: () => { throw new Error("unauthorized storage read"); } }, { ...context, authorized: false }).processingStatus, "");
});

test("F002 corrupt filter metadata is rejected while older safe view records remain readable", () => {
  const saved = storage(), context = { workspaceId: "w", actorId: "member-1", graphVersionId: version, authorized: true };
  const metadata = { query: "orders", materialType: "JAVASCRIPT", processingStatus: "DONE", directoryScrollTop: 50, readingLine: 12 };
  assert.throws(() => model.rememberEvidenceView(saved, context, { ...metadata, processingStatus: "COMPLETE_UNDERSTANDING" }), /筛选|filter|元数据/i);
  assert.throws(() => model.rememberEvidenceView(saved, context, { ...metadata, materialType: "arbitrary source content" }), /筛选|filter|元数据/i);
  model.rememberEvidenceView(saved, context, metadata);
  const key = [...saved.values.keys()][0];
  saved.setItem(key, JSON.stringify({ schemaVersion: 1, query: "legacy", directoryScrollTop: 40, readingLine: 10, recordId: null }));
  const legacy = model.restoreEvidenceView(saved, context);
  assert.equal(legacy.query, "legacy");
  assert.equal(legacy.materialType, ""); assert.equal(legacy.processingStatus, "");
  saved.setItem(key, JSON.stringify({ schemaVersion: 1, ...metadata, processingStatus: "COMPLETE_UNDERSTANDING" }));
  assert.throws(() => model.restoreEvidenceView(saved, context), /筛选|filter|元数据/i, "a corrupt saved selection cannot silently become an all-material view");
});

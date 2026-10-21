import assert from "node:assert/strict";
import test from "node:test";
import { rememberEvidenceView, restoreEvidenceView } from "../app/deterministic-facts/model.ts";

const version = "a".repeat(64), recordId = "b".repeat(64);
const context = { workspaceId: "w", actorId: "member-1", graphVersionId: version, recordId, recordKind: "FACT", authorized: true };
const metadata = { query: "orders", materialType: "JAVASCRIPT", processingStatus: "DONE", directoryScrollTop: 80, readingLine: 401,
  inspectorOpen: false, inspectorScrollTop: 140 };
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

test("F002 Inspector close reopen metadata retains fixed reading and filters without retaining record content", () => {
  const saved = storage();
  rememberEvidenceView(saved, context, { ...metadata, recordPayload: "NEVER_STORE_DETAIL", apiToken: "NEVER_STORE_DETAIL" });
  const restored = restoreEvidenceView(saved, context);
  assert.equal(restored.inspectorOpen, false, "the user's manual panel choice must survive an authorized refresh");
  assert.equal(restored.inspectorScrollTop, 140);
  assert.equal(restored.readingLine, 401); assert.equal(restored.directoryScrollTop, 80);
  assert.equal(restored.query, "orders"); assert.equal(restored.materialType, "JAVASCRIPT"); assert.equal(restored.processingStatus, "DONE");
  assert.equal([...saved.values.values()].some(value => value.includes("NEVER_STORE_DETAIL")), false);
  rememberEvidenceView(saved, context, { ...restored, inspectorOpen: true });
  assert.equal(restoreEvidenceView(saved, context).inspectorScrollTop, 140, "reopening cannot reset the saved position or select another record");
});

test("F002 Inspector scroll restoration is bound to record kind ID member version and current access", () => {
  const saved = storage(); rememberEvidenceView(saved, context, metadata);
  assert.equal(restoreEvidenceView(saved, context).inspectorScrollTop, 140);
  const otherRecord = restoreEvidenceView(saved, { ...context, recordId: "c".repeat(64) });
  assert.equal(otherRecord.inspectorScrollTop, 0); assert.equal(otherRecord.readingLine, 1);
  assert.equal(otherRecord.inspectorOpen, false, "a different record retains the deliberate panel preference but not the previous record's position");
  const otherKind = restoreEvidenceView(saved, { ...context, recordKind: "OBJECT" });
  assert.equal(otherKind.inspectorScrollTop, 0); assert.equal(otherKind.readingLine, 1, "a kind switch cannot inherit another kind's physical anchor even for an equal ID");
  assert.equal(restoreEvidenceView(saved, { ...context, actorId: "member-2" }).inspectorOpen, true);
  assert.equal(restoreEvidenceView(saved, { ...context, graphVersionId: "d".repeat(64) }).inspectorScrollTop, 0);
  assert.equal(restoreEvidenceView({ getItem: () => { throw new Error("unauthorized storage read"); } }, { ...context, authorized: false }).inspectorOpen, true);
});

test("F002 Inspector preferences reject corrupt values and migrate older safe metadata without guessing positions", () => {
  const saved = storage();
  assert.throws(() => rememberEvidenceView(saved, context, { ...metadata, inspectorOpen: "false" }), /面板|元数据|恢复/i);
  assert.throws(() => rememberEvidenceView(saved, context, { ...metadata, inspectorScrollTop: Infinity }), /面板|元数据|恢复/i);
  assert.throws(() => rememberEvidenceView(saved, context, { ...metadata, inspectorScrollTop: 10_000_001 }), /面板|元数据|恢复/i);
  assert.throws(() => rememberEvidenceView(saved, { ...context, recordKind: "<invalid>" }, metadata), /类型|元数据|定位/i);
  rememberEvidenceView(saved, context, metadata);
  const key = [...saved.values.keys()][0];
  saved.setItem(key, JSON.stringify({ schemaVersion: 1, query: "legacy", directoryScrollTop: 20, readingLine: 8, recordId }));
  const legacy = restoreEvidenceView(saved, context);
  assert.equal(legacy.inspectorOpen, true); assert.equal(legacy.inspectorScrollTop, 0);
  assert.equal(legacy.readingLine, 1, "an old record lacking the kind binding is not enough to restore this typed record's line");
  assert.equal(legacy.query, "legacy");
});
